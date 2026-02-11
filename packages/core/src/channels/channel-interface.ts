/**
 * @alfred/core - Channel Interface
 *
 * Defines the contract that all Alfred communication channels must implement.
 * Channels are the bridge between users and the Alfred agent (CLI, Discord, Matrix, etc.).
 */

import type { ChannelMessage } from '../types/index.js';

// ---------------------------------------------------------------------------
// Channel capability flags
// ---------------------------------------------------------------------------

export interface ChannelCapabilities {
  /** Can receive text messages */
  text: boolean;
  /** Can receive rich text / markdown */
  richText: boolean;
  /** Can handle file attachments */
  attachments: boolean;
  /** Can send images inline */
  images: boolean;
  /** Can handle audio messages */
  audio: boolean;
  /** Can handle video messages */
  video: boolean;
  /** Supports real-time streaming responses */
  streaming: boolean;
  /** Supports interactive buttons / actions */
  interactiveButtons: boolean;
  /** Supports threads / conversation grouping */
  threads: boolean;
  /** Supports reactions / emoji responses */
  reactions: boolean;
  /** Supports editing previously sent messages */
  editMessages: boolean;
  /** Supports typing indicators */
  typingIndicator: boolean;
}

/** Default capabilities: basic text only */
export const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  text: true,
  richText: false,
  attachments: false,
  images: false,
  audio: false,
  video: false,
  streaming: false,
  interactiveButtons: false,
  threads: false,
  reactions: false,
  editMessages: false,
  typingIndicator: false,
};

// ---------------------------------------------------------------------------
// Channel status
// ---------------------------------------------------------------------------

export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ChannelStatusInfo {
  status: ChannelStatus;
  connectedSince: number | null;
  lastMessageAt: number | null;
  messageCount: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Callback types
// ---------------------------------------------------------------------------

/**
 * Callback invoked when a message arrives on the channel.
 */
export type ChannelMessageCallback = (message: ChannelMessage) => void | Promise<void>;

// ---------------------------------------------------------------------------
// AlfredChannel interface
// ---------------------------------------------------------------------------

/**
 * The core interface that all Alfred channels must implement.
 *
 * A channel is responsible for:
 * 1. Connecting to an external messaging platform
 * 2. Listening for incoming messages
 * 3. Sending responses back
 * 4. Reporting its status and capabilities
 */
export interface AlfredChannel {
  /** Unique identifier for this channel type */
  readonly name: string;

  /** Human-readable display name */
  readonly displayName: string;

  /**
   * Initialize the channel with configuration.
   * Should set up connections, authenticate, etc.
   * @throws Error if initialization fails
   */
  initialize(config?: Record<string, unknown>): Promise<void>;

  /**
   * Start listening for incoming messages.
   * The callback is invoked for each message received.
   */
  listen(callback: ChannelMessageCallback): Promise<void>;

  /**
   * Send a message to a specific recipient on this channel.
   *
   * @param to - Recipient identifier (channel-specific: user ID, room ID, etc.)
   * @param message - The message to send
   */
  send(to: string, message: ChannelMessage): Promise<void>;

  /**
   * Get the current status of this channel.
   */
  getStatus(): ChannelStatusInfo;

  /**
   * Gracefully shut down the channel, closing connections.
   */
  shutdown(): Promise<void>;

  /**
   * Get the capabilities of this channel.
   */
  readonly capabilities: ChannelCapabilities;
}

// ---------------------------------------------------------------------------
// Base channel implementation
// ---------------------------------------------------------------------------

/**
 * Abstract base class that provides common plumbing for channel implementations.
 * Concrete channels can extend this to get status tracking and callback management for free.
 */
export abstract class BaseChannel implements AlfredChannel {
  abstract readonly name: string;
  abstract readonly displayName: string;

  protected statusInfo: ChannelStatusInfo = {
    status: 'disconnected',
    connectedSince: null,
    lastMessageAt: null,
    messageCount: 0,
    error: null,
  };

  protected messageCallback: ChannelMessageCallback | null = null;
  protected channelCapabilities: ChannelCapabilities = { ...DEFAULT_CAPABILITIES };

  get capabilities(): ChannelCapabilities {
    return this.channelCapabilities;
  }

  async initialize(_config?: Record<string, unknown>): Promise<void> {
    this.statusInfo.status = 'connecting';
    // Subclasses override to perform actual initialization
    this.statusInfo.status = 'connected';
    this.statusInfo.connectedSince = Date.now();
    this.statusInfo.error = null;
  }

  async listen(callback: ChannelMessageCallback): Promise<void> {
    this.messageCallback = callback;
  }

  abstract send(to: string, message: ChannelMessage): Promise<void>;

  getStatus(): ChannelStatusInfo {
    return { ...this.statusInfo };
  }

  async shutdown(): Promise<void> {
    this.messageCallback = null;
    this.statusInfo.status = 'disconnected';
  }

  /**
   * Helper: dispatch an incoming message through the registered callback.
   */
  protected async dispatchMessage(message: ChannelMessage): Promise<void> {
    this.statusInfo.lastMessageAt = Date.now();
    this.statusInfo.messageCount++;

    if (this.messageCallback) {
      await this.messageCallback(message);
    }
  }

  /**
   * Helper: set the channel into an error state.
   */
  protected setError(error: string): void {
    this.statusInfo.status = 'error';
    this.statusInfo.error = error;
  }
}
