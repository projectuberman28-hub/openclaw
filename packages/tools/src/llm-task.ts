/**
 * @alfred/tools - LLMTaskTool
 *
 * Delegate a subtask to another LLM call.
 * Useful for:
 *   - Summarisation
 *   - Data extraction
 *   - Translation
 *   - Reasoning chains
 *
 * Supports configurable model, max tokens, and temperature.
 */

import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:llm-task' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMTaskArgs {
  /** The prompt / task description to send to the LLM. */
  prompt: string;
  /** Model identifier (e.g. "anthropic/claude-sonnet-4-20250514"). */
  model?: string;
  /** Maximum tokens for the response. */
  maxTokens?: number;
  /** Temperature for sampling (0-2). */
  temperature?: number;
  /** System prompt override. */
  systemPrompt?: string;
}

export interface LLMTaskResult {
  response: string;
  model: string;
  tokensUsed?: number;
}

export interface LLMTaskConfig {
  /** Default model if none specified in the call. */
  defaultModel?: string;
  /** Default max tokens. */
  defaultMaxTokens?: number;
  /** Default temperature. */
  defaultTemperature?: number;
}

/**
 * Backend interface for making LLM calls.
 * The actual implementation is provided by the agent package.
 */
export interface LLMBackend {
  complete(request: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    maxTokens: number;
    temperature: number;
  }): Promise<{ content: string; tokensUsed?: number }>;
}

// ---------------------------------------------------------------------------
// LLMTaskTool
// ---------------------------------------------------------------------------

export class LLMTaskTool {
  private executor: SafeExecutor;
  private config: LLMTaskConfig;
  private backend: LLMBackend | null;

  constructor(executor: SafeExecutor, config: LLMTaskConfig = {}, backend?: LLMBackend) {
    this.executor = executor;
    this.config = config;
    this.backend = backend ?? null;
  }

  static definition = {
    name: 'llm_task',
    description:
      'Delegate a subtask to an LLM. Useful for summarisation, extraction, translation, ' +
      'or any task that benefits from a separate LLM call.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task prompt' },
        model: { type: 'string', description: 'Model identifier (optional)' },
        maxTokens: { type: 'number', description: 'Max response tokens (optional)' },
        temperature: { type: 'number', description: 'Temperature 0-2 (optional)' },
        systemPrompt: { type: 'string', description: 'System prompt override (optional)' },
      },
      required: ['prompt'],
    },
  };

  /**
   * Set the LLM backend (for lazy initialization).
   */
  setBackend(backend: LLMBackend): void {
    this.backend = backend;
  }

  /**
   * Run a subtask via the LLM.
   */
  async run(args: LLMTaskArgs, execOpts?: ExecuteOptions): Promise<LLMTaskResult> {
    if (!args.prompt || typeof args.prompt !== 'string') {
      throw new Error('LLMTaskTool: "prompt" is required');
    }

    if (!this.backend) {
      throw new Error('LLMTaskTool: no LLM backend configured');
    }

    const model = args.model ?? this.config.defaultModel ?? 'anthropic/claude-sonnet-4-20250514';
    const maxTokens = args.maxTokens ?? this.config.defaultMaxTokens ?? 4096;
    const temperature = args.temperature ?? this.config.defaultTemperature ?? 0.7;

    // Clamp temperature
    const clampedTemp = Math.max(0, Math.min(2, temperature));

    const result = await this.executor.execute(
      'llm_task',
      async () => {
        const messages: Array<{ role: string; content: string }> = [];

        if (args.systemPrompt) {
          messages.push({ role: 'system', content: args.systemPrompt });
        }

        messages.push({ role: 'user', content: args.prompt });

        logger.debug(
          { model, maxTokens, temperature: clampedTemp },
          'Delegating LLM subtask',
        );

        const response = await this.backend!.complete({
          model,
          messages,
          maxTokens,
          temperature: clampedTemp,
        });

        return {
          response: response.content,
          model,
          tokensUsed: response.tokensUsed,
        };
      },
      { timeout: 120_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as LLMTaskResult;
  }
}
