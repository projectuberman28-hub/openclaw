/**
 * @alfred/channel-bluebubbles - BlueBubbles (iMessage) channel for Alfred v3
 *
 * Bridges Alfred to iMessage via the BlueBubbles REST API.
 * Supports text messages, attachments, and tapback reactions.
 * Password + server URL authentication.
 * Polls for new messages with configurable interval.
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
// BlueBubbles configuration
// ---------------------------------------------------------------------------

interface BlueBubblesConfig {
  /** BlueBubbles server URL, e.g. http://192.168.1.100:1234 */
  serverUrl: string;
  /** Server password for authentication */
  password: string;
  /** Poll interval in ms (default 3000) */
  pollIntervalMs?: number;
  /** Only handle messages from these addresses/numbers (empty = all) */
  allowFrom?: string[];
}

// ---------------------------------------------------------------------------
// BlueBubbles tapback type mapping
// ---------------------------------------------------------------------------

const TAPBACK_TYPES: Record<number, string> = {
  2000: 'love',
  2001: 'like',
  2002: 'dislike',
  2003: 'laugh',
  2004: 'emphasize',
  2005: 'question',
  3000: 'remove-love',
  3001: 'remove-like',
  3002: 'remove-dislike',
  3003: 'remove-laugh',
  3004: 'remove-emphasize',
  3005: 'remove-question',
};

const TAPBACK_TO_TYPE: Record<string, number> = {
  love: 2000,
  like: 2001,
  dislike: 2002,
  laugh: 2003,
  emphasize: 2004,
  question: 2005,
};

// ---------------------------------------------------------------------------
// BlueBubblesChannel
// ---------------------------------------------------------------------------

