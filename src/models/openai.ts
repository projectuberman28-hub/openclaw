/**
 * @alfred/models - OpenAI Provider
 *
 * Implements ModelProvider for the OpenAI Chat Completions API.
 * Uses fetch for HTTP requests and streaming SSE responses.
 * All requests go through the privacy gate.
 */

import type { StreamChunk } from '@alfred/agent/streaming.js';
import type { PrivacyGate } from '@alfred/privacy';
import type { ModelProvider, ChatMessage, ChatOptions } from './provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.openai.com';
const LOG_PREFIX = '[OpenAIProvider]';

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  readonly model: string;

  private apiKey: string | undefined;
  private privacyGate: PrivacyGate | undefined;

  constructor(model: string, privacyGate?: PrivacyGate) {
    this.model = model;
    this.privacyGate = privacyGate;
    this.apiKey = process.env['OPENAI_API_KEY'];
  }

  /**
   * Check if the OpenAI API is available (API key is configured).
   */
  async isAvailable(): Promise<boolean> {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  /**
   * Send a streaming chat request to the OpenAI Chat Completions API.
   */
  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!this.apiKey) {
      throw new Error(`${LOG_PREFIX} OPENAI_API_KEY not set`);
    }

    // Gate through privacy pipeline
    let processedMessages = messages;
    if (this.privacyGate) {
      const gateResult = await this.privacyGate.gateOutbound(
        {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          model: this.model,
          provider: 'openai',
          endpoint: `${API_BASE}/v1/chat/completions`,
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
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
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
   * Process an SSE stream from the OpenAI API and yield StreamChunks.
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
            // Close any open tool use
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
            // Text content
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
                  // Close previous tool use if any
                  if (activeToolUse) {
                    let input: unknown = {};
                    try { input = JSON.parse(activeToolUse.inputJson); } catch { /* use empty */ }
                    yield {
                      type: 'tool_use_end',
                      data: { id: activeToolUse.id, name: activeToolUse.name, input },
                    };
                  }

                  // Start new tool use
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

          // Handle finish_reason
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
