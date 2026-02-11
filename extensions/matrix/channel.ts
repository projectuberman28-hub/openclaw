/**
 * @alfred/channel-matrix - Matrix channel extension for Alfred v3
 *
 * Connects to a Matrix homeserver via the Client-Server API over HTTP.
 * Uses long-poll /sync endpoint for real-time message receiving.
 * Supports text, HTML, files, reactions, and threads (MSC3440 relations).
 * Access token authentication with E2EE placeholder (Megolm).
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
// Matrix configuration
// ---------------------------------------------------------------------------

interface MatrixConfig {
  /** Homeserver base URL, e.g. https://matrix.example.com */
  homeserverUrl: string;
  /** Access token for authentication */
  accessToken: string;
  /** User ID (e.g. @bot:matrix.example.com) */
  userId: string;
  /** Room IDs to join/listen on (empty = listen on all joined rooms) */
  rooms?: string[];
  /** Enable E2EE placeholder (Megolm). Default: false */
  enableE2ee?: boolean;
  /** Device ID for E2EE sessions */
  deviceId?: string;
  /** Sync timeout in ms (default 30000) */
  syncTimeoutMs?: number;
  /** Sync filter for efficiency */
  syncFilter?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MatrixChannel
// ---------------------------------------------------------------------------

export class MatrixChannel implements AlfredChannel {
  readonly name = 'matrix';
  readonly displayName = 'Matrix';
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
  private homeserverUrl = '';
  private accessToken = '';
  private userId = '';
  private rooms: Set<string> = new Set();
  private enableE2ee = false;
  private deviceId = '';
  private syncTimeoutMs = 30000;
  private syncFilter: Record<string, unknown> | null = null;
  private syncToken: string | null = null;
  private syncing = false;
  private syncAbortController: AbortController | null = null;
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();
  private txnCounter = 0;

