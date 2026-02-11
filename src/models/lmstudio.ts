/**
 * @alfred/models - LM Studio Provider
 *
 * Implements ModelProvider for LM Studio's OpenAI-compatible API.
 * Communicates with localhost:1234 by default.
 * NO privacy gate -- data stays local.
 */

import type { StreamChunk } from '@alfred/agent/streaming.js';
import type { ModelProvider, ChatMessage, ChatOptions } from './provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE = 'http://localhost:1234';
const LOG_PREFIX = '[LMStudioProvider]';

// ---------------------------------------------------------------------------
// LMStudioProvider
// ---------------------------------------------------------------------------

export class LMStudioProvider implements ModelProvider {
  readonly name = 'lmstudio';
  readonly model: string;

  private baseUrl: string;

  constructor(model: string, baseUrl?: string) {
    this.model = model;
    this.baseUrl = baseUrl ?? process.env['LMSTUDIO_BASE_URL'] ?? DEFAULT_BASE;
  }

  /**
   * Check if LM Studio is available by pinging the /v1/models endpoint.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.baseUrl}/v1/models`, {
        signal: controller.signal,
      });

      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a streaming chat request to LM Studio's OpenAI-compatible API.
   */
  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    // Build request body (OpenAI-compatible format)
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    if (options?.maxTokens !== undefined) {
      body['max_tokens'] = options.maxTokens;
    }

    if (options?.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      body['tools'] = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    // Make the streaming request
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${LOG_PREFIX} HTTP ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error(`${LOG_PREFIX} No response body`);
    }

    // Process SSE stream (same format as OpenAI)
    yield* this.processSSEStream(response.body);
  }

  /**
   * Process an OpenAI-compatible SSE stream.
   */
  private async *processSSEStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let activeToolUse: { id: string; name: string; inputJson: string } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            if (activeToolUse) {
              let input: unknown = {};
              try { input = JSON.parse(activeToolUse.inputJson); } catch { /* use empty */ }
              yield {
                type: 'tool_use_end',
                data: { id: activeToolUse.id, name: activeToolUse.name, input },
              };
              activeToolUse = null;
            }
            yield { type: 'message_stop', data: {} };
            return;
          }

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          const choices = event['choices'] as Array<Record<string, unknown>> | undefined;
          if (!choices || choices.length === 0) continue;

          const choice = choices[0]!;
          const delta = choice['delta'] as Record<string, unknown> | undefined;

          if (delta) {
            const content = delta['content'] as string | undefined;
            if (content) {
              yield { type: 'text_delta', data: { text: content } };
            }

            // Tool calls
            const toolCalls = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
            if (toolCalls) {
              for (const tc of toolCalls) {
                const fn = tc['function'] as Record<string, unknown> | undefined;
                if (!fn) continue;

                if (fn['name']) {
                  if (activeToolUse) {
                    let input: unknown = {};
                    try { input = JSON.parse(activeToolUse.inputJson); } catch { /* use empty */ }
                    yield {
                      type: 'tool_use_end',
                      data: { id: activeToolUse.id, name: activeToolUse.name, input },
                    };
                  }

                  activeToolUse = {
                    id: (tc['id'] as string) ?? '',
                    name: (fn['name'] as string) ?? '',
                    inputJson: (fn['arguments'] as string) ?? '',
                  };
                  yield {
                    type: 'tool_use_start',
                    data: { id: activeToolUse.id, name: activeToolUse.name },
                  };
                } else if (fn['arguments'] && activeToolUse) {
                  const partial = (fn['arguments'] as string) ?? '';
                  activeToolUse.inputJson += partial;
                  yield {
                    type: 'tool_use_delta',
                    data: { partial_json: partial },
                  };
                }
              }
            }
          }

          const finishReason = choice['finish_reason'] as string | null;
          if (finishReason === 'tool_calls' && activeToolUse) {
            let input: unknown = {};
            try { input = JSON.parse(activeToolUse.inputJson); } catch { /* use empty */ }
            yield {
              type: 'tool_use_end',
              data: { id: activeToolUse.id, name: activeToolUse.name, input },
            };
            activeToolUse = null;
          } else if (finishReason === 'stop') {
            yield { type: 'message_stop', data: {} };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
