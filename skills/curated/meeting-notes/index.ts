/**
 * @alfred/skill-meeting-notes
 *
 * Process meeting transcripts into structured notes with summary,
 * action items, decisions, and attendee extraction.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionItem {
  action: string;
  assignee: string | null;
  deadline: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'completed';
}

interface MeetingSummary {
  id: string;
  title: string;
  date: string;
  duration?: string;
  summary: string;
  keyTopics: string[];
  actionItems: ActionItem[];
  decisions: string[];
  attendees: string[];
  rawTranscript: string;
  processedAt: number;
}

interface SearchResult {
  meetingId: string;
  title: string;
  date: string;
  matchContext: string;
  relevance: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'meeting-notes');
const DB_FILE = join(DATA_DIR, 'meetings.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadMeetings(): MeetingSummary[] {
  ensureDataDir();
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveMeetings(meetings: MeetingSummary[]): void {
  ensureDataDir();
  writeFileSync(DB_FILE, JSON.stringify(meetings, null, 2), 'utf-8');
}

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Transcript analysis
// ---------------------------------------------------------------------------

/**
 * Extract attendee names from transcript.
 * Looks for patterns like "Speaker:", "Name:", "[Name]", etc.
 */
function extractAttendees(transcript: string): string[] {
  const attendees = new Set<string>();

  // Pattern: "Name:" at the start of lines (speaker labels)
  const speakerPattern = /^([A-Z][a-z]+ ?[A-Z]?[a-z]*)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = speakerPattern.exec(transcript)) !== null) {
    const name = match[1]!.trim();
    if (name.length >= 2 && name.length <= 30 && !isCommonWord(name)) {
      attendees.add(name);
    }
  }

  // Pattern: "[Name]" speaker markers
  const bracketPattern = /\[([A-Z][a-z]+ ?[A-Z]?[a-z]*)\]/g;
  while ((match = bracketPattern.exec(transcript)) !== null) {
    const name = match[1]!.trim();
    if (name.length >= 2 && name.length <= 30 && !isCommonWord(name)) {
      attendees.add(name);
    }
  }

  // Pattern: "said Name", "asked Name", "@Name"
  const mentionPattern = /(?:said|asked|suggested|mentioned|@)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;
  while ((match = mentionPattern.exec(transcript)) !== null) {
    const name = match[1]!.trim();
    if (name.length >= 2 && name.length <= 30 && !isCommonWord(name)) {
      attendees.add(name);
    }
  }

  return Array.from(attendees);
}

function isCommonWord(word: string): boolean {
  const common = new Set([
    'The', 'This', 'That', 'What', 'When', 'Where', 'Which', 'Who',
    'How', 'Yes', 'No', 'Not', 'But', 'And', 'Also', 'Note',
    'Action', 'Summary', 'Decision', 'Meeting', 'Topic', 'Item',
    'Speaker', 'Unknown', 'Moderator', 'Host',
  ]);
  return common.has(word);
}

/**
 * Extract action items from transcript.
 * Looks for assignment patterns, TODO markers, and action verbs.
 */
function extractActionItems(transcript: string): ActionItem[] {
  const actions: ActionItem[] = [];
  const lines = transcript.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Pattern: "Action Item: ..." or "TODO: ..." or "AI: ..."
    const actionMatch = trimmed.match(
      /^(?:action\s*item|todo|ai|task|action)\s*:?\s*[-:]?\s*(.+)/i,
    );
    if (actionMatch) {
      const item = parseActionItem(actionMatch[1]!);
      actions.push(item);
      continue;
    }

    // Pattern: "Name will/should/needs to ..."
    const assignmentMatch = trimmed.match(
      /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|should|needs?\s+to|is\s+going\s+to|has\s+to|must)\s+(.+)/,
    );
    if (assignmentMatch) {
      actions.push({
        action: assignmentMatch[2]!.replace(/[.!]+$/, '').trim(),
        assignee: assignmentMatch[1]!,
        deadline: extractDeadline(trimmed),
        priority: assessPriority(trimmed),
        status: 'pending',
      });
      continue;
    }

    // Pattern: "- [ ] Task" (checkbox format)
    const checkboxMatch = trimmed.match(/^[-*]\s*\[\s*\]\s*(.+)/);
    if (checkboxMatch) {
      actions.push(parseActionItem(checkboxMatch[1]!));
      continue;
    }

    // Pattern: lines with "by [date]" or "deadline:"
    if (/\bby\s+(next\s+\w+|tomorrow|end\s+of\s+\w+|\d{1,2}\/\d{1,2})/i.test(trimmed)) {
      const hasAssignment = trimmed.match(
        /([A-Z][a-z]+)\s*[-:]\s*(.*)/,
      );
      if (hasAssignment) {
        actions.push({
          action: hasAssignment[2]!.replace(/[.!]+$/, '').trim(),
          assignee: hasAssignment[1]!,
          deadline: extractDeadline(trimmed),
          priority: assessPriority(trimmed),
          status: 'pending',
        });
      }
    }
  }

  return actions;
}

