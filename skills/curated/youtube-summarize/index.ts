/**
 * @alfred/skill-youtube-summarize
 *
 * Fetch YouTube video transcripts and generate timestamped summaries.
 * Uses YouTube innertube API for transcript extraction with yt-dlp fallback.
 */

import { execSync } from 'node:child_process';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptSegment {
  text: string;
  start: number; // seconds
  duration: number;
}

interface Chapter {
  title: string;
  start: number; // seconds
  startFormatted: string;
}

type SummaryStyle = 'brief' | 'detailed' | 'bullets' | 'chapters';

interface SummaryResult {
  videoId: string;
  title: string;
  summary: string;
  style: SummaryStyle;
  segmentCount: number;
  estimatedDuration: string;
}

// ---------------------------------------------------------------------------
// Video ID extraction
// ---------------------------------------------------------------------------

function extractVideoId(url: string): string {
  // Handle various YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Maybe it's already a video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

  throw new Error(`Could not extract video ID from: ${url}`);
}

// ---------------------------------------------------------------------------
// Transcript fetching via YouTube innertube API
// ---------------------------------------------------------------------------

async function fetchTranscriptFromYouTube(videoId: string): Promise<TranscriptSegment[]> {
  // Fetch the video page to get initial player data
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResponse = await fetch(pageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch video page: HTTP ${pageResponse.status}`);
  }

  const html = await pageResponse.text();

  // Extract captions track URL from ytInitialPlayerResponse
  const playerResponseMatch = html.match(
    /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|<\/script>)/,
  );

  if (!playerResponseMatch?.[1]) {
    throw new Error('Could not find player response data');
  }

  let playerData: any;
  try {
    playerData = JSON.parse(playerResponseMatch[1]);
  } catch {
    throw new Error('Failed to parse player response JSON');
  }

  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No captions available for this video');
  }

  // Prefer English, then first available
  const englishTrack = captionTracks.find(
    (t: any) => t.languageCode === 'en' || t.languageCode?.startsWith('en'),
  );
  const track = englishTrack ?? captionTracks[0];
  const captionUrl = track.baseUrl;

  if (!captionUrl) {
    throw new Error('Caption track has no URL');
  }

  // Fetch the transcript XML
  const captionResponse = await fetch(`${captionUrl}&fmt=json3`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!captionResponse.ok) {
    // Try XML format as fallback
    return fetchTranscriptXml(captionUrl);
  }

  const captionData: any = await captionResponse.json();

  if (!captionData?.events) {
    throw new Error('No transcript events in caption data');
  }

  const segments: TranscriptSegment[] = [];

  for (const event of captionData.events) {
    if (event.segs) {
      const text = event.segs.map((s: any) => s.utf8 ?? '').join('').trim();
      if (text) {
        segments.push({
          text,
          start: (event.tStartMs ?? 0) / 1000,
          duration: (event.dDurationMs ?? 0) / 1000,
        });
      }
    }
  }

  return segments;
}

async function fetchTranscriptXml(captionUrl: string): Promise<TranscriptSegment[]> {
  const response = await fetch(captionUrl, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch caption XML: HTTP ${response.status}`);
  }

  const xml = await response.text();
  const segments: TranscriptSegment[] = [];

  // Parse XML transcript: <text start="0.0" dur="3.5">Hello world</text>
  const textRegex = /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;

  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeHtmlEntities(match[3]!.trim());
    if (text) {
      segments.push({
        text,
        start: parseFloat(match[1]!),
        duration: parseFloat(match[2]!),
      });
    }
  }

  return segments;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '');
}

// ---------------------------------------------------------------------------
// yt-dlp fallback
// ---------------------------------------------------------------------------

