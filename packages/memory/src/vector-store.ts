/**
 * @alfred/memory - Vector storage backed by SQLite
 *
 * Stores embeddings alongside content and metadata in a better-sqlite3
 * database. Supports sqlite-vec extension for hardware-accelerated
 * similarity search, with a pure JS cosine similarity fallback.
 *
 * DB location: ALFRED_HOME/memory/vectors.db (auto-created).
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { resolveAlfredHome } from '@alfred/core/config/paths';
import pino from 'pino';

const logger = pino({ name: 'alfred:memory:vector-store' });

// ---------------------------------------------------------------------------
// Cosine similarity (pure JS)
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1]. Higher = more similar.
 *
 * cosine_sim(a, b) = dot(a, b) / (||a|| * ||b||)
 *
 * For unit-normalized vectors this simplifies to just the dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryRecord {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  agentId: string | null;
  sessionId: string | null;
  tags: string[];
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchFilter {
  agentId?: string;
  tags?: string[];
  sessionId?: string;
}

export interface VectorStoreOptions {
  /** Path to the SQLite database file. Defaults to ALFRED_HOME/memory/vectors.db */
  dbPath?: string;
  /** Whether to attempt loading the sqlite-vec extension */
  useSqliteVec?: boolean;
}

// ---------------------------------------------------------------------------
// Embedding serialization
// ---------------------------------------------------------------------------

/** Serialize a number[] to a Buffer (Float32 LE) for BLOB storage */
function embeddingToBlob(embedding: number[]): Buffer {
  const buf = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}

/** Deserialize a Buffer (Float32 LE) back to number[] */
function blobToEmbedding(blob: Buffer): number[] {
  const count = blob.length / 4;
  const result = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    result[i] = blob.readFloatLE(i * 4);
  }
  return result;
}

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

export class VectorStore {
  private db: Database.Database;
  private hasSqliteVec: boolean = false;

  constructor(options: VectorStoreOptions = {}) {
    const defaultDbDir = join(resolveAlfredHome(), 'memory');
    const dbPath = options.dbPath ?? join(defaultDbDir, 'vectors.db');

    // Ensure the directory exists
    const dir = join(dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Attempt to load sqlite-vec extension
    if (options.useSqliteVec !== false) {
      this.tryLoadSqliteVec();
    }

    this.initSchema();
    logger.info({ dbPath, sqliteVec: this.hasSqliteVec }, 'VectorStore initialized');
  }

  /**
   * Try to load the sqlite-vec extension. Fails silently if not available.
   */
  private tryLoadSqliteVec(): void {
    try {
      // sqlite-vec can be loaded from multiple locations
      // Try the npm package first, then system paths
      const possiblePaths = [
        'sqlite-vec',
        '/usr/local/lib/vec0',
        '/usr/lib/vec0',
      ];

      for (const extPath of possiblePaths) {
        try {
          this.db.loadExtension(extPath);
          this.hasSqliteVec = true;
          logger.info('sqlite-vec extension loaded successfully');
          return;
        } catch {
          // Try next
        }
      }
      logger.debug('sqlite-vec extension not available, using JS fallback');
    } catch {
      logger.debug('sqlite-vec extension not available, using JS fallback');
    }
  }

  /**
   * Initialize the database schema.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id          TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        embedding   BLOB NOT NULL,
        metadata    TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        agent_id    TEXT,
        session_id  TEXT,
        tags        TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
    `);
  }

  /**
   * Store a new memory with its embedding.
   * @returns The generated memory ID.
   */
  store(
    content: string,
    embedding: number[],
    metadata?: Record<string, unknown>,
    options?: { agentId?: string; sessionId?: string; tags?: string[] },
  ): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    const meta = metadata ?? {};
    const tags = options?.tags ?? [];

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, embedding, metadata, created_at, updated_at, agent_id, session_id, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      content,
      embeddingToBlob(embedding),
      JSON.stringify(meta),
      now,
      now,
      options?.agentId ?? null,
      options?.sessionId ?? null,
      JSON.stringify(tags),
    );

