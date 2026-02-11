/**
 * @alfred/agent - Conversation Analyzer
 *
 * Analyses a conversation to extract structured intelligence:
 * facts, preferences, tasks, capability gaps, sentiment, and topics.
 * All analysis is performed locally without LLM calls.
 */

import type { Message } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskExtraction {
  /** Description of the task / action item */
  description: string;
  /** Who the task is assigned to: 'user' | 'assistant' | 'unknown' */
  assignee: 'user' | 'assistant' | 'unknown';
  /** Whether the task appears to have been completed in the conversation */
  completed: boolean;
  /** The message index where the task was mentioned */
  sourceIndex: number;
}

export interface ConversationAnalysis {
  /** Facts explicitly stated by the user */
  facts: string[];
  /** Detected user preferences */
  preferences: string[];
  /** Action items / tasks extracted from the conversation */
  tasks: TaskExtraction[];
  /** Capability gaps: things the user asked for that could not be done */
  gaps: string[];
  /** Overall sentiment of the conversation */
  sentiment: 'positive' | 'neutral' | 'negative';
  /** Topics discussed in the conversation */
  topics: string[];
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Patterns indicating user preferences */
const PREFERENCE_PATTERNS = [
  /i (?:always |usually |typically )?(?:prefer|like|want|use|choose|favor)\b/i,
  /(?:my (?:favorite|preferred|default|go-to))\b/i,
  /(?:please (?:always|never|don't))\b/i,
  /(?:i (?:don't like|hate|dislike|avoid))\b/i,
  /(?:can you (?:always|never|make sure to))\b/i,
];

/** Patterns indicating action items / tasks */
const TASK_PATTERNS = [
  /(?:(?:can you|could you|please|would you)\s+)(.+?)(?:\?|$)/i,
  /(?:i need (?:you )?to\s+)(.+?)(?:\.|$)/i,
  /(?:todo|action item|task|reminder):\s*(.+?)(?:\.|$)/i,
  /(?:don't forget to|remember to|make sure to)\s+(.+?)(?:\.|$)/i,
];

/** Patterns indicating capability gaps (things that couldn't be done) */
const GAP_PATTERNS = [
  /(?:i (?:can't|cannot|couldn't|wasn't able to|unable to))\b/i,
  /(?:(?:that's|it's|this is) (?:not (?:possible|supported|available|implemented)))\b/i,
  /(?:unfortunately|sorry|i (?:don't|do not) (?:have|support|know how))\b/i,
  /(?:(?:no |not )(?:yet )?(?:supported|available|implemented))\b/i,
  /(?:outside (?:my|the) (?:scope|capabilities|ability))\b/i,
];

/** Patterns indicating positive sentiment */
const POSITIVE_PATTERNS = [
  /\b(?:thanks|thank you|great|awesome|perfect|excellent|wonderful|love it|fantastic|amazing|helpful|appreciate)\b/i,
  /(?:that (?:works|helped|solved|fixed))/i,
  /(?:good job|well done|nicely done)/i,
];

/** Patterns indicating negative sentiment */
const NEGATIVE_PATTERNS = [
  /\b(?:wrong|incorrect|broken|frustrated|annoying|terrible|awful|useless|disappointed|unhelpful)\b/i,
  /(?:that (?:didn't|doesn't|does not) (?:work|help))/i,
  /(?:not what i (?:asked|wanted|meant|expected))/i,
  /(?:you (?:keep|always) (?:getting|making) (?:it )?wrong)/i,
];

/** Common stop words to exclude from topic detection */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'down', 'this', 'that', 'these',
  'those', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
  'what', 'which', 'who', 'whom', 'me', 'him', 'them', 'i', 'you',
  'he', 'she', 'we', 'they', 'am', 'an', 'also', 'get', 'got',
  'like', 'know', 'think', 'want', 'need', 'use', 'make', 'see',
  'look', 'way', 'thing', 'going', 'well', 'back', 'much', 'even',
  'new', 'one', 'two', 'still', 'let', 'say', 'said',
]);

// ---------------------------------------------------------------------------
// ConversationAnalyzer
// ---------------------------------------------------------------------------

export class ConversationAnalyzer {
  /**
   * Analyse a conversation and return structured intelligence.
   */
  async analyze(messages: Message[]): Promise<ConversationAnalysis> {
    const facts = this.extractFacts(messages);
    const preferences = this.extractPreferences(messages);
    const tasks = this.extractTasks(messages);
    const gaps = this.detectGaps(messages);
    const sentiment = this.analyseSentiment(messages);
    const topics = this.extractTopics(messages);

    return {
      facts,
      preferences,
      tasks,
      gaps,
      sentiment,
      topics,
    };
  }

  // -------------------------------------------------------------------------
  // Extractors
  // -------------------------------------------------------------------------

  /**
   * Extract factual statements from user messages.
   */
  private extractFacts(messages: Message[]): string[] {
    const facts: string[] = [];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;

      const sentences = this.splitSentences(msg.content);
      for (const sentence of sentences) {
        // Declarative statements with specific data
        if (this.isFactualStatement(sentence)) {
          facts.push(sentence.slice(0, 200));
        }
      }
    }

    return [...new Set(facts)];
  }

  /**
   * Determine if a sentence is a factual / declarative statement.
   */
  private isFactualStatement(sentence: string): boolean {
    // Contains numbers, dates, proper nouns, or "is/are" declarations
    if (/\b\d{2,}\b/.test(sentence)) return true;
    if (/\b(my |our |the |i am|i'm|we are|we're)\b/i.test(sentence) &&
        /\b(name|email|address|phone|company|project|team|server|database|version)\b/i.test(sentence)) {
      return true;
    }
    // "X is Y" pattern
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:is|are|was|were)\b/.test(sentence)) {
      return true;
    }
    return false;
  }

  /**
   * Extract user preferences from the conversation.
   */
  private extractPreferences(messages: Message[]): string[] {
    const preferences: string[] = [];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;

      const sentences = this.splitSentences(msg.content);
      for (const sentence of sentences) {
        for (const pattern of PREFERENCE_PATTERNS) {
          if (pattern.test(sentence)) {
            preferences.push(sentence.slice(0, 200));
            break; // Only add once per sentence
          }
        }
      }
    }

    return [...new Set(preferences)];
  }

  /**
   * Extract action items / tasks from the conversation.
   */
  private extractTasks(messages: Message[]): TaskExtraction[] {
    const tasks: TaskExtraction[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        for (const pattern of TASK_PATTERNS) {
          const match = pattern.exec(msg.content);
          if (match) {
            const description = (match[1] ?? match[0]).trim().slice(0, 200);
            if (description.length > 5) {
              // Check if this task was completed later in the conversation
              const completed = this.wasTaskCompleted(description, messages, i);
              tasks.push({
                description,
                assignee: 'assistant',
                completed,
                sourceIndex: i,
              });
            }
          }
        }
      } else if (msg.role === 'assistant') {
        // Look for tasks the assistant suggests the user should do
        const sentences = this.splitSentences(msg.content);
        for (const sentence of sentences) {
          if (/\b(?:you (?:should|could|might want to|need to)|please)\b/i.test(sentence) &&
              sentence.length > 10 && sentence.length < 200) {
            tasks.push({
              description: sentence.slice(0, 200),
              assignee: 'user',
              completed: false,
              sourceIndex: i,
            });
          }
        }
      }
    }

    return tasks;
  }

  /**
   * Check if a task description appears to have been completed
   * by looking for confirmation in subsequent messages.
   */
  private wasTaskCompleted(description: string, messages: Message[], afterIndex: number): boolean {
    const keywords = description.toLowerCase().split(/\s+/).filter(
      (w) => w.length > 3 && !STOP_WORDS.has(w),
    );

    if (keywords.length === 0) return false;

    for (let i = afterIndex + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;

      const lower = msg.content.toLowerCase();
      const keywordMatch = keywords.some((k) => lower.includes(k));

      if (keywordMatch && /\b(?:done|completed|finished|created|updated|set|configured|fixed|resolved)\b/i.test(msg.content)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect capability gaps: things the user asked about that couldn't be done.
   */
  private detectGaps(messages: Message[]): string[] {
    const gaps: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;

      for (const pattern of GAP_PATTERNS) {
        if (pattern.test(msg.content)) {
          // Find the preceding user message for context
          let userContext = '';
          for (let j = i - 1; j >= 0; j--) {
            if (messages[j].role === 'user') {
              userContext = messages[j].content.slice(0, 100);
              break;
            }
          }

          const gapDescription = userContext
            ? `User asked: "${userContext}" -- Assistant could not fulfill`
            : `Capability gap detected in response`;

          gaps.push(gapDescription);
          break; // One gap per assistant message
        }
      }
    }

    return [...new Set(gaps)];
  }

  /**
   * Analyse the overall sentiment of the conversation.
   * Weighted towards the most recent user messages.
   */
  private analyseSentiment(messages: Message[]): 'positive' | 'neutral' | 'negative' {
    let score = 0;
    const userMessages = messages.filter((m) => m.role === 'user');

    for (let i = 0; i < userMessages.length; i++) {
      const content = userMessages[i].content;
      // Weight recent messages more heavily
      const weight = 1 + (i / userMessages.length);

      for (const pattern of POSITIVE_PATTERNS) {
        if (pattern.test(content)) {
          score += weight;
        }
      }

      for (const pattern of NEGATIVE_PATTERNS) {
        if (pattern.test(content)) {
          score -= weight;
        }
      }
    }

    if (score > 1) return 'positive';
    if (score < -1) return 'negative';
    return 'neutral';
  }

  /**
   * Extract the main topics discussed in the conversation.
   * Uses term frequency analysis on user messages.
   */
  private extractTopics(messages: Message[]): string[] {
    const wordFreq = new Map<string, number>();

    for (const msg of messages) {
      if (msg.role !== 'user') continue;

      const words = msg.content
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length > 2 && !STOP_WORDS.has(w));

      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      }
    }

    // Sort by frequency descending, take top topics
    const sorted = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count >= 2) // Only topics mentioned at least twice
      .slice(0, 10);

    return sorted.map(([word]) => word);
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Split text into sentences.
   */
  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
