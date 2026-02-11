/**
 * @alfred/playbook - Database layer
 *
 * Manages the SQLite database that backs the operational playbook.
 * Tables: entries, strategies, patterns.
 * Full-text search via FTS5 on entries(tool, error, tags) and
 * strategies(title, description).
 *
 * DB location: ALFRED_HOME/playbook/playbook.db (auto-created).
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import pino from 'pino';
import { resolveAlfredHome } from '@alfred/core/config/paths';
import type {
  PlaybookEntry,
  PlaybookStats,
  SearchOptions,
  Strategy,
  PlaybookPattern,
  EntryRow,
  StrategyRow,
  PatternRow,
} from './types.js';

const logger = pino({ name: 'alfred:playbook:database' });

// ---------------------------------------------------------------------------
// Row <-> Domain mappers
// ---------------------------------------------------------------------------

function rowToEntry(row: EntryRow): PlaybookEntry {
  return {
    id: row.id,
    type: row.type as PlaybookEntry['type'],
    timestamp: row.timestamp,
    tool: row.tool,
    args: safeJsonParse(row.args),
    result: safeJsonParse(row.result),
    error: row.error,
    durationMs: row.duration_ms,
    agentId: row.agent_id,
    sessionId: row.session_id,
    channel: row.channel,
    success: row.success === 1,
    tags: safeJsonParse(row.tags) as string[],
  };
}

function rowToStrategy(row: StrategyRow): Strategy {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    recommendations: safeJsonParse(row.recommendations) as string[],
    confidence: row.confidence,
    basedOn: safeJsonParse(row.based_on) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source ?? undefined,
    tags: safeJsonParse(row.tags) as string[] | undefined,
  };
}

function rowToPattern(row: PatternRow): PlaybookPattern {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    frequency: row.frequency,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    data: safeJsonParse(row.data) as Record<string, unknown>,
  };
}

function safeJsonParse(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// PlaybookDatabase
// ---------------------------------------------------------------------------

export class PlaybookDatabase {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    const defaultDir = join(resolveAlfredHome(), 'playbook');
    this.dbPath = dbPath ?? join(defaultDir, 'playbook.db');

    // Ensure parent directory exists
    const dir = join(this.dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
    logger.info({ dbPath: this.dbPath }, 'PlaybookDatabase initialized');
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      -- Main entries table: every logged event
      CREATE TABLE IF NOT EXISTS entries (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        tool        TEXT NOT NULL DEFAULT '',
        args        TEXT NOT NULL DEFAULT '{}',
        result      TEXT NOT NULL DEFAULT 'null',
        error       TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        agent_id    TEXT NOT NULL DEFAULT '',
        session_id  TEXT NOT NULL DEFAULT '',
        channel     TEXT,
        success     INTEGER NOT NULL DEFAULT 1,
        tags        TEXT NOT NULL DEFAULT '[]'
      );

      -- Strategies table: actionable insights
      CREATE TABLE IF NOT EXISTS strategies (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        source          TEXT,
        confidence      REAL NOT NULL DEFAULT 0.5,
        tags            TEXT NOT NULL DEFAULT '[]',
        recommendations TEXT NOT NULL DEFAULT '[]',
        based_on        TEXT NOT NULL DEFAULT '[]'
      );

      -- Patterns table: recurring behaviours
      CREATE TABLE IF NOT EXISTS patterns (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        frequency   INTEGER NOT NULL DEFAULT 1,
        first_seen  TEXT NOT NULL,
        last_seen   TEXT NOT NULL,
        data        TEXT NOT NULL DEFAULT '{}'
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_entries_type        ON entries(type);
      CREATE INDEX IF NOT EXISTS idx_entries_tool        ON entries(tool);
      CREATE INDEX IF NOT EXISTS idx_entries_timestamp   ON entries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_entries_agent_id    ON entries(agent_id);
      CREATE INDEX IF NOT EXISTS idx_entries_session_id  ON entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_entries_success     ON entries(success);
      CREATE INDEX IF NOT EXISTS idx_strategies_confidence ON strategies(confidence);
      CREATE INDEX IF NOT EXISTS idx_patterns_type       ON patterns(type);
    `);

    // FTS5 virtual tables -- wrap in try/catch per table so we don't fail
    // if they already exist (CREATE VIRTUAL TABLE IF NOT EXISTS is supported
    // in newer SQLite but better-sqlite3 bundles vary).
    this.createFtsTables();
  }

  private createFtsTables(): void {
    // FTS5 on entries: searchable by tool, error, tags
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
          tool,
          error,
          tags,
          content='entries',
          content_rowid='rowid'
        );
      `);
    } catch (err) {
      logger.warn({ err }, 'Could not create entries_fts (may already exist)');
    }

    // Triggers to keep FTS in sync
    try {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
          INSERT INTO entries_fts(rowid, tool, error, tags)
            VALUES (new.rowid, new.tool, COALESCE(new.error, ''), new.tags);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
          INSERT INTO entries_fts(entries_fts, rowid, tool, error, tags)
            VALUES ('delete', old.rowid, old.tool, COALESCE(old.error, ''), old.tags);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
          INSERT INTO entries_fts(entries_fts, rowid, tool, error, tags)
            VALUES ('delete', old.rowid, old.tool, COALESCE(old.error, ''), old.tags);
          INSERT INTO entries_fts(rowid, tool, error, tags)
            VALUES (new.rowid, new.tool, COALESCE(new.error, ''), new.tags);
        END;
      `);
    } catch (err) {
      logger.warn({ err }, 'Could not create entries FTS triggers');
    }

    // FTS5 on strategies: searchable by title, description
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS strategies_fts USING fts5(
          title,
          description,
          content='strategies',
          content_rowid='rowid'
        );
      `);
    } catch (err) {
      logger.warn({ err }, 'Could not create strategies_fts (may already exist)');
    }

    try {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS strategies_ai AFTER INSERT ON strategies BEGIN
          INSERT INTO strategies_fts(rowid, title, description)
            VALUES (new.rowid, new.title, new.description);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS strategies_ad AFTER DELETE ON strategies BEGIN
          INSERT INTO strategies_fts(strategies_fts, rowid, title, description)
            VALUES ('delete', old.rowid, old.title, old.description);
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS strategies_au AFTER UPDATE ON strategies BEGIN
          INSERT INTO strategies_fts(strategies_fts, rowid, title, description)
            VALUES ('delete', old.rowid, old.title, old.description);
          INSERT INTO strategies_fts(rowid, title, description)
            VALUES (new.rowid, new.title, new.description);
        END;
      `);
    } catch (err) {
      logger.warn({ err }, 'Could not create strategies FTS triggers');
    }
  }

  // -------------------------------------------------------------------------
  // Entry CRUD
  // -------------------------------------------------------------------------

  /**
   * Insert a new playbook entry. Returns the generated entry ID.
   */
  insert(entry: Omit<PlaybookEntry, 'id'> & { id?: string }): string {
    const id = entry.id ?? randomUUID();
    const now = entry.timestamp || new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO entries (id, type, timestamp, tool, args, result, error, duration_ms, agent_id, session_id, channel, success, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.type,
      now,
      entry.tool ?? '',
      JSON.stringify(entry.args ?? {}),
      JSON.stringify(entry.result ?? null),
      entry.error ?? null,
      entry.durationMs ?? 0,
      entry.agentId ?? '',
      entry.sessionId ?? '',
      entry.channel ?? null,
      entry.success ? 1 : 0,
      JSON.stringify(entry.tags ?? []),
    );

    logger.debug({ id, type: entry.type, tool: entry.tool }, 'Entry inserted');
    return id;
  }

  /**
   * Full-text search across entries using FTS5.
   * Falls back to LIKE-based search if FTS is unavailable.
   */
  search(query: string, options?: SearchOptions): PlaybookEntry[] {
    const limit = options?.limit ?? 50;
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Try FTS5 first
    try {
      let ftsQuery = `
        SELECT e.*
        FROM entries e
        JOIN entries_fts f ON e.rowid = f.rowid
        WHERE entries_fts MATCH ?
      `;
      params.push(query);

      if (options?.type) {
        conditions.push('e.type = ?');
        params.push(options.type);
      }
      if (options?.since) {
        conditions.push('e.timestamp >= ?');
        params.push(options.since);
      }
      if (conditions.length > 0) {
        ftsQuery += ' AND ' + conditions.join(' AND ');
      }
      ftsQuery += ' ORDER BY e.timestamp DESC LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(ftsQuery).all(...params) as EntryRow[];
      return rows.map(rowToEntry);
    } catch {
      // Fallback to LIKE search
      logger.debug('FTS5 search failed, falling back to LIKE search');
      return this.searchFallback(query, options);
    }
  }

  /**
   * LIKE-based search fallback when FTS5 is unavailable.
   */
  private searchFallback(query: string, options?: SearchOptions): PlaybookEntry[] {
    const limit = options?.limit ?? 50;
    const conditions: string[] = [];
    const params: unknown[] = [];

    const likePattern = `%${query}%`;
    conditions.push('(tool LIKE ? OR error LIKE ? OR tags LIKE ?)');
    params.push(likePattern, likePattern, likePattern);

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options?.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM entries ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as EntryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Retrieve a single entry by ID.
   */
  getEntry(id: string): PlaybookEntry | null {
    const row = this.db
      .prepare('SELECT * FROM entries WHERE id = ?')
      .get(id) as EntryRow | undefined;
    if (!row) return null;
    return rowToEntry(row);
  }

  /**
   * Retrieve entries with flexible filtering.
   */
  getEntries(options: {
    type?: string;
    tool?: string;
    agentId?: string;
    sessionId?: string;
    success?: boolean;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  } = {}): PlaybookEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options.tool) {
      conditions.push('tool = ?');
      params.push(options.tool);
    }
    if (options.agentId) {
      conditions.push('agent_id = ?');
      params.push(options.agentId);
    }
    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (options.success !== undefined) {
      conditions.push('success = ?');
      params.push(options.success ? 1 : 0);
    }
    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }
    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const sql = `SELECT * FROM entries ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as EntryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Delete an entry by ID.
   */
  deleteEntry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // -------------------------------------------------------------------------
  // Strategy CRUD
  // -------------------------------------------------------------------------

  /**
   * Insert or update a strategy. Returns the strategy ID.
   */
  saveStrategy(strategy: Strategy): string {
    const id = strategy.id || randomUUID();
    const now = new Date().toISOString();

    const existing = this.db
      .prepare('SELECT id FROM strategies WHERE id = ?')
      .get(id) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE strategies
        SET title = ?, description = ?, updated_at = ?, source = ?,
            confidence = ?, tags = ?, recommendations = ?, based_on = ?
        WHERE id = ?
      `).run(
        strategy.title,
        strategy.description,
        now,
        strategy.source ?? null,
        strategy.confidence,
        JSON.stringify(strategy.tags ?? []),
        JSON.stringify(strategy.recommendations ?? []),
        JSON.stringify(strategy.basedOn ?? []),
        id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO strategies (id, title, description, created_at, updated_at, source, confidence, tags, recommendations, based_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        strategy.title,
        strategy.description,
        strategy.createdAt ?? now,
        now,
        strategy.source ?? null,
        strategy.confidence,
        JSON.stringify(strategy.tags ?? []),
        JSON.stringify(strategy.recommendations ?? []),
        JSON.stringify(strategy.basedOn ?? []),
      );
    }

    logger.debug({ id, title: strategy.title }, 'Strategy saved');
    return id;
  }

  /**
   * Retrieve strategies, optionally filtered by minimum confidence.
   */
  getStrategies(options?: { minConfidence?: number; limit?: number }): Strategy[] {
    const minConf = options?.minConfidence ?? 0;
    const limit = options?.limit ?? 50;

    const rows = this.db.prepare(`
      SELECT * FROM strategies
      WHERE confidence >= ?
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(minConf, limit) as StrategyRow[];

    return rows.map(rowToStrategy);
  }

  /**
   * Get a single strategy by ID.
   */
  getStrategy(id: string): Strategy | null {
    const row = this.db
      .prepare('SELECT * FROM strategies WHERE id = ?')
      .get(id) as StrategyRow | undefined;
    if (!row) return null;
    return rowToStrategy(row);
  }

  /**
   * Full-text search across strategies.
   */
  searchStrategies(query: string, limit: number = 20): Strategy[] {
    try {
      const rows = this.db.prepare(`
        SELECT s.*
        FROM strategies s
        JOIN strategies_fts f ON s.rowid = f.rowid
        WHERE strategies_fts MATCH ?
        ORDER BY s.confidence DESC
        LIMIT ?
      `).all(query, limit) as StrategyRow[];
      return rows.map(rowToStrategy);
    } catch {
      // Fallback to LIKE
      const likePattern = `%${query}%`;
      const rows = this.db.prepare(`
        SELECT * FROM strategies
        WHERE title LIKE ? OR description LIKE ?
        ORDER BY confidence DESC
        LIMIT ?
      `).all(likePattern, likePattern, limit) as StrategyRow[];
      return rows.map(rowToStrategy);
    }
  }

  /**
   * Delete a strategy by ID.
   */
  deleteStrategy(id: string): boolean {
    const result = this.db.prepare('DELETE FROM strategies WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // -------------------------------------------------------------------------
  // Pattern CRUD
  // -------------------------------------------------------------------------

  /**
   * Upsert a pattern. If the pattern ID already exists, increment frequency
   * and update last_seen. Returns the pattern ID.
   */
  upsertPattern(pattern: PlaybookPattern): string {
    const id = pattern.id || randomUUID();
    const now = new Date().toISOString();

    const existing = this.db
      .prepare('SELECT id, frequency FROM patterns WHERE id = ?')
      .get(id) as { id: string; frequency: number } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE patterns
        SET frequency = frequency + 1,
            last_seen = ?,
            data = ?,
            description = ?
        WHERE id = ?
      `).run(now, JSON.stringify(pattern.data), pattern.description, id);
    } else {
      this.db.prepare(`
        INSERT INTO patterns (id, type, description, frequency, first_seen, last_seen, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        pattern.type,
        pattern.description,
        pattern.frequency ?? 1,
        pattern.firstSeen ?? now,
        pattern.lastSeen ?? now,
        JSON.stringify(pattern.data ?? {}),
      );
    }

    return id;
  }

  /**
   * Retrieve patterns by type.
   */
  getPatterns(type?: string, limit: number = 50): PlaybookPattern[] {
    if (type) {
      const rows = this.db.prepare(`
        SELECT * FROM patterns WHERE type = ? ORDER BY frequency DESC LIMIT ?
      `).all(type, limit) as PatternRow[];
      return rows.map(rowToPattern);
    }

    const rows = this.db.prepare(`
      SELECT * FROM patterns ORDER BY frequency DESC LIMIT ?
    `).all(limit) as PatternRow[];
    return rows.map(rowToPattern);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * Compute aggregate statistics from the playbook.
   */
  getStats(): PlaybookStats {
    // Total entries
    const totalRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM entries')
      .get() as { cnt: number };
    const totalEntries = totalRow.cnt;

    // Success rate
    const successRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM entries WHERE success = 1')
      .get() as { cnt: number };
    const successRate = totalEntries > 0
      ? Number(((successRow.cnt / totalEntries) * 100).toFixed(2))
      : 0;

    // Top tools (by usage count)
    const topTools = this.db.prepare(`
      SELECT tool, COUNT(*) as count
      FROM entries
      WHERE tool != ''
      GROUP BY tool
      ORDER BY count DESC
      LIMIT 10
    `).all() as Array<{ tool: string; count: number }>;

    // Top errors (by frequency)
    const topErrors = this.db.prepare(`
      SELECT error, COUNT(*) as count
      FROM entries
      WHERE error IS NOT NULL AND error != ''
      GROUP BY error
      ORDER BY count DESC
      LIMIT 10
    `).all() as Array<{ error: string; count: number }>;

    // Entries by day (last 30 days)
    const entriesByDay = this.db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM entries
      WHERE timestamp >= DATE('now', '-30 days')
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).all() as Array<{ date: string; count: number }>;

    return {
      totalEntries,
      successRate,
      topTools,
      topErrors,
      entriesByDay,
    };
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  /**
   * Run VACUUM to reclaim disk space and defragment the database.
   */
  vacuum(): void {
    this.db.exec('VACUUM');
    logger.info('Database vacuumed');
  }

  /**
   * Delete entries older than the given date.
   * @returns Number of deleted entries.
   */
  purgeOlderThan(date: Date): number {
    const result = this.db
      .prepare('DELETE FROM entries WHERE timestamp < ?')
      .run(date.toISOString());
    logger.info({ deleted: result.changes, before: date.toISOString() }, 'Entries purged');
    return result.changes;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
    logger.debug('PlaybookDatabase closed');
  }

  /**
   * Expose the raw database instance for advanced queries (used by Query/Strategy).
   */
  get raw(): Database.Database {
    return this.db;
  }
}
