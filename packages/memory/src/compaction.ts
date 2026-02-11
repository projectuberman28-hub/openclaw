/**
 * @alfred/memory - Memory compaction and pruning
 *
 * The MemoryCompactor merges semantically similar memories, extracts and
 * deduplicates key facts, and prunes stale low-relevance entries to keep
 * the memory store efficient and within token budgets.
 */

import { cosineSimilarity } from './vector-store.js';
import pino from 'pino';

const logger = pino({ name: 'alfred:memory:compaction' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id?: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
}

export interface CompactionResult {
  /** Merged summary of the compacted memories */
  summary: string;
  /** Extracted and deduplicated key facts */
  keyFacts: string[];
}

export interface CompactionOptions {
  /** Cosine similarity threshold to consider memories as similar (default 0.85) */
  similarityThreshold?: number;
  /** Maximum tokens for the compacted summary (default 2000) */
  maxSummaryTokens?: number;
}

export interface PruneResult {
  /** Number of memories removed */
  removed: number;
  /** IDs of removed memories */
  removedIds: string[];
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the number of tokens in a text.
 * Uses the ~4 characters per token heuristic for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Key fact extraction
// ---------------------------------------------------------------------------

/**
 * Extract key facts from a text string.
 *
 * Splits text into sentences, filters out short or trivial sentences,
 * and returns substantive statements as key facts.
 */
export function extractKeyFacts(text: string): string[] {
  // Split on sentence boundaries
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const facts: string[] = [];

  for (const sentence of sentences) {
    // Skip very short sentences (likely fragments or filler)
    if (sentence.length < 15) continue;

    // Skip questions
    if (sentence.endsWith('?')) continue;

    // Skip sentences that are purely conversational filler
    const lowerSentence = sentence.toLowerCase();
    const fillerPhrases = [
      'okay', 'alright', 'sure', 'thanks', 'thank you', 'got it',
      'i see', 'let me', 'well', 'so basically', 'um', 'uh',
    ];
    if (fillerPhrases.some((f) => lowerSentence.startsWith(f) && sentence.length < 30)) {
      continue;
    }

    facts.push(sentence);
  }

  return facts;
}

/**
 * Deduplicate key facts by checking for exact and near-exact matches.
 * Uses Jaccard similarity on word sets to catch paraphrases.
 */
export function deduplicateFacts(facts: string[]): string[] {
  if (facts.length === 0) return [];

  const unique: string[] = [];
  const wordSets: Set<string>[] = [];

  for (const fact of facts) {
    const words = new Set(
      fact
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    // Check against existing unique facts
    let isDuplicate = false;
    for (const existingWords of wordSets) {
      const intersection = new Set(
        [...words].filter((w) => existingWords.has(w)),
      );
      const union = new Set([...words, ...existingWords]);
      const jaccard =
        union.size > 0 ? intersection.size / union.size : 0;

      // High overlap = likely duplicate
      if (jaccard > 0.7) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(fact);
      wordSets.push(words);
    }
  }

  return unique;
}

// ---------------------------------------------------------------------------
// MemoryCompactor
// ---------------------------------------------------------------------------

export class MemoryCompactor {
  private similarityThreshold: number;
  private maxSummaryTokens: number;

  constructor(options: CompactionOptions = {}) {
    this.similarityThreshold = options.similarityThreshold ?? 0.85;
    this.maxSummaryTokens = options.maxSummaryTokens ?? 2000;
  }

  /**
   * Compact a set of memories by merging similar ones and extracting key facts.
   *
   * Algorithm:
   * 1. Group memories by semantic similarity (clustering via greedy assignment)
   * 2. For each cluster, merge content and extract key facts
   * 3. Deduplicate facts across all clusters
   * 4. Build a summary within the token budget
   */
  async compact(
    memories: MemoryEntry[],
  ): Promise<CompactionResult> {
    if (memories.length === 0) {
      return { summary: '', keyFacts: [] };
    }

    if (memories.length === 1) {
      const facts = extractKeyFacts(memories[0].content);
      return {
        summary: memories[0].content,
        keyFacts: deduplicateFacts(facts),
      };
    }

    // Step 1: Cluster similar memories
    const clusters = this.clusterMemories(memories);
    logger.debug(
      { inputCount: memories.length, clusterCount: clusters.length },
      'Memory clustering complete',
    );

    // Step 2: Merge each cluster and extract key facts
    const allFacts: string[] = [];
    const clusterSummaries: string[] = [];

    for (const cluster of clusters) {
      const merged = this.mergeCluster(cluster);
      clusterSummaries.push(merged.summary);
      allFacts.push(...merged.facts);
    }

    // Step 3: Deduplicate all facts
    const uniqueFacts = deduplicateFacts(allFacts);

    // Step 4: Build final summary within token budget
    const summary = this.buildSummary(clusterSummaries, uniqueFacts);

    return {
      summary,
      keyFacts: uniqueFacts,
    };
  }

  /**
   * Cluster memories by embedding similarity using greedy assignment.
   *
   * For each memory, check if it belongs to an existing cluster
   * (similarity > threshold to the cluster centroid). If not, start a new cluster.
   */
  private clusterMemories(memories: MemoryEntry[]): MemoryEntry[][] {
    // If no embeddings, treat all as one cluster
    const hasEmbeddings = memories.some((m) => m.embedding && m.embedding.length > 0);
    if (!hasEmbeddings) {
      return [memories];
    }

    const clusters: { centroid: number[]; members: MemoryEntry[] }[] = [];

    for (const memory of memories) {
      if (!memory.embedding || memory.embedding.length === 0) {
        // No embedding; assign to first cluster or create new
        if (clusters.length > 0) {
          clusters[0].members.push(memory);
        } else {
          clusters.push({ centroid: [], members: [memory] });
        }
        continue;
      }

      let bestCluster = -1;
      let bestSim = -1;

      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].centroid.length === 0) continue;
        const sim = cosineSimilarity(memory.embedding, clusters[i].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = i;
        }
      }

      if (bestSim >= this.similarityThreshold && bestCluster >= 0) {
        clusters[bestCluster].members.push(memory);
        // Update centroid as running mean
        clusters[bestCluster].centroid = this.updateCentroid(
          clusters[bestCluster].centroid,
          memory.embedding,
          clusters[bestCluster].members.length,
        );
      } else {
        // Start new cluster
        clusters.push({
          centroid: [...memory.embedding],
          members: [memory],
        });
      }
    }

    return clusters.map((c) => c.members);
  }

  /**
   * Update a centroid with a new vector using a running mean.
   */
  private updateCentroid(
    currentCentroid: number[],
    newVector: number[],
    newCount: number,
  ): number[] {
    if (currentCentroid.length === 0) return [...newVector];
    if (newVector.length !== currentCentroid.length) return currentCentroid;

    const result = new Array<number>(currentCentroid.length);
    for (let i = 0; i < currentCentroid.length; i++) {
      // Incremental mean: new_mean = old_mean + (new_val - old_mean) / count
      result[i] =
        currentCentroid[i] +
        (newVector[i] - currentCentroid[i]) / newCount;
    }
    return result;
  }

  /**
   * Merge a cluster of similar memories into a summary and key facts.
   */
  private mergeCluster(cluster: MemoryEntry[]): {
    summary: string;
    facts: string[];
  } {
    if (cluster.length === 1) {
      const facts = extractKeyFacts(cluster[0].content);
      return { summary: cluster[0].content, facts };
    }

    // Combine all content
    const allContent = cluster.map((m) => m.content).join('\n');
    const allFacts: string[] = [];

    for (const memory of cluster) {
      allFacts.push(...extractKeyFacts(memory.content));
    }

    // Deduplicate within cluster
    const uniqueFacts = deduplicateFacts(allFacts);

    // Build cluster summary from unique facts
    const summary =
      uniqueFacts.length > 0
        ? uniqueFacts.join(' ')
        : allContent.slice(0, 500);

    return { summary, facts: uniqueFacts };
  }

  /**
   * Build a final summary that fits within the token budget.
   */
  private buildSummary(
    clusterSummaries: string[],
    keyFacts: string[],
  ): string {
    const parts: string[] = [];
    let tokenCount = 0;

    // Add key facts first (highest density of information)
    if (keyFacts.length > 0) {
      const factsSection = 'Key facts:\n' + keyFacts.map((f) => `- ${f}`).join('\n');
      const factsTokens = estimateTokens(factsSection);

      if (tokenCount + factsTokens <= this.maxSummaryTokens) {
        parts.push(factsSection);
        tokenCount += factsTokens;
      } else {
        // Truncate facts to fit
        const header = 'Key facts:\n';
        let truncatedFacts = header;
        for (const fact of keyFacts) {
          const line = `- ${fact}\n`;
          if (tokenCount + estimateTokens(truncatedFacts + line) > this.maxSummaryTokens) {
            break;
          }
          truncatedFacts += line;
        }
        parts.push(truncatedFacts.trimEnd());
        tokenCount = estimateTokens(parts.join('\n\n'));
      }
    }

    // Add cluster summaries if room remains
    if (tokenCount < this.maxSummaryTokens && clusterSummaries.length > 0) {
      const remaining = this.maxSummaryTokens - tokenCount;
      const summarySection = 'Context:\n' + clusterSummaries.join('\n---\n');
      const summaryTokens = estimateTokens(summarySection);

      if (summaryTokens <= remaining) {
        parts.push(summarySection);
      } else {
        // Truncate to fit
        const maxChars = remaining * 4;
        parts.push('Context:\n' + summarySection.slice(0, maxChars).trimEnd());
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Prune old memories, optionally keeping high-importance ones.
   *
   * Importance is determined by metadata fields:
   *   - metadata.important === true
   *   - metadata.pinned === true
   *   - metadata.importance > 0.7 (numeric score)
   *   - tags containing "important" or "pinned"
   *
   * @returns The count and IDs of removed memories.
   */
  async pruneOldMemories(
    memories: MemoryEntry[],
    olderThan: Date,
    keepImportant: boolean = true,
  ): Promise<PruneResult> {
    const removed: string[] = [];
    const cutoff = olderThan.toISOString();

    for (const memory of memories) {
      const createdAt = (memory.metadata['createdAt'] as string) ??
        (memory.metadata['created_at'] as string) ??
        '';

      // Skip if no timestamp or not old enough
      if (!createdAt || createdAt >= cutoff) continue;

      // Check importance
      if (keepImportant && this.isImportant(memory)) {
        logger.debug(
          { id: memory.id },
          'Keeping important memory despite age',
        );
        continue;
      }

      if (memory.id) {
        removed.push(memory.id);
      }
    }

    logger.info(
      { removedCount: removed.length, olderThan: cutoff },
      'Memory pruning complete',
    );

    return {
      removed: removed.length,
      removedIds: removed,
    };
  }

  /**
   * Check if a memory is marked as important via metadata or tags.
   */
  private isImportant(memory: MemoryEntry): boolean {
    const meta = memory.metadata;

    // Check boolean flags
    if (meta['important'] === true || meta['pinned'] === true) {
      return true;
    }

    // Check numeric importance score
    const importance = meta['importance'];
    if (typeof importance === 'number' && importance > 0.7) {
      return true;
    }

    // Check tags
    const tags = meta['tags'];
    if (Array.isArray(tags)) {
      if (
        tags.includes('important') ||
        tags.includes('pinned') ||
        tags.includes('core')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Estimate the total tokens used by a collection of memories.
   */
  estimateTotalTokens(memories: MemoryEntry[]): number {
    let total = 0;
    for (const memory of memories) {
      total += estimateTokens(memory.content);
      total += estimateTokens(JSON.stringify(memory.metadata));
    }
    return total;
  }
}
