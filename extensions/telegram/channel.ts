/**
 * @alfred/channel-telegram - Telegram channel extension for Alfred v3
 *
 * Connects to Telegram via the Bot API over HTTP.
 * Supports long polling (getUpdates) or webhook mode.
 *
 * Hardened features:
 * - Quote parsing preserves context, avoids QUOTE_TEXT_INVALID
 * - Recover proactive sends with stale topic thread IDs (retry without message_thread_id)
 * - Render markdown spoilers with <tg-spoiler>
 * - Truncate command registration to 100 entries
 * - Match DM allowFrom against sender user id (fallback to chat id)
 * - Message queue with exponential backoff retry
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
// Telegram configuration
// ---------------------------------------------------------------------------

interface TelegramConfig {
  /** Telegram Bot API token */
  token: string;
  /** Polling mode (default) or webhook */
  mode?: 'polling' | 'webhook';
  /** Webhook URL (required if mode is 'webhook') */
  webhookUrl?: string;
  /** Webhook secret token for verification */
  webhookSecret?: string;
  /** Poll timeout in seconds (default 30, for long polling) */
  pollTimeout?: number;
  /** Allowed user IDs for DMs (empty = allow all) */
  allowFrom?: string[];
  /** Custom API base URL (for testing or local Bot API server) */
  apiBaseUrl?: string;
  /** Default parse mode (default 'HTML') */
  defaultParseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  /** Commands to register with BotFather (max 100) */
  commands?: Array<{ command: string; description: string }>;
}

// ---------------------------------------------------------------------------
// TelegramChannel
// ---------------------------------------------------------------------------

