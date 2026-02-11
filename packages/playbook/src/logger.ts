/**
 * @alfred/playbook - Structured event logger
 *
 * High-level logging facade that creates typed PlaybookEntry records and
 * immediately persists them via PlaybookDatabase. Every tool invocation,
 * fallback, forge lifecycle event, and error flows through here.
 */

import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { PlaybookDatabase } from './database.js';
import type { PlaybookEntry, ForgeEventType } from './types.js';

const log = pino({ name: 'alfred:playbook:logger' });

// ---------------------------------------------------------------------------
// Parameter interfaces
// ---------------------------------------------------------------------------

export interface ToolExecutionParams {
  tool: string;
  args: unknown;
  result: unknown;
  error?: string;
  durationMs: number;
  agentId: string;
  sessionId: string;
  channel?: string;
  tags?: string[];
}

export interface FallbackParams {
  capability: string;
  failedProvider: string;
  succeededProvider: string;
  error: string;
  agentId?: string;
  sessionId?: string;
  channel?: string;
}

export interface ForgeEventParams {
  type: ForgeEventType;
  skillName: string;
  details?: unknown;
  agentId?: string;
  sessionId?: string;
}

export interface ErrorParams {
  source: string;
  error: string;
  context?: unknown;
  agentId?: string;
  sessionId?: string;
  channel?: string;
}

// ---------------------------------------------------------------------------
// PlaybookLogger
// ---------------------------------------------------------------------------

export class PlaybookLogger {
  private db: PlaybookDatabase;

  constructor(db: PlaybookDatabase) {
    this.db = db;
  }

  /**
   * Log a tool execution (success or failure).
   * @returns The entry ID of the persisted record.
   */
  logToolExecution(params: ToolExecutionParams): string {
    const entry: Omit<PlaybookEntry, 'id'> = {
      type: 'tool_execution',
      timestamp: new Date().toISOString(),
      tool: params.tool,
      args: params.args,
      result: params.result,
      error: params.error ?? null,
      durationMs: params.durationMs,
      agentId: params.agentId,
      sessionId: params.sessionId,
      channel: params.channel ?? null,
      success: !params.error,
      tags: params.tags ?? [],
    };

    const id = this.db.insert(entry);

    log.debug(
      {
        id,
        tool: params.tool,
        success: entry.success,
        durationMs: params.durationMs,
      },
      'Tool execution logged',
    );

    return id;
  }

  /**
   * Log a fallback event: provider A failed, provider B succeeded.
   * @returns The entry ID of the persisted record.
   */
  logFallback(params: FallbackParams): string {
    const entry: Omit<PlaybookEntry, 'id'> = {
      type: 'fallback',
      timestamp: new Date().toISOString(),
      tool: params.capability,
      args: {
        failedProvider: params.failedProvider,
        succeededProvider: params.succeededProvider,
      },
      result: { succeededProvider: params.succeededProvider },
      error: params.error,
      durationMs: 0,
      agentId: params.agentId ?? '',
      sessionId: params.sessionId ?? '',
      channel: params.channel ?? null,
      success: true, // The fallback itself succeeded
      tags: ['fallback', params.capability, params.failedProvider, params.succeededProvider],
    };

    const id = this.db.insert(entry);

    log.info(
      {
        id,
        capability: params.capability,
        from: params.failedProvider,
        to: params.succeededProvider,
      },
      'Fallback logged',
    );

    return id;
  }

  /**
   * Log a forge lifecycle event (gap detection, build, test, promotion, etc.).
   * @returns The entry ID of the persisted record.
   */
  logForgeEvent(params: ForgeEventParams): string {
    const isFailure = params.type === 'test_failed' || params.type === 'quarantined';

    const entry: Omit<PlaybookEntry, 'id'> = {
      type: 'forge_event',
      timestamp: new Date().toISOString(),
      tool: params.skillName,
      args: { forgeEventType: params.type, details: params.details ?? null },
      result: params.details ?? null,
      error: isFailure ? `Forge ${params.type}: ${params.skillName}` : null,
      durationMs: 0,
      agentId: params.agentId ?? '',
      sessionId: params.sessionId ?? '',
      channel: null,
      success: !isFailure,
      tags: ['forge', params.type, params.skillName],
    };

    const id = this.db.insert(entry);

    log.info(
      { id, forgeEvent: params.type, skill: params.skillName },
      'Forge event logged',
    );

    return id;
  }

  /**
   * Log a general error from any subsystem.
   * @returns The entry ID of the persisted record.
   */
  logError(params: ErrorParams): string {
    const entry: Omit<PlaybookEntry, 'id'> = {
      type: 'error',
      timestamp: new Date().toISOString(),
      tool: params.source,
      args: params.context ?? {},
      result: null,
      error: params.error,
      durationMs: 0,
      agentId: params.agentId ?? '',
      sessionId: params.sessionId ?? '',
      channel: params.channel ?? null,
      success: false,
      tags: ['error', params.source],
    };

    const id = this.db.insert(entry);

    log.warn(
      { id, source: params.source, error: params.error },
      'Error logged',
    );

    return id;
  }

  /**
   * Log a custom / system event.
   * @returns The entry ID of the persisted record.
   */
  logSystem(params: {
    tool: string;
    message: string;
    details?: unknown;
    agentId?: string;
    sessionId?: string;
    tags?: string[];
  }): string {
    const entry: Omit<PlaybookEntry, 'id'> = {
      type: 'system',
      timestamp: new Date().toISOString(),
      tool: params.tool,
      args: params.details ?? {},
      result: { message: params.message },
      error: null,
      durationMs: 0,
      agentId: params.agentId ?? '',
      sessionId: params.sessionId ?? '',
      channel: null,
      success: true,
      tags: params.tags ?? ['system'],
    };

    const id = this.db.insert(entry);

    log.debug({ id, tool: params.tool }, 'System event logged');
    return id;
  }
}