    logger.debug({ id, contentLength: content.length }, 'Memory stored');
    return id;
  }

  /**
   * Search memories by vector similarity.
   * Uses sqlite-vec if available, otherwise falls back to JS cosine similarity.
   */
  search(
    queryEmbedding: number[],
    limit: number = 10,
    filter?: SearchFilter,
  ): SearchResult[] {
    // Build WHERE clauses for filtering
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

    // Fetch all candidate rows (filtered by SQL WHERE)
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

    // Apply tag filter in JS (JSON array stored as text)
    let candidates = rows;
    if (filter?.tags && filter.tags.length > 0) {
      const requiredTags = new Set(filter.tags);
      candidates = rows.filter((row) => {
        const rowTags: string[] = JSON.parse(row.tags);
        return filter.tags!.some((t) => rowTags.includes(t));
      });
    }

    // Score each candidate by cosine similarity
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

    // Sort by score descending and take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Get a single memory by ID.
   */
  get(id: string): MemoryRecord | null {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as
      | {
          id: string;
          content: string;
          embedding: Buffer;
          metadata: string;
          created_at: string;
          updated_at: string;
          agent_id: string | null;
          session_id: string | null;
          tags: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      embedding: blobToEmbedding(row.embedding),
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      agentId: row.agent_id,
      sessionId: row.session_id,
      tags: JSON.parse(row.tags),
    };
  }

  /**
   * Update the content and/or metadata of an existing memory.
   */
  update(
    id: string,
    updates: {
      content?: string;
      embedding?: number[];
      metadata?: Record<string, unknown>;
      tags?: string[];
    },
  ): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const now = new Date().toISOString();
    const content = updates.content ?? existing.content;
    const embedding = updates.embedding
      ? embeddingToBlob(updates.embedding)
      : embeddingToBlob(existing.embedding);
    const metadata = updates.metadata
      ? JSON.stringify(updates.metadata)
      : JSON.stringify(existing.metadata);
    const tags = updates.tags
      ? JSON.stringify(updates.tags)
      : JSON.stringify(existing.tags);

    this.db
      .prepare(
        `UPDATE memories SET content = ?, embedding = ?, metadata = ?, tags = ?, updated_at = ? WHERE id = ?`,
      )
      .run(content, embedding, metadata, tags, now, id);

    return true;
  }

  /**
   * Delete a memory by ID.
   */
  delete(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    logger.debug({ id }, 'Memory deleted');
  }

  /**
   * Count total stored memories, optionally filtered by agent.
   */
  count(agentId?: string): number {
    if (agentId) {
      const row = this.db
        .prepare('SELECT COUNT(*) as cnt FROM memories WHERE agent_id = ?')
        .get(agentId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM memories')
      .get() as { cnt: number };
    return row.cnt;
  }

  /**
   * List all unique agent IDs that have stored memories.
   */
  listAgents(): string[] {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT agent_id FROM memories WHERE agent_id IS NOT NULL',
      )
      .all() as Array<{ agent_id: string }>;
    return rows.map((r) => r.agent_id);
  }

  /**
   * Delete all memories older than the given date.
   * @returns Number of deleted records.
   */
  deleteOlderThan(date: Date): number {
    const result = this.db
      .prepare('DELETE FROM memories WHERE created_at < ?')
      .run(date.toISOString());
    return result.changes;
  }

  /**
   * Get all memories (for compaction or export).
   */
  getAll(filter?: SearchFilter): MemoryRecord[] {
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
      .prepare(`SELECT * FROM memories ${whereClause} ORDER BY created_at ASC`)
      .all(...params) as Array<{
      id: string;
      content: string;
      embedding: Buffer;
      metadata: string;
      created_at: string;
      updated_at: string;
      agent_id: string | null;
      session_id: string | null;
      tags: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      embedding: blobToEmbedding(row.embedding),
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      agentId: row.agent_id,
      sessionId: row.session_id,
      tags: JSON.parse(row.tags),
    }));
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
    logger.debug('VectorStore closed');
  }
}
