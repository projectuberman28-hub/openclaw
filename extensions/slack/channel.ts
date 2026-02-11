/**
 * @alfred/channel-slack - Slack channel extension for Alfred v3
 *
 * Connects to Slack via the Web API over HTTP.
 * Supports Socket Mode (WebSocket) or Events API for receiving messages.
 * Uses mrkdwn formatting, supports files, reactions, and threads.
 * Bot token + app-level token authentication.
 * Message queue with exponential backoff retry.
 */

import type {
  Attachment,
  ChannelMessage,
} from '@alfred/core';

// ---------------------------------------------------------------------------
// Channel interfaces (AlfredChannel contract)
// ---------------------------------------------------------------------------

type ChannelStatus = 'connected' | 'disconnected' | 'error' | 'initializing';

interface ChannelCapabilities {
  text: boolean;
  images: boolean;
  audio: boolean;
  video: boolean;
  files: boolean;
  reactions: boolean;
  threads: boolean;
  editing: boolean;
}

interface SendOptions {
  threadId?: string;
  replyTo?: string;
  attachments?: Attachment[];
  parseMode?: string;
}

interface AlfredChannel {
  name: string;
  displayName: string;
  initialize(config: any): Promise<void>;
  listen(callback: (message: ChannelMessage) => Promise<void>): void;
  send(to: string, message: string, options?: SendOptions): Promise<{ messageId?: string }>;
  getStatus(): ChannelStatus;
  shutdown(): Promise<void>;
  capabilities: ChannelCapabilities;
}

// ---------------------------------------------------------------------------
// Message Queue with exponential backoff retry
// ---------------------------------------------------------------------------

interface QueuedMessage {
  id: string;
  to: string;
  message: string;
  options?: SendOptions;
  sendFn: (to: string, message: string, options?: SendOptions) => Promise<{ messageId?: string }>;
  retries: number;
  maxRetries: number;
  nextRetryMs: number;
  resolve: (value: { messageId?: string }) => void;
  reject: (reason: Error) => void;
}

class MessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;

  private static INITIAL_BACKOFF_MS = 1000;
  private static MAX_BACKOFF_MS = 60000;
  private static MAX_RETRIES = 5;

  async enqueue(
    to: string,
    message: string,
    options: SendOptions | undefined,
    sendFn: (to: string, message: string, options?: SendOptions) => Promise<{ messageId?: string }>,
  ): Promise<{ messageId?: string }> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        to,
        message,
        options,
        sendFn,
        retries: 0,
        maxRetries: MessageQueue.MAX_RETRIES,
        nextRetryMs: MessageQueue.INITIAL_BACKOFF_MS,
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];
      try {
        const result = await item.sendFn(item.to, item.message, item.options);
        this.queue.shift();
        item.resolve(result);
      } catch (err) {
        item.retries++;
        if (item.retries >= item.maxRetries) {
          this.queue.shift();
          item.reject(
            new Error(`Send failed after ${item.maxRetries} retries: ${(err as Error).message}`),
          );
        } else {
          const delay = item.nextRetryMs;
          item.nextRetryMs = Math.min(item.nextRetryMs * 2, MessageQueue.MAX_BACKOFF_MS);
          await this.sleep(delay);
        }
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Slack constants
// ---------------------------------------------------------------------------

const SLACK_API_BASE = 'https://slack.com/api';

// ---------------------------------------------------------------------------
// Slack configuration
// ---------------------------------------------------------------------------

interface SlackConfig {
  /** Bot token (xoxb-...) */
  botToken: string;
  /** App-level token (xapp-...) for Socket Mode */
  appToken?: string;
  /** Receive mode: 'socket' (default) or 'events' */
  mode?: 'socket' | 'events';
  /** Channel IDs to listen on (empty = all) */
  allowedChannels?: string[];
}

// ---------------------------------------------------------------------------
// SlackChannel
// ---------------------------------------------------------------------------

export class SlackChannel implements AlfredChannel {
  readonly name = 'slack';
  readonly displayName = 'Slack';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: true,
    video: true,
    files: true,
    reactions: true,
    threads: true,
    editing: true,
  };

  private status: ChannelStatus = 'disconnected';
  private botToken = '';
  private appToken = '';
  private mode: 'socket' | 'events' = 'socket';
  private allowedChannels: Set<string> = new Set();
  private botUserId = '';
  private ws: WebSocket | null = null;
  private socketUrl: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: SlackConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.botToken) {
      this.status = 'error';
      throw new Error('SlackChannel: "botToken" is required in config');
    }

    this.botToken = config.botToken;
    this.appToken = config.appToken ?? '';
    this.mode = config.mode ?? 'socket';

    if (config.allowedChannels) {
      this.allowedChannels = new Set(config.allowedChannels);
    }

    if (this.mode === 'socket' && !this.appToken) {
      this.status = 'error';
      throw new Error('SlackChannel: "appToken" is required for Socket Mode');
    }

    // Validate bot token
    try {
      const res = await this.slackApi('auth.test', {});
      if (!res.ok) throw new Error(res.error ?? 'auth.test failed');
      this.botUserId = res.user_id ?? '';
      this.status = 'connected';
    } catch (err) {
      this.status = 'error';
      throw new Error(`SlackChannel: token validation failed: ${(err as Error).message}`);
    }
  }

  listen(callback: (message: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;

    if (this.mode === 'socket') {
      this.connectSocketMode();
    }
    // In events mode, the host application calls processEvent() directly
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.stopPing();
    if (this.ws) {
      this.ws.close(1000, 'Shutting down');
      this.ws = null;
    }
    this.messageCallback = null;
    this.status = 'disconnected';
  }

  // -----------------------------------------------------------------------
  // Events API support: process incoming event from HTTP handler
  // -----------------------------------------------------------------------

  async processEvent(event: SlackEventPayload): Promise<void> {
    // URL verification challenge
    if (event.type === 'url_verification') {
      return; // The HTTP handler should return { challenge: event.challenge }
    }

    if (event.type === 'event_callback' && event.event) {
      await this.handleSlackEvent(event.event);
    }
  }

  // -----------------------------------------------------------------------
  // Sending
  // -----------------------------------------------------------------------

  async send(
    to: string,
    message: string,
    options?: SendOptions,
  ): Promise<{ messageId?: string }> {
    return this.messageQueue.enqueue(to, message, options, this.doSend.bind(this));
  }

  private async doSend(
    to: string,
    message: string,
    options?: SendOptions,
  ): Promise<{ messageId?: string }> {
    // Handle file uploads first
    if (options?.attachments && options.attachments.length > 0) {
      return this.sendWithFiles(to, message, options);
    }

    const params: Record<string, unknown> = {
      channel: to,
      text: message,
      mrkdwn: true,
    };

    // Thread support
    if (options?.threadId) {
      params.thread_ts = options.threadId;
    }

    const res = await this.slackApi('chat.postMessage', params);
    if (!res.ok) {
      throw new Error(`Slack chat.postMessage failed: ${res.error ?? 'unknown error'}`);
    }

    return { messageId: res.ts };
  }

  private async sendWithFiles(
    to: string,
    message: string,
    options: SendOptions,
  ): Promise<{ messageId?: string }> {
    // Slack v2 file uploads: files.uploadV2
    // Step 1: Get upload URLs for each file
    const fileUploads: Array<{ id: string; upload_url: string; att: Attachment }> = [];

    for (const att of options.attachments ?? []) {
      const data = att.data ? atob(att.data) : '';
      const sizeBytes = att.size ?? data.length;

      const urlRes = await this.slackApi('files.getUploadURLExternal', {
        filename: att.filename,
        length: sizeBytes,
      });

      if (!urlRes.ok) {
        throw new Error(`Slack file URL request failed: ${urlRes.error}`);
      }

      fileUploads.push({
        id: urlRes.file_id,
        upload_url: urlRes.upload_url,
        att,
      });
    }

    // Step 2: Upload file data to each URL
    for (const fu of fileUploads) {
      const data = fu.att.data ? atob(fu.att.data) : '';
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i);
      }

      await fetch(fu.upload_url, {
        method: 'POST',
        headers: { 'Content-Type': fu.att.mimeType },
        body: bytes,
      });
    }

    // Step 3: Complete the uploads and share to channel
    const files = fileUploads.map((fu) => ({
      id: fu.id,
      title: fu.att.filename,
    }));

    const completeParams: Record<string, unknown> = {
      files,
      channel_id: to,
      initial_comment: message,
    };

    if (options.threadId) {
      completeParams.thread_ts = options.threadId;
    }

    const completeRes = await this.slackApi(
      'files.completeUploadExternal',
      completeParams,
    );

    if (!completeRes.ok) {
      throw new Error(`Slack file upload completion failed: ${completeRes.error}`);
    }

    return { messageId: completeRes.files?.[0]?.id };
  }

  // -----------------------------------------------------------------------
  // Editing & Reactions
  // -----------------------------------------------------------------------

  async editMessage(
    channel: string,
    messageTs: string,
    newText: string,
  ): Promise<void> {
    const res = await this.slackApi('chat.update', {
      channel,
      ts: messageTs,
      text: newText,
      mrkdwn: true,
    });

    if (!res.ok) {
      throw new Error(`Slack chat.update failed: ${res.error}`);
    }
  }

  async addReaction(
    channel: string,
    messageTs: string,
    emoji: string,
  ): Promise<void> {
    // Strip colons from emoji name
    const name = emoji.replace(/:/g, '');
    const res = await this.slackApi('reactions.add', {
      channel,
      timestamp: messageTs,
      name,
    });

    if (!res.ok && res.error !== 'already_reacted') {
      throw new Error(`Slack reactions.add failed: ${res.error}`);
    }
  }

  // -----------------------------------------------------------------------
  // Socket Mode
  // -----------------------------------------------------------------------

  private async connectSocketMode(): Promise<void> {
    try {
      // Get a WebSocket URL
      const res = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const json = (await res.json()) as SlackApiResponse;
      if (!json.ok || !json.url) {
        throw new Error(json.error ?? 'apps.connections.open failed');
      }

      this.socketUrl = json.url;
    } catch (err) {
      this.status = 'error';
      this.scheduleReconnect();
      return;
    }

    try {
      this.ws = new WebSocket(this.socketUrl!);
    } catch {
      this.status = 'error';
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.status = 'connected';
      this.startPing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleSocketMessage(event.data as string);
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.status = 'disconnected';
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // handled in onclose
    };
  }

  private handleSocketMessage(raw: string): void {
    let payload: SocketModePayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    // Acknowledge the envelope
    if (payload.envelope_id) {
      this.sendSocket({ envelope_id: payload.envelope_id });
    }

    // Handle hello
    if (payload.type === 'hello') {
      return;
    }

    // Handle disconnect
    if (payload.type === 'disconnect') {
      this.ws?.close(1000, 'Server requested disconnect');
      return;
    }

    // Handle events
    if (payload.type === 'events_api' && payload.payload?.event) {
      this.handleSlackEvent(payload.payload.event);
    }

    // Handle slash commands
    if (payload.type === 'slash_commands' && payload.payload) {
      this.handleSlashCommand(payload.payload);
    }
  }

  private async handleSlackEvent(event: SlackEvent): Promise<void> {
    if (!this.messageCallback) return;

    // Ignore bot messages (including our own)
    if (event.bot_id || event.user === this.botUserId) return;

    // Only process message events
    if (event.type !== 'message' && event.type !== 'app_mention') return;

    // Ignore subtypes that are not actual user messages
    if (event.subtype && event.subtype !== 'file_share' && event.subtype !== 'thread_broadcast') return;

    // Check allowed channels
    if (this.allowedChannels.size > 0 && !this.allowedChannels.has(event.channel ?? '')) return;

    const attachments: Attachment[] = (event.files ?? []).map((f) => ({
      filename: f.name ?? f.title ?? 'file',
      mimeType: f.mimetype ?? 'application/octet-stream',
      url: f.url_private ?? f.permalink,
      size: f.size,
    }));

    const msg: ChannelMessage = {
      channel: this.name,
      sender: event.user ?? 'unknown',
      content: event.text ?? '',
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        channelId: event.channel,
        teamId: event.team,
        ts: event.ts,
        eventType: event.type,
        channelType: event.channel_type,
      },
      threadId: event.thread_ts,
      replyTo: event.thread_ts !== event.ts ? event.thread_ts : undefined,
      timestamp: new Date(parseFloat(event.ts ?? '0') * 1000),
    };

    try {
      await this.messageCallback(msg);
    } catch {
      // Callback errors should not crash event processing
    }
  }

  private handleSlashCommand(payload: Record<string, unknown>): void {
    if (!this.messageCallback) return;

    const msg: ChannelMessage = {
      channel: this.name,
      sender: (payload.user_id as string) ?? 'unknown',
      content: `${payload.command as string} ${(payload.text as string) ?? ''}`.trim(),
      metadata: {
        isSlashCommand: true,
        command: payload.command,
        channelId: payload.channel_id,
        triggerId: payload.trigger_id,
        responseUrl: payload.response_url,
      },
      timestamp: new Date(),
    };

    this.messageCallback(msg).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Socket helpers
  // -----------------------------------------------------------------------

  private sendSocket(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendSocket({ type: 'ping' });
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.status = 'error';
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 60000);
    this.reconnectAttempts++;

    setTimeout(() => {
      if (this.status !== 'error') {
        this.connectSocketMode();
      }
    }, delay);
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async slackApi(
    method: string,
    params: Record<string, unknown>,
  ): Promise<SlackApiResponse> {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
    });

    const json = (await res.json()) as SlackApiResponse;
    return json;
  }
}

// ---------------------------------------------------------------------------
// Slack API types
// ---------------------------------------------------------------------------

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  user_id?: string;
  url?: string;
  file_id?: string;
  upload_url?: string;
  files?: Array<{ id: string }>;
  [key: string]: unknown;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  event?: SlackEvent;
}

interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  team?: string;
  ts?: string;
  thread_ts?: string;
  files?: Array<{
    id: string;
    name?: string;
    title?: string;
    mimetype?: string;
    url_private?: string;
    permalink?: string;
    size?: number;
  }>;
}

interface SocketModePayload {
  type: string;
  envelope_id?: string;
  payload?: any;
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default SlackChannel;
