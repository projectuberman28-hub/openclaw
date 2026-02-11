/**
 * @alfred/channel-webchat - WebSocket-based webchat channel for Alfred v3
 *
 * Connects to an Alfred Gateway WebSocket endpoint for real-time messaging.
 * Supports text, markdown, and code blocks. No external dependencies needed.
 * Manages sessions per connected client with session lifecycle hooks.
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
// Webchat configuration
// ---------------------------------------------------------------------------

interface WebchatConfig {
  /** Gateway WebSocket URL, e.g. ws://localhost:18789/ws or wss://alfred.example.com/ws */
  gatewayUrl: string;
  /** Auth token for gateway (optional) */
  authToken?: string;
  /** Reconnect on disconnect (default true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default 10) */
  maxReconnectAttempts?: number;
  /** Ping interval in ms to keep connection alive (default 30000) */
  pingIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

interface WebchatSession {
  id: string;
  clientId: string;
  connectedAt: Date;
  lastActivity: Date;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Wire protocol messages
// ---------------------------------------------------------------------------

interface WireMessage {
  type: 'message' | 'typing' | 'ping' | 'pong' | 'session' | 'ack' | 'error';
  id?: string;
  sessionId?: string;
  clientId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// WebchatChannel
// ---------------------------------------------------------------------------

export class WebchatChannel implements AlfredChannel {
  readonly name = 'webchat';
  readonly displayName = 'Web Chat';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: false,
    audio: false,
    video: false,
    files: false,
    reactions: false,
    threads: false,
    editing: false,
  };

