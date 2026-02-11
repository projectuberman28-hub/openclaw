/**
 * @alfred/tools - MemoryWriteTool
 *
 * Store information in long-term memory with tags and metadata.
 * Uses the memory backend from @alfred/memory.
 */

import { nanoid } from 'nanoid';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:memory-write' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryWriteArgs {
  content: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface MemoryWriteResult {
  id: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

/**
 * Interface expected from the memory backend for writes.
 */
export interface MemoryWriteBackend {
  store(entry: MemoryEntry): Promise<void>;
}

// ---------------------------------------------------------------------------
// MemoryWriteTool
// ---------------------------------------------------------------------------

export class MemoryWriteTool {
  private executor: SafeExecutor;
  private backend: MemoryWriteBackend | null;

  constructor(executor: SafeExecutor, backend?: MemoryWriteBackend) {
    this.executor = executor;
    this.backend = backend ?? null;
  }

  static definition = {
    name: 'memory_write',
    description:
      'Store information in long-term memory for later retrieval. ' +
      'Attach tags and metadata for organisation.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to remember' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorisation (optional)',
        },
        metadata: {
          type: 'object',
          description: 'Arbitrary metadata (optional)',
        },
      },
      required: ['content'],
    },
  };

  /**
   * Set the write backend (for lazy initialization).
   */
  setBackend(backend: MemoryWriteBackend): void {
    this.backend = backend;
  }

  /**
   * Write content to long-term memory.
   */
  async write(args: MemoryWriteArgs, execOpts?: ExecuteOptions): Promise<MemoryWriteResult> {
    if (!args.content || typeof args.content !== 'string') {
      throw new Error('MemoryWriteTool: "content" is required');
    }

    if (!this.backend) {
      // Fallback: log a warning and return a generated ID
      logger.warn('No memory backend configured – entry will not be persisted');
      return { id: nanoid() };
    }

    const result = await this.executor.execute(
      'memory_write',
      async () => {
        const id = nanoid();
        const entry: MemoryEntry = {
          id,
          content: args.content,
          tags: args.tags ?? [],
          metadata: args.metadata ?? {},
          createdAt: Date.now(),
        };

        await this.backend!.store(entry);

        logger.info(
          { id, tags: entry.tags, contentLength: args.content.length },
          'Memory entry stored',
        );

        return { id };
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as MemoryWriteResult;
  }
}
