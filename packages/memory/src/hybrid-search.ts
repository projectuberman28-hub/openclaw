/**
 * @alfred/memory - Hybrid search combining vector similarity + BM25
 *
 * Provides a HybridSearch class that merges dense vector search with
 * sparse BM25 keyword search, fused via reciprocal rank fusion (RRF).
 * Optionally uses SQLite FTS5 for efficient text search when available.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { resolveAlfredHome } from '@alfred/core/config/paths';
import { cosineSimilarity } from './vector-store.js';
import pino from 'pino';

const logger = pino({ name: 'alfred:memory:hybrid-search' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridSearchResult {
  id: string;
  content: string;
  /** Combined score from RRF */
  score: number;
  /** Raw vector similarity score [0, 1] */
  vectorScore: number;
  /** Raw BM25 score */
  bm25Score: number;
  metadata: Record<string, unknown>;
}

export interface HybridSearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Weight for vector similarity score (default 0.7) */
  vectorWeight?: number;
  /** Weight for BM25 text score (default 0.3) */
  bm25Weight?: number;
  /** Optional filters */
  filter?: {
    agentId?: string;
    tags?: string[];
    sessionId?: string;
  };
}

export interface HybridSearchConfig {
  /** Path to the SQLite database. Defaults to ALFRED_HOME/memory/vectors.db */
  dbPath?: string;
}

// ---------------------------------------------------------------------------
// BM25 Implementation
// ---------------------------------------------------------------------------

/**
 * Tokenize text into lowercase terms, stripping punctuation.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Stopwords to exclude from BM25 scoring.
 * These are extremely common English words that carry little semantic weight.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'of', 'in', 'to', 'and', 'or', 'for',
  'on', 'at', 'by', 'be', 'as', 'do', 'if', 'so', 'no', 'not', 'but',
  'was', 'are', 'has', 'had', 'have', 'will', 'with', 'this', 'that',
  'from', 'they', 'been', 'were', 'said', 'each', 'which', 'their',
  'can', 'its', 'than', 'other', 'into', 'could', 'may', 'i', 'my',
  'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her', 'his',
]);

/**
 * Tokenize and remove stopwords.
 */