  private status: ChannelStatus = 'disconnected';
  private gatewayUrl = '';
  private authToken = '';
  private autoReconnect = true;
  private maxReconnectAttempts = 10;
  private pingIntervalMs = 30000;
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private messageCallback: ((message: ChannelMessage) => Promise<void>) | null = null;
  private messageQueue = new MessageQueue();
  private reconnectAttempts = 0;
  private pendingAcks = new Map<string, {
    resolve: (value: { messageId?: string }) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // Session management
  private sessions = new Map<string, WebchatSession>();
  private currentSessionId: string | null = null;
  private msgCounter = 0;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(config: WebchatConfig): Promise<void> {
    this.status = 'initializing';

    if (!config.gatewayUrl) {
      this.status = 'error';
      throw new Error('WebchatChannel: "gatewayUrl" is required in config');
    }

    this.gatewayUrl = config.gatewayUrl.replace(/\/+$/, '');
    this.authToken = config.authToken ?? '';
    this.autoReconnect = config.autoReconnect ?? true;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.pingIntervalMs = config.pingIntervalMs ?? 30000;

    // Attempt initial connection
    await this.connect();
  }

  listen(callback: (message: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.autoReconnect = false;
    this.stopPing();
    this.clearPendingAcks();

    if (this.ws) {
      this.ws.close(1000, 'Shutting down');
      this.ws = null;
    }

    this.sessions.clear();
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
    _options?: SendOptions,
  ): Promise<{ messageId?: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const msgId = this.nextMsgId();

    const wire: WireMessage = {
      type: 'message',
      id: msgId,
      sessionId: to, // `to` is the session ID of the target client
      content: message,
      timestamp: Date.now(),
    };

    // Wait for ack with timeout
    return new Promise<{ messageId?: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(msgId);
        reject(new Error('Send timed out waiting for ack'));
      }, 10000);

      this.pendingAcks.set(msgId, { resolve, reject, timer });

      this.ws!.send(JSON.stringify(wire));
    });
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  getSession(sessionId: string): WebchatSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): WebchatSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): WebchatSession[] {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return Array.from(this.sessions.values()).filter(
      (s) => s.lastActivity.getTime() > fiveMinutesAgo,
    );
  }

  // -----------------------------------------------------------------------
  // WebSocket connection
  // -----------------------------------------------------------------------

  private async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const url = this.authToken
          ? `${this.gatewayUrl}?token=${encodeURIComponent(this.authToken)}`
          : this.gatewayUrl;

        this.ws = new WebSocket(url);
      } catch (err) {
        this.status = 'error';
        reject(new Error(`Failed to create WebSocket: ${(err as Error).message}`));
        return;
      }

      const connectTimeout = setTimeout(() => {
        this.ws?.close();
        this.status = 'error';
        reject(new Error('WebSocket connection timed out'));
      }, 15000);

      this.ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.reconnectAttempts = 0;
        this.status = 'connected';
        this.startPing();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string);
      };

      this.ws.onclose = (event: CloseEvent) => {
        clearTimeout(connectTimeout);
        this.stopPing();
        this.clearPendingAcks();
        this.status = 'disconnected';

        if (this.autoReconnect && event.code !== 1000) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Error details handled in onclose
      };
    });
  }

  private handleMessage(raw: string): void {
    let wire: WireMessage;
    try {
      wire = JSON.parse(raw);
    } catch {
      return;
    }

    switch (wire.type) {
      case 'message':
        this.handleIncomingMessage(wire);
        break;

      case 'session':
        this.handleSessionEvent(wire);
        break;

      case 'ack':
        this.handleAck(wire);
        break;

      case 'pong':
        // Pong received, connection is alive
        break;

      case 'error':
        this.handleErrorMessage(wire);
        break;

      case 'typing':
        // Could emit typing indicator event; skip for now
        break;
    }
  }

  private handleIncomingMessage(wire: WireMessage): void {
    if (!this.messageCallback) return;

    const sessionId = wire.sessionId ?? wire.clientId ?? 'unknown';

    // Update session activity
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }

    // Send ack back
    if (wire.id) {
      this.sendWire({
        type: 'ack',
        id: wire.id,
        sessionId,
      });
    }

    const msg: ChannelMessage = {
      channel: this.name,
      sender: sessionId,
      content: wire.content ?? '',
      metadata: {
        sessionId,
        clientId: wire.clientId,
        wireId: wire.id,
        ...wire.metadata,
      },
      timestamp: new Date(wire.timestamp ?? Date.now()),
    };

    this.messageCallback(msg).catch(() => {});
  }

  private handleSessionEvent(wire: WireMessage): void {
    const sessionId = wire.sessionId ?? wire.clientId;
    if (!sessionId) return;

    const action = wire.metadata?.action as string | undefined;

    if (action === 'connected' || action === 'created') {
      const session: WebchatSession = {
        id: sessionId,
        clientId: wire.clientId ?? sessionId,
        connectedAt: new Date(),
        lastActivity: new Date(),
        metadata: wire.metadata ?? {},
      };
      this.sessions.set(sessionId, session);
    } else if (action === 'disconnected' || action === 'destroyed') {
      this.sessions.delete(sessionId);
    }

    // Set our own session ID if this is a session assignment for us
    if (wire.metadata?.self) {
      this.currentSessionId = sessionId;
    }
  }

  private handleAck(wire: WireMessage): void {
    if (!wire.id) return;

    const pending = this.pendingAcks.get(wire.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAcks.delete(wire.id);
      pending.resolve({ messageId: wire.id });
    }
  }

  private handleErrorMessage(wire: WireMessage): void {
    // If error references a pending message, reject it
    if (wire.id) {
      const pending = this.pendingAcks.get(wire.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(wire.id);
        pending.reject(new Error(wire.content ?? 'Server error'));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private sendWire(wire: WireMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(wire));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendWire({ type: 'ping', timestamp: Date.now() });
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearPendingAcks(): void {
    for (const [id, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingAcks.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.status = 'error';
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 60000);
    this.reconnectAttempts++;

    setTimeout(async () => {
      if (this.status !== 'error' && this.autoReconnect) {
        try {
          await this.connect();
        } catch {
          // Will retry via onclose -> scheduleReconnect
        }
      }
    }, delay);
  }

  private nextMsgId(): string {
    this.msgCounter++;
    return `wc_${Date.now()}_${this.msgCounter}`;
  }
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default WebchatChannel;
