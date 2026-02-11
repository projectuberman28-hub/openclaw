/**
 * @alfred/skill-social-drafter
 *
 * Draft platform-specific social media posts with formatting,
 * character limits, and variant generation.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = 'x' | 'twitter' | 'linkedin' | 'instagram' | 'facebook' | 'mastodon' | 'threads' | 'bluesky';

interface PlatformConfig {
  name: string;
  maxLength: number;
  style: 'casual' | 'professional' | 'visual' | 'conversational';
  hashtagStrategy: 'inline' | 'end' | 'none';
  maxHashtags: number;
  supportsFormatting: boolean;
}

interface PlatformDraft {
  platform: string;
  content: string;
  charCount: number;
  charLimit: number;
  withinLimit: boolean;
  hashtags: string[];
  tips: string[];
}

interface ScheduledPost {
  id: string;
  content: string;
  platform: string;
  scheduledFor: string;
  createdAt: number;
  status: 'scheduled' | 'posted' | 'cancelled';
}

// ---------------------------------------------------------------------------
// Platform configurations
// ---------------------------------------------------------------------------

const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  x: {
    name: 'X (Twitter)',
    maxLength: 280,
    style: 'casual',
    hashtagStrategy: 'inline',
    maxHashtags: 3,
    supportsFormatting: false,
  },
  twitter: {
    name: 'X (Twitter)',
    maxLength: 280,
    style: 'casual',
    hashtagStrategy: 'inline',
    maxHashtags: 3,
    supportsFormatting: false,
  },
  linkedin: {
    name: 'LinkedIn',
    maxLength: 3000,
    style: 'professional',
    hashtagStrategy: 'end',
    maxHashtags: 5,
    supportsFormatting: true,
  },
  instagram: {
    name: 'Instagram',
    maxLength: 2200,
    style: 'visual',
    hashtagStrategy: 'end',
    maxHashtags: 30,
    supportsFormatting: false,
  },
  facebook: {
    name: 'Facebook',
    maxLength: 63206,
    style: 'conversational',
    hashtagStrategy: 'end',
    maxHashtags: 5,
    supportsFormatting: false,
  },
  mastodon: {
    name: 'Mastodon',
    maxLength: 500,
    style: 'casual',
    hashtagStrategy: 'end',
    maxHashtags: 5,
    supportsFormatting: false,
  },
  threads: {
    name: 'Threads',
    maxLength: 500,
    style: 'conversational',
    hashtagStrategy: 'none',
    maxHashtags: 0,
    supportsFormatting: false,
  },
  bluesky: {
    name: 'Bluesky',
    maxLength: 300,
    style: 'casual',
    hashtagStrategy: 'inline',
    maxHashtags: 3,
    supportsFormatting: false,
  },
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'social-drafter');
const SCHEDULE_FILE = join(DATA_DIR, 'scheduled.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadScheduled(): ScheduledPost[] {
  ensureDataDir();
  if (!existsSync(SCHEDULE_FILE)) return [];
  try {
    return JSON.parse(readFileSync(SCHEDULE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveScheduled(posts: ScheduledPost[]): void {
  ensureDataDir();
  writeFileSync(SCHEDULE_FILE, JSON.stringify(posts, null, 2), 'utf-8');
}

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Content adaptation
// ---------------------------------------------------------------------------

function extractKeywords(content: string): string[] {
  const words = content.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these',
    'those', 'i', 'we', 'you', 'he', 'she', 'it', 'they', 'my', 'your',
    'our', 'their', 'its', 'just', 'also', 'very', 'really', 'about',
    'not', 'so', 'if', 'then', 'than', 'from', 'into', 'out', 'up',
  ]);

  return words
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 3)
    .slice(0, 10);
}

function generateHashtags(content: string, maxCount: number): string[] {
  const keywords = extractKeywords(content);
  return keywords
    .slice(0, maxCount)
    .map((k) => `#${k.charAt(0).toUpperCase() + k.slice(1)}`);
}

function adaptForPlatform(content: string, config: PlatformConfig): PlatformDraft {
  let adapted: string;
  const hashtags = config.maxHashtags > 0 ? generateHashtags(content, config.maxHashtags) : [];
  const tips: string[] = [];

  switch (config.style) {
    case 'casual': {
      // Keep it concise and punchy for X/Twitter/Bluesky
      adapted = content.trim();
      if (adapted.length > config.maxLength) {
        // Trim to fit with ellipsis
        const hashtagSpace = config.hashtagStrategy === 'inline'
          ? hashtags.slice(0, 2).join(' ').length + 2
          : 0;
        const maxContent = config.maxLength - hashtagSpace - 3;
        adapted = adapted.slice(0, maxContent).replace(/\s+\S*$/, '') + '...';
        tips.push(`Content was truncated to fit ${config.maxLength} character limit`);
      }
      if (config.hashtagStrategy === 'inline' && hashtags.length > 0) {
        adapted += ' ' + hashtags.slice(0, config.maxHashtags).join(' ');
      }
      tips.push('Keep it conversational and engaging');
      break;
    }

    case 'professional': {
      // LinkedIn: structured, professional, paragraph-based
      const sentences = content.split(/[.!]+/).map((s) => s.trim()).filter(Boolean);
      const paragraphs: string[] = [];

      if (sentences.length >= 1) {
        paragraphs.push(sentences[0]! + '.');
      }
      if (sentences.length >= 2) {
        paragraphs.push('');
        paragraphs.push(sentences.slice(1, 4).join('. ') + '.');
      }
      if (sentences.length >= 4) {
        paragraphs.push('');
        paragraphs.push(sentences.slice(4).join('. ') + '.');
      }

      adapted = paragraphs.join('\n');

      // Add hashtags at the end
      if (hashtags.length > 0) {
        adapted += '\n\n' + hashtags.join(' ');
      }

      tips.push('Start with a hook to stop the scroll');
      tips.push('Use line breaks to improve readability');
      tips.push('End with a call to action or question');
      break;
    }

    case 'visual': {
      // Instagram: engaging, emoji-friendly, hashtag-heavy
      adapted = content.trim();

      // Add line breaks for readability
      const sentences = adapted.split(/[.!]+/).map((s) => s.trim()).filter(Boolean);
      adapted = sentences.join('.\n\n');

      // Instagram hashtags at the end, separated by a gap
      if (hashtags.length > 0) {
        const igHashtags = generateHashtags(content, 30);
        adapted += '\n\n.\n.\n.\n' + igHashtags.join(' ');
      }

      tips.push('Pair with a high-quality image or carousel');
      tips.push('Use the first line as your hook');
      tips.push('Hashtags placed at the end for cleaner look');
      break;
    }

    case 'conversational': {
      // Facebook/Threads: natural, conversational
      adapted = content.trim();
      if (hashtags.length > 0 && config.hashtagStrategy !== 'none') {
        adapted += '\n\n' + hashtags.slice(0, 3).join(' ');
      }
      tips.push('Ask a question to encourage engagement');
      tips.push('Tag relevant people or pages');
      break;
    }

    default: {
      adapted = content.trim();
      break;
    }
  }

  const charCount = adapted.length;

  return {
    platform: config.name,
    content: adapted,
    charCount,
    charLimit: config.maxLength,
    withinLimit: charCount <= config.maxLength,
    hashtags,
    tips,
  };
}

// ---------------------------------------------------------------------------
// Variant generation
// ---------------------------------------------------------------------------

function generateVariants(draft: string, count: number): string[] {
  const variants: string[] = [];
  const sentences = draft.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);

  // Variant 1: Question format
  if (sentences.length > 0) {
    const core = sentences[0]!;
    variants.push(`Did you know? ${core}. ${sentences.slice(1).join('. ')}`.trim());
  }

  // Variant 2: Reversed order
  if (sentences.length >= 2) {
    const reversed = [...sentences].reverse();
    variants.push(reversed.join('. ') + '.');
  }

  // Variant 3: Bold opening
  if (sentences.length > 0) {
    variants.push(
      `Here's what matters: ${sentences.join('. ')}.`.trim(),
    );
  }

  // Variant 4: List format
  if (sentences.length >= 2) {
    const listed = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
    variants.push(listed);
  }

  // Variant 5: Thread/story format
  if (sentences.length >= 2) {
    variants.push(
      `Thread:\n\n${sentences.map((s) => s + '.').join('\n\n')}`,
    );
  }

  // Variant 6: Call to action
  if (sentences.length > 0) {
    variants.push(
      `${sentences.join('. ')}.\n\nWhat do you think? Share your thoughts below.`,
    );
  }

  // Variant 7: Concise
  if (sentences.length > 0) {
    variants.push(sentences[0]! + '.');
  }

  return variants.slice(0, Math.max(1, count));
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function socialDraft(
  content: string,
  platforms: string[],
): Promise<{ drafts: PlatformDraft[] }> {
  if (!content || content.trim().length === 0) {
    throw new Error('Content is required');
  }
  if (!platforms || platforms.length === 0) {
    throw new Error('At least one platform is required');
  }

  const drafts: PlatformDraft[] = [];

  for (const platform of platforms) {
    const key = platform.toLowerCase().replace(/\s+/g, '');
    const config = PLATFORM_CONFIGS[key];

    if (!config) {
      // Use generic config for unknown platforms
      drafts.push({
        platform: platform,
        content: content.trim(),
        charCount: content.trim().length,
        charLimit: 5000,
        withinLimit: content.trim().length <= 5000,
        hashtags: generateHashtags(content, 5),
        tips: [`Unknown platform "${platform}" — using generic formatting`],
      });
      continue;
    }

    drafts.push(adaptForPlatform(content, config));
  }

  return { drafts };
}

async function socialVariants(
  draft: string,
  count: number = 3,
): Promise<{ variants: string[] }> {
  if (!draft || draft.trim().length === 0) {
    throw new Error('Draft content is required');
  }

  const clampedCount = Math.min(Math.max(1, count), 10);
  const variants = generateVariants(draft.trim(), clampedCount);

  return { variants };
}

async function socialSchedule(
  draft: string,
  datetime: string,
): Promise<{ id: string; scheduledFor: string; warning?: string }> {
  if (!draft || draft.trim().length === 0) {
    throw new Error('Draft content is required');
  }

  const scheduledDate = new Date(datetime);
  if (isNaN(scheduledDate.getTime())) {
    throw new Error(`Invalid datetime: ${datetime}. Use ISO format (YYYY-MM-DDTHH:mm:ss).`);
  }

  let warning: string | undefined;
  if (scheduledDate.getTime() < Date.now()) {
    // Suggest next day at same time
    const nextDay = new Date(scheduledDate);
    nextDay.setDate(nextDay.getDate() + 1);
    warning = `Datetime is in the past. Consider scheduling for ${nextDay.toISOString()} instead.`;
  }

  const posts = loadScheduled();
  const post: ScheduledPost = {
    id: generateId(),
    content: draft.trim(),
    platform: 'general',
    scheduledFor: scheduledDate.toISOString(),
    createdAt: Date.now(),
    status: 'scheduled',
  };

  posts.push(post);
  saveScheduled(posts);

  const result: { id: string; scheduledFor: string; warning?: string } = {
    id: post.id,
    scheduledFor: post.scheduledFor,
  };

  if (warning) result.warning = warning;

  return result;
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'social-drafter';
export const description = 'Draft platform-specific social media posts with formatting and variants';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'social_draft',
    description: 'Draft social media posts adapted for specific platforms',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to adapt for social media' },
        platforms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target platforms: x, linkedin, instagram, facebook, mastodon, threads, bluesky',
        },
      },
      required: ['content', 'platforms'],
    },
  },
  {
    name: 'social_variants',
    description: 'Generate alternative versions of a social media draft',
    parameters: {
      type: 'object',
      properties: {
        draft: { type: 'string', description: 'Original draft to create variants of' },
        count: { type: 'number', description: 'Number of variants to generate (1-10, default: 3)' },
      },
      required: ['draft'],
    },
  },
  {
    name: 'social_schedule',
    description: 'Schedule a social media post for later publishing',
    parameters: {
      type: 'object',
      properties: {
        draft: { type: 'string', description: 'Post content' },
        datetime: { type: 'string', description: 'Publish time (ISO format)' },
      },
      required: ['draft', 'datetime'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'social_draft':
      return socialDraft(args.content as string, args.platforms as string[]);
    case 'social_variants':
      return socialVariants(args.draft as string, (args.count as number) ?? 3);
    case 'social_schedule':
      return socialSchedule(args.draft as string, args.datetime as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
