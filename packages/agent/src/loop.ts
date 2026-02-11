/**
 * @alfred/agent - Agent Loop
 *
 * The core execution loop for the AI assistant. Orchestrates:
 *   1. Intake (user message)
 *   2. Context assembly (system prompt + memories + conversation history)
 *   3. LLM inference (streaming)
 *   4. Tool use detection & execution
 *   5. Loop continuation or final reply
 *
 * Features:
 *   - Emits events via AsyncGenerator for real-time streaming
 *   - Max 25 iterations to prevent infinite loops
 *   - Context overflow recovery with progressive fallback
 *   - Abort support via AbortController
 *   - Token usage tracking per run
 */

import type {
  AgentConfig,
  Message,
  ToolDefinition,
  ToolResult,
  ToolResultBlock,
  ToolUse,
} from '@alfred/core';

import { ContextAssembler, estimateTokens } from './context.js';
import { buildSystemPrompt } from './system-prompt.js';
import { SessionCompactor } from './compaction.js';
import { StreamProcessor, type StreamChunk } from './streaming.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events emitted by the agent loop */
export interface AgentEvent {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  data: unknown;
}

/** Input to the agent loop */
export interface AgentInput {
  message: string;
  sessionId: string;
  channel: string;
}

/** A tool registry provides tool definitions and execution */
export interface ToolRegistry {
  /** Get all available tool definitions */
  getDefinitions(): ToolDefinition[];
  /** Execute a tool by name with arguments */
  execute(name: string, args: Record<string, unknown>, abortSignal?: AbortSignal): Promise<ToolResult>;
}

