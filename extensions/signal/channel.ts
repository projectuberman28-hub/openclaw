/**
 * @alfred/channel-signal - Signal channel extension for Alfred v3
 *
 * Bridges Alfred to Signal via the signal-cli-rest API.
 * Polls GET /v1/receive for inbound messages and sends via POST /v2/send.
 * Supports text, attachments, and reactions with exponential backoff retry.
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
// Signal channel configuration
// ---------------------------------------------------------------------------

interface SignalConfig {
  /** signal-cli-rest API base URL (default http://localhost:8080) */
  endpoint?: string;
  /** Registered phone number on signal-cli, e.g. +14155551234 */
  number: string;
  /** Poll interval in ms (default 2000) */
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// SignalChannel
// ---------------------------------------------------------------------------

export class SignalChannel implements AlfredChannel {
  readonly name = 'signal';
  readonly displayName = 'Signal';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: true,
    video: true,
    files: true,
    reactions: true,
    threads: false,
    editing: false,
  };

  private status: ChannelStatus = 'disconnected';
  private endpoint = 'http://localhost:8080';
  private number = '';
  private pollIntervalMs = 2000;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: SignalConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.number) {
      this.status = 'error';
      throw new Error('SignalChannel: "number" is required in config');
    }

    this.number = config.number;
    this.endpoint = (config.endpoint ?? this.endpoint).replace(/\/+$/, '');
    this.pollIntervalMs = config.pollIntervalMs ?? this.pollIntervalMs;

    // Verify connectivity by hitting the receive endpoint once
    try {
      const res = await fetch(`${this.endpoint}/v1/receive/${encodeURIComponent(this.number)}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      this.status = 'connected';
    } catch (err) {
      this.status = 'error';
      throw new Error(`SignalChannel: failed to connect to signal-cli-rest API at ${this.endpoint}: ${(err as Error).message}`);
    }
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
    const body: Record<string, unknown> = {
      message,
      number: this.number,
      recipients: [to],
    };

    // Handle attachments - base64 data expected
    if (options?.attachments && options.attachments.length > 0) {
      body.base64_attachments = options.attachments.map((att) => ({
        filename: att.filename,
        contentType: att.mimeType,
        base64: att.data ?? '',
      }));
    }

    const res = await fetch(`${this.endpoint}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Signal send failed (HTTP ${res.status}): ${errBody}`);
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const timestamp = json.timestamp as string | undefined;
    return { messageId: timestamp ?? undefined };
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
        // Swallow poll errors to avoid crashing the interval
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

    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/v1/receive/${encodeURIComponent(this.number)}`);
    } catch (err) {
      this.status = 'error';
      throw err;
    }

    if (!res.ok) {
      if (res.status === 204) return; // no messages
      throw new Error(`Poll failed: HTTP ${res.status}`);
    }

    const messages = (await res.json()) as SignalEnvelope[];
    if (!Array.isArray(messages)) return;

    for (const envelope of messages) {
      const parsed = this.parseEnvelope(envelope);
      if (parsed) {
        try {
          await this.messageCallback(parsed);
        } catch {
          // Callback errors should not crash polling
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Parsing
  // -----------------------------------------------------------------------

  private parseEnvelope(envelope: SignalEnvelope): ChannelMessage | null {
    const dataMessage = envelope.envelope?.dataMessage;
    if (!dataMessage) {
      // Might be a reaction
      const reaction = envelope.envelope?.dataMessage?.reaction;
      if (reaction) {
        return this.parseReaction(envelope);
      }
      return null;
    }

    const sender = envelope.envelope?.sourceNumber ?? envelope.envelope?.source ?? 'unknown';
    const content = dataMessage.message ?? '';

    const attachments: Attachment[] = (dataMessage.attachments ?? []).map(
      (att: SignalAttachment) => ({
        filename: att.filename ?? att.id ?? 'attachment',
        mimeType: att.contentType ?? 'application/octet-stream',
        url: att.id ? `${this.endpoint}/v1/attachments/${att.id}` : undefined,
        size: att.size,
      }),
    );

    // Handle reaction messages
    if (dataMessage.reaction) {
      return {
        channel: this.name,
        sender,
        content: `[reaction:${dataMessage.reaction.emoji}]`,
        metadata: {
          isReaction: true,
          emoji: dataMessage.reaction.emoji,
          targetAuthor: dataMessage.reaction.targetAuthorNumber,
          targetTimestamp: dataMessage.reaction.targetSentTimestamp,
          isRemove: dataMessage.reaction.isRemove ?? false,
        },
        timestamp: new Date(envelope.envelope?.timestamp ?? Date.now()),
      };
    }

    return {
      channel: this.name,
      sender,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        timestamp: envelope.envelope?.timestamp,
        groupId: dataMessage.groupInfo?.groupId,
      },
      timestamp: new Date(envelope.envelope?.timestamp ?? Date.now()),
    };
  }

  private parseReaction(envelope: SignalEnvelope): ChannelMessage | null {
    const reaction = envelope.envelope?.dataMessage?.reaction;
    if (!reaction) return null;

    const sender = envelope.envelope?.sourceNumber ?? 'unknown';
    return {
      channel: this.name,
      sender,
      content: `[reaction:${reaction.emoji}]`,
      metadata: {
        isReaction: true,
        emoji: reaction.emoji,
        targetAuthor: reaction.targetAuthorNumber,
        targetTimestamp: reaction.targetSentTimestamp,
        isRemove: reaction.isRemove ?? false,
      },
      timestamp: new Date(envelope.envelope?.timestamp ?? Date.now()),
    };
  }
}

// ---------------------------------------------------------------------------
// Signal REST API types
// ---------------------------------------------------------------------------

interface SignalEnvelope {
  envelope?: {
    source?: string;
    sourceNumber?: string;
    timestamp?: number;
    dataMessage?: {
      message?: string;
      groupInfo?: { groupId?: string };
      attachments?: SignalAttachment[];
      reaction?: {
        emoji: string;
        targetAuthorNumber?: string;
        targetSentTimestamp?: number;
        isRemove?: boolean;
      };
    };
  };
}

interface SignalAttachment {
  contentType?: string;
  filename?: string;
  id?: string;
  size?: number;
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default SignalChannel;
