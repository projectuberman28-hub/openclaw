/**
 * @alfred/tools - PlaybookTool
 *
 * Query operational memory (the Playbook):
 *   - query()      – search playbook entries
 *   - stats()      – get playbook statistics
 *   - strategies() – list learned strategies
 *   - failures()   – list recent failures
 *
 * The Playbook records tool outcomes, learned strategies, and failure patterns
 * so the agent can improve over time.
 */

import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:playbook' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaybookEntry {
  id: string;
  type: 'success' | 'failure' | 'strategy' | 'note';
  tool: string;
  summary: string;
  details: Record<string, unknown>;
  timestamp: number;
  tags: string[];
}

export interface PlaybookStats {
  totalEntries: number;
  successCount: number;
  failureCount: number;
  strategyCount: number;
  topTools: Array<{ name: string; count: number }>;
  recentActivity: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  applicableTools: string[];
  conditions: string[];
  successRate: number;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface FailureEntry {
  id: string;
  tool: string;
  error: string;
  context: Record<string, unknown>;
  timestamp: number;
  resolved: boolean;
  resolution?: string;
}

export interface PlaybookQueryArgs {
  query: string;
  limit?: number;
}

export interface PlaybookFailuresArgs {
  since?: string;
}

/**
 * Backend interface for the Playbook.
 */
export interface PlaybookBackend {
  query(query: string, limit: number): Promise<PlaybookEntry[]>;
  getStats(): Promise<PlaybookStats>;
  getStrategies(): Promise<Strategy[]>;
  getFailures(since?: Date): Promise<FailureEntry[]>;
}

// ---------------------------------------------------------------------------
// PlaybookTool
// ---------------------------------------------------------------------------

export class PlaybookTool {
  private executor: SafeExecutor;
  private backend: PlaybookBackend | null;

  constructor(executor: SafeExecutor, backend?: PlaybookBackend) {
    this.executor = executor;
    this.backend = backend ?? null;
  }

  static definition = {
    name: 'playbook',
    description:
      'Query operational memory. Search entries, view stats, list strategies, or review failures.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['query', 'stats', 'strategies', 'failures'],
          description: 'Playbook action',
        },
        query: { type: 'string', description: 'Search query (for query action)' },
        limit: { type: 'number', description: 'Max results (for query action)' },
        since: {
          type: 'string',
          description: 'ISO date string – only failures after this date (for failures action)',
        },
      },
      required: ['action'],
    },
  };

  /**
   * Set the playbook backend.
   */
  setBackend(backend: PlaybookBackend): void {
    this.backend = backend;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  async query(args: PlaybookQueryArgs, execOpts?: ExecuteOptions): Promise<PlaybookEntry[]> {
    if (!args.query || typeof args.query !== 'string') {
      throw new Error('PlaybookTool.query: "query" is required');
    }

    if (!this.backend) {
      logger.warn('No playbook backend configured');
      return [];
    }

    const limit = args.limit ?? 20;

    const result = await this.executor.execute(
      'playbook.query',
      async () => this.backend!.query(args.query, limit),
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as PlaybookEntry[];
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  async stats(execOpts?: ExecuteOptions): Promise<PlaybookStats> {
    if (!this.backend) {
      return {
        totalEntries: 0,
        successCount: 0,
        failureCount: 0,
        strategyCount: 0,
        topTools: [],
        recentActivity: 0,
      };
    }

    const result = await this.executor.execute(
      'playbook.stats',
      async () => this.backend!.getStats(),
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return {
        totalEntries: 0,
        successCount: 0,
        failureCount: 0,
        strategyCount: 0,
        topTools: [],
        recentActivity: 0,
      };
    }

    return result.result as PlaybookStats;
  }

  // -----------------------------------------------------------------------
  // Strategies
  // -----------------------------------------------------------------------

  async strategies(execOpts?: ExecuteOptions): Promise<Strategy[]> {
    if (!this.backend) {
      return [];
    }

    const result = await this.executor.execute(
      'playbook.strategies',
      async () => this.backend!.getStrategies(),
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as Strategy[];
  }

  // -----------------------------------------------------------------------
  // Failures
  // -----------------------------------------------------------------------

  async failures(args: PlaybookFailuresArgs = {}, execOpts?: ExecuteOptions): Promise<FailureEntry[]> {
    if (!this.backend) {
      return [];
    }

    const result = await this.executor.execute(
      'playbook.failures',
      async () => {
        let since: Date | undefined;

        if (args.since) {
          since = new Date(args.since);
          if (isNaN(since.getTime())) {
            throw new Error(`PlaybookTool.failures: invalid date "${args.since}"`);
          }
        }

        return this.backend!.getFailures(since);
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as FailureEntry[];
  }
}
