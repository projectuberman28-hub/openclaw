/**
 * @alfred/models - Ollama Provider
 *
 * Implements ModelProvider for the Ollama local LLM server.
 * Uses fetch to communicate with localhost:11434.
 * NO privacy gate -- data stays local.
 */

import type { StreamChunk } from '@alfred/agent/streaming.js';
import type { ModelProvider, ChatMessage, ChatOptions } from './provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE = 'http://localhost:11434';
const LOG_PREFIX = '[OllamaProvider]';

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama';
  readonly model: string;

  private baseUrl: string;

  constructor(model: string, baseUrl?: string) {
    this.model = model;
    this.baseUrl = baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? DEFAULT_BASE;
  }

  /**
   * Check if Ollama is available by pinging the /api/tags endpoint.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a streaming chat request to Ollama's /api/chat endpoint.
   */
  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    // Build request body
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {} as Record<string, unknown>,
    };

    const ollamaOptions = body['options'] as Record<string, unknown>;

    if (options?.temperature !== undefined) {
      ollamaOptions['temperature'] = options.temperature;
    }

    if (options?.maxTokens !== undefined) {
      ollamaOptions['num_predict'] = options.maxTokens;
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
    const response = await fetch(`${this.baseUrl}/api/chat`, {
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

    // Process Ollama's NDJSON stream
    yield* this.processNDJSONStream(response.body);
  }

  /**
   * Process Ollama's newline-delimited JSON stream.
   *
   * Ollama returns one JSON object per line:
   * {"model":"llama3.1","message":{"role":"assistant","content":"Hi"},"done":false}
   */
  private async *processNDJSONStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          const message = event['message'] as Record<string, unknown> | undefined;
          const isDone = event['done'] as boolean | undefined;

          if (message) {
            const content = message['content'] as string | undefined;
            if (content) {
              yield { type: 'text_delta', data: { text: content } };
            }

            // Handle tool calls (Ollama format)
            const toolCalls = message['tool_calls'] as Array<Record<string, unknown>> | undefined;
            if (toolCalls) {
              for (const tc of toolCalls) {
                const fn = tc['function'] as Record<string, unknown> | undefined;
                if (!fn) continue;

                const toolId = `ollama_tool_${Date.now()}`;
                const toolName = (fn['name'] as string) ?? '';
                const args = fn['arguments'] ?? {};

                yield {
                  type: 'tool_use_start',
                  data: { id: toolId, name: toolName },
                };
                yield {
                  type: 'tool_use_end',
                  data: { id: toolId, name: toolName, input: args },
                };
              }
            }
          }

          if (isDone) {
            yield { type: 'message_stop', data: {} };
          }
        }
      }

      // Flush remaining
      const remaining = decoder.decode();
      if (remaining) buffer += remaining;

    } finally {
      reader.releaseLock();
    }
  }

  /**
   * List available models on the Ollama server.
   */
  async listModels(): Promise<Array<{ name: string; size: number; modified: string }>> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`${LOG_PREFIX} Failed to list models: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { models?: Array<Record<string, unknown>> };
    return (data.models ?? []).map((m) => ({
      name: (m['name'] as string) ?? '',
      size: (m['size'] as number) ?? 0,
      modified: (m['modified_at'] as string) ?? '',
    }));
  }

  /**
   * Pull a model from Ollama's registry.
   * Returns a ReadableStream of progress events.
   */
  async pullModel(modelName: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`${LOG_PREFIX} Failed to pull model: HTTP ${response.status}`);
    }

    return response;
  }
}