  // E2EE placeholder state
  private e2eeSessionKeys: Map<string, string> = new Map();

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: MatrixConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.homeserverUrl || !config.accessToken || !config.userId) {
      this.status = 'error';
      throw new Error('MatrixChannel: "homeserverUrl", "accessToken", and "userId" are required');
    }

    this.homeserverUrl = config.homeserverUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.userId = config.userId;
    this.enableE2ee = config.enableE2ee ?? false;
    this.deviceId = config.deviceId ?? '';
    this.syncTimeoutMs = config.syncTimeoutMs ?? 30000;
    this.syncFilter = config.syncFilter ?? null;

    if (config.rooms) {
      this.rooms = new Set(config.rooms);
    }

    // Validate credentials by calling /whoami
    try {
      const res = await this.matrixApi('GET', '/_matrix/client/v3/account/whoami');
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }
      const data = await res.json() as { user_id: string; device_id?: string };
      if (data.user_id !== this.userId) {
        throw new Error(`User ID mismatch: expected ${this.userId}, got ${data.user_id}`);
      }
      if (data.device_id && !this.deviceId) {
        this.deviceId = data.device_id;
      }
    } catch (err) {
      this.status = 'error';
      throw new Error(`MatrixChannel: authentication failed: ${(err as Error).message}`);
    }

    // Join configured rooms if not already joined
    for (const roomId of this.rooms) {
      try {
        await this.matrixApi(
          'POST',
          `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
          {},
        );
      } catch {
        // May already be joined, non-fatal
      }
    }

    // E2EE placeholder: upload device keys if enabled
    if (this.enableE2ee) {
      await this.initializeE2ee();
    }

    this.status = 'connected';
  }

  listen(callback: (message: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
    this.startSync();
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.stopSync();
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
    // Handle file uploads first
    if (options?.attachments && options.attachments.length > 0) {
      return this.sendWithAttachment(to, message, options);
    }

    const txnId = this.nextTxnId();

    // Determine if we should send HTML or plain text
    const isHtml = options?.parseMode === 'html' || message.includes('<');

    const content: Record<string, unknown> = {
      msgtype: 'm.text',
      body: this.stripHtml(message),
    };

    if (isHtml) {
      content.format = 'org.matrix.custom.html';
      content.formatted_body = message;
    }

    // Thread support (MSC3440 / m.thread relation)
    if (options?.threadId) {
      content['m.relates_to'] = {
        rel_type: 'm.thread',
        event_id: options.threadId,
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: options.replyTo ?? options.threadId,
        },
      };
    } else if (options?.replyTo) {
      // Simple reply (not a thread)
      content['m.relates_to'] = {
        'm.in_reply_to': {
          event_id: options.replyTo,
        },
      };
    }

    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(to)}/send/m.room.message/${txnId}`;

    const res = await this.matrixApi('PUT', path, content);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Matrix sendMessage failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as { event_id?: string };
    return { messageId: json.event_id };
  }

  private async sendWithAttachment(
    roomId: string,
    caption: string,
    options: SendOptions,
  ): Promise<{ messageId?: string }> {
    const att = options.attachments![0];

    // Upload the file to the media repo
    const mxcUrl = await this.uploadMedia(att);

    const txnId = this.nextTxnId();

    // Determine message type
    let msgtype = 'm.file';
    if (att.mimeType.startsWith('image/')) msgtype = 'm.image';
    else if (att.mimeType.startsWith('audio/')) msgtype = 'm.audio';
    else if (att.mimeType.startsWith('video/')) msgtype = 'm.video';

    const content: Record<string, unknown> = {
      msgtype,
      body: caption || att.filename,
      url: mxcUrl,
      info: {
        mimetype: att.mimeType,
        size: att.size,
      },
    };

    if (options.threadId) {
      content['m.relates_to'] = {
        rel_type: 'm.thread',
        event_id: options.threadId,
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: options.replyTo ?? options.threadId,
        },
      };
    }

    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`;

    const res = await this.matrixApi('PUT', path, content);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Matrix sendAttachment failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as { event_id?: string };
    return { messageId: json.event_id };
  }

  private async uploadMedia(att: Attachment): Promise<string> {
    let body: Uint8Array | null = null;
    if (att.data) {
      const binaryStr = atob(att.data);
      body = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        body[i] = binaryStr.charCodeAt(i);
      }
    } else if (att.url) {
      // Fetch the file from URL and upload
      const fileRes = await fetch(att.url);
      const arrayBuf = await fileRes.arrayBuffer();
      body = new Uint8Array(arrayBuf);
    }

    if (!body) throw new Error('Attachment has no data or url');

    const filename = encodeURIComponent(att.filename);
    const url = `${this.homeserverUrl}/_matrix/media/v3/upload?filename=${filename}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': att.mimeType,
      },
      body,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Matrix media upload failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as { content_uri: string };
    return json.content_uri;
  }

  // -----------------------------------------------------------------------
  // Reactions
  // -----------------------------------------------------------------------

  async addReaction(roomId: string, eventId: string, emoji: string): Promise<{ messageId?: string }> {
    const txnId = this.nextTxnId();

    const content = {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: emoji,
      },
    };

    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}`;
    const res = await this.matrixApi('PUT', path, content);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Matrix reaction failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as { event_id?: string };
    return { messageId: json.event_id };
  }

  // -----------------------------------------------------------------------
  // Message editing
  // -----------------------------------------------------------------------

  async editMessage(roomId: string, eventId: string, newContent: string): Promise<{ messageId?: string }> {
    const txnId = this.nextTxnId();

    const content = {
      msgtype: 'm.text',
      body: `* ${this.stripHtml(newContent)}`,
      'm.new_content': {
        msgtype: 'm.text',
        body: this.stripHtml(newContent),
        format: 'org.matrix.custom.html',
        formatted_body: newContent,
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    };

    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`;
    const res = await this.matrixApi('PUT', path, content);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Matrix edit failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = await res.json() as { event_id?: string };
    return { messageId: json.event_id };
  }

  // -----------------------------------------------------------------------
  // Sync loop
  // -----------------------------------------------------------------------

  private startSync(): void {
    if (this.syncing) return;
    this.syncing = true;
    this.syncLoop();
  }

  private stopSync(): void {
    this.syncing = false;
    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.syncAbortController = null;
    }
  }

  private async syncLoop(): Promise<void> {
    while (this.syncing && this.status !== 'error') {
      try {
        this.syncAbortController = new AbortController();
        await this.doSync(this.syncAbortController.signal);
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;

        // On network errors wait before retrying
        this.status = 'error';
        await this.sleep(5000);
        this.status = 'connected';
      }
    }
  }

  private async doSync(signal: AbortSignal): Promise<void> {
    const params = new URLSearchParams();
    params.set('timeout', String(this.syncTimeoutMs));

    if (this.syncToken) {
      params.set('since', this.syncToken);
    }

    if (this.syncFilter) {
      params.set('filter', JSON.stringify(this.syncFilter));
    } else {
      // Default filter: only get room messages and reactions
      params.set(
        'filter',
        JSON.stringify({
          room: {
            timeline: {
              types: ['m.room.message', 'm.reaction'],
              limit: 50,
            },
            state: { lazy_load_members: true },
          },
          presence: { types: [] },
          account_data: { types: [] },
        }),
      );
    }

    const url = `${this.homeserverUrl}/_matrix/client/v3/sync?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal,
    });

    if (!res.ok) {
      throw new Error(`Sync failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as MatrixSyncResponse;

    // Store the next batch token
    if (data.next_batch) {
      this.syncToken = data.next_batch;
    }

    // Process joined rooms
    if (data.rooms?.join) {
      for (const [roomId, roomData] of Object.entries(data.rooms.join)) {
        // If we have a room filter, skip non-matching rooms
        if (this.rooms.size > 0 && !this.rooms.has(roomId)) continue;

        const events = roomData.timeline?.events ?? [];
        for (const event of events) {
          const parsed = this.parseEvent(roomId, event);
          if (parsed && this.messageCallback) {
            try {
              await this.messageCallback(parsed);
            } catch {
              // Callback errors should not crash sync
            }
          }
        }
      }
    }

    // Process invited rooms (auto-join if in our room list)
    if (data.rooms?.invite) {
      for (const roomId of Object.keys(data.rooms.invite)) {
        if (this.rooms.size === 0 || this.rooms.has(roomId)) {
          try {
            await this.matrixApi(
              'POST',
              `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
              {},
            );
          } catch {
            // Non-fatal
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event parsing
  // -----------------------------------------------------------------------

  private parseEvent(roomId: string, event: MatrixEvent): ChannelMessage | null {
    // Ignore our own messages
    if (event.sender === this.userId) return null;

    // Handle reactions
    if (event.type === 'm.reaction') {
      const relatesTo = event.content?.['m.relates_to'];
      if (!relatesTo) return null;

      return {
        channel: this.name,
        sender: event.sender ?? 'unknown',
        content: `[reaction:${relatesTo.key ?? '?'}]`,
        metadata: {
          roomId,
          eventId: event.event_id,
          isReaction: true,
          targetEventId: relatesTo.event_id,
          emoji: relatesTo.key,
        },
        timestamp: new Date(event.origin_server_ts ?? Date.now()),
      };
    }

    // Handle room messages
    if (event.type !== 'm.room.message') return null;

    const content = event.content;
    if (!content) return null;

    // Ignore edits (they come as new events with m.new_content)
    if (content['m.relates_to']?.rel_type === 'm.replace') return null;

    const msgtype = content.msgtype ?? 'm.text';
    let textContent = content.body ?? '';

    // Prefer formatted body for HTML
    if (content.formatted_body && content.format === 'org.matrix.custom.html') {
      textContent = content.formatted_body;
    }

    // Parse attachments
    const attachments: Attachment[] = [];
    if (msgtype === 'm.image' || msgtype === 'm.file' || msgtype === 'm.audio' || msgtype === 'm.video') {
      const mxcUrl = content.url as string | undefined;
      const info = content.info as Record<string, unknown> | undefined;

      attachments.push({
        filename: content.body ?? 'file',
        mimeType: (info?.mimetype as string) ?? 'application/octet-stream',
        url: mxcUrl ? this.mxcToHttpUrl(mxcUrl) : undefined,
        size: info?.size as number | undefined,
      });
    }

    // Thread detection
    const relatesTo = content['m.relates_to'];
    let threadId: string | undefined;
    let replyTo: string | undefined;

    if (relatesTo?.rel_type === 'm.thread') {
      threadId = relatesTo.event_id;
      replyTo = relatesTo['m.in_reply_to']?.event_id;
    } else if (relatesTo?.['m.in_reply_to']) {
      replyTo = relatesTo['m.in_reply_to'].event_id;
    }

    return {
      channel: this.name,
      sender: event.sender ?? 'unknown',
      content: textContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        roomId,
        eventId: event.event_id,
        msgtype,
        isEncrypted: event.type === 'm.room.encrypted',
      },
      threadId,
      replyTo,
      timestamp: new Date(event.origin_server_ts ?? Date.now()),
    };
  }

  // -----------------------------------------------------------------------
  // E2EE placeholder (Megolm)
  // -----------------------------------------------------------------------

  private async initializeE2ee(): Promise<void> {
    // PLACEHOLDER: In a real implementation, this would:
    // 1. Upload device identity keys (ed25519 + curve25519)
    // 2. Upload one-time keys
    // 3. Set up Megolm outbound/inbound sessions per room
    // 4. Handle key requests from other devices

    // For now, we upload empty device keys to signal E2EE support
    try {
      await this.matrixApi('POST', '/_matrix/client/v3/keys/upload', {
        device_keys: {
          user_id: this.userId,
          device_id: this.deviceId,
          algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
          keys: {},
          signatures: {},
        },
      });
    } catch {
      // Non-fatal: E2EE key upload failure doesn't block operation
    }
  }

  /**
   * Placeholder for decrypting Megolm-encrypted events.
   * In a real implementation, this would use the stored session keys
   * to decrypt m.room.encrypted events.
   */
  decryptEvent(_event: MatrixEvent): MatrixEvent | null {
    // PLACEHOLDER: Would use Megolm session keys to decrypt
    // event.content.ciphertext using the session from
    // this.e2eeSessionKeys
    return null;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private mxcToHttpUrl(mxcUrl: string): string {
    // mxc://server.name/mediaId -> homeserver/_matrix/media/v3/download/server.name/mediaId
    const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match) return mxcUrl;
    return `${this.homeserverUrl}/_matrix/media/v3/download/${match[1]}/${match[2]}`;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  private nextTxnId(): string {
    this.txnCounter++;
    return `alfred_${Date.now()}_${this.txnCounter}`;
  }

  private async matrixApi(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };

    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return fetch(`${this.homeserverUrl}${path}`, init);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Matrix API types
// ---------------------------------------------------------------------------

interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, MatrixJoinedRoom>;
    invite?: Record<string, unknown>;
    leave?: Record<string, unknown>;
  };
}

interface MatrixJoinedRoom {
  timeline?: {
    events: MatrixEvent[];
    prev_batch?: string;
    limited?: boolean;
  };
  state?: {
    events: MatrixEvent[];
  };
}

interface MatrixEvent {
  type: string;
  event_id?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: Record<string, any>;
  unsigned?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default MatrixChannel;
