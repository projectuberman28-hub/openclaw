/**
 * @alfred/channel-discord - Discord channel extension for Alfred v3
 *
 * Lightweight fetch-based Discord integration (no discord.js dependency).
 * Connects to the Discord Gateway via WebSocket for real-time messages
 * and uses the REST API for sending messages, managing threads, and files.
 * Supports text, embeds, files, reactions, threads, and forum/media channels.
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
// Discord constants
// ---------------------------------------------------------------------------

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

const GatewayIntent = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;

// ---------------------------------------------------------------------------
// Discord configuration
// ---------------------------------------------------------------------------

interface DiscordConfig {
  /** Bot token for authentication */
  token: string;
  /** Gateway intents bitmask (default: guilds + messages + reactions + DMs + content) */
  intents?: number;
  /** Channel IDs to listen on (empty = all) */
  allowedChannels?: string[];
}

// ---------------------------------------------------------------------------
// DiscordChannel
// ---------------------------------------------------------------------------

export class DiscordChannel implements AlfredChannel {
  readonly name = 'discord';
  readonly displayName = 'Discord';
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
  private token = '';
  private intents = 0;
  private allowedChannels: Set<string> = new Set();
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private sequenceNumber: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private botUserId: string | null = null;
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: DiscordConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.token) {
      this.status = 'error';
      throw new Error('DiscordChannel: "token" is required in config');
    }

    this.token = config.token;
    this.intents =
      config.intents ??
      (GatewayIntent.GUILDS |
        GatewayIntent.GUILD_MESSAGES |
        GatewayIntent.GUILD_MESSAGE_REACTIONS |
        GatewayIntent.DIRECT_MESSAGES |
        GatewayIntent.MESSAGE_CONTENT);

    if (config.allowedChannels) {
      this.allowedChannels = new Set(config.allowedChannels);
    }

    // Validate token by fetching current bot user
    try {
      const res = await this.apiRequest('GET', '/users/@me');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const user = (await res.json()) as { id: string };
      this.botUserId = user.id;
      this.status = 'connected';
    } catch (err) {
      this.status = 'error';
      throw new Error(`DiscordChannel: token validation failed: ${(err as Error).message}`);
    }
  }

  listen(callback: (message: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
    this.connectGateway();
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Shutting down');
      this.ws = null;
    }
    this.messageCallback = null;
    this.status = 'disconnected';
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
    // Determine the channel ID for sending
    // `to` is a channel ID, or we use threadId to route into a thread
    const channelId = options?.threadId ?? to;

    const body: Record<string, unknown> = {
      content: message,
    };

    // Reply reference
    if (options?.replyTo) {
      body.message_reference = {
        message_id: options.replyTo,
      };
    }

    // Handle attachments with multipart form data
    if (options?.attachments && options.attachments.length > 0) {
      return this.sendWithAttachments(channelId, body, options.attachments);
    }

    const res = await this.apiRequest(
      'POST',
      `/channels/${channelId}/messages`,
      body,
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Discord send failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as { id?: string };
    return { messageId: json.id };
  }

  private async sendWithAttachments(
    channelId: string,
    jsonBody: Record<string, unknown>,
    attachments: Attachment[],
  ): Promise<{ messageId?: string }> {
    // Discord requires multipart form data for file uploads
    // Build a form body manually
    const boundary = `----AlfredBoundary${Date.now()}`;
    const parts: string[] = [];

    // JSON payload part
    jsonBody.attachments = attachments.map((att, i) => ({
      id: i,
      filename: att.filename,
      description: att.filename,
    }));

    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="payload_json"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      JSON.stringify(jsonBody) + `\r\n`,
    );

    // File parts (base64 data expected)
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const data = att.data ?? '';
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files[${i}]"; filename="${att.filename}"\r\n` +
        `Content-Type: ${att.mimeType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        data + `\r\n`,
      );
    }

    parts.push(`--${boundary}--\r\n`);
    const bodyStr = parts.join('');

    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyStr,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Discord file upload failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as { id?: string };
    return { messageId: json.id };
  }

  // -----------------------------------------------------------------------
  // Thread & Forum support
  // -----------------------------------------------------------------------

  /**
   * Create a thread in a forum or text channel and send a starter message.
   */
  async createThread(
    channelId: string,
    threadName: string,
    message: string,
    options?: { autoArchiveDuration?: number; appliedTags?: string[] },
  ): Promise<{ threadId: string; messageId?: string }> {
    const body: Record<string, unknown> = {
      name: threadName,
      auto_archive_duration: options?.autoArchiveDuration ?? 1440,
      message: {
        content: message,
      },
    };

    // Forum channels support applied_tags
    if (options?.appliedTags) {
      body.applied_tags = options.appliedTags;
    }

    const res = await this.apiRequest(
      'POST',
      `/channels/${channelId}/threads`,
      body,
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Discord thread creation failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as { id: string; last_message_id?: string };
    return {
      threadId: json.id,
      messageId: json.last_message_id,
    };
  }

  /**
   * Create a thread from an existing message (wire message thread create --message).
   */
  async createThreadFromMessage(
    channelId: string,
    messageId: string,
    threadName: string,
  ): Promise<{ threadId: string }> {
    const res = await this.apiRequest(
      'POST',
      `/channels/${channelId}/messages/${messageId}/threads`,
      { name: threadName, auto_archive_duration: 1440 },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Discord thread-from-message failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as { id: string };
    return { threadId: json.id };
  }

  // -----------------------------------------------------------------------
  // Gateway WebSocket
  // -----------------------------------------------------------------------

  private connectGateway(): void {
    const url = this.resumeGatewayUrl ?? DISCORD_GATEWAY_URL;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.status = 'error';
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleGatewayMessage(event.data as string);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();

      // Certain close codes mean we cannot reconnect
      const nonRecoverableCodes = [4004, 4010, 4011, 4012, 4013, 4014];
      if (nonRecoverableCodes.includes(event.code)) {
        this.status = 'error';
        return;
      }

      this.status = 'disconnected';
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Error fires before close, handled in onclose
    };
  }

  private handleGatewayMessage(raw: string): void {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.s !== null && payload.s !== undefined) {
      this.sequenceNumber = payload.s;
    }

    switch (payload.op) {
      case GatewayOpcode.HELLO:
        this.startHeartbeat(payload.d?.heartbeat_interval ?? 41250);
        if (this.sessionId && this.sequenceNumber !== null) {
          this.sendGateway({
            op: GatewayOpcode.RESUME,
            d: {
              token: this.token,
              session_id: this.sessionId,
              seq: this.sequenceNumber,
            },
          });
        } else {
          this.identify();
        }
        break;

      case GatewayOpcode.HEARTBEAT:
        this.sendHeartbeat();
        break;

      case GatewayOpcode.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;

      case GatewayOpcode.RECONNECT:
        this.ws?.close(4000, 'Reconnect requested');
        break;

      case GatewayOpcode.INVALID_SESSION:
        // d is boolean indicating if session is resumable
        if (!payload.d) {
          this.sessionId = null;
          this.sequenceNumber = null;
        }
        setTimeout(() => this.connectGateway(), 1000 + Math.random() * 4000);
        break;

      case GatewayOpcode.DISPATCH:
        this.handleDispatch(payload.t ?? '', payload.d);
        break;
    }
  }

  private handleDispatch(eventName: string, data: any): void {
    switch (eventName) {
      case 'READY':
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        this.botUserId = data.user?.id ?? this.botUserId;
        this.status = 'connected';
        break;

      case 'RESUMED':
        this.status = 'connected';
        break;

      case 'MESSAGE_CREATE':
        this.handleMessageCreate(data);
        break;

      case 'MESSAGE_REACTION_ADD':
        this.handleReactionAdd(data);
        break;
    }
  }

  private handleMessageCreate(data: DiscordMessageData): void {
    if (!this.messageCallback) return;

    // Ignore own messages
    if (data.author?.id === this.botUserId) return;

    // Harden routing: check allowed channels
    if (this.allowedChannels.size > 0 && !this.allowedChannels.has(data.channel_id)) return;

    const attachments: Attachment[] = (data.attachments ?? []).map((att) => ({
      filename: att.filename,
      mimeType: att.content_type ?? 'application/octet-stream',
      url: att.url,
      size: att.size,
    }));

    const msg: ChannelMessage = {
      channel: this.name,
      sender: data.author?.id ?? 'unknown',
      content: data.content ?? '',
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        channelId: data.channel_id,
        guildId: data.guild_id,
        messageId: data.id,
        username: data.author?.username,
        discriminator: data.author?.discriminator,
        isBot: data.author?.bot ?? false,
        embeds: data.embeds,
      },
      threadId: data.thread?.id,
      replyTo: data.message_reference?.message_id,
      timestamp: new Date(data.timestamp ?? Date.now()),
    };

    this.messageCallback(msg).catch(() => {});
  }

  private handleReactionAdd(data: DiscordReactionData): void {
    if (!this.messageCallback) return;
    if (data.user_id === this.botUserId) return;

    const msg: ChannelMessage = {
      channel: this.name,
      sender: data.user_id,
      content: `[reaction:${data.emoji?.name ?? '?'}]`,
      metadata: {
        isReaction: true,
        emoji: data.emoji,
        channelId: data.channel_id,
        guildId: data.guild_id,
        messageId: data.message_id,
      },
      timestamp: new Date(),
    };

    this.messageCallback(msg).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Gateway helpers
  // -----------------------------------------------------------------------

  private identify(): void {
    this.sendGateway({
      op: GatewayOpcode.IDENTIFY,
      d: {
        token: this.token,
        intents: this.intents,
        properties: {
          os: 'linux',
          browser: 'alfred',
          device: 'alfred',
        },
      },
    });
  }

  private sendGateway(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;

    // Send first heartbeat with jitter
    setTimeout(() => this.sendHeartbeat(), Math.random() * intervalMs);

    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        // Zombie connection, reconnect
        this.ws?.close(4000, 'Heartbeat timeout');
        return;
      }
      this.heartbeatAcked = false;
      this.sendHeartbeat();
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat(): void {
    this.sendGateway({
      op: GatewayOpcode.HEARTBEAT,
      d: this.sequenceNumber,
    });
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
        this.connectGateway();
      }
    }, delay);
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async apiRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
    };

    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return fetch(`${DISCORD_API_BASE}${path}`, init);
  }
}

// ---------------------------------------------------------------------------
// Discord API types
// ---------------------------------------------------------------------------

interface GatewayPayload {
  op: number;
  d: any;
  s: number | null;
  t: string | null;
}

interface DiscordMessageData {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: {
    id: string;
    username?: string;
    discriminator?: string;
    bot?: boolean;
  };
  content?: string;
  timestamp?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    content_type?: string;
    url: string;
    size?: number;
  }>;
  embeds?: unknown[];
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
  thread?: {
    id: string;
  };
}

interface DiscordReactionData {
  user_id: string;
  channel_id: string;
  guild_id?: string;
  message_id: string;
  emoji?: {
    id?: string;
    name?: string;
    animated?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default DiscordChannel;
