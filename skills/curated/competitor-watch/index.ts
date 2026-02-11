/**
 * @alfred/skill-competitor-watch
 *
 * Monitor competitor websites, pricing, and presence.
 * Track changes and generate diff reports.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Competitor {
  id: string;
  name: string;
  urls: string[];
  snapshots: Snapshot[];
  addedAt: number;
  lastChecked: number | null;
}

interface Snapshot {
  url: string;
  contentHash: string;
  title: string;
  textPreview: string;
  pricingMentions: string[];
  capturedAt: number;
}

interface DiffEntry {
  url: string;
  changeType: 'content' | 'pricing' | 'new-page' | 'removed';
  description: string;
  previousHash?: string;
  currentHash?: string;
  detectedAt: number;
}

interface CompetitorReportEntry {
  name: string;
  urlCount: number;
  lastChecked: string | null;
  recentChanges: number;
  pricingChanges: boolean;
  status: 'active' | 'stale' | 'new';
}

interface CompetitorReport {
  generatedAt: string;
  totalCompetitors: number;
  competitors: CompetitorReportEntry[];
  recentAlerts: DiffEntry[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'competitor-watch');
const DB_FILE = join(DATA_DIR, 'competitors.json');
const DIFFS_FILE = join(DATA_DIR, 'diffs.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadCompetitors(): Competitor[] {
  ensureDataDir();
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCompetitors(competitors: Competitor[]): void {
  ensureDataDir();
  writeFileSync(DB_FILE, JSON.stringify(competitors, null, 2), 'utf-8');
}

function loadDiffs(): DiffEntry[] {
  ensureDataDir();
  if (!existsSync(DIFFS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DIFFS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveDiffs(diffs: DiffEntry[]): void {
  ensureDataDir();
  writeFileSync(DIFFS_FILE, JSON.stringify(diffs, null, 2), 'utf-8');
}

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

async function fetchPage(url: string, retries: number = 2): Promise<{ html: string; title: string }> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ua = USER_AGENTS[attempt % USER_AGENTS.length]!;
      const response = await fetch(url, {
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      const title = titleMatch?.[1]?.trim() ?? url;

      return { html, title };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch: ${url}`);
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10_000);
}

function extractPricingMentions(text: string): string[] {
  const mentions: string[] = [];

  // Find price patterns: $XX.XX, XX.XX/mo, etc.
  const pricePatterns = text.match(
    /\$\d+(?:,\d{3})*(?:\.\d{2})?(?:\s*\/\s*(?:mo(?:nth)?|yr|year|user|seat))?/gi,
  );
  if (pricePatterns) {
    mentions.push(...pricePatterns.slice(0, 10));
  }

  // Find plan names near prices
  const planPatterns = text.match(
    /(?:free|basic|starter|pro|premium|enterprise|business|team|individual)\s*(?:plan|tier|pricing)?/gi,
  );
  if (planPatterns) {
    mentions.push(...[...new Set(planPatterns)].slice(0, 5));
  }

  return [...new Set(mentions)];
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function competitorAdd(
  name: string,
  urls: string[],
): Promise<{ id: string; name: string; urlCount: number }> {
  if (!name || name.trim().length === 0) {
    throw new Error('Competitor name is required');
  }
  if (!urls || urls.length === 0) {
    throw new Error('At least one URL is required');
  }

  const competitors = loadCompetitors();
  const existing = competitors.find(
    (c) => c.name.toLowerCase() === name.toLowerCase().trim(),
  );

  if (existing) {
    // Add new URLs to existing competitor
    const newUrls = urls.filter((u) => !existing.urls.includes(u));
    existing.urls.push(...newUrls);
    saveCompetitors(competitors);
    return { id: existing.id, name: existing.name, urlCount: existing.urls.length };
  }

  const competitor: Competitor = {
    id: generateId(),
    name: name.trim(),
    urls,
    snapshots: [],
    addedAt: Date.now(),
    lastChecked: null,
  };

  competitors.push(competitor);
  saveCompetitors(competitors);

  return { id: competitor.id, name: competitor.name, urlCount: urls.length };
}

async function competitorRemove(name: string): Promise<{ removed: boolean }> {
  const competitors = loadCompetitors();
  const idx = competitors.findIndex(
    (c) => c.name.toLowerCase() === name.toLowerCase().trim(),
  );

  if (idx === -1) return { removed: false };

  competitors.splice(idx, 1);
  saveCompetitors(competitors);
  return { removed: true };
}

async function competitorReport(): Promise<{ report: CompetitorReport }> {
  const competitors = loadCompetitors();
  const allDiffs = loadDiffs();
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Refresh data for each competitor
  for (const competitor of competitors) {
    for (const url of competitor.urls) {
      try {
        const { html, title } = await fetchPage(url);
        const text = extractText(html);
        const contentHash = hashContent(text);
        const pricingMentions = extractPricingMentions(text);

        // Check for changes
        const prevSnapshot = competitor.snapshots.find((s) => s.url === url);

        if (prevSnapshot && prevSnapshot.contentHash !== contentHash) {
          const pricingChanged =
            JSON.stringify(prevSnapshot.pricingMentions) !== JSON.stringify(pricingMentions);

          allDiffs.push({
            url,
            changeType: pricingChanged ? 'pricing' : 'content',
            description: pricingChanged
              ? `Pricing changes detected on ${competitor.name}: ${url}`
              : `Content updated on ${competitor.name}: ${url}`,
            previousHash: prevSnapshot.contentHash,
            currentHash: contentHash,
            detectedAt: now,
          });
        }

        // Update snapshot
        const snapshotIdx = competitor.snapshots.findIndex((s) => s.url === url);
        const newSnapshot: Snapshot = {
          url,
          contentHash,
          title,
          textPreview: text.slice(0, 500),
          pricingMentions,
          capturedAt: now,
        };

        if (snapshotIdx >= 0) {
          competitor.snapshots[snapshotIdx] = newSnapshot;
        } else {
          competitor.snapshots.push(newSnapshot);
        }
      } catch {
        // Skip failed URLs
      }

      // Small delay between requests
      await new Promise((r) => setTimeout(r, 300));
    }

    competitor.lastChecked = now;
  }

  saveCompetitors(competitors);
  saveDiffs(allDiffs);

  // Build report
  const recentDiffs = allDiffs.filter((d) => d.detectedAt > weekAgo);

  const competitorEntries: CompetitorReportEntry[] = competitors.map((c) => {
    const recentChanges = recentDiffs.filter((d) =>
      c.urls.some((u) => d.url === u),
    ).length;

    const pricingChanges = recentDiffs.some(
      (d) => d.changeType === 'pricing' && c.urls.some((u) => d.url === u),
    );

    const daysSinceAdded = (now - c.addedAt) / 86_400_000;
    let status: 'active' | 'stale' | 'new';
    if (daysSinceAdded < 1) {
      status = 'new';
    } else if (c.lastChecked && now - c.lastChecked < 7 * 86_400_000) {
      status = 'active';
    } else {
      status = 'stale';
    }

    return {
      name: c.name,
      urlCount: c.urls.length,
      lastChecked: c.lastChecked
        ? new Date(c.lastChecked).toISOString().split('T')[0]!
        : null,
      recentChanges,
      pricingChanges,
      status,
    };
  });

  return {
    report: {
      generatedAt: new Date().toISOString(),
      totalCompetitors: competitors.length,
      competitors: competitorEntries,
      recentAlerts: recentDiffs.slice(0, 20),
    },
  };
}

async function competitorDiff(name: string): Promise<{ diffs: DiffEntry[] }> {
  const competitors = loadCompetitors();
  const competitor = competitors.find(
    (c) => c.name.toLowerCase() === name.toLowerCase().trim(),
  );

  if (!competitor) {
    throw new Error(`Competitor not found: ${name}`);
  }

  const allDiffs = loadDiffs();
  const competitorDiffs = allDiffs
    .filter((d) => competitor.urls.some((u) => d.url === u))
    .sort((a, b) => b.detectedAt - a.detectedAt)
    .slice(0, 50);

  return { diffs: competitorDiffs };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'competitor-watch';
export const description = 'Monitor competitor websites, pricing, and presence with change tracking';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'competitor_add',
    description: 'Add a competitor to monitor',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Competitor name' },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs to monitor (website, pricing page, etc.)',
        },
      },
      required: ['name', 'urls'],
    },
  },
  {
    name: 'competitor_remove',
    description: 'Remove a competitor from monitoring',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Competitor name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'competitor_report',
    description: 'Generate a report across all monitored competitors',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'competitor_diff',
    description: 'Get recent changes for a specific competitor',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Competitor name' },
      },
      required: ['name'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'competitor_add':
      return competitorAdd(args.name as string, args.urls as string[]);
    case 'competitor_remove':
      return competitorRemove(args.name as string);
    case 'competitor_report':
      return competitorReport();
    case 'competitor_diff':
      return competitorDiff(args.name as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
