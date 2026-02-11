/**
 * @alfred/tools - MemorySearchTool
 *
 * Search long-term memory using HybridSearch from @alfred/memory.
 * Combines keyword (BM25-style) and vector-based semantic search
 * with tag filtering.
 */

import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:memory-search' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryResult {
  id: string;
  content: string;
  score: number;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface MemorySearchArgs {
  query: string;
  limit?: number;
  tags?: string[];
}

/**
 * Interface expected from the memory backend.
 * The actual implementation lives in @alfred/memory.
 */
export interface HybridSearchBackend {
  search(query: string, options?: { limit?: number; tags?: string[] }): Promise<MemoryResult[]>;
}

// ---------------------------------------------------------------------------
// MemorySearchTool
// ---------------------------------------------------------------------------

export class MemorySearchTool {
  private executor: SafeExecutor;
  private backend: HybridSearchBackend | null;

  constructor(executor: SafeExecutor, backend?: HybridSearchBackend) {
    this.executor = executor;
    this.backend = backend ?? null;
  }

  static definition = {
    name: 'memory_search',
    description:
      'Search long-term memory for relevant information. ' +
      'Uses hybrid keyword + semantic search with optional tag filtering.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (optional)',
        },
      },
      required: ['query'],
    },
  };

  /**
   * Set the search backend (for lazy initialization).
   */
  setBackend(backend: HybridSearchBackend): void {
    this.backend = backend;
  }

  /**
   * Search long-term memory.
   */
  async search(args: MemorySearchArgs, execOpts?: ExecuteOptions): Promise<MemoryResult[]> {
    if (!args.query || typeof args.query !== 'string') {
      throw new Error('MemorySearchTool: "query" is required');
    }

    if (!this.backend) {
      logger.warn('No memory backend configured – returning empty results');
      return [];
    }

    const limit = args.limit ?? 10;

    const result = await this.executor.execute(
      'memory_search',
      async () => {
        const results = await this.backend!.search(args.query, {
          limit,
          tags: args.tags,
        });

        logger.debug(
          { query: args.query, resultCount: results.length },
          'Memory search completed',
        );

        return results;
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      logger.error({ error: result.error }, 'Memory search failed');
      return [];
    }

    return result.result as MemoryResult[];
  }
}