function fetchTranscriptViaDlp(videoId: string): TranscriptSegment[] {
  try {
    const result = execSync(
      `yt-dlp --write-auto-sub --sub-lang en --skip-download --print-json "https://www.youtube.com/watch?v=${videoId}"`,
      { timeout: 30_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const data = JSON.parse(result);
    if (data.subtitles?.en || data.automatic_captions?.en) {
      const subs = data.subtitles?.en ?? data.automatic_captions?.en;
      // Parse VTT format
      return parseVttSubtitles(subs);
    }

    return [];
  } catch {
    throw new Error('yt-dlp is not available or failed to extract transcript');
  }
}

function parseVttSubtitles(subs: any[]): TranscriptSegment[] {
  // yt-dlp returns subtitle track metadata; actual parsing would need the VTT file
  if (!subs || subs.length === 0) return [];

  const segments: TranscriptSegment[] = [];
  for (const sub of subs) {
    if (sub.text) {
      segments.push({
        text: sub.text,
        start: sub.start ?? 0,
        duration: sub.duration ?? 0,
      });
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  if (titleMatch?.[1]) {
    return titleMatch[1].replace(/ - YouTube$/, '').trim();
  }
  return 'Unknown Title';
}

async function getVideoTitle(videoId: string): Promise<string> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const html = await response.text();
      return extractTitle(html);
    }
  } catch {
    // ignore
  }
  return `Video ${videoId}`;
}

// ---------------------------------------------------------------------------
// Chapter extraction
// ---------------------------------------------------------------------------

async function extractChapters(videoId: string): Promise<Chapter[]> {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch video page: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Look for chapters in the description or playerResponse
  const chapters: Chapter[] = [];

  // Pattern: "0:00 Introduction\n1:23 Topic One"
  const chapterPattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/g;

  // Try to find chapters in description
  const descMatch = html.match(/"description":\s*\{[^}]*"simpleText":\s*"([^"]+)"/);
  if (descMatch?.[1]) {
    const desc = descMatch[1].replace(/\\n/g, '\n');
    let match: RegExpExecArray | null;
    while ((match = chapterPattern.exec(desc)) !== null) {
      const timeStr = match[1]!;
      const title = match[2]!.trim();
      chapters.push({
        title,
        start: parseTimestamp(timeStr),
        startFormatted: timeStr,
      });
    }
  }

  // Also check for engagementPanels chapter data
  const chaptersMatch = html.match(
    /"chapterRenderer":\s*\{[^}]*"title":\s*\{[^}]*"simpleText":\s*"([^"]+)"/g,
  );
  if (chaptersMatch && chapters.length === 0) {
    for (const cm of chaptersMatch) {
      const titleMatch = cm.match(/"simpleText":\s*"([^"]+)"/);
      if (titleMatch?.[1]) {
        chapters.push({
          title: titleMatch[1],
          start: 0,
          startFormatted: '0:00',
        });
      }
    }
  }

  return chapters;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  return parts[0]! * 60 + parts[1]!;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

function generateSummary(
  segments: TranscriptSegment[],
  style: SummaryStyle,
  chapters: Chapter[],
): string {
  if (segments.length === 0) {
    return 'No transcript content available to summarize.';
  }

  const fullText = segments.map((s) => s.text).join(' ');
  const totalDuration = segments[segments.length - 1]!.start + segments[segments.length - 1]!.duration;

  switch (style) {
    case 'brief':
      return generateBriefSummary(segments, totalDuration);
    case 'detailed':
      return generateDetailedSummary(segments, totalDuration);
    case 'bullets':
      return generateBulletSummary(segments, totalDuration);
    case 'chapters':
      return generateChapterSummary(segments, chapters, totalDuration);
    default:
      return generateBriefSummary(segments, totalDuration);
  }
}

function generateBriefSummary(segments: TranscriptSegment[], duration: number): string {
  // Group into ~5 equal time sections
  const sectionCount = Math.min(5, Math.ceil(segments.length / 10));
  const sectionDuration = duration / sectionCount;
  const sections: string[] = [];

  for (let i = 0; i < sectionCount; i++) {
    const startTime = i * sectionDuration;
    const endTime = (i + 1) * sectionDuration;
    const sectionSegments = segments.filter(
      (s) => s.start >= startTime && s.start < endTime,
    );
    const sectionText = sectionSegments.map((s) => s.text).join(' ');

    // Extract key sentences (first and most content-rich)
    const sentences = sectionText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    if (sentences.length > 0) {
      sections.push(
        `[${formatTimestamp(startTime)}] ${sentences[0]}${sentences.length > 1 ? '...' : ''}`,
      );
    }
  }

  return sections.join('\n\n');
}

function generateDetailedSummary(segments: TranscriptSegment[], duration: number): string {
  const sectionCount = Math.min(10, Math.ceil(segments.length / 5));
  const sectionDuration = duration / sectionCount;
  const sections: string[] = [];

  for (let i = 0; i < sectionCount; i++) {
    const startTime = i * sectionDuration;
    const endTime = (i + 1) * sectionDuration;
    const sectionSegments = segments.filter(
      (s) => s.start >= startTime && s.start < endTime,
    );
    const sectionText = sectionSegments.map((s) => s.text).join(' ');

    const sentences = sectionText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

    const topSentences = sentences.slice(0, 3).join('. ');

    if (topSentences) {
      sections.push(`### ${formatTimestamp(startTime)} - ${formatTimestamp(endTime)}\n${topSentences}.`);
    }
  }

  return sections.join('\n\n');
}

