/**
 * @alfred/agent - Pattern Detector
 *
 * Analyses across multiple sessions to detect recurring patterns in
 * user behaviour: repeated requests, time-based patterns, workflow
 * sequences, and preference patterns.
 */

import type { Session } from '../session.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedPattern {
  /** Type of pattern detected */
  type: 'recurring_request' | 'time_pattern' | 'workflow' | 'preference';
  /** Human-readable description of the pattern */
  description: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** How many times this pattern was observed */
  frequency: number;
}

// ---------------------------------------------------------------------------
// PatternDetector
// ---------------------------------------------------------------------------

export class PatternDetector {
  /**
   * Detect patterns across a set of sessions.
   */
  detect(sessions: Session[]): DetectedPattern[] {
    if (sessions.length < 2) return [];

    const patterns: DetectedPattern[] = [];

    patterns.push(...this.detectRecurringRequests(sessions));
    patterns.push(...this.detectTimePatterns(sessions));
    patterns.push(...this.detectWorkflowPatterns(sessions));
    patterns.push(...this.detectPreferencePatterns(sessions));

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    return patterns;
  }

  // -------------------------------------------------------------------------
  // Recurring requests
  // -------------------------------------------------------------------------

  /**
   * Detect requests that appear repeatedly across sessions.
   * Uses n-gram similarity to find messages with similar intent.
   */
  private detectRecurringRequests(sessions: Session[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Extract user message intents from each session
    const sessionIntents: Array<{ sessionId: string; intents: string[] }> = [];

    for (const session of sessions) {
      const userMessages = session.messages.filter((m) => m.role === 'user');
      const intents = userMessages.map((m) => this.normalizeIntent(m.content));
      sessionIntents.push({ sessionId: session.id, intents });
    }

    // Find intents that appear across multiple sessions
    const intentFrequency = new Map<string, number>();
    const intentSessions = new Map<string, Set<string>>();

    for (const { sessionId, intents } of sessionIntents) {
      // Use a set to count each intent at most once per session
      const uniqueIntents = new Set(intents);
      for (const intent of uniqueIntents) {
        if (intent.length < 3) continue; // Skip very short intents

        intentFrequency.set(intent, (intentFrequency.get(intent) ?? 0) + 1);

        if (!intentSessions.has(intent)) {
          intentSessions.set(intent, new Set());
        }
        intentSessions.get(intent)!.add(sessionId);
      }
    }

    // Patterns that appear in at least 2 different sessions
    for (const [intent, frequency] of intentFrequency) {
      const sessionCount = intentSessions.get(intent)?.size ?? 0;
      if (sessionCount >= 2) {
        const confidence = Math.min(0.9, 0.3 + (sessionCount / sessions.length) * 0.6);
        patterns.push({
          type: 'recurring_request',
          description: `User frequently asks about: "${intent}"`,
          confidence,
          frequency,
        });
      }
    }

    // Also detect similar intents using bigram overlap
    const allIntents = [...intentFrequency.keys()];
    const clusters = this.clusterSimilarIntents(allIntents);

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;

      // Total frequency across the cluster
      const totalFreq = cluster.reduce(
        (sum, intent) => sum + (intentFrequency.get(intent) ?? 0),
        0,
      );

      // Total unique sessions
      const allSessions = new Set<string>();
      for (const intent of cluster) {
        const sessions = intentSessions.get(intent);
        if (sessions) {
          for (const s of sessions) allSessions.add(s);
        }
      }

      if (allSessions.size >= 2 && totalFreq >= 3) {
        const representative = cluster.reduce((a, b) => a.length > b.length ? a : b);
        const confidence = Math.min(0.85, 0.25 + (allSessions.size / sessions.length) * 0.5);
        patterns.push({
          type: 'recurring_request',
          description: `Recurring intent cluster around: "${representative}" (${cluster.length} variants)`,
          confidence,
          frequency: totalFreq,
        });
      }
    }

    return patterns;
  }

  // -------------------------------------------------------------------------
  // Time-based patterns
  // -------------------------------------------------------------------------