function parseActionItem(text: string): ActionItem {
  // Try to extract assignee from "... (assigned to Name)" or "... @Name"
  let assignee: string | null = null;
  const assigneeMatch = text.match(
    /(?:assigned?\s+to|owner|@)\s*:?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i,
  );
  if (assigneeMatch) {
    assignee = assigneeMatch[1]!;
  }

  return {
    action: text.replace(/\(assigned.*?\)/gi, '').replace(/@\w+/g, '').trim().replace(/[.!]+$/, ''),
    assignee,
    deadline: extractDeadline(text),
    priority: assessPriority(text),
    status: 'pending',
  };
}

function extractDeadline(text: string): string | null {
  const patterns = [
    /by\s+(next\s+\w+)/i,
    /by\s+(tomorrow)/i,
    /by\s+(end\s+of\s+\w+)/i,
    /by\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
    /deadline\s*:?\s*(\w[\w\s/]+)/i,
    /due\s*:?\s*(\w[\w\s/]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1]!.trim();
  }

  return null;
}

function assessPriority(text: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase();
  if (/\b(?:urgent|critical|asap|immediately|high\s*priority|p0|p1|blocker)\b/.test(lower)) {
    return 'high';
  }
  if (/\b(?:low\s*priority|p3|nice\s*to\s*have|whenever|eventually)\b/.test(lower)) {
    return 'low';
  }
  return 'medium';
}

/**
 * Extract decisions from transcript.
 */
function extractDecisions(transcript: string): string[] {
  const decisions: string[] = [];
  const lines = transcript.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Pattern: "Decision: ..." or "Decided: ..."
    const decisionMatch = trimmed.match(
      /^(?:decision|decided|agreed|conclusion|resolved)\s*:?\s*[-:]?\s*(.+)/i,
    );
    if (decisionMatch) {
      decisions.push(decisionMatch[1]!.trim());
      continue;
    }

    // Pattern: "We decided to ..." or "The team agreed to ..."
    const agreedMatch = trimmed.match(
      /(?:we|the team|everyone|the group)\s+(?:decided|agreed|concluded|resolved)\s+(?:to\s+)?(.+)/i,
    );
    if (agreedMatch) {
      decisions.push(agreedMatch[1]!.replace(/[.!]+$/, '').trim());
    }
  }

  return decisions;
}

/**
 * Extract key topics discussed.
 */
function extractKeyTopics(transcript: string): string[] {
  const topics: string[] = [];
  const lines = transcript.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Pattern: "Topic: ..." or "Agenda item: ..."
    const topicMatch = trimmed.match(
      /^(?:topic|agenda\s*item|discussion|item\s*\d*)\s*:?\s*[-:]?\s*(.+)/i,
    );
    if (topicMatch) {
      topics.push(topicMatch[1]!.trim());
      continue;
    }

    // Pattern: markdown headers "# Topic" or "## Topic"
    const headerMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      topics.push(headerMatch[1]!.trim());
    }
  }

  // If no explicit topics found, extract from content
  if (topics.length === 0) {
    // Use the first few substantive lines as topics
    const substantiveLines = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 20 && l.length < 100 && !l.includes(':'))
      .slice(0, 5);
    topics.push(...substantiveLines);
  }

  return topics.slice(0, 10);
}

/**
 * Generate a summary of the transcript.
 */
function generateSummary(transcript: string, attendees: string[]): string {
  const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);

  // Extract significant sentences
  const sentences: string[] = [];
  for (const line of lines) {
    const lineSentences = line
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20 && s.length < 200);
    sentences.push(...lineSentences);
  }

  // Take first few and key sentences
  const summary: string[] = [];

  // Add context line
  if (attendees.length > 0) {
    summary.push(`Meeting with ${attendees.join(', ')}.`);
  }

  // First few sentences for context
  const uniqueSentences = [...new Set(sentences)];
  for (const sentence of uniqueSentences.slice(0, 10)) {
    // Skip speaker labels and very short content
    if (!/^[A-Z][a-z]+\s*:/.test(sentence) && sentence.length > 30) {
      summary.push(sentence + '.');
    }
  }

  return summary.slice(0, 8).join(' ');
}

