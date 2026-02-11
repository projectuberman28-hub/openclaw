/**
 * @alfred/models - Anthropic Provider
 *
 * Implements ModelProvider for Anthropic's Messages API.
 * Uses fetch for HTTP requests and streaming SSE responses.
 * All requests go through the privacy gate.
 */

import type { StreamChunk } from '@alfred/agent/streaming.js';
import type { PrivacyGate } from '@alfred/privacy';
import type { ModelProvider, ChatMessage, ChatOptions } from './provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';
const LOG_PREFIX = '[AnthropicProvider]';

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly model: string;

  private apiKey: string | undefined;
  private privacyGate: PrivacyGate | undefined;

  constructor(model: string, privacyGate?: PrivacyGate) {
    this.model = model;
    this.privacyGate = privacyGate;
    this.apiKey = process.env['ANTHROPIC_API_KEY'];
  }

  /**
   * Check if the Anthropic API is available (API key is configured).
   */
  async isAvailable(): Promise<boolean> {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  /**
   * Send a streaming chat request to the Anthropic Messages API.
   */
  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!this.apiKey) {
      throw new Error(`${LOG_PREFIX} ANTHROPIC_API_KEY not set`);
    }

    // Separate system prompt from messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n') || undefined;

    // Gate through privacy pipeline
    let processedMessages = nonSystemMessages;
    if (this.privacyGate) {
      const gateResult = await this.privacyGate.gateOutbound(
        {
          messages: nonSystemMessages.map((m) => ({ role: m.role, content: m.content })),
          model: this.model,
          provider: 'anthropic',
          endpoint: `${API_BASE}/v1/messages`,
        },
        {
          sessionId: options?.sessionId ?? 'unknown',
          channel: options?.channel ?? 'unknown',
        },
      );
      processedMessages = gateResult.request.messages.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      }));
    }

    // Build request body
    const body: Record<string, unknown> = {
      model: this.model,
      messages: processedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options?.maxTokens ?? 8192,
      stream: true,
    };

    if (systemPrompt) {
      body['system'] = systemPrompt;
    }

    if (options?.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      body['tools'] = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    // Make the streaming request
    const response = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
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

    // Process SSE stream
    yield* this.processSSEStream(response.body);
  }

  /**
   * Process an SSE stream from the Anthropic API and yield StreamChunks.
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
            yield { type: 'message_stop', data: {} };
            return;
          }

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          const eventType = event['type'] as string;

          switch (eventType) {
            case 'content_block_start': {
              const block = event['content_block'] as Record<string, unknown> | undefined;
              if (block?.['type'] === 'tool_use') {
                activeToolUse = {
                  id: (block['id'] as string) ?? '',
                  name: (block['name'] as string) ?? '',
                  inputJson: '',
                };
                yield {
                  type: 'tool_use_start',
                  data: { id: activeToolUse.id, name: activeToolUse.name },
                };
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event['delta'] as Record<string, unknown> | undefined;
              if (!delta) break;

              if (delta['type'] === 'text_delta') {
                yield {
                  type: 'text_delta',
                  data: { text: (delta['text'] as string) ?? '' },
                };
              } else if (delta['type'] === 'input_json_delta' && activeToolUse) {
                const partial = (delta['partial_json'] as string) ?? '';
                activeToolUse.inputJson += partial;
                yield {
                  type: 'tool_use_delta',
                  data: { partial_json: partial },
                };
              }
              break;
            }

            case 'content_block_stop': {
              if (activeToolUse) {
                let input: unknown = {};
                try {
                  input = JSON.parse(activeToolUse.inputJson);
                } catch { /* use empty */ }

                yield {
                  type: 'tool_use_end',
                  data: {
                    id: activeToolUse.id,
                    name: activeToolUse.name,
                    input,
                  },
                };
                activeToolUse = null;
              }
              break;
            }

            case 'message_stop': {
              yield { type: 'message_stop', data: {} };
              break;
            }

            case 'message_delta': {
              const delta = event['delta'] as Record<string, unknown> | undefined;
              if (delta?.['stop_reason']) {
                yield {
                  type: 'message_stop',
                  data: { stop_reason: delta['stop_reason'] },
                };
              }
              break;
            }
          }
        }
      }

      // Flush remaining buffer
      const remaining = decoder.decode();
      if (remaining) buffer += remaining;

    } finally {
      reader.releaseLock();
    }
  }
}