export function tokenizeWithStopwords(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

/**
 * BM25 scoring engine.
 *
 * BM25 is a bag-of-words retrieval function that ranks documents based on
 * query terms. It uses term frequency (TF), inverse document frequency (IDF),
 * and document length normalization.
 *
 * Score(D, Q) = SUM over q in Q of:
 *   IDF(q) * (f(q,D) * (k1 + 1)) / (f(q,D) + k1 * (1 - b + b * |D| / avgdl))
 *
 * Where:
 *   f(q,D) = frequency of term q in document D
 *   |D|    = length of document D in terms
 *   avgdl  = average document length across the corpus
 *   k1     = term frequency saturation parameter (default 1.2)
 *   b      = length normalization parameter (default 0.75)
 *   IDF(q) = log((N - n(q) + 0.5) / (n(q) + 0.5) + 1)
 *   N      = total documents in corpus
 *   n(q)   = number of documents containing term q
 */
export class BM25 {
  /** Term frequency saturation parameter */
  private k1: number;
  /** Length normalization parameter */
  private b: number;

  /** Corpus: array of tokenized documents */
  private documents: string[][] = [];
  /** Document IDs parallel to documents array */
  private docIds: string[] = [];
  /** Raw content parallel to documents array */
  private docContents: string[] = [];
  /** Metadata parallel to documents array */
  private docMetadata: Array<Record<string, unknown>> = [];

  /** Number of documents containing each term */
  private df: Map<string, number> = new Map();
  /** Total number of documents */
  private N: number = 0;
  /** Average document length */
  private avgdl: number = 0;
  /** IDF cache */
  private idfCache: Map<string, number> = new Map();

  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  /**
   * Build the BM25 index from a set of documents.
   */
  index(
    docs: Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
    }>,
  ): void {
    this.documents = [];
    this.docIds = [];
    this.docContents = [];
    this.docMetadata = [];
    this.df = new Map();
    this.idfCache = new Map();

    let totalLen = 0;

    for (const doc of docs) {
      const tokens = tokenizeWithStopwords(doc.content);
      this.documents.push(tokens);
      this.docIds.push(doc.id);
      this.docContents.push(doc.content);
      this.docMetadata.push(doc.metadata);
      totalLen += tokens.length;

      // Count document frequency (unique terms per document)
      const seen = new Set<string>();
      for (const token of tokens) {
        if (!seen.has(token)) {
          seen.add(token);
          this.df.set(token, (this.df.get(token) ?? 0) + 1);
        }
      }
    }

    this.N = docs.length;
    this.avgdl = this.N > 0 ? totalLen / this.N : 0;

    // Pre-compute IDF for all terms
    for (const [term, docFreq] of this.df.entries()) {
      this.idfCache.set(term, this.computeIdf(docFreq));
    }
  }

  /**
   * Compute IDF for a term given its document frequency.
   *
   * IDF(q) = ln((N - n(q) + 0.5) / (n(q) + 0.5) + 1)
   *
   * This is the "IDF with +1 smoothing" variant that prevents negative IDF
   * for very common terms.
   */
  private computeIdf(docFreq: number): number {
    return Math.log(
      (this.N - docFreq + 0.5) / (docFreq + 0.5) + 1,
    );
  }

  /**
   * Get the IDF for a term. Returns 0 if the term is not in the corpus.
   */
  private getIdf(term: string): number {
    return this.idfCache.get(term) ?? 0;
  }

  /**
   * Score all documents against a query.
   * Returns results sorted by BM25 score descending.
   */
  search(
    query: string,
    limit: number = 10,
  ): Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }> {
    const queryTerms = tokenizeWithStopwords(query);
    if (queryTerms.length === 0 || this.N === 0) {
      return [];
    }

    const scores: Array<{
      id: string;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < this.documents.length; i++) {
      const docTokens = this.documents[i];
      const docLen = docTokens.length;
      if (docLen === 0) continue;

      // Build term frequency map for this document
      const tf = new Map<string, number>();
      for (const token of docTokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }

      let score = 0;
      for (const term of queryTerms) {
        const termFreq = tf.get(term) ?? 0;
        if (termFreq === 0) continue;

        const idf = this.getIdf(term);

        // BM25 TF component with length normalization
        const tfNorm =
          (termFreq * (this.k1 + 1)) /
          (termFreq + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl)));

        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.push({
          id: this.docIds[i],
          content: this.docContents[i],
          score,
          metadata: this.docMetadata[i],
        });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit);
  }

  /** Get the number of indexed documents */
  get size(): number {
    return this.N;
  }
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

/**
 * Reciprocal Rank Fusion (RRF) merges ranked lists from different retrieval
 * methods into a single ranking.
 *
 * For each document d and its rank r_i in list i:
 *   RRF_score(d) = SUM_i weight_i / (k + r_i)
 *
 * Where k is a constant (default 60) that dampens the effect of high rankings.
 *
 * @param rankedLists Array of { items: ranked results, weight: importance }
 * @param k Fusion constant (default 60)
 */
