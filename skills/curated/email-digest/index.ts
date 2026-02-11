/**
 * @alfred/skill-email-digest
 *
 * Fetch emails via IMAP, categorize by urgency, generate digests,
 * and suggest quick replies. Uses Node.js TLS sockets for IMAP.
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmailCategory = 'urgent' | 'action-needed' | 'informational' | 'spam' | 'uncategorized';

interface Email {
  id: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  isRead: boolean;
  category: EmailCategory;
  flags: string[];
}

interface EmailDigest {
  period: string;
  generatedAt: string;
  totalEmails: number;
  unread: number;
  categories: {
    urgent: Email[];
    actionNeeded: Email[];
    informational: Email[];
    spam: Email[];
    uncategorized: Email[];
  };
  summary: string;
}

interface CategoryResult {
  total: number;
  categorized: number;
  breakdown: Record<EmailCategory, number>;
  emails: Array<{ id: string; subject: string; category: EmailCategory; confidence: number }>;
}

interface ReplySuggestion {
  tone: 'professional' | 'casual' | 'brief';
  content: string;
  subject: string;
}

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'email-digest');
const CACHE_FILE = join(DATA_DIR, 'email-cache.json');
const CONFIG_FILE = join(DATA_DIR, 'imap-config.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadCache(): Email[] {
  ensureDataDir();
  if (!existsSync(CACHE_FILE)) return [];
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCache(emails: Email[]): void {
  ensureDataDir();
  writeFileSync(CACHE_FILE, JSON.stringify(emails, null, 2), 'utf-8');
}

function loadImapConfig(): ImapConfig | null {
  ensureDataDir();
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// IMAP client — minimal implementation using TLS sockets
// ---------------------------------------------------------------------------

class SimpleImapClient {
  private socket: tls.TLSSocket | net.Socket | null = null;
  private buffer: string = '';
  private tagCounter: number = 0;
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  private nextTag(): string {
    return `A${String(++this.tagCounter).padStart(4, '0')}`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('IMAP connection timeout (10s)'));
      }, 10_000);

      if (this.config.tls) {
        this.socket = tls.connect(
          {
            host: this.config.host,
            port: this.config.port,
            rejectUnauthorized: true,
          },
          () => {
            clearTimeout(timeout);
            resolve();
          },
        );
      } else {
        this.socket = net.connect(
          { host: this.config.host, port: this.config.port },
          () => {
            clearTimeout(timeout);
            resolve();
          },
        );
      }

      this.socket.setEncoding('utf-8');
      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.socket.on('data', (data: string) => {
        this.buffer += data;
      });
    });
  }

  private async sendCommand(command: string): Promise<string> {
    const tag = this.nextTag();
    const fullCommand = `${tag} ${command}\r\n`;

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected'));
        return;
      }

      this.buffer = '';

      this.socket.write(fullCommand);

      const timeout = setTimeout(() => {
        reject(new Error(`IMAP command timeout: ${command}`));
      }, 10_000);

      const checkResponse = () => {
        const lines = this.buffer.split('\r\n');
        for (const line of lines) {
          if (line.startsWith(`${tag} OK`)) {
            clearTimeout(timeout);
            resolve(this.buffer);
            return;
          }
          if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
            clearTimeout(timeout);
            reject(new Error(`IMAP error: ${line}`));
            return;
          }
        }
        // Keep checking
        setTimeout(checkResponse, 100);
      };

      setTimeout(checkResponse, 200);
    });
  }

  async login(): Promise<void> {
    // Wait for greeting
    await new Promise((r) => setTimeout(r, 500));
    await this.sendCommand(`LOGIN "${this.config.user}" "${this.config.password}"`);
  }

  async selectFolder(folder: string): Promise<number> {
    const response = await this.sendCommand(`SELECT "${folder}"`);
    const existsMatch = response.match(/\* (\d+) EXISTS/);
    return existsMatch ? parseInt(existsMatch[1]!) : 0;
  }

  async fetchHeaders(start: number, end: number): Promise<string> {
    return this.sendCommand(
      `FETCH ${start}:${end} (FLAGS BODY[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])`,
    );
  }

  async fetchBody(seq: number): Promise<string> {
    return this.sendCommand(`FETCH ${seq} BODY[TEXT]`);
  }

  async logout(): Promise<void> {
    try {
      await this.sendCommand('LOGOUT');
    } catch {
      // Ignore logout errors
    }
    this.socket?.destroy();
    this.socket = null;
  }
}

// ---------------------------------------------------------------------------
// Email parsing
// ---------------------------------------------------------------------------

function parseImapHeaders(raw: string): Partial<Email>[] {
  const emails: Partial<Email>[] = [];
  const fetchBlocks = raw.split(/\* \d+ FETCH/);

  for (const block of fetchBlocks) {
    if (block.trim().length === 0) continue;

    const from = extractHeader(block, 'From');
    const to = extractHeader(block, 'To');
    const subject = extractHeader(block, 'Subject');
    const date = extractHeader(block, 'Date');
    const messageId = extractHeader(block, 'Message-ID') || generateId();

    // Extract flags
    const flagsMatch = block.match(/FLAGS \(([^)]*)\)/);
    const flagsStr = flagsMatch?.[1] ?? '';
    const flags = flagsStr.split(/\s+/).filter(Boolean);
    const isRead = flags.includes('\\Seen');

    if (subject || from) {
      emails.push({
        messageId: messageId.replace(/[<>]/g, ''),
        from: from || 'Unknown',
        to: to || '',
        subject: subject || '(No Subject)',
        date: date || new Date().toISOString(),
        isRead,
        flags,
      });
    }
  }

  return emails;
}

function extractHeader(text: string, header: string): string {
  const pattern = new RegExp(`${header}:\\s*(.+?)(?:\\r?\\n(?!\\s)|$)`, 'im');
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Email categorization
// ---------------------------------------------------------------------------

function categorizeEmail(email: Email): { category: EmailCategory; confidence: number } {
  const subject = email.subject.toLowerCase();
  const from = email.from.toLowerCase();
  const body = (email.body || '').toLowerCase();
  const combined = `${subject} ${from} ${body}`;

  // Spam indicators
  const spamPatterns = [
    /\bunsubscribe\b/,
    /\bwin\s+(?:a|free|big)\b/,
    /\bcongratulations\b/,
    /\bact\s+now\b/,
    /\blimited\s+time\s+offer\b/,
    /\bno-?reply@/,
    /\bnewsletter\b/,
    /\bpromotion\b/,
    /\bdiscount\b/,
    /\bspecial\s+offer\b/,
    /\bopt[\s-]*out\b/,
  ];
  const spamScore = spamPatterns.filter((p) => p.test(combined)).length;

  if (spamScore >= 3) {
    return { category: 'spam', confidence: Math.min(0.95, 0.5 + spamScore * 0.1) };
  }

  // Urgent indicators
  const urgentPatterns = [
    /\burgent\b/,
    /\basap\b/,
    /\bimmediate(?:ly)?\b/,
    /\bcritical\b/,
    /\bemergency\b/,
    /\bdeadline\s+(?:today|tomorrow|tonight)\b/,
    /\baction\s+required\b/,
    /\btime[\s-]sensitive\b/,
    /\bbreaking\b/,
    /\bimportant(?:!\s*$|:)/,
  ];
  const urgentScore = urgentPatterns.filter((p) => p.test(combined)).length;

  if (urgentScore >= 2) {
    return { category: 'urgent', confidence: Math.min(0.95, 0.5 + urgentScore * 0.15) };
  }

  // Action needed indicators
  const actionPatterns = [
    /\bplease\s+(?:review|approve|sign|confirm|respond|reply)\b/,
    /\byour\s+(?:review|approval|input|feedback|response)\s+(?:is\s+)?(?:needed|required|requested)\b/,
    /\baction\s+(?:needed|required|item)\b/,
    /\bfollow[\s-]?up\b/,
    /\breminder\b/,
    /\btask\b/,
    /\bmeeting\s+(?:invite|request|scheduled)\b/,
    /\bapproval\s+(?:needed|pending)\b/,
    /\bplease\s+(?:complete|submit|update)\b/,
  ];
  const actionScore = actionPatterns.filter((p) => p.test(combined)).length;

  if (actionScore >= 1) {
    return {
      category: 'action-needed',
      confidence: Math.min(0.9, 0.4 + actionScore * 0.15),
    };
  }

  if (urgentScore >= 1) {
    return { category: 'urgent', confidence: 0.5 + urgentScore * 0.1 };
  }

  if (spamScore >= 1) {
    return { category: 'spam', confidence: 0.3 + spamScore * 0.1 };
  }

  // Default: informational
  return { category: 'informational', confidence: 0.6 };
}

// ---------------------------------------------------------------------------
// Reply suggestions
// ---------------------------------------------------------------------------

function generateReplySuggestions(email: Email): ReplySuggestion[] {
  const suggestions: ReplySuggestion[] = [];
  const subject = email.subject.toLowerCase();
  const replySubject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;

  // Professional reply
  if (email.category === 'action-needed' || email.category === 'urgent') {
    suggestions.push({
      tone: 'professional',
      subject: replySubject,
      content: `Thank you for your email. I have received this and will address it promptly. I will follow up with a more detailed response by end of day.\n\nBest regards`,
    });
  }

  // Meeting-related
  if (/meeting|invite|calendar|schedule/i.test(subject)) {
    suggestions.push({
      tone: 'professional',
      subject: replySubject,
      content: `Thank you for the meeting invitation. I can confirm my attendance. Please let me know if there is anything I should prepare in advance.\n\nBest regards`,
    });

    suggestions.push({
      tone: 'professional',
      subject: replySubject,
      content: `Thank you for the invite. Unfortunately, I have a scheduling conflict at that time. Could we look at an alternative time? I am available [suggest times].\n\nBest regards`,
    });
  }

  // Review request
  if (/review|feedback|approve/i.test(subject)) {
    suggestions.push({
      tone: 'professional',
      subject: replySubject,
      content: `Thank you for sending this over. I will review it and provide my feedback by [timeline]. Please let me know if there is a specific deadline.\n\nBest regards`,
    });
  }

  // General casual reply
  suggestions.push({
    tone: 'casual',
    subject: replySubject,
    content: `Thanks for the heads up! I will take a look and get back to you soon.`,
  });

  // Brief acknowledgment
  suggestions.push({
    tone: 'brief',
    subject: replySubject,
    content: `Received, thank you. Will follow up shortly.`,
  });

  return suggestions.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function emailFetch(
  count: number = 20,
  folder: string = 'INBOX',
): Promise<{ emails: Email[]; total: number; source: string }> {
  const config = loadImapConfig();

  if (!config) {
    // Fall back to cached emails
    const cached = loadCache();
    if (cached.length > 0) {
      return {
        emails: cached.slice(0, count),
        total: cached.length,
        source: 'cache',
      };
    }
    throw new Error(
      'IMAP not configured and no cached emails available. Create config at ~/.alfred/state/email-digest/imap-config.json with: { "host", "port", "user", "password", "tls" }',
    );
  }

  const client = new SimpleImapClient(config);

  try {
    await client.connect();
    await client.login();
    const totalMessages = await client.selectFolder(folder);

    if (totalMessages === 0) {
      return { emails: [], total: 0, source: 'imap' };
    }

    // Fetch the most recent N emails
    const start = Math.max(1, totalMessages - count + 1);
    const headerData = await client.fetchHeaders(start, totalMessages);
    const parsed = parseImapHeaders(headerData);

    const emails: Email[] = parsed.map((partial) => {
      const email: Email = {
        id: generateId(),
        messageId: partial.messageId ?? generateId(),
        from: partial.from ?? 'Unknown',
        to: partial.to ?? '',
        subject: partial.subject ?? '(No Subject)',
        date: partial.date ?? new Date().toISOString(),
        body: '',
        isRead: partial.isRead ?? false,
        category: 'uncategorized',
        flags: partial.flags ?? [],
      };

      // Categorize
      const { category } = categorizeEmail(email);
      email.category = category;

      return email;
    });

    // Cache results
    saveCache(emails);

    await client.logout();

    return { emails, total: totalMessages, source: 'imap' };
  } catch (err) {
    // Fall back to cache on connection failure
    const cached = loadCache();
    if (cached.length > 0) {
      return {
        emails: cached.slice(0, count),
        total: cached.length,
        source: 'cache (IMAP connection failed)',
      };
    }
    throw new Error(
      `IMAP connection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function emailDigest(
  period: string = 'today',
): Promise<{ digest: EmailDigest }> {
  const { emails, total } = await emailFetch(100);

  // Filter by period
  const now = new Date();
  let cutoff: Date;

  switch (period) {
    case 'today':
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week':
      cutoff = new Date(now.getTime() - 7 * 86_400_000);
      break;
    case 'month':
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    default:
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const filtered = emails.filter((e) => {
    try {
      return new Date(e.date) >= cutoff;
    } catch {
      return true;
    }
  });

  // Categorize and group
  const categories: EmailDigest['categories'] = {
    urgent: [],
    actionNeeded: [],
    informational: [],
    spam: [],
    uncategorized: [],
  };

  for (const email of filtered) {
    const { category } = categorizeEmail(email);
    email.category = category;

    switch (category) {
      case 'urgent':
        categories.urgent.push(email);
        break;
      case 'action-needed':
        categories.actionNeeded.push(email);
        break;
      case 'informational':
        categories.informational.push(email);
        break;
      case 'spam':
        categories.spam.push(email);
        break;
      default:
        categories.uncategorized.push(email);
    }
  }

  const unread = filtered.filter((e) => !e.isRead).length;

  // Generate summary
  const summaryParts: string[] = [];
  summaryParts.push(`You have ${filtered.length} emails from ${period}.`);
  if (categories.urgent.length > 0) {
    summaryParts.push(`${categories.urgent.length} urgent email(s) requiring immediate attention.`);
  }
  if (categories.actionNeeded.length > 0) {
    summaryParts.push(`${categories.actionNeeded.length} email(s) need your action.`);
  }
  summaryParts.push(`${categories.informational.length} informational, ${categories.spam.length} spam.`);
  if (unread > 0) {
    summaryParts.push(`${unread} unread.`);
  }

  return {
    digest: {
      period,
      generatedAt: new Date().toISOString(),
      totalEmails: filtered.length,
      unread,
      categories,
      summary: summaryParts.join(' '),
    },
  };
}

async function emailCategorize(): Promise<{ categories: CategoryResult }> {
  const { emails } = await emailFetch(100);

  const breakdown: Record<EmailCategory, number> = {
    urgent: 0,
    'action-needed': 0,
    informational: 0,
    spam: 0,
    uncategorized: 0,
  };

  const categorized: CategoryResult['emails'] = [];

  for (const email of emails) {
    const { category, confidence } = categorizeEmail(email);
    email.category = category;
    breakdown[category]++;

    categorized.push({
      id: email.id,
      subject: email.subject,
      category,
      confidence,
    });
  }

  // Update cache with categories
  saveCache(emails);

  return {
    categories: {
      total: emails.length,
      categorized: emails.filter((e) => e.category !== 'uncategorized').length,
      breakdown,
      emails: categorized,
    },
  };
}

async function emailReplySuggest(
  id: string,
): Promise<{ suggestions: ReplySuggestion[] }> {
  const cached = loadCache();
  const email = cached.find((e) => e.id === id);

  if (!email) {
    throw new Error(`Email not found: ${id}. Fetch emails first with email_fetch.`);
  }

  const suggestions = generateReplySuggestions(email);
  return { suggestions };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'email-digest';
export const description = 'Fetch emails via IMAP, categorize by urgency, generate digests, and suggest replies';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'email_fetch',
    description: 'Fetch recent emails from IMAP server',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of emails to fetch (default: 20)' },
        folder: { type: 'string', description: 'IMAP folder name (default: INBOX)' },
      },
    },
  },
  {
    name: 'email_digest',
    description: 'Generate a categorized email digest',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: 'Time period for the digest (default: today)',
        },
      },
    },
  },
  {
    name: 'email_categorize',
    description: 'Categorize all unread emails by urgency and type',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'email_reply_suggest',
    description: 'Suggest quick reply options for an email',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Email ID (from email_fetch results)' },
      },
      required: ['id'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'email_fetch':
      return emailFetch(
        (args.count as number) ?? 20,
        (args.folder as string) ?? 'INBOX',
      );
    case 'email_digest':
      return emailDigest((args.period as string) ?? 'today');
    case 'email_categorize':
      return emailCategorize();
    case 'email_reply_suggest':
      return emailReplySuggest(args.id as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