export class BlueBubblesChannel implements AlfredChannel {
  readonly name = 'bluebubbles';
  readonly displayName = 'iMessage (BlueBubbles)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: true,
    video: true,
    files: true,
    reactions: true, // tapbacks
    threads: false,
    editing: false,
  };

  private status: ChannelStatus = 'disconnected';
  private serverUrl = '';
  private password = '';
  private pollIntervalMs = 3000;
  private allowFrom: Set<string> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageTimestamp: number = 0;
  private processedMessageGuids = new Set<string>();
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: BlueBubblesConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.serverUrl || !config.password) {
      this.status = 'error';
      throw new Error('BlueBubblesChannel: "serverUrl" and "password" are required');
    }

    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
    this.password = config.password;
    this.pollIntervalMs = config.pollIntervalMs ?? 3000;

    if (config.allowFrom) {
      this.allowFrom = new Set(
        config.allowFrom.map((addr) => this.normalizeAddress(addr)),
      );
    }

    // Validate connection by fetching server info
    try {
      const res = await this.bbApi('GET', '/api/v1/server/info');
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const info = await res.json() as BlueBubblesApiResponse;
      if (info.status !== 200) {
        throw new Error(info.message ?? 'Server info check failed');
      }
    } catch (err) {
      this.status = 'error';
      throw new Error(`BlueBubblesChannel: connection failed: ${(err as Error).message}`);
    }

    // Set last timestamp to now to avoid processing old messages
    this.lastMessageTimestamp = Date.now();

    this.status = 'connected';
  }

  listen(callback: (message: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
    this.startPolling();
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.stopPolling();
    this.messageCallback = null;
    this.processedMessageGuids.clear();
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
    // Handle attachment sends
    if (options?.attachments && options.attachments.length > 0) {
      return this.sendWithAttachments(to, message, options.attachments);
    }

    // Send a text message
    // First, we need to find or create a chat with the recipient
    const chatGuid = await this.resolveChat(to);

    const body = {
      chatGuid,
      message,
      method: 'private-api', // Use Private API for best compatibility
    };

    const res = await this.bbApi('POST', '/api/v1/message/text', body);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`BlueBubbles send failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as BlueBubblesApiResponse;
    if (json.status !== 200) {
      throw new Error(`BlueBubbles send failed: ${json.message ?? 'unknown error'}`);
    }

    const guid = json.data?.guid ?? json.data?.tempGuid;
    return { messageId: guid };
  }

  private async sendWithAttachments(
    to: string,
    caption: string,
    attachments: Attachment[],
  ): Promise<{ messageId?: string }> {
    const chatGuid = await this.resolveChat(to);

    // BlueBubbles expects multipart form data for attachment uploads
    const att = attachments[0]; // Send first attachment

    const boundary = `----BBBoundary${Date.now()}`;
    const parts: string[] = [];

    // Chat GUID field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="chatGuid"\r\n\r\n` +
      chatGuid + `\r\n`,
    );

    // Message/caption field (if provided)
    if (caption) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="message"\r\n\r\n` +
        caption + `\r\n`,
      );
    }

    // Method field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="method"\r\n\r\n` +
      `private-api\r\n`,
    );

    // Attachment file
    if (att.data) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="attachment"; filename="${att.filename}"\r\n` +
        `Content-Type: ${att.mimeType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        att.data + `\r\n`,
      );
    } else if (att.url) {
      // If we have a URL but not data, fetch it first
      const fileRes = await fetch(att.url);
      const arrayBuf = await fileRes.arrayBuffer();
      const base64 = this.arrayBufferToBase64(arrayBuf);

      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="attachment"; filename="${att.filename}"\r\n` +
        `Content-Type: ${att.mimeType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        base64 + `\r\n`,
      );
    }

    parts.push(`--${boundary}--\r\n`);
    const bodyStr = parts.join('');

    const res = await fetch(
      `${this.serverUrl}/api/v1/message/attachment?password=${encodeURIComponent(this.password)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: bodyStr,
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`BlueBubbles attachment send failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as BlueBubblesApiResponse;
    if (json.status !== 200) {
      throw new Error(`BlueBubbles attachment send failed: ${json.message ?? 'unknown'}`);
    }

    return { messageId: json.data?.guid };
  }

  // -----------------------------------------------------------------------
  // Tapback reactions
  // -----------------------------------------------------------------------

  async sendReaction(
    chatGuid: string,
    targetMessagePart: string,
    reactionType: string,
  ): Promise<void> {
    const tapbackType = TAPBACK_TO_TYPE[reactionType];
    if (tapbackType === undefined) {
      throw new Error(`Unknown reaction type: ${reactionType}. Valid types: ${Object.keys(TAPBACK_TO_TYPE).join(', ')}`);
    }

    const body = {
      chatGuid,
      selectedMessageGuid: targetMessagePart,
      partIndex: 0,
      reaction: tapbackType,
    };

    const res = await this.bbApi('POST', '/api/v1/message/react', body);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`BlueBubbles reaction failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as BlueBubblesApiResponse;
    if (json.status !== 200) {
      throw new Error(`BlueBubbles reaction failed: ${json.message ?? 'unknown'}`);
    }
  }

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------

  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      try {
        await this.poll();
      } catch {
        // Swallow poll errors
      }
    }, this.pollIntervalMs);

    // Also poll immediately
    this.poll().catch(() => {});
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.status !== 'connected' || !this.messageCallback) return;

    try {
      // Fetch messages since last timestamp
      const params = new URLSearchParams({
        after: String(this.lastMessageTimestamp),
        limit: '50',
        sort: 'ASC',
        with: 'chat,attachment', // Include chat and attachment data
      });

      const res = await this.bbApi('POST', '/api/v1/message/query', {
        after: this.lastMessageTimestamp,
        limit: 50,
        sort: 'ASC',
        with: ['chat', 'attachment'],
      });

      if (!res.ok) return;

      const json = await res.json() as BlueBubblesApiResponse;
      if (json.status !== 200 || !Array.isArray(json.data)) return;

      const messages = json.data as BlueBubblesMessage[];

      for (const msg of messages) {
        // Skip already processed messages
        if (this.processedMessageGuids.has(msg.guid)) continue;
        this.processedMessageGuids.add(msg.guid);

        // Limit the dedup set size
        if (this.processedMessageGuids.size > 10000) {
          const arr = Array.from(this.processedMessageGuids);
          this.processedMessageGuids = new Set(arr.slice(arr.length - 5000));
        }

        // Update last timestamp
        if (msg.dateCreated && msg.dateCreated > this.lastMessageTimestamp) {
          this.lastMessageTimestamp = msg.dateCreated;
        }

        // Skip outgoing messages (from us)
        if (msg.isFromMe) continue;

        const parsed = this.parseMessage(msg);
        if (!parsed) continue;

        try {
          await this.messageCallback(parsed);
        } catch {
          // Callback errors should not crash polling
        }
      }
    } catch (err) {
      this.status = 'error';
      // Will recover on next poll cycle
      setTimeout(() => {
        if (this.status === 'error') this.status = 'connected';
      }, 5000);
    }
  }

  // -----------------------------------------------------------------------
  // Message parsing
  // -----------------------------------------------------------------------

  private parseMessage(msg: BlueBubblesMessage): ChannelMessage | null {
    const sender = msg.handle?.address ?? msg.handle?.uncanonicalizedId ?? 'unknown';

    // Check allow-from filter
    if (this.allowFrom.size > 0) {
      const normalizedSender = this.normalizeAddress(sender);
      if (!this.allowFrom.has(normalizedSender)) return null;
    }

    // Determine the chat GUID for routing
    const chatGuid = msg.chats?.[0]?.guid ?? '';

    // Handle tapback reactions
    if (msg.associatedMessageGuid && msg.associatedMessageType !== undefined) {
      const tapbackName = TAPBACK_TYPES[msg.associatedMessageType] ?? `tapback-${msg.associatedMessageType}`;
      const isRemove = tapbackName.startsWith('remove-');

      return {
        channel: this.name,
        sender,
        content: `[reaction:${tapbackName}]`,
        metadata: {
          isReaction: true,
          reactionType: tapbackName,
          isRemove,
          targetMessageGuid: msg.associatedMessageGuid,
          chatGuid,
          guid: msg.guid,
        },
        timestamp: new Date(msg.dateCreated ?? Date.now()),
      };
    }

    // Regular text message
    let content = msg.text ?? '';

    // Parse attachments
    const attachments: Attachment[] = (msg.attachments ?? []).map((att) => ({
      filename: att.filename ?? att.transferName ?? 'attachment',
      mimeType: att.mimeType ?? 'application/octet-stream',
      url: att.guid
        ? `${this.serverUrl}/api/v1/attachment/${att.guid}/download?password=${encodeURIComponent(this.password)}`
        : undefined,
      size: att.totalBytes,
    }));

    return {
      channel: this.name,
      sender,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        chatGuid,
        guid: msg.guid,
        isGroup: msg.chats?.[0]?.participants?.length > 2,
        groupName: msg.chats?.[0]?.displayName,
        service: msg.chats?.[0]?.serviceName ?? 'iMessage',
        handleId: msg.handle?.id,
      },
      timestamp: new Date(msg.dateCreated ?? Date.now()),
    };
  }

  // -----------------------------------------------------------------------
  // Chat resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a recipient address to a chatGuid.
   * Looks up existing chats first, or creates a new one.
   */
  private async resolveChat(to: string): Promise<string> {
    // If `to` already looks like a chat GUID (e.g. iMessage;-;+1234567890), use it directly
    if (to.includes(';')) {
      return to;
    }

    // Search for existing chat with this recipient
    try {
      const res = await this.bbApi('POST', '/api/v1/chat/query', {
        with: ['participants'],
        limit: 10,
      });

      if (res.ok) {
        const json = await res.json() as BlueBubblesApiResponse;
        if (json.status === 200 && Array.isArray(json.data)) {
          const normalizedTo = this.normalizeAddress(to);

          for (const chat of json.data as BlueBubblesChat[]) {
            const participants = chat.participants ?? [];
            if (
              participants.length <= 2 &&
              participants.some(
                (p: any) =>
                  this.normalizeAddress(p.address ?? p.uncanonicalizedId ?? '') === normalizedTo,
              )
            ) {
              return chat.guid;
            }
          }
        }
      }
    } catch {
      // Fall through to create new chat
    }

    // Create a new chat
    try {
      const res = await this.bbApi('POST', '/api/v1/chat/new', {
        participants: [to],
        service: 'iMessage',
        message: '', // Empty initial message; the actual message is sent separately
      });

      if (res.ok) {
        const json = await res.json() as BlueBubblesApiResponse;
        if (json.status === 200 && json.data?.guid) {
          return json.data.guid;
        }
      }
    } catch {
      // Fall through
    }

    // Fallback: construct a best-guess GUID
    return `iMessage;-;${to}`;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private normalizeAddress(address: string): string {
    // Remove spaces, dashes, parentheses, and lowercase for comparison
    return address.replace(/[\s\-()]/g, '').toLowerCase();
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private async bbApi(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.serverUrl}${path}${separator}password=${encodeURIComponent(this.password)}`;

    const headers: Record<string, string> = {};
    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return fetch(url, init);
  }
}

// ---------------------------------------------------------------------------
// BlueBubbles API types
// ---------------------------------------------------------------------------

interface BlueBubblesApiResponse {
  status: number;
  message?: string;
  data?: any;
}

interface BlueBubblesMessage {
  guid: string;
  text?: string;
  isFromMe?: boolean;
  dateCreated?: number;
  handle?: {
    id?: number;
    address?: string;
    uncanonicalizedId?: string;
  };
  chats?: BlueBubblesChat[];
  attachments?: BlueBubblesAttachment[];
  associatedMessageGuid?: string;
  associatedMessageType?: number;
}

interface BlueBubblesChat {
  guid: string;
  displayName?: string;
  serviceName?: string;
  participants?: Array<{
    address?: string;
    uncanonicalizedId?: string;
  }>;
}

interface BlueBubblesAttachment {
  guid?: string;
  filename?: string;
  transferName?: string;
  mimeType?: string;
  totalBytes?: number;
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default BlueBubblesChannel;
