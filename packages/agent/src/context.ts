/**
 * @alfred/agent - Context Assembler
 *
 * Assembles the message context for an inference call, respecting token limits.
 * Priority order:
 *   1. System prompt (always included, never removed)
 *   2. Recent messages (most recent first, most important)
 *   3. Memories
 *   4. Older messages
 *
 * Token estimation uses a simple heuristic: JSON.stringify(msg).length / 4
 */

import type { Message, ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssembleParams {
  systemPrompt: string;
  messages: Message[];
  memories: string[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface AssembledContext {
  /** Messages ready for API submission (system prompt is messages[0] with role 'system') */
  messages: Message[];
  /** Estimated token count */
  tokenEstimate: number;
  /** Whether any content was truncated to fit the budget */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token count for an arbitrary value.
 * Heuristic: length of JSON representation / 4.
 */
export function estimateTokens(value: unknown): number {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(json.length / 4);
}

// ---------------------------------------------------------------------------
// ContextAssembler
// ---------------------------------------------------------------------------

export class ContextAssembler {
  /**
   * Assemble a context payload that fits within the token budget.
   *
   * Algorithm:
   *   1. Reserve space for the system prompt (mandatory).
   *   2. Add messages from most-recent to oldest until the budget is exhausted.
   *   3. If space remains, inject memory block as a system-level message after
   *      the system prompt.
   *   4. If still over budget after step 2, trim memory entries first, then
   *      remove oldest non-system messages.
   */
  assemble(params: AssembleParams): AssembledContext {
    const { systemPrompt, messages, memories, maxTokens } = params;

    let truncated = false;

    // ----- 1. System prompt (always present) -----
    const systemMsg: Message = {
      role: 'system',
      content: systemPrompt,
      timestamp: Date.now(),
      sessionId: messages[0]?.sessionId ?? '',
    };
    const systemTokens = estimateTokens(systemMsg);

    // Reserve ~5% for overhead (tool definitions, framing)
    const toolOverhead = estimateTokens(params.tools);
    const reservedTokens = systemTokens + toolOverhead;
    let remainingBudget = maxTokens - reservedTokens;

    if (remainingBudget <= 0) {
      // Even the system prompt exceeds budget -- return just the system prompt
      return {
        messages: [systemMsg],
        tokenEstimate: systemTokens + toolOverhead,
        truncated: true,
      };
    }

    // ----- 2. Add messages most-recent first -----
    const includedMessages: Message[] = [];
    // Work backwards from the end (most recent)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const tokensNeeded = estimateTokens(msg);
      if (tokensNeeded <= remainingBudget) {
        includedMessages.unshift(msg); // preserve chronological order
        remainingBudget -= tokensNeeded;
      } else {
        truncated = true;
        // Stop adding older messages; we keep the most recent ones
        break;
      }
    }

    // ----- 3. Inject memories -----
    const memoryMessages: Message[] = [];
    if (memories.length > 0 && remainingBudget > 0) {
      // Build memory block -- add entries until budget is consumed
      const memoryLines: string[] = [];
      for (const mem of memories) {
        const entryTokens = estimateTokens(mem);
        if (entryTokens <= remainingBudget) {
          memoryLines.push(`- ${mem}`);
          remainingBudget -= entryTokens;
        } else {
          truncated = true;
          break;
        }
      }
      if (memoryLines.length > 0) {
        const memoryContent = `## RECALLED MEMORIES\n\n${memoryLines.join('\n')}`;
        const memMsg: Message = {
          role: 'system',
          content: memoryContent,
          timestamp: Date.now(),
          sessionId: systemMsg.sessionId,
        };
        memoryMessages.push(memMsg);
      }
    }

    // ----- 4. Assemble final message list -----
    const finalMessages: Message[] = [
      systemMsg,
      ...memoryMessages,
      ...includedMessages,
    ];

    const totalTokens = finalMessages.reduce(
      (sum, msg) => sum + estimateTokens(msg),
      toolOverhead,
    );

    return {
      messages: finalMessages,
      tokenEstimate: totalTokens,
      truncated,
    };
  }
}