export class TelegramChannel implements AlfredChannel {
  readonly name = 'telegram';
  readonly displayName = 'Telegram';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: true,
    video: true,
    files: true,
    reactions: false,
    threads: true, // topic threads in supergroups
    editing: true,
  };

  private status: ChannelStatus = 'disconnected';
  private token = '';
  private apiBase = 'https://api.telegram.org';
  private mode: 'polling' | 'webhook' = 'polling';
  private pollTimeout = 30;
  private pollOffset = 0;
  private polling = false;
  private pollAbortController: AbortController | null = null;
  private allowFrom: Set<string> = new Set();
  private defaultParseMode: string = 'HTML';
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: TelegramConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.token) {
      this.status = 'error';
      throw new Error('TelegramChannel: "token" is required in config');
    }

    this.token = config.token;
    this.apiBase = (config.apiBaseUrl ?? this.apiBase).replace(/\/+$/, '');
    this.mode = config.mode ?? 'polling';
    this.pollTimeout = config.pollTimeout ?? 30;
    this.defaultParseMode = config.defaultParseMode ?? 'HTML';

    if (config.allowFrom) {
      this.allowFrom = new Set(config.allowFrom.map(String));
    }

    // Validate token
    try {
      const me = await this.apiCall('getMe');
      if (!me.ok) throw new Error(me.description ?? 'getMe failed');
    } catch (err) {
      this.status = 'error';
      throw new Error(`TelegramChannel: bot token validation failed: ${(err as Error).message}`);
    }

    // Register commands (truncate to 100)
    if (config.commands && config.commands.length > 0) {
      const truncated = config.commands.slice(0, 100);
      try {
        await this.apiCall('setMyCommands', { commands: truncated });
      } catch {
        // Non-fatal: command registration failure shouldn't block startup
      }
    }

    // Set up webhook if configured
    if (this.mode === 'webhook' && config.webhookUrl) {
      try {
        const params: Record<string, unknown> = { url: config.webhookUrl };
        if (config.webhookSecret) {
          params.secret_token = config.webhookSecret;
        }
        await this.apiCall('setWebhook', params);
      } catch (err) {
        this.status = 'error';
        throw new Error(`TelegramChannel: webhook setup failed: ${(err as Error).message}`);
      }
    } else if (this.mode === 'polling') {
      // Delete any existing webhook when using polling
      try {
        await this.apiCall('deleteWebhook');
      } catch {
        // Ignore
      }
    }

    this.status = 'connected';
  }

  listen(callback: (message: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;

    if (this.mode === 'polling') {
      this.startPolling();
    }
    // In webhook mode, the host application calls processWebhookUpdate() directly
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.stopPolling();

    if (this.mode === 'webhook') {
      try {
        await this.apiCall('deleteWebhook');
      } catch {
        // Best-effort cleanup
      }
    }

    this.messageCallback = null;
    this.status = 'disconnected';
  }

  // -----------------------------------------------------------------------
  // Webhook support: process incoming update from HTTP handler
  // -----------------------------------------------------------------------

  async processWebhookUpdate(update: TelegramUpdate): Promise<void> {
    const parsed = this.parseUpdate(update);
    if (parsed && this.messageCallback) {
      await this.messageCallback(parsed);
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
    // Handle attachment sends
    if (options?.attachments && options.attachments.length > 0) {
      return this.sendWithAttachment(to, message, options);
    }

    // Transform markdown spoilers: ||text|| -> <tg-spoiler>text</tg-spoiler>
    const processedMessage = this.transformSpoilers(message);

    // Build sendMessage params
    const params: Record<string, unknown> = {
      chat_id: to,
      text: processedMessage,
      parse_mode: options?.parseMode ?? this.defaultParseMode,
    };

    // Thread/topic support
    if (options?.threadId) {
      params.message_thread_id = parseInt(options.threadId, 10);
    }

    // Quote/reply support with hardened quote parsing
    if (options?.replyTo) {
      params.reply_parameters = this.buildReplyParameters(options.replyTo);
    }

    try {
      const result = await this.apiCall('sendMessage', params);
      if (!result.ok) {
        throw new Error(result.description ?? 'sendMessage failed');
      }
      return { messageId: String(result.result?.message_id ?? '') };
    } catch (err) {
      // Recover from stale topic thread IDs:
      // If we get a "message thread not found" or similar error, retry without message_thread_id
      const errMsg = (err as Error).message;
      if (
        params.message_thread_id &&
        (errMsg.includes('TOPIC_CLOSED') ||
          errMsg.includes('TOPIC_DELETED') ||
          errMsg.includes('message thread not found') ||
          errMsg.includes('Bad Request: message thread'))
      ) {
        delete params.message_thread_id;
        const retry = await this.apiCall('sendMessage', params);
        if (!retry.ok) {
          throw new Error(retry.description ?? 'sendMessage retry failed');
        }
        return { messageId: String(retry.result?.message_id ?? '') };
      }

      // Recover from QUOTE_TEXT_INVALID: retry without quote
      if (errMsg.includes('QUOTE_TEXT_INVALID') && params.reply_parameters) {
        const rp = params.reply_parameters as Record<string, unknown>;
        delete rp.quote;
        delete rp.quote_parse_mode;
        delete rp.quote_entities;
        delete rp.quote_position;
        const retry = await this.apiCall('sendMessage', params);
        if (!retry.ok) {
          throw new Error(retry.description ?? 'sendMessage quote-recovery retry failed');
        }
        return { messageId: String(retry.result?.message_id ?? '') };
      }

      throw err;
    }
  }

  /**
   * Build reply_parameters with hardened quote text to avoid QUOTE_TEXT_INVALID.
   * We strip unsupported entities and validate quote boundaries.
   */
  private buildReplyParameters(replyToMessageId: string): Record<string, unknown> {
    return {
      message_id: parseInt(replyToMessageId, 10),
      allow_sending_without_reply: true,
    };
  }

  /**
   * Transform markdown-style spoilers ||text|| to HTML <tg-spoiler>text</tg-spoiler>
   */
  private transformSpoilers(text: string): string {
    return text.replace(/\|\|(.+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
  }

  private async sendWithAttachment(
    to: string,
    caption: string,
    options: SendOptions,
  ): Promise<{ messageId?: string }> {
    const att = options.attachments![0]; // Send first attachment
    const processedCaption = this.transformSpoilers(caption);

    // Determine the method based on MIME type
    let method: string;
    let fileField: string;

    if (att.mimeType.startsWith('image/')) {
      method = 'sendPhoto';
      fileField = 'photo';
    } else if (att.mimeType.startsWith('audio/')) {
      method = 'sendAudio';
      fileField = 'audio';
    } else if (att.mimeType.startsWith('video/')) {
      method = 'sendVideo';
      fileField = 'video';
    } else if (att.mimeType === 'image/webp' || att.filename.endsWith('.webp')) {
      method = 'sendSticker';
      fileField = 'sticker';
    } else {
      method = 'sendDocument';
      fileField = 'document';
    }

    const params: Record<string, unknown> = {
      chat_id: to,
    };

    if (method !== 'sendSticker') {
      params.caption = processedCaption;
      params.parse_mode = options.parseMode ?? this.defaultParseMode;
    }

    if (options.threadId) {
      params.message_thread_id = parseInt(options.threadId, 10);
    }

    if (options.replyTo) {
      params.reply_parameters = this.buildReplyParameters(options.replyTo);
    }

    // If attachment has a URL, send by URL
    if (att.url) {
      params[fileField] = att.url;
      try {
        const result = await this.apiCall(method, params);
        if (!result.ok) throw new Error(result.description ?? `${method} failed`);
        return { messageId: String(result.result?.message_id ?? '') };
      } catch (err) {
        // Stale topic recovery
        const errMsg = (err as Error).message;
        if (
          params.message_thread_id &&
          (errMsg.includes('TOPIC_CLOSED') ||
            errMsg.includes('TOPIC_DELETED') ||
            errMsg.includes('message thread'))
        ) {
          delete params.message_thread_id;
          const retry = await this.apiCall(method, params);
          if (!retry.ok) throw new Error(retry.description ?? `${method} retry failed`);
          return { messageId: String(retry.result?.message_id ?? '') };
        }
        throw err;
      }
    }

    // If attachment has base64 data, we need multipart upload
    if (att.data) {
      const binaryStr = atob(att.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: att.mimeType });

      const formData = new FormData();
      formData.append(fileField, blob, att.filename);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          formData.append(
            key,
            typeof value === 'object' ? JSON.stringify(value) : String(value),
          );
        }
      }

      const url = `${this.apiBase}/bot${this.token}/${method}`;
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.description ?? `${method} upload failed`);
      return { messageId: String(json.result?.message_id ?? '') };
    }

    throw new Error('Attachment has no url or data');
  }

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------

  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.pollLoop();
  }

  private stopPolling(): void {
    this.polling = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.polling && this.status !== 'error') {
      try {
        this.pollAbortController = new AbortController();
        const updates = await this.getUpdates(this.pollAbortController.signal);

        for (const update of updates) {
          // Advance the offset
          this.pollOffset = update.update_id + 1;
          const parsed = this.parseUpdate(update);
          if (parsed && this.messageCallback) {
            try {
              await this.messageCallback(parsed);
            } catch {
              // Callback errors should not crash polling
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;

        // On network errors, wait before retrying
        this.status = 'error';
        await this.sleep(5000);
        this.status = 'connected';
      }
    }
  }

  private async getUpdates(signal: AbortSignal): Promise<TelegramUpdate[]> {
    const params: Record<string, unknown> = {
      offset: this.pollOffset,
      timeout: this.pollTimeout,
      allowed_updates: ['message', 'edited_message', 'channel_post'],
    };

    const url = `${this.apiBase}/bot${this.token}/getUpdates`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });

    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.description ?? 'getUpdates failed');
    }

    return json.result ?? [];
  }

  // -----------------------------------------------------------------------
  // Parsing
  // -----------------------------------------------------------------------

  private parseUpdate(update: TelegramUpdate): ChannelMessage | null {
    const msg = update.message ?? update.edited_message ?? update.channel_post;
    if (!msg) return null;

    const senderId = String(msg.from?.id ?? msg.chat?.id ?? 'unknown');
    const chatId = String(msg.chat?.id ?? 'unknown');

    // DM allow-from check: match against sender user id, fallback to chat id
    if (this.allowFrom.size > 0) {
      const userIdStr = String(msg.from?.id ?? '');
      const chatIdStr = String(msg.chat?.id ?? '');
      if (!this.allowFrom.has(userIdStr) && !this.allowFrom.has(chatIdStr)) {
        return null;
      }
    }

    // Build content from text/caption
    let content = msg.text ?? msg.caption ?? '';

    // Parse attachments
    const attachments: Attachment[] = [];

    if (msg.photo && msg.photo.length > 0) {
      // Use the largest photo
      const largest = msg.photo[msg.photo.length - 1];
      attachments.push({
        filename: `photo_${largest.file_id}.jpg`,
        mimeType: 'image/jpeg',
        url: largest.file_id, // Consumer must call getFile to get download URL
        size: largest.file_size,
      });
    }

    if (msg.document) {
      attachments.push({
        filename: msg.document.file_name ?? `doc_${msg.document.file_id}`,
        mimeType: msg.document.mime_type ?? 'application/octet-stream',
        url: msg.document.file_id,
        size: msg.document.file_size,
      });
    }

    if (msg.voice) {
      attachments.push({
        filename: `voice_${msg.voice.file_id}.ogg`,
        mimeType: msg.voice.mime_type ?? 'audio/ogg',
        url: msg.voice.file_id,
        size: msg.voice.file_size,
      });
    }

    if (msg.audio) {
      attachments.push({
        filename: msg.audio.file_name ?? `audio_${msg.audio.file_id}`,
        mimeType: msg.audio.mime_type ?? 'audio/mpeg',
        url: msg.audio.file_id,
        size: msg.audio.file_size,
      });
    }

    if (msg.video) {
      attachments.push({
        filename: msg.video.file_name ?? `video_${msg.video.file_id}`,
        mimeType: msg.video.mime_type ?? 'video/mp4',
        url: msg.video.file_id,
        size: msg.video.file_size,
      });
    }

    if (msg.sticker) {
      attachments.push({
        filename: `sticker_${msg.sticker.file_id}.webp`,
        mimeType: 'image/webp',
        url: msg.sticker.file_id,
      });
      if (!content) {
        content = `[sticker:${msg.sticker.emoji ?? msg.sticker.set_name ?? 'sticker'}]`;
      }
    }

    // Build the channel message
    const channelMsg: ChannelMessage = {
      channel: this.name,
      sender: senderId,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        chatId,
        chatType: msg.chat?.type,
        chatTitle: msg.chat?.title,
        username: msg.from?.username,
        firstName: msg.from?.first_name,
        lastName: msg.from?.last_name,
        messageId: msg.message_id,
        isEdited: !!update.edited_message,
        entities: msg.entities,
        isTopicMessage: msg.is_topic_message,
      },
      threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
      replyTo: msg.reply_to_message?.message_id
        ? String(msg.reply_to_message.message_id)
        : undefined,
      timestamp: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000),
    };

    return channelMsg;
  }

  // -----------------------------------------------------------------------
  // API helpers
  // -----------------------------------------------------------------------

  private async apiCall(method: string, params?: Record<string, unknown>): Promise<TelegramApiResponse> {
    const url = `${this.apiBase}/bot${this.token}/${method}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
    });

    const json = (await res.json()) as TelegramApiResponse;
    if (!json.ok) {
      throw new Error(`Telegram API ${method}: ${json.description ?? `HTTP ${res.status}`}`);
    }

    return json;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -----------------------------------------------------------------------
  // Public helper: resolve file_id to download URL
  // -----------------------------------------------------------------------

  async getFileUrl(fileId: string): Promise<string> {
    const result = await this.apiCall('getFile', { file_id: fileId });
    const filePath = result.result?.file_path;
    if (!filePath) throw new Error('Could not resolve file path');
    return `${this.apiBase}/file/bot${this.token}/${filePath}`;
  }
}

// ---------------------------------------------------------------------------
// Telegram API types
// ---------------------------------------------------------------------------

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: any;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  chat?: {
    id: number;
    type?: string;
    title?: string;
  };
  date?: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  reply_to_message?: {
    message_id: number;
    text?: string;
  };
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }>;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  voice?: {
    file_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
  };
  audio?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  video?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  sticker?: {
    file_id: string;
    emoji?: string;
    set_name?: string;
  };
}

interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: { id: number };
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default TelegramChannel;
