/**
 * @alfred/agent - Context Enricher
 *
 * Enriches incoming messages with relevant memories, tool suggestions,
 * and contextual notes to help the agent produce better responses.
 */

import type { ConversationAnalysis } from './conversation-analyzer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  /** The memory content / fact */
  content: string;
  /** When the memory was created (Unix epoch ms) */
  createdAt: number;
  /** Keywords / tags associated with the memory */
  tags: string[];
  /** Relevance score (0-1) if pre-computed */
  score?: number;
}

export interface EnrichedContext {
  /** Memories relevant to the current message */
  relevantMemories: string[];
  /** Tools that might be useful based on message intent */
  suggestedTools: string[];
  /** Additional context notes for the agent */
  contextNotes: string[];
}

// ---------------------------------------------------------------------------
// Tool-intent mapping
// ---------------------------------------------------------------------------

/**
 * Map of intent keywords to tool names.
 * When a user message contains these keywords, the corresponding tools
 * are suggested.
 */
const TOOL_INTENT_MAP: Array<{ keywords: RegExp; tools: string[] }> = [
  {
    keywords: /\b(?:search|find|look up|google|lookup|query)\b/i,
    tools: ['web_search', 'search'],
  },
  {
    keywords: /\b(?:file|read|write|save|create|open|edit|delete|directory|folder|path)\b/i,
    tools: ['file_read', 'file_write', 'file_list'],
  },
  {
    keywords: /\b(?:run|execute|command|terminal|shell|bash|script|npm|pip|cargo)\b/i,
    tools: ['shell_exec', 'command_run'],
  },
  {
    keywords: /\b(?:http|api|request|fetch|get|post|put|endpoint|url|webhook)\b/i,
    tools: ['http_request', 'api_call'],
  },
  {
    keywords: /\b(?:email|mail|send|inbox|message|notify|notification)\b/i,
    tools: ['email_send', 'email_read', 'notification'],
  },
  {
    keywords: /\b(?:schedule|cron|timer|alarm|remind|reminder|calendar|event)\b/i,
    tools: ['scheduler', 'reminder', 'calendar'],
  },
  {
    keywords: /\b(?:git|commit|push|pull|branch|merge|repo|repository|clone)\b/i,
    tools: ['git', 'shell_exec'],
  },
  {
    keywords: /\b(?:database|sql|query|table|insert|select|update|delete|migrate)\b/i,
    tools: ['database', 'sql_query'],
  },
  {
    keywords: /\b(?:image|picture|photo|screenshot|draw|diagram|chart|graph|plot)\b/i,
    tools: ['image_generate', 'screenshot', 'chart'],
  },
  {
    keywords: /\b(?:remember|memory|recall|forget|memorize|note|save for later)\b/i,
    tools: ['memory_store', 'memory_recall'],
  },
  {
    keywords: /\b(?:encrypt|decrypt|hash|password|secret|credential|vault)\b/i,
    tools: ['vault', 'crypto'],
  },
  {
    keywords: /\b(?:weather|forecast|temperature|climate)\b/i,
    tools: ['weather'],
  },
  {
    keywords: /\b(?:translate|translation|language|spanish|french|german|japanese|chinese)\b/i,
    tools: ['translate'],
  },
  {
    keywords: /\b(?:summarize|summary|tldr|tl;dr|condense|brief)\b/i,
    tools: ['summarize'],
  },
  {
    keywords: /\b(?:calculate|math|compute|formula|equation|convert|conversion)\b/i,
    tools: ['calculator', 'unit_convert'],
  },
];

// ---------------------------------------------------------------------------
// ContextEnricher
// ---------------------------------------------------------------------------

export class ContextEnricher {
  /**
   * Enrich a user message with relevant context.
   *
   * @param message - The incoming user message text
   * @param memories - Available memory entries to search through
   * @param recentAnalysis - Optional analysis of recent conversation for deeper context
   */
  enrich(
    message: string,
    memories: MemoryEntry[],
    recentAnalysis?: ConversationAnalysis,
  ): EnrichedContext {
    const relevantMemories = this.findRelevantMemories(message, memories, recentAnalysis);
    const suggestedTools = this.suggestTools(message, recentAnalysis);
    const contextNotes = this.buildContextNotes(message, recentAnalysis);

    return {
      relevantMemories,
      suggestedTools,
      contextNotes,
    };
  }

  // -------------------------------------------------------------------------
  // Memory matching
  // -------------------------------------------------------------------------

