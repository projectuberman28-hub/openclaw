/**
 * @alfred/tools - SafeExecutor
 *
 * Wraps ALL tool calls with:
 *   - Configurable timeout (default 30 000 ms)
 *   - AbortController / AbortSignal integration
 *   - Error sanitisation (no raw stack traces to users)
 *   - Duration tracking
 *   - onToolComplete callback for logging / playbook events
 *
 * Emits a 'tool:failure' event via the optional EventEmitter so that
 * the playbook package can listen without a circular dependency.
 */

import { EventEmitter } from 'node:events';
import type { ToolResult } from '@alfred/core';
import pino from 'pino';

const logger = pino({ name: 'alfred:tools:executor' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  /** Timeout in milliseconds. Default 30 000. */
  timeout?: number;
  /** External abort signal – the call is cancelled when this fires. */
  signal?: AbortSignal;
}

export type OnToolComplete = (result: ToolResult) => void | Promise<void>;

export interface SafeExecutorOptions {
  /** Default timeout in ms for every tool invocation. */
  defaultTimeout?: number;
  /** Callback fired after every tool invocation completes (success or error). */
  onToolComplete?: OnToolComplete;
  /** Optional event emitter for broadcasting tool events. */
  bus?: EventEmitter;
}

// ---------------------------------------------------------------------------
// Error sanitisation
// ---------------------------------------------------------------------------

/**
 * Strip internal file paths and stack frames from error messages so that
 * raw implementation details are never surfaced to end-users / the LLM.
 */
function sanitiseError(err: unknown): string {
  if (err instanceof Error) {
    // Keep the message but drop the stack
    const msg = err.message || 'Unknown error';
    // Strip absolute file paths (Unix + Windows)
    return msg
      .replace(/\s+at\s+.+/g, '')
      .replace(/[A-Z]:\\[^\s:]+/gi, '[path]')
      .replace(/\/[\w./-]+/g, '[path]')
      .trim();
  }
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}

// ---------------------------------------------------------------------------
// SafeExecutor
// ---------------------------------------------------------------------------

export class SafeExecutor {
  private defaultTimeout: number;
  private onToolComplete?: OnToolComplete;
  private bus?: EventEmitter;

  constructor(options: SafeExecutorOptions = {}) {
    this.defaultTimeout = options.defaultTimeout ?? 30_000;
    this.onToolComplete = options.onToolComplete;
    this.bus = options.bus;
  }

  /**
   * Execute a tool function with timeout, abort, and error handling.
   *
   * @param toolName  Human-readable tool name (for logging / result).
   * @param fn        The async function to execute.
   * @param options   Per-call overrides for timeout / signal.
   * @returns         A ToolResult with name, result/error, and durationMs.
   */
  async execute(
    toolName: string,
    fn: () => Promise<any>,
    options?: ExecuteOptions,
  ): Promise<ToolResult> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const externalSignal = options?.signal;
    const start = performance.now();

    // Build an internal AbortController that merges timeout + external signal
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Wire up the external signal
    const onExternalAbort = () => ac.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        return this.buildResult(toolName, undefined, 'Aborted before execution', 0);
      }
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ac.abort();
            reject(new Error(`Tool "${toolName}" timed out after ${timeout}ms`));
          }, timeout);
        }),
        // Listen on internal controller so external abort also rejects
        new Promise<never>((_, reject) => {
          if (ac.signal.aborted) {
            reject(new Error('Aborted'));
            return;
          }
          ac.signal.addEventListener('abort', () => reject(new Error('Aborted')), {
            once: true,
          });
        }),
      ]);

      const durationMs = Math.round(performance.now() - start);
      const toolResult: ToolResult = { name: toolName, result, durationMs };

      this.emitComplete(toolResult);
      return toolResult;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMsg = sanitiseError(err);

      logger.warn({ tool: toolName, durationMs, error: errorMsg }, 'Tool execution failed');

      const toolResult: ToolResult = {
        name: toolName,
        result: undefined,
        error: errorMsg,
        durationMs,
      };

      this.emitComplete(toolResult);
      this.emitFailure(toolResult);

      return toolResult;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildResult(
    name: string,
    result: any,
    error: string | undefined,
    durationMs: number,
  ): ToolResult {
    const tr: ToolResult = { name, result, durationMs };
    if (error) tr.error = error;
    this.emitComplete(tr);
    if (error) this.emitFailure(tr);
    return tr;
  }

  private emitComplete(result: ToolResult): void {
    try {
      this.onToolComplete?.(result);
    } catch {
      // Swallow callback errors – they must not break tool execution.
    }
  }

  private emitFailure(result: ToolResult): void {
    try {
      this.bus?.emit('tool:failure', result);
    } catch {
      // Swallow – bus listeners must not break tool execution.
    }
  }
}
