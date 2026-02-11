/**
 * @alfred/channels - Channel Router
 *
 * Routes incoming channel messages to the appropriate agent.
 * Refreshes bindings per message so config changes take effect immediately.
 * Queues messages for ordered processing.
 */

import { EventEmitter } from 'node:events';
import type { ChannelMessage } from '@alfred/core/types/index.js';
import { AgentRouter } from '../agents/routing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutedMessage {
  /** The original channel message. */
  message: ChannelMessage;
  /** The resolved agent ID. */
  agentId: string;
  /** Timestamp when the message was queued. */
  queuedAt: number;
  /** Timestamp when routing was resolved. */
  routedAt: number;
}

// ---------------------------------------------------------------------------
// ChannelRouter
// ---------------------------------------------------------------------------

export class ChannelRouter extends EventEmitter {
  private agentRouter: AgentRouter;
  private queue: RoutedMessage[] = [];
  private processing = false;
  private maxQueueSize: number;

  constructor(agentRouter: AgentRouter, options?: { maxQueueSize?: number }) {
    super();
    this.agentRouter = agentRouter;
    this.maxQueueSize = options?.maxQueueSize ?? 1000;
  }

  /**
   * Route a channel message to the appropriate agent.
   *
   * Messages are queued and processed in order. The router emits a
   * 'message' event for each routed message that handlers can consume.
   */
  async route(message: ChannelMessage): Promise<void> {
    // Determine target agent
    const agentId = this.agentRouter.route(message);

    const routed: RoutedMessage = {
      message,
      agentId,
      queuedAt: Date.now(),
      routedAt: Date.now(),
    };

    // Enforce queue size limit
    if (this.queue.length >= this.maxQueueSize) {
      console.warn(
        `[ChannelRouter] Queue full (${this.maxQueueSize}), dropping oldest message`,
      );
      this.queue.shift();
    }

    this.queue.push(routed);
    this.emit('message', routed);

    // Process queue if not already running
    if (!this.processing) {
      await this.processQueue();
    }
  }

  /**
   * Process queued messages in order.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const routed = this.queue.shift()!;

        try {
          // Emit 'process' event for handlers to act on
          this.emit('process', routed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[ChannelRouter] Error processing message from ${routed.message.channel}: ${message}`,
          );
          this.emit('error', { routed, error: message });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get the current queue depth.
   */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /**
   * Get the underlying agent router.
   */
  getAgentRouter(): AgentRouter {
    return this.agentRouter;
  }

  /**
   * Clear the message queue.
   */
  clearQueue(): void {
    this.queue = [];
  }
}
