/**
 * @alfred/tools - MessageTool
 *
 * Send messages via channels (Discord, Matrix, Slack, email, etc.).
 * This is a placeholder that emits events for the channel router to handle.
 * The actual delivery is performed by channel-specific adapters.
 */

import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:message' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageSendArgs {
  /** Channel name (e.g. "discord", "matrix", "slack", "email"). */
  channel: string;
  /** Recipient identifier (user ID, email, room, etc.). */
  to: string;
  /** Message body. */
  message: string;
  /** Optional attachment paths. */
  attachments?: string[];
}

export interface MessageSendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/** Event payload emitted for the channel router. */
export interface MessageEvent {
  id: string;
  channel: string;
  to: string;
  message: string;
  attachments: string[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// MessageTool
// ---------------------------------------------------------------------------

export class MessageTool {
  private executor: SafeExecutor;
  private bus: EventEmitter;

  constructor(executor: SafeExecutor, bus?: EventEmitter) {
    this.executor = executor;
    this.bus = bus ?? new EventEmitter();
  }

  static definition = {
    name: 'message',
    description:
      'Send a message via a named channel (discord, matrix, slack, email, etc.). ' +
      'The channel router handles delivery.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name' },
        to: { type: 'string', description: 'Recipient identifier' },
        message: { type: 'string', description: 'Message body' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to attach (optional)',
        },
      },
      required: ['channel', 'to', 'message'],
    },
  };

  /**
   * Send a message. Emits a 'message:send' event for the channel router.
   *
   * Returns immediately with a message ID. Actual delivery is async
   * and handled by the relevant channel adapter.
   */
  async send(args: MessageSendArgs, execOpts?: ExecuteOptions): Promise<MessageSendResult> {
    if (!args.channel || typeof args.channel !== 'string') {
      throw new Error('MessageTool: "channel" is required');
    }
    if (!args.to || typeof args.to !== 'string') {
      throw new Error('MessageTool: "to" is required');
    }
    if (!args.message || typeof args.message !== 'string') {
      throw new Error('MessageTool: "message" is required');
    }

    const result = await this.executor.execute(
      'message.send',
      async () => {
        const messageId = nanoid();

        const event: MessageEvent = {
          id: messageId,
          channel: args.channel,
          to: args.to,
          message: args.message,
          attachments: args.attachments ?? [],
          timestamp: Date.now(),
        };

        // Emit for the channel router to pick up
        this.bus.emit('message:send', event);

        logger.info(
          { messageId, channel: args.channel, to: args.to },
          'Message queued for delivery',
        );

        return { sent: true, messageId };
      },
      { timeout: 5_000, ...execOpts },
    );

    if (result.error) {
      return { sent: false, error: result.error };
    }

    return result.result as MessageSendResult;
  }

  /**
   * Get the event bus (for registering channel handlers).
   */
  getEventBus(): EventEmitter {
    return this.bus;
  }
}