export function reciprocalRankFusion<T extends { id: string }>(
  rankedLists: Array<{
    items: T[];
    weight: number;
  }>,
  k: number = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const { items, weight } of rankedLists) {
    for (let rank = 0; rank < items.length; rank++) {
      const id = items[rank].id;
      const existing = scores.get(id) ?? 0;
      scores.set(id, existing + weight / (k + rank + 1));
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Embedding deserialization helper
// ---------------------------------------------------------------------------

function blobToEmbedding(blob: Buffer): number[] {
  const count = blob.length / 4;
  const result = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    result[i] = blob.readFloatLE(i * 4);
  }
  return result;
}

// ---------------------------------------------------------------------------
// HybridSearch
// ---------------------------------------------------------------------------

export class HybridSearch {
  private db: Database.Database;
  private bm25: BM25;
  private hasFts5: boolean = false;
  private isOwner: boolean;

  constructor(config: HybridSearchConfig = {}) {
    const defaultDbDir = join(resolveAlfredHome(), 'memory');
    const dbPath = config.dbPath ?? join(defaultDbDir, 'vectors.db');

    const dir = join(dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.isOwner = true;

    this.bm25 = new BM25();
    this.tryInitFts5();
  }

  /**
   * Construct a HybridSearch using an existing database connection.
   * Does not own the connection (will not close it).
   */
  static fromDatabase(db: Database.Database): HybridSearch {
    const instance = Object.create(HybridSearch.prototype) as HybridSearch;
    instance.db = db;
    instance.bm25 = new BM25();
    instance.hasFts5 = false;
    instance.isOwner = false;
    instance.tryInitFts5();
    return instance;
  }

  /**
   * Attempt to create an FTS5 virtual table for full-text search.
   */
  private tryInitFts5(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
        USING fts5(content, id UNINDEXED, tokenize='porter unicode61');
      `);
      this.hasFts5 = true;
      logger.info('FTS5 full-text search available');
    } catch (error) {
      logger.debug(
        { error: String(error) },
        'FTS5 not available, using BM25 in-memory fallback',
      );
      this.hasFts5 = false;
    }
  }

  /**
   * Sync the FTS5 index with the memories table.
   * Call this after inserting or updating memories to keep FTS5 in sync.
   */
  syncFts5Index(): void {
    if (!this.hasFts5) return;

    try {
      // Clear and rebuild
      this.db.exec('DELETE FROM memories_fts');

      const rows = this.db
        .prepare('SELECT id, content FROM memories')
        .all() as Array<{ id: string; content: string }>;

      const insert = this.db.prepare(
        'INSERT INTO memories_fts (id, content) VALUES (?, ?)',
      );

      const insertAll = this.db.transaction(() => {
        for (const row of rows) {
          insert.run(row.id, row.content);
        }
      });

      insertAll();
      logger.debug({ count: rows.length }, 'FTS5 index synced');
    } catch (error) {
      logger.warn({ error: String(error) }, 'Failed to sync FTS5 index');
    }
  }

  /**
   * Rebuild the in-memory BM25 index from the database.
   */
  rebuildBm25Index(): void {
    const rows = this.db
      .prepare('SELECT id, content, metadata FROM memories')
      .all() as Array<{ id: string; content: string; metadata: string }>;

    this.bm25.index(
      rows.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: JSON.parse(r.metadata),
      })),
    );

    logger.debug({ count: rows.length }, 'BM25 index rebuilt');
  }

  /**
   * Perform hybrid search combining vector similarity and BM25 text matching.
   *
   * The results from both retrieval methods are merged using Reciprocal Rank
   * Fusion (RRF), with configurable weights for each signal.
   */
  search(
    query: string,
    queryEmbedding: number[],
    options: HybridSearchOptions = {},
  ): HybridSearchResult[] {
    const {
      limit = 10,
      vectorWeight = 0.7,
      bm25Weight = 0.3,
      filter,
    } = options;

    // Retrieve a larger candidate set for fusion
    const candidateLimit = Math.max(limit * 3, 50);

    // ----- Vector search -----
    const vectorResults = this.vectorSearch(
      queryEmbedding,
      candidateLimit,
      filter,
    );

    // ----- BM25 text search -----
    const bm25Results = this.textSearch(query, candidateLimit, filter);

    // ----- Reciprocal Rank Fusion -----
    const rrfScores = reciprocalRankFusion(
      [
        { items: vectorResults, weight: vectorWeight },
        { items: bm25Results, weight: bm25Weight },
      ],
      60,
    );

    // Build a map of all candidate documents for quick lookup
    const docMap = new Map<
      string,
      {
        content: string;
        vectorScore: number;
        bm25Score: number;
        metadata: Record<string, unknown>;
      }
    >();

    for (const vr of vectorResults) {
      docMap.set(vr.id, {
        content: vr.content,
        vectorScore: vr.score,
        bm25Score: 0,
        metadata: vr.metadata,
      });
    }

    for (const br of bm25Results) {
      const existing = docMap.get(br.id);
      if (existing) {
        existing.bm25Score = br.score;
      } else {
        docMap.set(br.id, {
          content: br.content,
          vectorScore: 0,
          bm25Score: br.score,
          metadata: br.metadata,
        });
      }
    }

    // Assemble final results sorted by RRF score
    const results: HybridSearchResult[] = [];
    for (const [id, rrfScore] of rrfScores.entries()) {
      const doc = docMap.get(id);
      if (!doc) continue;

      results.push({
        id,
        content: doc.content,
        score: rrfScore,
        vectorScore: doc.vectorScore,
        bm25Score: doc.bm25Score,
        metadata: doc.metadata,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Pure vector similarity search against stored memories.
   */
  private vectorSearch(
    queryEmbedding: number[],
    limit: number,
    filter?: HybridSearchOptions['filter'],
  ): Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter?.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT id, content, embedding, metadata, tags FROM memories ${whereClause}`,
      )
      .all(...params) as Array<{
      id: string;
      content: string;
      embedding: Buffer;
      metadata: string;
      tags: string;
    }>;

    // Apply tag filter
    let candidates = rows;
    if (filter?.tags && filter.tags.length > 0) {
      candidates = rows.filter((row) => {
        const rowTags: string[] = JSON.parse(row.tags);
        return filter.tags!.some((t) => rowTags.includes(t));
      });
    }

    const scored = candidates.map((row) => {
      const storedEmbedding = blobToEmbedding(row.embedding);
      const score = cosineSimilarity(queryEmbedding, storedEmbedding);
      return {
        id: row.id,
        content: row.content,
        score,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * BM25 text search. Uses FTS5 if available, otherwise in-memory BM25.
   */
  private textSearch(
    query: string,
    limit: number,
    filter?: HybridSearchOptions['filter'],
  ): Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }> {
    if (this.hasFts5) {
      return this.fts5Search(query, limit, filter);
    }
    return this.bm25Search(query, limit, filter);
  }

  /**
   * FTS5-backed text search using SQLite's built-in BM25 ranking.
   */
  private fts5Search(
    query: string,
    limit: number,
    filter?: HybridSearchOptions['filter'],
  ): Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }> {
    try {
      // Escape FTS5 special characters in query
      const safeQuery = query
        .replace(/[*"(){}[\]^~\\:]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .join(' OR ');

      if (!safeQuery) return [];

      // FTS5 rank is negative (closer to 0 = better match)
      const rows = this.db
        .prepare(
          `SELECT f.id, f.content, rank as score
           FROM memories_fts f
           WHERE memories_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(safeQuery, limit * 2) as Array<{
        id: string;
        content: string;
        score: number;
      }>;

      // Fetch metadata from the main table and apply filters
      const results: Array<{
        id: string;
        content: string;
        score: number;
        metadata: Record<string, unknown>;
      }> = [];

      for (const row of rows) {
        const memory = this.db
          .prepare(
            'SELECT metadata, agent_id, session_id, tags FROM memories WHERE id = ?',
          )
          .get(row.id) as
          | {
              metadata: string;
              agent_id: string | null;
              session_id: string | null;
              tags: string;
            }
          | undefined;

        if (!memory) continue;

        // Apply filters
        if (filter?.agentId && memory.agent_id !== filter.agentId) continue;
        if (filter?.sessionId && memory.session_id !== filter.sessionId) continue;
        if (filter?.tags && filter.tags.length > 0) {
          const rowTags: string[] = JSON.parse(memory.tags);
          if (!filter.tags.some((t) => rowTags.includes(t))) continue;
        }

        // Convert FTS5 rank (negative, closer to 0 = better) to positive score
        results.push({
          id: row.id,
          content: row.content,
          score: Math.abs(row.score),
          metadata: JSON.parse(memory.metadata),
        });
      }

      return results.slice(0, limit);
    } catch (error) {
      logger.warn(
        { error: String(error) },
        'FTS5 search failed, falling back to BM25',
      );
      return this.bm25Search(query, limit, filter);
    }
  }

  /**
   * In-memory BM25 search fallback when FTS5 is not available.
   */
  private bm25Search(
    query: string,
    limit: number,
    filter?: HybridSearchOptions['filter'],
  ): Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }> {
    // Fetch documents from DB (applying SQL-level filters)
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter?.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT id, content, metadata, tags FROM memories ${whereClause}`,
      )
      .all(...params) as Array<{
      id: string;
      content: string;
      metadata: string;
      tags: string;
    }>;

    // Apply tag filter
    let docs = rows;
    if (filter?.tags && filter.tags.length > 0) {
      docs = rows.filter((row) => {
        const rowTags: string[] = JSON.parse(row.tags);
        return filter.tags!.some((t) => rowTags.includes(t));
      });
    }

    // Build BM25 index from filtered docs
    this.bm25.index(
      docs.map((d) => ({
        id: d.id,
        content: d.content,
        metadata: JSON.parse(d.metadata),
      })),
    );

    return this.bm25.search(query, limit);
  }

  /**
   * Close the database connection (only if this instance owns it).
   */
  close(): void {
    if (this.isOwner) {
      this.db.close();
      logger.debug('HybridSearch closed');
    }
  }
}