function generateBulletSummary(segments: TranscriptSegment[], duration: number): string {
  const sectionCount = Math.min(15, Math.ceil(segments.length / 5));
  const sectionDuration = duration / sectionCount;
  const bullets: string[] = [];

  for (let i = 0; i < sectionCount; i++) {
    const startTime = i * sectionDuration;
    const endTime = (i + 1) * sectionDuration;
    const sectionSegments = segments.filter(
      (s) => s.start >= startTime && s.start < endTime,
    );
    const sectionText = sectionSegments.map((s) => s.text).join(' ');

    const sentences = sectionText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

    if (sentences[0]) {
      bullets.push(`- [${formatTimestamp(startTime)}] ${sentences[0]}`);
    }
  }

  return bullets.join('\n');
}

function generateChapterSummary(
  segments: TranscriptSegment[],
  chapters: Chapter[],
  duration: number,
): string {
  if (chapters.length === 0) {
    // No chapters available — fall back to auto-segmentation
    return `*No chapters detected — auto-segmenting:*\n\n${generateDetailedSummary(segments, duration)}`;
  }

  const sections: string[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const nextStart = i + 1 < chapters.length ? chapters[i + 1]!.start : duration;

    const chapterSegments = segments.filter(
      (s) => s.start >= chapter.start && s.start < nextStart,
    );
    const chapterText = chapterSegments.map((s) => s.text).join(' ');

    const sentences = chapterText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

    const summary = sentences.slice(0, 3).join('. ');

    sections.push(
      `### ${chapter.startFormatted} — ${chapter.title}\n${summary || '(no transcript content)'}`,
    );
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function youtubeSummarize(
  url: string,
  style: SummaryStyle = 'brief',
): Promise<SummaryResult> {
  const videoId = extractVideoId(url);
  let segments: TranscriptSegment[];

  try {
    segments = await fetchTranscriptFromYouTube(videoId);
  } catch {
    // Fallback to yt-dlp
    try {
      segments = fetchTranscriptViaDlp(videoId);
    } catch {
      throw new Error(
        'Could not fetch transcript. Video may not have captions, or both YouTube API and yt-dlp failed.',
      );
    }
  }

  const title = await getVideoTitle(videoId);
  const chapters = style === 'chapters' ? await extractChapters(videoId) : [];
  const summary = generateSummary(segments, style, chapters);

  const totalSeconds =
    segments.length > 0
      ? segments[segments.length - 1]!.start + segments[segments.length - 1]!.duration
      : 0;

  return {
    videoId,
    title,
    summary,
    style,
    segmentCount: segments.length,
    estimatedDuration: formatDuration(totalSeconds),
  };
}

async function youtubeTranscript(
  url: string,
): Promise<{ videoId: string; segments: TranscriptSegment[] }> {
  const videoId = extractVideoId(url);
  let segments: TranscriptSegment[];

  try {
    segments = await fetchTranscriptFromYouTube(videoId);
  } catch {
    try {
      segments = fetchTranscriptViaDlp(videoId);
    } catch {
      throw new Error('Could not fetch transcript from any source.');
    }
  }

  return { videoId, segments };
}

async function youtubeChapters(
  url: string,
): Promise<{ videoId: string; chapters: Chapter[] }> {
  const videoId = extractVideoId(url);
  const chapters = await extractChapters(videoId);
  return { videoId, chapters };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'youtube-summarize';
export const description =
  'Fetch YouTube video transcripts and generate timestamped summaries';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'youtube_summarize',
    description: 'Generate a summary of a YouTube video from its transcript',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube video URL or ID' },
        style: {
          type: 'string',
          enum: ['brief', 'detailed', 'bullets', 'chapters'],
          description: 'Summary style (default: brief)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'youtube_transcript',
    description: 'Get the raw transcript with timestamps for a YouTube video',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube video URL or ID' },
      },
      required: ['url'],
    },
  },
  {
    name: 'youtube_chapters',
    description: 'Extract chapter markers from a YouTube video',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube video URL or ID' },
      },
      required: ['url'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'youtube_summarize':
      return youtubeSummarize(args.url as string, (args.style as SummaryStyle) ?? 'brief');
    case 'youtube_transcript':
      return youtubeTranscript(args.url as string);
    case 'youtube_chapters':
      return youtubeChapters(args.url as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