/** A model provider handles LLM inference */
export interface ModelProvider {
  /**
   * Send a chat completion request and return a readable stream.
   * Should throw an error with a numeric `status` property for HTTP errors.
   */
  chat(params: {
    model: string;
    messages: Array<{ role: string; content: string; toolUse?: ToolUse[]; toolResult?: Array<{ toolUseId: string; content: unknown; isError?: boolean }> }>;
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;
}

/** A memory store provides recall capabilities */
export interface MemoryStore {
  /** Recall memories relevant to a query */
  recall(query: string, limit?: number): Promise<string[]>;
  /** Store a new memory */
  store(content: string, tags?: string[]): Promise<void>;
}

/** Configuration for the agent loop */
export interface AgentLoopConfig {
  /** Agent configuration */
  agent: AgentConfig & { systemPrompt?: string; contextWindow?: number; maxTokens?: number; temperature?: number };
  /** Tool registry */
  tools: ToolRegistry;
  /** Model provider */
  model: ModelProvider;
  /** Memory store (optional) */
  memory?: MemoryStore;
  /** Maximum loop iterations (default: 25) */
  maxIterations?: number;
  /** Maximum characters for tool results during overflow recovery */
  overflowToolResultCap?: number;
}

/** Token usage stats for a loop run */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

export class AgentLoop {
  private readonly agent: AgentLoopConfig['agent'];
  private readonly tools: ToolRegistry;
  private readonly model: ModelProvider;
  private readonly memory: MemoryStore | undefined;
  private readonly maxIterations: number;
  private readonly overflowToolResultCap: number;
  private readonly contextAssembler: ContextAssembler;
  private readonly compactor: SessionCompactor;
  private readonly streamProcessor: StreamProcessor;

  constructor(config: AgentLoopConfig) {
    this.agent = config.agent;
    this.tools = config.tools;
    this.model = config.model;
    this.memory = config.memory;
    this.maxIterations = config.maxIterations ?? 25;
    this.overflowToolResultCap = config.overflowToolResultCap ?? 2000;
    this.contextAssembler = new ContextAssembler();
    this.compactor = new SessionCompactor();
    this.streamProcessor = new StreamProcessor();
  }

  /**
   * Run the agent loop.
   *
   * Yields AgentEvent objects as the loop progresses:
   *   - 'thinking': agent is processing
   *   - 'text': text delta from the model
   *   - 'tool_use': model wants to use a tool
   *   - 'tool_result': result of tool execution
   *   - 'error': an error occurred
   *   - 'done': loop complete
   *
   * @param input - User message, session ID, and channel
   * @param abortController - Optional AbortController for cancellation
   */
  async *run(
    input: AgentInput,
    abortController?: AbortController,
  ): AsyncGenerator<AgentEvent> {
    const signal = abortController?.signal;

    // Token tracking
    const tokenUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    // Conversation messages for this run
    const messages: Message[] = [];

    // Add the user message
    const userMessage: Message = {
      role: 'user',
      content: input.message,
      timestamp: Date.now(),
      sessionId: input.sessionId,
    };
    messages.push(userMessage);

    yield { type: 'thinking', data: { phase: 'intake' } };

    // Recall memories
    let memories: string[] = [];
    if (this.memory) {
      try {
        memories = await this.memory.recall(input.message, 10);
      } catch (err) {
        yield {
          type: 'error',
          data: { message: 'Memory recall failed', error: String(err) },
        };
        // Continue without memories
      }
    }

    // Get tool definitions
    const toolDefs = this.tools.getDefinitions();
    const toolNames = toolDefs.map((t) => t.name);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(this.agent, {
      tools: toolNames,
      channel: input.channel,
      dateTime: new Date().toISOString(),
    });

    // Main loop
    let iteration = 0;
    let pendingToolResults: Message[] = [];
    let overflowRetryMode: 'none' | 'cap_tools' | 'compact' = 'none';

    while (iteration < this.maxIterations) {
      iteration++;

      // Check for abort
      if (signal?.aborted) {
        yield { type: 'error', data: { message: 'Aborted by user' } };
        yield { type: 'done', data: { tokenUsage, iterations: iteration, aborted: true } };
        return;
      }

      yield { type: 'thinking', data: { phase: 'context_assembly', iteration } };

      // Build the full message list for this iteration
      const allMessages = [...messages, ...pendingToolResults];

      // Apply overflow recovery if needed
      const processedMessages = overflowRetryMode === 'cap_tools'
        ? this.capToolResults(allMessages, this.overflowToolResultCap)
        : allMessages;

      // Assemble context
      const contextWindow = this.agent.contextWindow ?? 128000;
      const maxResponseTokens = this.agent.maxTokens ?? 8192;
      const contextBudget = contextWindow - maxResponseTokens;

      let assembledMessages: Message[];

      if (overflowRetryMode === 'compact') {
        // Compact the conversation before assembling
        const compactionResult = await this.compactor.compact(processedMessages, {
          reserveTokensFloor: Math.floor(contextBudget * 0.6),
          memoryFlush: false,
        });
        assembledMessages = this.contextAssembler.assemble({
          systemPrompt,
          messages: compactionResult.compactedMessages,
          memories,
          tools: toolDefs,
          maxTokens: contextBudget,
        }).messages;
      } else {
        assembledMessages = this.contextAssembler.assemble({
          systemPrompt,
          messages: processedMessages,
          memories,
          tools: toolDefs,
          maxTokens: contextBudget,
        }).messages;
      }

      // Track prompt tokens
      const promptTokens = estimateTokens(assembledMessages);
      tokenUsage.promptTokens += promptTokens;

      yield { type: 'thinking', data: { phase: 'inference', iteration } };

      // Call the model
      let stream: ReadableStream<Uint8Array>;
      try {
        stream = await this.model.chat({
          model: this.agent.model,
          messages: assembledMessages.map((m) => ({
            role: m.role,
            content: m.content,
            toolUse: m.toolUse,
            toolResult: m.toolResult,
          })),
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          maxTokens: maxResponseTokens,
          temperature: this.agent.temperature ?? 0.7,
          signal,
        });
      } catch (err: unknown) {
        // Check for context overflow error (HTTP status based)
        if (this.isContextOverflowError(err)) {
          if (overflowRetryMode === 'none') {
            // First retry: cap tool results
            overflowRetryMode = 'cap_tools';
            yield {
              type: 'error',
              data: {
                message: 'Context overflow detected, retrying with capped tool results',
                recoverable: true,
              },
            };
            continue;
          } else if (overflowRetryMode === 'cap_tools') {
            // Second retry: compact conversation
            overflowRetryMode = 'compact';
            yield {
              type: 'error',
              data: {
                message: 'Context still overflowing, retrying with compacted history',
                recoverable: true,
              },
            };
            continue;
          } else {
            // Third failure: give up
            yield {
              type: 'error',
              data: {
                message: 'Context overflow could not be recovered',
                error: String(err),
              },
            };
            yield { type: 'done', data: { tokenUsage, iterations: iteration, error: true } };
            return;
          }
        }

        yield {
          type: 'error',
          data: { message: 'Model inference failed', error: String(err) },
        };
        yield { type: 'done', data: { tokenUsage, iterations: iteration, error: true } };
        return;
      }

      // Reset overflow mode on success
      overflowRetryMode = 'none';

      // Process the stream
      let assistantText = '';
      const toolUses: ToolUse[] = [];
      let completionTokens = 0;

      try {
        for await (const chunk of this.streamProcessor.processStream(stream)) {
          // Check abort during streaming
          if (signal?.aborted) {
            yield { type: 'error', data: { message: 'Aborted during streaming' } };
            yield { type: 'done', data: { tokenUsage, iterations: iteration, aborted: true } };
            return;
          }

          yield* this.handleStreamChunk(chunk, toolUses);

          if (chunk.type === 'text_delta') {
            const text = (chunk.data as { text: string }).text;
            assistantText += text;
            completionTokens += estimateTokens(text);
          }
        }
      } catch (err) {
        yield {
          type: 'error',
          data: { message: 'Stream processing failed', error: String(err) },
        };
        yield { type: 'done', data: { tokenUsage, iterations: iteration, error: true } };
        return;
      }

      tokenUsage.completionTokens += completionTokens;
      tokenUsage.totalTokens = tokenUsage.promptTokens + tokenUsage.completionTokens;

      // Add assistant message to history
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantText,
        timestamp: Date.now(),
        sessionId: input.sessionId,
        toolUse: toolUses.length > 0 ? toolUses : undefined,
      };
      messages.push(assistantMessage);

      // If no tool uses, we're done
      if (toolUses.length === 0) {
        yield {
          type: 'done',
          data: {
            tokenUsage,
            iterations: iteration,
            finalText: assistantText,
          },
        };
        return;
      }

      // Execute tools
      pendingToolResults = [];

      for (const toolUse of toolUses) {
        if (signal?.aborted) {
          yield { type: 'error', data: { message: 'Aborted during tool execution' } };
          yield { type: 'done', data: { tokenUsage, iterations: iteration, aborted: true } };
          return;
        }

        yield {
          type: 'tool_use',
          data: { id: toolUse.id, name: toolUse.name, arguments: toolUse.arguments },
        };

        let toolResult: ToolResult;
        try {
          toolResult = await this.tools.execute(
            toolUse.name,
            toolUse.arguments as Record<string, unknown>,
            signal,
          );
        } catch (err) {
          toolResult = {
            name: toolUse.name,
            error: `Tool execution failed: ${String(err)}`,
            durationMs: 0,
          };
        }

        yield {
          type: 'tool_result',
          data: {
            toolUseId: toolUse.id,
            name: toolResult.name,
            result: toolResult.result,
            error: toolResult.error,
            durationMs: toolResult.durationMs,
          },
        };

        // Build a tool result message
        const resultContent = toolResult.error
          ? `Error: ${toolResult.error}`
          : typeof toolResult.result === 'string'
            ? toolResult.result
            : JSON.stringify(toolResult.result ?? 'No output');

        const toolResultMessage: Message = {
          role: 'tool',
          content: resultContent,
          timestamp: Date.now(),
          sessionId: input.sessionId,
          toolResult: [
            {
              toolUseId: toolUse.id,
              content: toolResult.result ?? toolResult.error ?? '',
              isError: !!toolResult.error,
            },
          ],
        };

        pendingToolResults.push(toolResultMessage);
      }

      // Continue the loop (tool results will be included in the next iteration)
      messages.push(...pendingToolResults);
      pendingToolResults = [];
    }

    // Hit max iterations
    yield {
      type: 'error',
      data: {
        message: `Maximum iterations (${this.maxIterations}) reached. Stopping to prevent infinite loop.`,
      },
    };
    yield { type: 'done', data: { tokenUsage, iterations: this.maxIterations, maxIterationsReached: true } };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Handle a stream chunk and yield appropriate AgentEvents.
   */
  private *handleStreamChunk(
    chunk: StreamChunk,
    toolUses: ToolUse[],
  ): Generator<AgentEvent> {
    switch (chunk.type) {
      case 'text_delta': {
        const text = (chunk.data as { text: string }).text;
        yield { type: 'text', data: { text } };
        break;
      }

      case 'tool_use_start': {
        // Will be yielded when execution starts
        break;
      }

      case 'tool_use_end': {
        const toolData = chunk.data as { id: string; name: string; input: unknown };
        toolUses.push({
          id: toolData.id,
          name: toolData.name,
          arguments: (toolData.input ?? {}) as Record<string, unknown>,
        });
        break;
      }

      case 'tool_use_delta': {
        // Accumulation handled by StreamProcessor
        break;
      }

      case 'message_stop': {
        // Handled by the loop after stream processing
        break;
      }
    }
  }

  /**
   * Determine if an error is a context overflow error.
   *
   * ONLY triggers on actual API errors (HTTP status codes), NOT on
   * response text that happens to contain the word "overflow".
   */
  private isContextOverflowError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;

    const statusCode = (err as { status?: number }).status;

    // HTTP 413 (Payload Too Large) or 400 with specific error codes
    if (statusCode === 413) return true;

    if (statusCode === 400) {
      const message = (err as { message?: string }).message ?? '';
      const code = (err as { code?: string }).code ?? '';

      // Check for known provider error codes/messages for context overflow
      if (
        code === 'context_length_exceeded' ||
        code === 'max_tokens_exceeded' ||
        code === 'request_too_large' ||
        /\bcontext.{0,20}(?:length|window|limit)\b/i.test(message) ||
        /\btoo many tokens\b/i.test(message) ||
        /\bmax.{0,10}token.{0,10}exceed/i.test(message)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Cap the content of tool result messages to a maximum character count.
   * Used during overflow recovery to reduce context size.
   */
  private capToolResults(messages: Message[], maxChars: number): Message[] {
    return messages.map((msg) => {
      if (msg.role !== 'tool') return msg;

      const content = msg.content;
      if (content.length <= maxChars) return msg;

      const truncated = content.slice(0, maxChars) + `\n...[truncated, ${content.length - maxChars} chars removed]`;

      return {
        ...msg,
        content: truncated,
        toolResult: msg.toolResult?.map((tr: ToolResultBlock) => ({
          ...tr,
          content: typeof tr.content === 'string' && tr.content.length > maxChars
            ? tr.content.slice(0, maxChars) + '...[truncated]'
            : tr.content,
        })),
      };
    });
  }
}
