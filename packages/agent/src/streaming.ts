/**
 * @alfred/agent - Stream Processor
 *
 * Processes Server-Sent Events (SSE) streams from LLM APIs.
 * Handles text deltas, tool use accumulation, and incomplete UTF-8 buffering.
 *
 * SSE format expected:
 *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamChunk {
  type:
    | 'text_delta'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_end'
    | 'message_stop';
  data: unknown;
}

/**
 * Raw SSE event parsed from the wire.
 */
interface SSEEvent {
  event?: string;
  data: string;
}

// ---------------------------------------------------------------------------
// StreamProcessor
// ---------------------------------------------------------------------------

export class StreamProcessor {
  /**
   * Process a ReadableStream of SSE bytes and yield structured StreamChunks.
   *
   * The generator handles:
   *   - Line-by-line SSE parsing (data: ... separated by blank lines)
   *   - Accumulation of partial tool use JSON across multiple deltas
   *   - Buffering of incomplete UTF-8 byte sequences at chunk boundaries
   */
  async *processStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });

    let lineBuffer = '';
    let currentEvent: Partial<SSEEvent> = {};

    // State for accumulating tool use blocks
    let activeToolUse: {
      id: string;
      name: string;
      inputJson: string;
    } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode bytes to text, streaming-safe (handles incomplete UTF-8)
        const text = decoder.decode(value, { stream: true });
        lineBuffer += text;

        // Split on newlines, keeping the last partial line in the buffer
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');

          if (line === '') {
            // Blank line = end of SSE event
            if (currentEvent.data !== undefined) {
              const chunks = this.parseSSEEvent(currentEvent as SSEEvent, activeToolUse);
              for (const chunk of chunks.chunks) {
                yield chunk;
              }
              activeToolUse = chunks.activeToolUse;
            }
            currentEvent = {};
            continue;
          }

          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            if (currentEvent.data !== undefined) {
              currentEvent.data += '\n' + payload;
            } else {
              currentEvent.data = payload;
            }
          } else if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7).trim();
          }
          // Ignore other SSE fields (id:, retry:, comments)
        }
      }

      // Flush decoder (any remaining bytes)
      const remaining = decoder.decode(new Uint8Array(), { stream: false });
      if (remaining) {
        lineBuffer += remaining;
      }

      // Process any remaining buffered data
      if (lineBuffer.trim() !== '' && currentEvent.data !== undefined) {
        const chunks = this.parseSSEEvent(currentEvent as SSEEvent, activeToolUse);
        for (const chunk of chunks.chunks) {
          yield chunk;
        }
        activeToolUse = chunks.activeToolUse;
      }

      // If we have an unclosed tool use block, close it
      if (activeToolUse) {
        yield {
          type: 'tool_use_end',
          data: {
            id: activeToolUse.id,
            name: activeToolUse.name,
            input: this.safeParseJson(activeToolUse.inputJson),
          },
        };
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single SSE event payload and return StreamChunks.
   *
   * Recognises Anthropic-style streaming event types:
   *   - content_block_start (type: text or tool_use)
   *   - content_block_delta (text_delta or input_json_delta)
   *   - content_block_stop
   *   - message_stop
   *   - message_delta
   *
   * Also handles OpenAI-compatible delta format as a fallback.
   */
  private parseSSEEvent(
    event: SSEEvent,
    activeToolUse: { id: string; name: string; inputJson: string } | null,
  ): {
    chunks: StreamChunk[];
    activeToolUse: { id: string; name: string; inputJson: string } | null;
  } {
    const chunks: StreamChunk[] = [];

    if (event.data === '[DONE]') {
      chunks.push({ type: 'message_stop', data: {} });
      return { chunks, activeToolUse };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      // Malformed JSON -- skip this event
      return { chunks, activeToolUse };
    }

    const eventType = (parsed['type'] as string) ?? '';

    switch (eventType) {
      // ----- Anthropic streaming events -----
      case 'content_block_start': {
        const block = parsed['content_block'] as Record<string, unknown> | undefined;
        if (block?.type === 'tool_use') {
          activeToolUse = {
            id: (block['id'] as string) ?? '',
            name: (block['name'] as string) ?? '',
            inputJson: '',
          };
          chunks.push({
            type: 'tool_use_start',
            data: { id: activeToolUse.id, name: activeToolUse.name },
          });
        }
        // text blocks don't need a start event
        break;
      }

      case 'content_block_delta': {
        const delta = parsed['delta'] as Record<string, unknown> | undefined;
        if (!delta) break;

        if (delta['type'] === 'text_delta') {
          chunks.push({
            type: 'text_delta',
            data: { text: (delta['text'] as string) ?? '' },
          });
        } else if (delta['type'] === 'input_json_delta') {
          const partial = (delta['partial_json'] as string) ?? '';
          if (activeToolUse) {
            activeToolUse.inputJson += partial;
            chunks.push({
              type: 'tool_use_delta',
              data: { partial_json: partial },
            });
          }
        }
        break;
      }

      case 'content_block_stop': {
        if (activeToolUse) {
          chunks.push({
            type: 'tool_use_end',
            data: {
              id: activeToolUse.id,
              name: activeToolUse.name,
              input: this.safeParseJson(activeToolUse.inputJson),
            },
          });
          activeToolUse = null;
        }
        break;
      }

      case 'message_stop': {
        chunks.push({ type: 'message_stop', data: {} });
        break;
      }

      case 'message_delta': {
        // May contain stop_reason; we treat it as a stop signal
        const delta = parsed['delta'] as Record<string, unknown> | undefined;
        if (delta?.['stop_reason'] === 'end_turn' || delta?.['stop_reason'] === 'stop_sequence') {
          chunks.push({ type: 'message_stop', data: { stop_reason: delta['stop_reason'] } });
        }
        break;
      }

      default: {
        // ----- OpenAI-compatible fallback -----
        const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
        if (choices && choices.length > 0) {
          const choice = choices[0];
          const delta = choice['delta'] as Record<string, unknown> | undefined;
          if (delta) {
            const content = delta['content'] as string | undefined;
            if (content) {
              chunks.push({ type: 'text_delta', data: { text: content } });
            }

            const toolCalls = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
            if (toolCalls) {
              for (const tc of toolCalls) {
                const fn = tc['function'] as Record<string, unknown> | undefined;
                if (!fn) continue;

                if (fn['name']) {
                  // Start of a new tool call
                  activeToolUse = {
                    id: (tc['id'] as string) ?? '',
                    name: (fn['name'] as string) ?? '',
                    inputJson: (fn['arguments'] as string) ?? '',
                  };
                  chunks.push({
                    type: 'tool_use_start',
                    data: { id: activeToolUse.id, name: activeToolUse.name },
                  });
                } else if (fn['arguments'] && activeToolUse) {
                  // Continuation delta
                  const partial = (fn['arguments'] as string) ?? '';
                  activeToolUse.inputJson += partial;
                  chunks.push({
                    type: 'tool_use_delta',
                    data: { partial_json: partial },
                  });
                }
              }
            }
          }

          if (choice['finish_reason'] === 'tool_calls' && activeToolUse) {
            chunks.push({
              type: 'tool_use_end',
              data: {
                id: activeToolUse.id,
                name: activeToolUse.name,
                input: this.safeParseJson(activeToolUse.inputJson),
              },
            });
            activeToolUse = null;
          } else if (choice['finish_reason'] === 'stop') {
            chunks.push({ type: 'message_stop', data: {} });
          }
        }
        break;
      }
    }

    return { chunks, activeToolUse };
  }

  /**
   * Safely parse a JSON string, returning an empty object on failure.
   */
  private safeParseJson(json: string): unknown {
    if (!json || json.trim() === '') return {};
    try {
      return JSON.parse(json);
    } catch {
      // Try to recover truncated JSON by closing open braces/brackets
      return this.recoverPartialJson(json);
    }
  }

  /**
   * Attempt to recover truncated JSON by closing unclosed braces/brackets.
   * This is best-effort and returns an empty object if recovery fails.
   */
  private recoverPartialJson(json: string): unknown {
    let fixed = json.trim();
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;

    // Close open brackets first, then braces
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixed += ']';
    }
    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixed += '}';
    }

    try {
      return JSON.parse(fixed);
    } catch {
      return {};
    }
  }
}
