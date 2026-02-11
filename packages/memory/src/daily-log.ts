/**
 * @alfred/memory - Daily log for conversations, tasks, learnings, and errors
 *
 * Maintains Markdown-formatted daily log files at ALFRED_HOME/logs/daily/.
 * Each day gets its own file (YYYY-MM-DD.md) with timestamped entries
 * organized by type.
 *
 * Thread-safe file appending via atomic write operations.
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { resolveAlfredHome } from '@alfred/core/config/paths';
import pino from 'pino';

const logger = pino({ name: 'alfred:memory:daily-log' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DailyLogEntryType = 'conversation' | 'task' | 'learning' | 'error';

export interface DailyLogEntry {
  /** Timestamp of the entry (ISO 8601) */
  timestamp: string;
  /** Entry type */
  type: DailyLogEntryType;
  /** Content of the log entry */
  content: string;
  /** Optional structured metadata */
  metadata?: Record<string, unknown>;
}

export interface DailyLogOptions {
  /** Base directory for daily logs. Defaults to ALFRED_HOME/logs/daily/ */
  logDir?: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Type labels for the Markdown log */
const TYPE_LABELS: Record<DailyLogEntryType, string> = {
  conversation: 'Conversation',
  task: 'Task',
  learning: 'Learning',
  error: 'Error',
};

/** Type icons for visual distinction in Markdown */
const TYPE_ICONS: Record<DailyLogEntryType, string> = {
  conversation: '[CONV]',
  task: '[TASK]',
  learning: '[LEARN]',
  error: '[ERROR]',
};

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a time as HH:MM:SS.
 */
function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Generate the Markdown header for a daily log file.
 */
function generateDailyHeader(dateStr: string): string {
  const dayOfWeek = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
  });
  return `# Alfred Daily Log - ${dateStr} (${dayOfWeek})\n\n`;
}

/**
 * Format a single log entry as Markdown.
 */
function formatEntry(entry: DailyLogEntry): string {
  const time = formatTime(new Date(entry.timestamp));
  const icon = TYPE_ICONS[entry.type];
  let text = `### ${icon} ${time} - ${TYPE_LABELS[entry.type]}\n\n`;
  text += `${entry.content}\n`;

  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    text += '\n<details><summary>Metadata</summary>\n\n';
    text += '```json\n';
    text += JSON.stringify(entry.metadata, null, 2);
    text += '\n```\n\n</details>\n';
  }

  text += '\n---\n\n';
  return text;
}

/**
 * Parse a Markdown daily log file back into structured entries.
 */