  /**
   * Detect patterns based on when sessions or messages occur.
   * E.g., "User always starts a session around 9am" or "User asks about X on Mondays".
   */
  private detectTimePatterns(sessions: Session[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Analyse session start times
    const hourCounts = new Array<number>(24).fill(0);
    const dayOfWeekCounts = new Array<number>(7).fill(0);

    for (const session of sessions) {
      const date = new Date(session.startedAt);
      hourCounts[date.getHours()]++;
      dayOfWeekCounts[date.getDay()]++;
    }

    // Find peak hours (hours with significantly more sessions)
    const avgHour = sessions.length / 24;
    for (let h = 0; h < 24; h++) {
      if (hourCounts[h] >= Math.max(3, avgHour * 2.5)) {
        const confidence = Math.min(0.8, 0.3 + (hourCounts[h] / sessions.length) * 0.5);
        patterns.push({
          type: 'time_pattern',
          description: `User is most active around ${h}:00 (${hourCounts[h]} sessions)`,
          confidence,
          frequency: hourCounts[h],
        });
      }
    }

    // Find peak days
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const avgDay = sessions.length / 7;
    for (let d = 0; d < 7; d++) {
      if (dayOfWeekCounts[d] >= Math.max(3, avgDay * 2)) {
        const confidence = Math.min(0.75, 0.25 + (dayOfWeekCounts[d] / sessions.length) * 0.5);
        patterns.push({
          type: 'time_pattern',
          description: `User is most active on ${dayNames[d]}s (${dayOfWeekCounts[d]} sessions)`,
          confidence,
          frequency: dayOfWeekCounts[d],
        });
      }
    }

    // Detect time-correlated intents
    // Group messages by hour bucket and see if certain topics cluster at certain times
    const hourTopics = new Map<number, Map<string, number>>();

    for (const session of sessions) {
      for (const msg of session.messages) {
        if (msg.role !== 'user') continue;
        const hour = new Date(msg.timestamp).getHours();
        const intent = this.normalizeIntent(msg.content);
        if (intent.length < 3) continue;

        if (!hourTopics.has(hour)) {
          hourTopics.set(hour, new Map());
        }
        const topics = hourTopics.get(hour)!;
        topics.set(intent, (topics.get(intent) ?? 0) + 1);
      }
    }

    for (const [hour, topics] of hourTopics) {
      for (const [intent, count] of topics) {
        if (count >= 3) {
          patterns.push({
            type: 'time_pattern',
            description: `User tends to ask about "${intent}" around ${hour}:00`,
            confidence: Math.min(0.7, 0.2 + count * 0.1),
            frequency: count,
          });
        }
      }
    }

    return patterns;
  }

  // -------------------------------------------------------------------------
  // Workflow patterns
  // -------------------------------------------------------------------------

  /**
   * Detect workflow patterns: sequences of actions that the user
   * frequently performs in order (A -> B -> C).
   */
  private detectWorkflowPatterns(sessions: Session[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Extract action sequences from each session
    const sequenceCounts = new Map<string, number>();

    for (const session of sessions) {
      const userMessages = session.messages.filter((m) => m.role === 'user');
      if (userMessages.length < 2) continue;

      const intents = userMessages.map((m) => this.normalizeIntent(m.content)).filter((i) => i.length >= 3);

      // Extract bigram sequences (pairs of consecutive intents)
      for (let i = 0; i < intents.length - 1; i++) {
        const pair = `${intents[i]} -> ${intents[i + 1]}`;
        sequenceCounts.set(pair, (sequenceCounts.get(pair) ?? 0) + 1);
      }

      // Extract trigram sequences
      for (let i = 0; i < intents.length - 2; i++) {
        const triple = `${intents[i]} -> ${intents[i + 1]} -> ${intents[i + 2]}`;
        sequenceCounts.set(triple, (sequenceCounts.get(triple) ?? 0) + 1);
      }
    }

    // Report sequences that appear multiple times
    for (const [sequence, count] of sequenceCounts) {
      if (count >= 2) {
        const steps = sequence.split(' -> ').length;
        const confidence = Math.min(0.85, 0.2 + count * 0.15 + steps * 0.05);
        patterns.push({
          type: 'workflow',
          description: `Detected workflow: ${sequence} (observed ${count} times)`,
          confidence,
          frequency: count,
        });
      }
    }

    return patterns;
  }

  // -------------------------------------------------------------------------
  // Preference patterns
  // -------------------------------------------------------------------------

  /**
   * Detect preference patterns: consistent choices or styles the user exhibits.
   */
  private detectPreferencePatterns(sessions: Session[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Analyse channel preferences
    const channelCounts = new Map<string, number>();
    for (const session of sessions) {
      channelCounts.set(session.channel, (channelCounts.get(session.channel) ?? 0) + 1);
    }

    if (channelCounts.size > 1) {
      const sorted = [...channelCounts.entries()].sort((a, b) => b[1] - a[1]);
      const [topChannel, topCount] = sorted[0];
      if (topCount > sessions.length * 0.6) {
        patterns.push({
          type: 'preference',
          description: `User strongly prefers the "${topChannel}" channel (${Math.round(topCount / sessions.length * 100)}% of sessions)`,
          confidence: Math.min(0.9, topCount / sessions.length),
          frequency: topCount,
        });
      }
    }

    // Analyse message length preferences
    const userMsgLengths: number[] = [];
    for (const session of sessions) {
      for (const msg of session.messages) {
        if (msg.role === 'user') {
          userMsgLengths.push(msg.content.length);
        }
      }
    }

    if (userMsgLengths.length >= 10) {
      const avgLength = userMsgLengths.reduce((a, b) => a + b, 0) / userMsgLengths.length;

      if (avgLength < 50) {
        patterns.push({
          type: 'preference',
          description: 'User prefers short, concise messages (avg < 50 chars)',
          confidence: 0.6,
          frequency: userMsgLengths.length,
        });
      } else if (avgLength > 200) {
        patterns.push({
          type: 'preference',
          description: 'User provides detailed, verbose messages (avg > 200 chars)',
          confidence: 0.6,
          frequency: userMsgLengths.length,
        });
      }
    }

    // Detect explicit preference keywords across sessions
    const preferencePhrases = new Map<string, number>();
    const PREF_PATTERN = /\b(?:i (?:always |usually |typically )?(?:prefer|like|want|use|choose|need))\s+(.{5,50})/gi;

    for (const session of sessions) {
      for (const msg of session.messages) {
        if (msg.role !== 'user') continue;

        let match;
        const regex = new RegExp(PREF_PATTERN.source, PREF_PATTERN.flags);
        while ((match = regex.exec(msg.content)) !== null) {
          const pref = match[1].trim().toLowerCase();
          preferencePhrases.set(pref, (preferencePhrases.get(pref) ?? 0) + 1);
        }
      }
    }

    for (const [pref, count] of preferencePhrases) {
      if (count >= 2) {
        patterns.push({
          type: 'preference',
          description: `User has expressed preference for: "${pref}" (${count} times)`,
          confidence: Math.min(0.8, 0.3 + count * 0.15),
          frequency: count,
        });
      }
    }

    return patterns;
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Normalize a user message into a simplified "intent" string.
   * Strips punctuation, lowercases, and reduces to key words.
   */
  private normalizeIntent(content: string): string {
    // Take the first sentence / line (usually the main intent)
    const firstLine = content.split(/[.!?\n]/)[0] ?? content;

    return firstLine
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 2 && !this.isStopWord(w))
      .slice(0, 6) // Keep at most 6 key words
      .join(' ');
  }

  /**
   * Check if a word is a stop word.
   */
  private isStopWord(word: string): boolean {
    const stops = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of',
      'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'and',
      'or', 'but', 'not', 'no', 'if', 'that', 'this', 'it', 'its',
      'my', 'your', 'me', 'him', 'her', 'them', 'you', 'what',
      'which', 'who', 'how', 'when', 'where', 'why', 'just', 'also',
      'so', 'very', 'too', 'much', 'please', 'thanks', 'thank',
      'hey', 'hi', 'hello', 'help',
    ]);
    return stops.has(word);
  }

  /**
   * Cluster similar intents using bigram overlap.
   * Returns groups of intents that share >= 50% of their bigrams.
   */
  private clusterSimilarIntents(intents: string[]): string[][] {
    if (intents.length < 2) return [];

    const bigramSets = new Map<string, Set<string>>();
    for (const intent of intents) {
      bigramSets.set(intent, this.getBigrams(intent));
    }

    const clusters: string[][] = [];
    const assigned = new Set<string>();

    for (const intent of intents) {
      if (assigned.has(intent)) continue;

      const cluster = [intent];
      assigned.add(intent);

      const intentBigrams = bigramSets.get(intent)!;

      for (const other of intents) {
        if (assigned.has(other)) continue;

        const otherBigrams = bigramSets.get(other)!;
        const similarity = this.bigramSimilarity(intentBigrams, otherBigrams);

        if (similarity >= 0.5) {
          cluster.push(other);
          assigned.add(other);
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Get the set of character bigrams for a string.
   */
  private getBigrams(text: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.slice(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Calculate the Dice coefficient between two bigram sets.
   */
  private bigramSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;

    let intersection = 0;
    for (const bigram of a) {
      if (b.has(bigram)) intersection++;
    }

    return (2 * intersection) / (a.size + b.size);
  }
}
