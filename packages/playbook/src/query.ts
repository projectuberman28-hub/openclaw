/**
 * @alfred/playbook - Query engine
 *
 * Provides high-level, pre-built queries against the playbook database.
 * All methods return typed PlaybookEntry arrays or derived aggregates.
 * Leverages FTS5 where available and falls back to standard SQL.
 */

import type { PlaybookDatabase } from './database.js';
import type { PlaybookEntry, EntryRow } from './types.js';

// ---------------------------------------------------------------------------
// Row mapper (duplicated locally to avoid circular imports)
// ---------------------------------------------------------------------------

function safeJsonParse(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

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

// ---------------------------------------------------------------------------
// PlaybookQuery
// ---------------------------------------------------------------------------

export class PlaybookQuery {
  private db: PlaybookDatabase;

  constructor(db: PlaybookDatabase) {
    this.db = db;
  }

  /**
   * Full-text search across entries. Delegates to PlaybookDatabase.search
   * which uses FTS5 with LIKE fallback.
   */
  search(query: string, limit: number = 50): PlaybookEntry[] {
    return this.db.search(query, { limit });
  }

  /**
   * Get execution history for a specific tool, ordered newest-first.
   */
  getToolHistory(toolName: string, limit: number = 50): PlaybookEntry[] {
    const rows = this.db.raw
      .prepare(`
        SELECT * FROM entries
        WHERE tool = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(toolName, limit) as EntryRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Get all failed entries since a given date (or all time).
   */
  getFailures(since?: Date, limit: number = 100): PlaybookEntry[] {
    if (since) {
      const rows = this.db.raw
        .prepare(`
          SELECT * FROM entries
          WHERE success = 0 AND timestamp >= ?
          ORDER BY timestamp DESC
          LIMIT ?
        `)
        .all(since.toISOString(), limit) as EntryRow[];
      return rows.map(rowToEntry);
    }

    const rows = this.db.raw
      .prepare(`
        SELECT * FROM entries
        WHERE success = 0
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as EntryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Get forge lifecycle events, optionally filtered to a specific skill.
   */
  getForgeEvents(skillName?: string): PlaybookEntry[] {
    if (skillName) {
      const rows = this.db.raw
        .prepare(`
          SELECT * FROM entries
          WHERE type = 'forge_event' AND tool = ?
          ORDER BY timestamp DESC
        `)
        .all(skillName) as EntryRow[];
      return rows.map(rowToEntry);
    }

    const rows = this.db.raw
      .prepare(`
        SELECT * FROM entries
        WHERE type = 'forge_event'
        ORDER BY timestamp DESC
      `)
      .all() as EntryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Get recent activity within the last N hours (default 24).
   */
  getRecentActivity(hours: number = 24): PlaybookEntry[] {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const rows = this.db.raw
      .prepare(`
        SELECT * FROM entries
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
      `)
      .all(since) as EntryRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Compute the success rate for a specific tool.
   */
  getToolSuccessRate(toolName: string): { total: number; success: number; rate: number } {
    const totalRow = this.db.raw
      .prepare('SELECT COUNT(*) as cnt FROM entries WHERE tool = ?')
      .get(toolName) as { cnt: number };

    const successRow = this.db.raw
      .prepare('SELECT COUNT(*) as cnt FROM entries WHERE tool = ? AND success = 1')
      .get(toolName) as { cnt: number };

    const total = totalRow.cnt;
    const success = successRow.cnt;
    const rate = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0;

    return { total, success, rate };
  }

  /**
   * Get the most frequently used tools with their success rates.
   */
  getMostUsedTools(limit: number = 10): Array<{ tool: string; count: number; successRate: number }> {
    const rows = this.db.raw
      .prepare(`
        SELECT
          tool,
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
        FROM entries
        WHERE tool != ''
        GROUP BY tool
        ORDER BY total DESC
        LIMIT ?
      `)
      .all(limit) as Array<{ tool: string; total: number; successes: number }>;

    return rows.map((row) => ({
      tool: row.tool,
      count: row.total,
      successRate: row.total > 0
        ? Number(((row.successes / row.total) * 100).toFixed(2))
        : 0,
    }));
  }

  /**
   * Get the average execution duration for a specific tool (in ms).
   */
  getToolAvgDuration(toolName: string): number {
    const row = this.db.raw
      .prepare(`
        SELECT AVG(duration_ms) as avg_ms
        FROM entries
        WHERE tool = ? AND duration_ms > 0
      `)
      .get(toolName) as { avg_ms: number | null };

    return row.avg_ms ? Number(row.avg_ms.toFixed(2)) : 0;
  }

  /**
   * Get fallback events, ordered newest-first.
   */
  getFallbacks(limit: number = 50): PlaybookEntry[] {
    const rows = this.db.raw
      .prepare(`
        SELECT * FROM entries
        WHERE type = 'fallback'
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as EntryRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Get entries grouped by session, returning session summaries.
   */
  getSessionSummaries(limit: number = 20): Array<{
    sessionId: string;
    agentId: string;
    entryCount: number;
    successRate: number;
    firstEntry: string;
    lastEntry: string;
  }> {
    const rows = this.db.raw
      .prepare(`
        SELECT
          session_id,
          agent_id,
          COUNT(*) as entry_count,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
          MIN(timestamp) as first_entry,
          MAX(timestamp) as last_entry
        FROM entries
        WHERE session_id != ''
        GROUP BY session_id
        ORDER BY last_entry DESC
        LIMIT ?
      `)
      .all(limit) as Array<{
      session_id: string;
      agent_id: string;
      entry_count: number;
      successes: number;
      first_entry: string;
      last_entry: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      agentId: row.agent_id,
      entryCount: row.entry_count,
      successRate: row.entry_count > 0
        ? Number(((row.successes / row.entry_count) * 100).toFixed(2))
        : 0,
      firstEntry: row.first_entry,
      lastEntry: row.last_entry,
    }));
  }

  /**
   * Get the error distribution: unique error messages and their counts.
   */
  getErrorDistribution(limit: number = 20): Array<{ error: string; count: number; lastSeen: string }> {
    const rows = this.db.raw
      .prepare(`
        SELECT
          error,
          COUNT(*) as count,
          MAX(timestamp) as last_seen
        FROM entries
        WHERE error IS NOT NULL AND error != ''
        GROUP BY error
        ORDER BY count DESC
        LIMIT ?
      `)
      .all(limit) as Array<{ error: string; count: number; last_seen: string }>;

    return rows.map((row) => ({
      error: row.error,
      count: row.count,
      lastSeen: row.last_seen,
    }));
  }

  /**
   * Count entries by type.
   */
  countByType(): Record<string, number> {
    const rows = this.db.raw
      .prepare(`
        SELECT type, COUNT(*) as count
        FROM entries
        GROUP BY type
        ORDER BY count DESC
      `)
      .all() as Array<{ type: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.type] = row.count;
    }
    return result;
  }
}
