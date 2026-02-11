/**
 * @alfred/privacy - Audit Log
 *
 * JSONL file logging for cloud API calls.
 * Logs metadata about outbound/inbound calls - NEVER logs actual PII values.
 * Only counts, types, and operational metadata are persisted.
 */

import { mkdir, appendFile, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: number;
  provider: string;
  model: string;
  endpoint: string;
  direction: 'outbound' | 'inbound';
  piiDetected: number;
  piiRedacted: boolean;
  redactedTypes: string[];
  estimatedTokens: number;
  latencyMs: number;
  sessionId: string;
  channel: string;
  success: boolean;
}

export interface PrivacyScore {
  score: number;
  totalCalls: number;
  piiCaught: number;
  redactionRate: number;
}

export interface AuditLogOptions {
  /** Path to the JSONL audit log file. Defaults to ~/.alfred/logs/cloud-audit.jsonl */
  logPath?: string;
}

// ---------------------------------------------------------------------------
// AuditLog class
// ---------------------------------------------------------------------------

export class AuditLog {
  private logPath: string;
  private initialized: boolean = false;

  constructor(options: AuditLogOptions = {}) {
    this.logPath =
      options.logPath ??
      join(homedir(), '.alfred', 'logs', 'cloud-audit.jsonl');
  }

  /**
   * Ensure the log directory exists. Called lazily before first write.
   */
  private async ensureDirectory(): Promise<void> {
    if (this.initialized) return;
    const dir = dirname(this.logPath);
    await mkdir(dir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Append a single audit entry as a JSONL line.
   */
  private async append(entry: AuditEntry): Promise<void> {
    await this.ensureDirectory();
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.logPath, line, 'utf-8');
  }

  /**
   * Log an outbound API call (request sent to cloud provider).
   */
  async logOutbound(entry: Omit<AuditEntry, 'direction'>): Promise<void> {
    await this.append({ ...entry, direction: 'outbound' });
  }

  /**
   * Log an inbound API response (response received from cloud provider).
   */
  async logInbound(entry: Omit<AuditEntry, 'direction'>): Promise<void> {
    await this.append({ ...entry, direction: 'inbound' });
  }

  /**
   * Read audit entries from the log file.
   *
   * @param limit  - Max number of entries to return (most recent first). 0 = all.
   * @param filter - Partial AuditEntry fields to filter on.
   */
  async getEntries(
    limit: number = 0,
    filter?: Partial<AuditEntry>,
  ): Promise<AuditEntry[]> {
    let content: string;
    try {
      content = await readFile(this.logPath, 'utf-8');
    } catch (err: unknown) {
      // File doesn't exist yet — no entries
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const lines = content.trim().split('\n').filter(Boolean);
    let entries: AuditEntry[] = [];

    for (const line of lines) {
      try {
        const entry: AuditEntry = JSON.parse(line);
        entries.push(entry);
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    // Apply filter if provided
    if (filter) {
      entries = entries.filter((entry) => {
        for (const [key, value] of Object.entries(filter)) {
          const entryVal = entry[key as keyof AuditEntry];
          if (Array.isArray(value)) {
            // For array fields, check if all filter values are present
            if (!Array.isArray(entryVal)) return false;
            for (const v of value) {
              if (!(entryVal as string[]).includes(v as string)) return false;
            }
          } else if (entryVal !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // Sort most recent first
    entries.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    if (limit > 0) {
      entries = entries.slice(0, limit);
    }

    return entries;
  }

  /**
   * Calculate a privacy health score based on audit history.
   *
   * score: 0-100 where 100 = perfect (all PII was redacted)
   * - If no PII was ever detected, score = 100
   * - Otherwise, score = (piiRedactedCalls / piiDetectedCalls) * 100
   */
  async getPrivacyScore(): Promise<PrivacyScore> {
    const entries = await this.getEntries();

    const totalCalls = entries.length;
    const callsWithPII = entries.filter((e) => e.piiDetected > 0);
    const piiCaught = callsWithPII.length;
    const redactedCalls = callsWithPII.filter((e) => e.piiRedacted);
    const redactionRate = piiCaught > 0 ? redactedCalls.length / piiCaught : 1;

    const score = Math.round(
      piiCaught === 0 ? 100 : redactionRate * 100,
    );

    return {
      score,
      totalCalls,
      piiCaught,
      redactionRate,
    };
  }

  /**
   * Get the path to the audit log file.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Check if the audit log file exists and return its size.
   */
  async getLogInfo(): Promise<{ exists: boolean; sizeBytes: number }> {
    try {
      const stats = await stat(this.logPath);
      return { exists: true, sizeBytes: stats.size };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }
}
