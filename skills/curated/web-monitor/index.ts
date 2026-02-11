/**
 * @alfred/skill-web-monitor
 *
 * Watch URLs for content changes, compute diffs, and alert on modifications.
 * Stores monitored targets in SQLite with content hashing.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitorEntry {
  id: string;
  url: string;
  interval: number; // ms
  selector?: string;
  lastHash: string | null;
  lastContent: string | null;
  lastChecked: number | null; // epoch ms
  createdAt: number;
}

interface CheckResult {
  changed: boolean;
  diff?: string;
  previousHash?: string;
  currentHash?: string;
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// Storage layer (SQLite-like via JSON file for portability)
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'web-monitor');
const DB_FILE = join(DATA_DIR, 'monitors.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDb(): Map<string, MonitorEntry> {
  ensureDataDir();
  if (!existsSync(DB_FILE)) {
    return new Map();
  }
  try {
    const raw = readFileSync(DB_FILE, 'utf-8');
    const entries: MonitorEntry[] = JSON.parse(raw);
    return new Map(entries.map((e) => [e.url, e]));
  } catch {
    return new Map();
  }
}

function saveDb(db: Map<string, MonitorEntry>): void {
  ensureDataDir();
  const entries = Array.from(db.values());
  writeFileSync(DB_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Simple diff generator
// ---------------------------------------------------------------------------

function generateDiff(oldText: string | null, newText: string): string {
  if (oldText === null) {
    return `[Initial content captured — ${newText.length} characters]`;
  }

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diff: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] ?? '';
    const newLine = newLines[i] ?? '';

    if (oldLine !== newLine) {
      if (oldLine) diff.push(`- ${oldLine}`);
      if (newLine) diff.push(`+ ${newLine}`);
    }
  }

  if (diff.length === 0) {
    return '[No visible line-level differences]';
  }

  return diff.slice(0, 200).join('\n') + (diff.length > 200 ? '\n... (truncated)' : '');
}

// ---------------------------------------------------------------------------
// HTTP fetching with selector support
// ---------------------------------------------------------------------------

async function fetchContent(url: string, selector?: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Alfred/3.0 WebMonitor',
      Accept: 'text/html,application/xhtml+xml,*/*',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();

  if (selector) {
    // Basic CSS selector extraction — find content between matching tags
    // For production, use a proper HTML parser like cheerio
    const selectorPattern = selectorToRegex(selector);
    const match = html.match(selectorPattern);
    if (match) {
      return match[0];
    }
    // Fallback: return full content if selector doesn't match
    return html;
  }

  return html;
}

/**
 * Convert simple CSS selectors to regex patterns.
 * Supports: #id, .class, tag
 */
function selectorToRegex(selector: string): RegExp {
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    return new RegExp(`<[^>]+id=["']${id}["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    return new RegExp(`<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }
  // Tag selector
  return new RegExp(`<${selector}[^>]*>[\\s\\S]*?<\\/${selector}>`, 'i');
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  selector?: string,
  maxRetries: number = 3,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchContent(url, selector);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('Fetch failed after retries');
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

async function monitorAdd(
  url: string,
  interval: number = 3_600_000,
  selector?: string,
): Promise<{ id: string; url: string; interval: number }> {
  const db = loadDb();

  if (db.has(url)) {
    const existing = db.get(url)!;
    existing.interval = interval;
    if (selector !== undefined) existing.selector = selector;
    saveDb(db);
    return { id: existing.id, url, interval };
  }

  const entry: MonitorEntry = {
    id: generateId(),
    url,
    interval,
    selector,
    lastHash: null,
    lastContent: null,
    lastChecked: null,
    createdAt: Date.now(),
  };

  db.set(url, entry);
  saveDb(db);

  return { id: entry.id, url, interval };
}

async function monitorRemove(url: string): Promise<{ removed: boolean }> {
  const db = loadDb();
  const removed = db.delete(url);
  if (removed) saveDb(db);
  return { removed };
}

async function monitorList(): Promise<MonitorEntry[]> {
  const db = loadDb();
  return Array.from(db.values());
}

async function monitorCheck(url: string): Promise<CheckResult> {
  const db = loadDb();
  const entry = db.get(url);

  if (!entry) {
    throw new Error(`URL not monitored: ${url}. Add it first with monitor_add.`);
  }

  const content = await fetchWithRetry(url, entry.selector);
  const currentHash = hashContent(content);
  const checkedAt = Date.now();

  const changed = entry.lastHash !== null && entry.lastHash !== currentHash;
  const diff = changed ? generateDiff(entry.lastContent, content) : undefined;

  const result: CheckResult = {
    changed,
    diff,
    previousHash: entry.lastHash ?? undefined,
    currentHash,
    checkedAt,
  };

  // Update entry
  entry.lastHash = currentHash;
  entry.lastContent = content.slice(0, 100_000); // Cap stored content at 100KB
  entry.lastChecked = checkedAt;
  saveDb(db);

  return result;
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'web-monitor';
export const description = 'Watch URLs for content changes, compute diffs, and alert on modifications';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'monitor_add',
    description: 'Add a URL to monitor for changes',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to monitor' },
        interval: {
          type: 'number',
          description: 'Check interval in milliseconds (default: 3600000 = 1 hour)',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to monitor specific page section',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'monitor_remove',
    description: 'Remove a URL from monitoring',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to stop monitoring' },
      },
      required: ['url'],
    },
  },
  {
    name: 'monitor_list',
    description: 'List all monitored URLs with their status',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'monitor_check',
    description: 'Force an immediate check of a monitored URL',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to check now' },
      },
      required: ['url'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'monitor_add':
      return monitorAdd(
        args.url as string,
        (args.interval as number) ?? 3_600_000,
        args.selector as string | undefined,
      );
    case 'monitor_remove':
      return monitorRemove(args.url as string);
    case 'monitor_list':
      return monitorList();
    case 'monitor_check':
      return monitorCheck(args.url as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