function parseLogFile(content: string): DailyLogEntry[] {
  const entries: DailyLogEntry[] = [];
  // Split on the entry header pattern: ### [TYPE] HH:MM:SS - Label
  const entryRegex =
    /### \[(CONV|TASK|LEARN|ERROR)\] (\d{2}:\d{2}:\d{2}) - (\w+)\n\n([\s\S]*?)(?=\n---\n|$)/g;

  const typeMap: Record<string, DailyLogEntryType> = {
    CONV: 'conversation',
    TASK: 'task',
    LEARN: 'learning',
    ERROR: 'error',
  };

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(content)) !== null) {
    const typeCode = match[1];
    const timeStr = match[2];
    const body = match[4].trim();

    // Extract metadata if present
    let entryContent = body;
    let metadata: Record<string, unknown> | undefined;

    const metadataMatch = body.match(
      /<details><summary>Metadata<\/summary>\s*```json\s*([\s\S]*?)\s*```\s*<\/details>/,
    );
    if (metadataMatch) {
      entryContent = body
        .replace(metadataMatch[0], '')
        .trim();
      try {
        metadata = JSON.parse(metadataMatch[1]);
      } catch {
        // Ignore malformed metadata
      }
    }

    // Reconstruct timestamp (we only have time, need date from filename)
    // The caller will set the date portion
    entries.push({
      timestamp: timeStr, // Will be resolved by caller
      type: typeMap[typeCode] ?? 'conversation',
      content: entryContent,
      metadata,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Write lock for thread-safe appending
// ---------------------------------------------------------------------------

/**
 * Simple async mutex for serializing writes to the same file.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// ---------------------------------------------------------------------------
// DailyLog
// ---------------------------------------------------------------------------

export class DailyLog {
  private logDir: string;
  /** Per-file write locks for thread safety */
  private locks: Map<string, AsyncMutex> = new Map();

  constructor(options: DailyLogOptions = {}) {
    this.logDir =
      options.logDir ?? join(resolveAlfredHome(), 'logs', 'daily');

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Get the file path for a given date string (YYYY-MM-DD).
   */
  private getFilePath(dateStr: string): string {
    return join(this.logDir, `${dateStr}.md`);
  }

  /**
   * Get or create a mutex for a specific file.
   */
  private getLock(filePath: string): AsyncMutex {
    let lock = this.locks.get(filePath);
    if (!lock) {
      lock = new AsyncMutex();
      this.locks.set(filePath, lock);
    }
    return lock;
  }

  /**
   * Ensure a daily log file exists with proper header.
   */
  private async ensureFile(dateStr: string): Promise<string> {
    const filePath = this.getFilePath(dateStr);

    if (!existsSync(filePath)) {
      const header = generateDailyHeader(dateStr);
      await writeFile(filePath, header, 'utf-8');
      logger.debug({ dateStr, filePath }, 'Created daily log file');
    }

    return filePath;
  }

  /**
   * Add a new entry to the daily log.
   *
   * Thread-safe: uses an async mutex to serialize writes to the same file.
   */
  async addEntry(
    type: DailyLogEntryType,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const dateStr = formatDate(now);
    const filePath = await this.ensureFile(dateStr);

    const entry: DailyLogEntry = {
      timestamp: now.toISOString(),
      type,
      content,
      metadata,
    };

    const formatted = formatEntry(entry);

    // Thread-safe append
    const lock = this.getLock(filePath);
    await lock.acquire();
    try {
      await appendFile(filePath, formatted, 'utf-8');
      logger.debug({ type, dateStr }, 'Added daily log entry');
    } finally {
      lock.release();
    }
  }

  /**
   * Get all entries for today.
   */
  async getToday(): Promise<DailyLogEntry[]> {
    const dateStr = formatDate(new Date());
    return this.getDate(dateStr);
  }

  /**
   * Get all entries for a specific date.
   *
   * @param dateStr Date in YYYY-MM-DD format
   */
  async getDate(dateStr: string): Promise<DailyLogEntry[]> {
    const filePath = this.getFilePath(dateStr);

    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const entries = parseLogFile(content);

      // Resolve timestamps: combine date with parsed time
      for (const entry of entries) {
        if (!entry.timestamp.includes('T')) {
          // It's just a time string (HH:MM:SS); prepend the date
          entry.timestamp = `${dateStr}T${entry.timestamp}`;
        }
      }

      return entries;
    } catch (error) {
      logger.error(
        { error: String(error), dateStr },
        'Failed to read daily log',
      );
      return [];
    }
  }

  /**
   * Get all entries within a date range (inclusive).
   *
   * @param startDate Start date in YYYY-MM-DD format
   * @param endDate End date in YYYY-MM-DD format
   */
  async getRange(
    startDate: string,
    endDate: string,
  ): Promise<DailyLogEntry[]> {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    const allEntries: DailyLogEntry[] = [];

    // Iterate through each day in the range
    const current = new Date(start);
    while (current <= end) {
      const dateStr = formatDate(current);
      const entries = await this.getDate(dateStr);
      allEntries.push(...entries);
      current.setDate(current.getDate() + 1);
    }

    // Sort by timestamp
    allEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return allEntries;
  }

  /**
   * List all available log dates (files in the log directory).
   */
  async listDates(): Promise<string[]> {
    try {
      const files = await readdir(this.logDir);
      return files
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''))
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Get a summary of entries by type for a specific date.
   */
  async getSummary(dateStr: string): Promise<Record<DailyLogEntryType, number>> {
    const entries = await this.getDate(dateStr);
    const summary: Record<DailyLogEntryType, number> = {
      conversation: 0,
      task: 0,
      learning: 0,
      error: 0,
    };

    for (const entry of entries) {
      summary[entry.type]++;
    }

    return summary;
  }

  /**
   * Search across all daily logs for entries matching a keyword.
   */
  async searchEntries(
    keyword: string,
    options?: { startDate?: string; endDate?: string; type?: DailyLogEntryType },
  ): Promise<DailyLogEntry[]> {
    const dates = await this.listDates();
    const lowerKeyword = keyword.toLowerCase();
    const results: DailyLogEntry[] = [];

    for (const dateStr of dates) {
      // Apply date range filter
      if (options?.startDate && dateStr < options.startDate) continue;
      if (options?.endDate && dateStr > options.endDate) continue;

      const entries = await this.getDate(dateStr);
      for (const entry of entries) {
        // Apply type filter
        if (options?.type && entry.type !== options.type) continue;

        // Keyword match
        if (entry.content.toLowerCase().includes(lowerKeyword)) {
          results.push(entry);
        }
      }
    }

    return results;
  }
}
