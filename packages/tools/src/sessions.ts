/**
 * @alfred/tools - SessionsTool
 *
 * Manage conversation sessions:
 *   - list()    – enumerate active sessions
 *   - history() – retrieve message history for a session
 *   - send()    – inject a message into a session
 *   - spawn()   – create a new session with a specific agent
 */

import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import type { SessionInfo, Message } from '@alfred/core';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:sessions' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSendArgs {
  sessionId: string;
  message: string;
}

export interface SessionSpawnArgs {
  agentId: string;
  message: string;
}

export interface SessionSpawnResult {
  sessionId: string;
}

/**
 * Session store backend interface.
 */
export interface SessionBackend {
  listSessions(): Promise<SessionInfo[]>;
  getHistory(sessionId: string): Promise<Message[]>;
  sendMessage(sessionId: string, content: string): Promise<void>;
  createSession(agentId: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// SessionsTool
// ---------------------------------------------------------------------------

export class SessionsTool {
  private executor: SafeExecutor;
  private backend: SessionBackend | null;
  private bus: EventEmitter;

  constructor(executor: SafeExecutor, backend?: SessionBackend, bus?: EventEmitter) {
    this.executor = executor;
    this.backend = backend ?? null;
    this.bus = bus ?? new EventEmitter();
  }

  static definition = {
    name: 'sessions',
    description:
      'Manage conversation sessions. List active sessions, view history, ' +
      'send messages, or spawn new agent sessions.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'history', 'send', 'spawn'],
          description: 'Session action',
        },
        sessionId: { type: 'string', description: 'Session ID (for history/send)' },
        message: { type: 'string', description: 'Message to send (for send/spawn)' },
        agentId: { type: 'string', description: 'Agent ID (for spawn)' },
      },
      required: ['action'],
    },
  };

  /**
   * Set the session backend.
   */
  setBackend(backend: SessionBackend): void {
    this.backend = backend;
  }

  // -----------------------------------------------------------------------
  // List sessions
  // -----------------------------------------------------------------------

  async list(execOpts?: ExecuteOptions): Promise<SessionInfo[]> {
    if (!this.backend) {
      logger.warn('No session backend configured');
      return [];
    }

    const result = await this.executor.execute(
      'sessions.list',
      async () => this.backend!.listSessions(),
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as SessionInfo[];
  }

  // -----------------------------------------------------------------------
  // Get history
  // -----------------------------------------------------------------------

  async history(args: { sessionId: string }, execOpts?: ExecuteOptions): Promise<Message[]> {
    if (!args.sessionId || typeof args.sessionId !== 'string') {
      throw new Error('SessionsTool.history: "sessionId" is required');
    }

    if (!this.backend) {
      logger.warn('No session backend configured');
      return [];
    }

    const result = await this.executor.execute(
      'sessions.history',
      async () => this.backend!.getHistory(args.sessionId),
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as Message[];
  }

  // -----------------------------------------------------------------------
  // Send message
  // -----------------------------------------------------------------------

  async send(args: SessionSendArgs, execOpts?: ExecuteOptions): Promise<void> {
    if (!args.sessionId || typeof args.sessionId !== 'string') {
      throw new Error('SessionsTool.send: "sessionId" is required');
    }
    if (!args.message || typeof args.message !== 'string') {
      throw new Error('SessionsTool.send: "message" is required');
    }

    if (!this.backend) {
      // Emit event as fallback
      this.bus.emit('session:message', {
        sessionId: args.sessionId,
        message: args.message,
        timestamp: Date.now(),
      });
      return;
    }

    const result = await this.executor.execute(
      'sessions.send',
      async () => this.backend!.sendMessage(args.sessionId, args.message),
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  // -----------------------------------------------------------------------
  // Spawn new session
  // -----------------------------------------------------------------------

  async spawn(args: SessionSpawnArgs, execOpts?: ExecuteOptions): Promise<SessionSpawnResult> {
    if (!args.agentId || typeof args.agentId !== 'string') {
      throw new Error('SessionsTool.spawn: "agentId" is required');
    }
    if (!args.message || typeof args.message !== 'string') {
      throw new Error('SessionsTool.spawn: "message" is required');
    }

    if (!this.backend) {
      // Emit event and return generated ID
      const sessionId = nanoid();
      this.bus.emit('session:spawn', {
        sessionId,
        agentId: args.agentId,
        message: args.message,
        timestamp: Date.now(),
      });
      return { sessionId };
    }

    const result = await this.executor.execute(
      'sessions.spawn',
      async () => {
        const sessionId = await this.backend!.createSession(args.agentId);

        // Send initial message
        await this.backend!.sendMessage(sessionId, args.message);

        logger.info(
          { sessionId, agentId: args.agentId },
          'New session spawned',
        );

        return { sessionId };
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as SessionSpawnResult;
  }
}