/**
 * Generate a title from the transcript content.
 */
function generateTitle(transcript: string, topics: string[]): string {
  if (topics.length > 0 && topics[0]!.length < 80) {
    return topics[0]!;
  }

  // Try to find a title-like line at the beginning
  const firstLines = transcript.split('\n').slice(0, 5);
  for (const line of firstLines) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 80 && !trimmed.includes(':')) {
      return trimmed;
    }
  }

  return `Meeting — ${new Date().toISOString().split('T')[0]}`;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function meetingProcess(
  transcript: string,
): Promise<{
  id: string;
  title: string;
  summary: string;
  actionItems: ActionItem[];
  decisions: string[];
  attendees: string[];
  keyTopics: string[];
}> {
  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Transcript is empty');
  }

  const attendees = extractAttendees(transcript);
  const actionItems = extractActionItems(transcript);
  const decisions = extractDecisions(transcript);
  const keyTopics = extractKeyTopics(transcript);
  const summary = generateSummary(transcript, attendees);
  const title = generateTitle(transcript, keyTopics);

  const meeting: MeetingSummary = {
    id: generateId(),
    title,
    date: new Date().toISOString().split('T')[0]!,
    summary,
    keyTopics,
    actionItems,
    decisions,
    attendees: attendees.length > 0 ? attendees : ['Unknown'],
    rawTranscript: transcript.slice(0, 50_000), // Cap transcript storage
    processedAt: Date.now(),
  };

  const meetings = loadMeetings();
  meetings.push(meeting);
  saveMeetings(meetings);

  return {
    id: meeting.id,
    title: meeting.title,
    summary: meeting.summary,
    actionItems: meeting.actionItems,
    decisions: meeting.decisions,
    attendees: meeting.attendees,
    keyTopics: meeting.keyTopics,
  };
}

async function meetingSummary(id: string): Promise<{ summary: MeetingSummary }> {
  const meetings = loadMeetings();
  const meeting = meetings.find((m) => m.id === id);
  if (!meeting) {
    throw new Error(`Meeting not found: ${id}`);
  }
  return { summary: meeting };
}

async function meetingActions(id: string): Promise<{ actions: ActionItem[] }> {
  const meetings = loadMeetings();
  const meeting = meetings.find((m) => m.id === id);
  if (!meeting) {
    throw new Error(`Meeting not found: ${id}`);
  }
  return { actions: meeting.actionItems };
}

async function meetingSearch(query: string): Promise<{ results: SearchResult[] }> {
  const meetings = loadMeetings();
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 2);

  const results: SearchResult[] = [];

  for (const meeting of meetings) {
    const searchText = `${meeting.title} ${meeting.summary} ${meeting.rawTranscript} ${meeting.keyTopics.join(' ')} ${meeting.decisions.join(' ')}`.toLowerCase();

    let matchCount = 0;
    for (const word of queryWords) {
      if (searchText.includes(word)) matchCount++;
    }

    if (matchCount === 0) continue;

    const relevance = matchCount / queryWords.length;

    // Extract context around first match
    const idx = searchText.indexOf(lowerQuery);
    const contextStart = Math.max(0, idx === -1 ? 0 : idx - 80);
    const contextEnd = Math.min(searchText.length, (idx === -1 ? 0 : idx) + query.length + 80);
    const matchContext = idx >= 0
      ? `...${searchText.slice(contextStart, contextEnd)}...`
      : meeting.summary.slice(0, 150);

    results.push({
      meetingId: meeting.id,
      title: meeting.title,
      date: meeting.date,
      matchContext,
      relevance,
    });
  }

  results.sort((a, b) => b.relevance - a.relevance);
  return { results: results.slice(0, 20) };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'meeting-notes';
export const description =
  'Process meeting transcripts into structured notes with summary, action items, and decisions';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'meeting_process',
    description: 'Process a meeting transcript into structured notes',
    parameters: {
      type: 'object',
      properties: {
        transcript: { type: 'string', description: 'Raw meeting transcript text' },
      },
      required: ['transcript'],
    },
  },
  {
    name: 'meeting_summary',
    description: 'Get the summary of a previously processed meeting',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Meeting ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'meeting_actions',
    description: 'Get action items from a processed meeting',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Meeting ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'meeting_search',
    description: 'Search across all meeting notes',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'meeting_process':
      return meetingProcess(args.transcript as string);
    case 'meeting_summary':
      return meetingSummary(args.id as string);
    case 'meeting_actions':
      return meetingActions(args.id as string);
    case 'meeting_search':
      return meetingSearch(args.query as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