  /**
   * Find memories relevant to the current message.
   *
   * Scoring:
   *   - Keyword overlap: number of shared significant words
   *   - Recency bonus: newer memories get a boost
   *   - Tag match: memories whose tags match message keywords
   *   - Analysis context: if recent analysis has matching topics/facts
   */
  private findRelevantMemories(
    message: string,
    memories: MemoryEntry[],
    analysis?: ConversationAnalysis,
  ): string[] {
    if (memories.length === 0) return [];

    const messageKeywords = this.extractKeywords(message);
    const analysisTopics = new Set(analysis?.topics ?? []);
    const now = Date.now();

    // Score each memory
    const scored: Array<{ memory: MemoryEntry; score: number }> = [];

    for (const memory of memories) {
      let score = memory.score ?? 0;

      // Keyword overlap
      const memoryKeywords = this.extractKeywords(memory.content);
      const overlap = messageKeywords.filter((k) => memoryKeywords.includes(k));
      score += overlap.length * 2;

      // Tag matching
      const tagOverlap = memory.tags.filter((t) =>
        messageKeywords.includes(t.toLowerCase()),
      );
      score += tagOverlap.length * 3;

      // Topic match from analysis
      for (const topic of analysisTopics) {
        if (memory.content.toLowerCase().includes(topic)) {
          score += 1.5;
        }
      }

      // Recency bonus: memories less than 1 hour old get +2, less than 24h get +1
      const ageMs = now - memory.createdAt;
      if (ageMs < 60 * 60 * 1000) {
        score += 2;
      } else if (ageMs < 24 * 60 * 60 * 1000) {
        score += 1;
      }

      if (score > 0) {
        scored.push({ memory, score });
      }
    }

    // Sort by score descending, take top 10
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 10);

    return top.map((s) => s.memory.content);
  }

  // -------------------------------------------------------------------------
  // Tool suggestion
  // -------------------------------------------------------------------------

  /**
   * Suggest tools based on the message intent.
   */
  private suggestTools(
    message: string,
    analysis?: ConversationAnalysis,
  ): string[] {
    const suggestions = new Set<string>();

    // Match message against tool-intent patterns
    for (const mapping of TOOL_INTENT_MAP) {
      if (mapping.keywords.test(message)) {
        for (const tool of mapping.tools) {
          suggestions.add(tool);
        }
      }
    }

    // If analysis detected capability gaps, suggest memory tools for awareness
    if (analysis && analysis.gaps.length > 0) {
      suggestions.add('memory_store');
    }

    // If analysis detected tasks, suggest relevant task tools
    if (analysis) {
      const pendingTasks = analysis.tasks.filter((t) => !t.completed);
      if (pendingTasks.length > 0) {
        suggestions.add('reminder');
      }
    }

    return [...suggestions];
  }

  // -------------------------------------------------------------------------
  // Context notes
  // -------------------------------------------------------------------------

  /**
   * Build context notes to help the agent respond better.
   */
  private buildContextNotes(
    message: string,
    analysis?: ConversationAnalysis,
  ): string[] {
    const notes: string[] = [];

    if (!analysis) return notes;

    // Note user sentiment
    if (analysis.sentiment === 'negative') {
      notes.push('User sentiment in this conversation has been negative. Be extra careful, empathetic, and precise.');
    } else if (analysis.sentiment === 'positive') {
      notes.push('User has expressed positive sentiment. Continue the good interaction quality.');
    }

    // Note active preferences
    if (analysis.preferences.length > 0) {
      notes.push(`User has ${analysis.preferences.length} known preferences. Consider them when responding.`);
    }

    // Note pending tasks
    const pendingTasks = analysis.tasks.filter((t) => !t.completed && t.assignee === 'assistant');
    if (pendingTasks.length > 0) {
      notes.push(`There are ${pendingTasks.length} pending tasks assigned to you. Consider addressing them if relevant.`);
    }

    // Note capability gaps
    if (analysis.gaps.length > 0) {
      notes.push(`${analysis.gaps.length} capability gap(s) were identified earlier. Be transparent if similar limitations apply.`);
    }

    return notes;
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Extract significant keywords from text.
   * Filters out stop words and very short words.
   */
  private extractKeywords(text: string): string[] {
    const STOP = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'and', 'or', 'but', 'not', 'no', 'if', 'then',
      'that', 'this', 'it', 'its', 'my', 'your', 'he', 'she', 'they',
      'we', 'me', 'him', 'her', 'them', 'i', 'you', 'what', 'which',
      'who', 'how', 'when', 'where', 'why', 'just', 'also', 'so', 'very',
      'too', 'much', 'more', 'some', 'any', 'all', 'each', 'about', 'up',
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
  }
}
