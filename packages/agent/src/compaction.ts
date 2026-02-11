/**
 * @alfred/agent - Session Compaction
 *
 * Compacts long conversation histories by extracting key facts and replacing
 * older messages with a single summary message. Preserves parentId chains
 * so message lineage remains intact.
 */

import type { Message } from '@alfred/core';
import { estimateTokens } from './context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionOptions {
  /** Minimum tokens to keep available after compaction */
  reserveTokensFloor: number;
  /** Whether to flush extracted facts to long-term memory */
  memoryFlush: boolean;
}

export interface CompactionResult {
  /** The compacted message history */
  compactedMessages: Message[];
  /** Human-readable summary of the compacted content */
  summary: string;
  /** Key facts extracted from the compacted messages */
  extractedFacts: string[];
  /** Chain of parent message IDs preserved through compaction */
  parentIdChain: string[];
}

// ---------------------------------------------------------------------------
// SessionCompactor
// ---------------------------------------------------------------------------

export class SessionCompactor {
  private compactionAnnounced = false;

  /**
   * Estimate the total token count for a set of messages.
   */
  estimateTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
  }

  /**
   * Compact a message history.
   *
   * Strategy:
   *   1. Identify messages that can be compacted (older half of the conversation).
   *   2. Extract key facts from those messages.
   *   3. Generate a concise summary.
   *   4. Replace the older messages with a single summary message.
   *   5. Preserve parentId chain so lineage tracking remains intact.
   *   6. Keep the most recent messages untouched.
   *
   * The compaction is purely local -- no LLM call is made. The summary
   * is constructed from extracted facts and message patterns.
   */
  async compact(
    messages: Message[],
    options: CompactionOptions,
  ): Promise<CompactionResult> {
    if (messages.length === 0) {
      return {
        compactedMessages: [],
        summary: '',
        extractedFacts: [],
        parentIdChain: [],
      };
    }

    const totalTokens = this.estimateTokens(messages);

    // If we're already under budget, no compaction needed
    if (totalTokens <= options.reserveTokensFloor) {
      return {
        compactedMessages: [...messages],
        summary: '',
        extractedFacts: [],
        parentIdChain: [],
      };
    }

    // Determine the split point: keep the most recent messages that fit
    // within the reserve floor, compact everything older.
    const keepCount = this.findKeepCount(messages, options.reserveTokensFloor);
    const compactableMessages = messages.slice(0, messages.length - keepCount);
    const retainedMessages = messages.slice(messages.length - keepCount);

    // Extract facts from compactable messages
    const extractedFacts = this.extractFacts(compactableMessages);

    // Preserve parentId chain
    const parentIdChain = this.buildParentIdChain(compactableMessages);

    // Build summary
    const summary = this.buildSummary(compactableMessages, extractedFacts);

    // Create summary message
    const summaryMessage: Message = {
      role: 'system',
      content: this.formatSummaryContent(summary, extractedFacts),
      timestamp: compactableMessages[compactableMessages.length - 1]?.timestamp ?? Date.now(),
      sessionId: messages[0].sessionId,
    };

    // Stabilize announce timing
    if (!this.compactionAnnounced) {
      this.compactionAnnounced = true;
    }

    const compactedMessages = [summaryMessage, ...retainedMessages];

    return {
      compactedMessages,
      summary,
      extractedFacts,
      parentIdChain,
    };
  }

  /**
   * Reset the compaction announcement flag.
   * Call this when starting a new session.
   */
  resetAnnouncement(): void {
    this.compactionAnnounced = false;
  }

  /**
   * Whether compaction has already been announced in this session.
   */
  get wasAnnounced(): boolean {
    return this.compactionAnnounced;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Find how many of the most recent messages to keep so that
   * the retained set stays within the token budget.
   * Always keeps at least 2 messages (the last user + assistant exchange).
   */
  private findKeepCount(messages: Message[], tokenBudget: number): number {
    let tokens = 0;
    let count = 0;

    // Walk backwards from the end
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(messages[i]);
      if (tokens + msgTokens > tokenBudget && count >= 2) {
        break;
      }
      tokens += msgTokens;
      count++;
    }

    // Always keep at least 2 messages
    return Math.max(count, Math.min(2, messages.length));
  }

  /**
   * Extract key facts from messages.
   *
   * Heuristics:
   *   - User messages that contain proper nouns, numbers, or declarative statements
   *   - Assistant messages that contain definitive answers
   *   - Tool results that returned successfully
   */
  private extractFacts(messages: Message[]): string[] {
    const facts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const userFacts = this.extractUserFacts(msg.content);
        facts.push(...userFacts);
      } else if (msg.role === 'assistant') {
        const assistantFacts = this.extractAssistantFacts(msg.content);
        facts.push(...assistantFacts);
      } else if (msg.role === 'tool' && msg.toolResult) {
        for (const tr of msg.toolResult) {
          if (!tr.isError && tr.content) {
            const resultStr = typeof tr.content === 'string'
              ? tr.content
              : JSON.stringify(tr.content);
            if (resultStr.length < 200) {
              facts.push(`Tool result (${tr.toolUseId}): ${resultStr}`);
            }
          }
        }
      }
    }

    // Deduplicate
    return [...new Set(facts)];
  }

  /**
   * Extract facts from user messages.
   * Looks for sentences containing names, numbers, dates, or explicit statements.
   */
  private extractUserFacts(content: string): string[] {
    const facts: string[] = [];
    const sentences = content.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);

    for (const sentence of sentences) {
      // Contains a number or date-like pattern
      if (/\d{2,}/.test(sentence)) {
        facts.push(`User stated: ${sentence.slice(0, 150)}`);
        continue;
      }

      // Contains words that suggest a preference or fact
      if (/\b(my|i am|i'm|i have|i use|i prefer|i like|i need|i want|always|never)\b/i.test(sentence)) {
        facts.push(`User preference: ${sentence.slice(0, 150)}`);
        continue;
      }

      // Contains a proper noun (capitalized word not at start of sentence)
      const words = sentence.split(/\s+/);
      const hasProperNoun = words.some(
        (w, i) => i > 0 && /^[A-Z][a-z]+/.test(w) && !['The', 'This', 'That', 'These', 'Those', 'It'].includes(w),
      );
      if (hasProperNoun && sentence.length > 10) {
        facts.push(`User mentioned: ${sentence.slice(0, 150)}`);
      }
    }

    return facts;
  }

  /**
   * Extract facts from assistant messages.
   * Looks for definitive statements, recommendations, or confirmations.
   */
  private extractAssistantFacts(content: string): string[] {
    const facts: string[] = [];
    const sentences = content.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);

    for (const sentence of sentences) {
      // Confirmation or action taken
      if (/\b(done|completed|created|updated|deleted|saved|sent|confirmed|set|configured)\b/i.test(sentence)) {
        facts.push(`Action taken: ${sentence.slice(0, 150)}`);
      }
    }

    return facts;
  }

  /**
   * Build the parentId chain from compacted messages.
   * Extracts any message IDs or session references so that the lineage
   * can be traced back even after compaction.
   */
  private buildParentIdChain(messages: Message[]): string[] {
    const chain: string[] = [];

    for (const msg of messages) {
      // Use sessionId + timestamp as a pseudo-ID for lineage tracking
      chain.push(`${msg.sessionId}:${msg.timestamp}`);
    }

    return chain;
  }

  /**
   * Build a human-readable summary of compacted messages.
   */
  private buildSummary(messages: Message[], facts: string[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const toolMessages = messages.filter((m) => m.role === 'tool');

    const parts: string[] = [];

    parts.push(
      `Conversation history compacted: ${messages.length} messages ` +
      `(${userMessages.length} user, ${assistantMessages.length} assistant, ${toolMessages.length} tool).`,
    );

    // Summarise the first and last user messages for context
    if (userMessages.length > 0) {
      const first = userMessages[0].content.slice(0, 100);
      parts.push(`Conversation started with: "${first}${userMessages[0].content.length > 100 ? '...' : ''}"`);

      if (userMessages.length > 1) {
        const last = userMessages[userMessages.length - 1].content.slice(0, 100);
        parts.push(`Last compacted user message: "${last}${userMessages[userMessages.length - 1].content.length > 100 ? '...' : ''}"`);
      }
    }

    if (facts.length > 0) {
      parts.push(`Key facts extracted: ${facts.length}`);
    }

    return parts.join(' ');
  }

  /**
   * Format the summary message content for insertion into the message history.
   */
  private formatSummaryContent(summary: string, facts: string[]): string {
    const sections: string[] = [];

    sections.push(`## CONVERSATION SUMMARY (COMPACTED)\n\n${summary}`);

    if (facts.length > 0) {
      const factList = facts.map((f) => `- ${f}`).join('\n');
      sections.push(`## EXTRACTED FACTS\n\n${factList}`);
    }

    return sections.join('\n\n');
  }
}
