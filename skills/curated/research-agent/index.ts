/**
 * @alfred/skill-research-agent
 *
 * Multi-query web search with synthesis and citation tracking.
 * Generates search queries, fetches results, extracts content, and produces cited summaries.
 */

import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResearchDepth = 'quick' | 'deep';

interface Source {
  title: string;
  url: string;
  snippet: string;
  relevanceScore: number;
}

interface ResearchResult {
  topic: string;
  summary: string;
  sources: Source[];
  queryCount: number;
  depth: ResearchDepth;
}

interface ComparisonRow {
  aspect: string;
  values: Record<string, string>;
}

interface ComparisonResult {
  topics: string[];
  comparison: ComparisonRow[];
  sources: Source[];
}

interface Citation {
  claim: string;
  support: 'supports' | 'refutes' | 'neutral';
  source: Source;
  excerpt: string;
}

interface CitationResult {
  claim: string;
  citations: Citation[];
  verdict: 'supported' | 'refuted' | 'mixed' | 'insufficient-evidence';
}

// ---------------------------------------------------------------------------
// Search engine interface
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Perform a web search using DuckDuckGo HTML API.
 */
async function webSearch(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);

  // Use DuckDuckGo HTML (no API key needed)
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoResults(html);
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Extract result entries from DDG HTML results
  const resultPattern =
    /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) !== null) {
    const rawUrl = match[1] ?? '';
    const title = stripHtml(match[2] ?? '');
    const snippet = stripHtml(match[3] ?? '');

    // DDG wraps URLs — extract actual URL
    const urlMatch = rawUrl.match(/uddg=([^&]+)/);
    const url = urlMatch ? decodeURIComponent(urlMatch[1]!) : rawUrl;

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  // Fallback: simpler pattern for result links
  if (results.length === 0) {
    const simpleLinkPattern =
      /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    while ((match = simpleLinkPattern.exec(html)) !== null && results.length < 10) {
      const url = match[1]!;
      const title = match[2]!.trim();
      if (
        title.length > 5 &&
        !url.includes('duckduckgo.com') &&
        !url.includes('duck.co')
      ) {
        results.push({ title, url, snippet: '' });
      }
    }
  }

  return results.slice(0, 10);
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Alfred/3.0 ResearchAgent', Accept: 'text/html' },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return '';

    const html = await response.text();
    return extractReadableContent(html);
  } catch {
    return '';
  }
}

function extractReadableContent(html: string): string {
  // Remove script, style, nav, header, footer tags
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Try to extract article or main content
  const articleMatch = cleaned.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  const mainMatch = cleaned.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  const contentMatch = cleaned.match(/<div[^>]+(?:class|id)="[^"]*(?:content|article|post)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const content = articleMatch?.[1] ?? mainMatch?.[1] ?? contentMatch?.[1] ?? cleaned;

  // Strip remaining HTML tags and normalize whitespace
  return stripHtml(content)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000); // Cap at 5000 chars per page
}

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

function generateQueries(topic: string, depth: ResearchDepth): string[] {
  const baseQueries = [topic];

  // Generate varied queries for better coverage
  const perspectives = [
    `${topic} overview explanation`,
    `${topic} latest developments 2024 2025`,
    `${topic} pros and cons analysis`,
  ];

  if (depth === 'deep') {
    perspectives.push(
      `${topic} research studies`,
      `${topic} expert opinions`,
      `${topic} statistics data`,
      `${topic} comparison alternatives`,
      `${topic} future trends predictions`,
      `${topic} challenges problems`,
      `${topic} best practices recommendations`,
    );
  }

  const limit = depth === 'quick' ? 3 : 10;
  return [...baseQueries, ...perspectives].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

function synthesizeSources(
  topic: string,
  sources: Source[],
  contentMap: Map<string, string>,
): string {
  if (sources.length === 0) {
    return `No search results found for "${topic}". Try rephrasing the query.`;
  }

  const sections: string[] = [];
  sections.push(`# Research: ${topic}\n`);

  // Group content by theme using simple keyword clustering
  const keyPoints: Array<{ text: string; sourceIdx: number }> = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const content = contentMap.get(source.url) || source.snippet;

    if (content) {
      // Extract key sentences
      const sentences = content
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 30 && s.length < 300);

      for (const sentence of sentences.slice(0, 3)) {
        keyPoints.push({ text: sentence, sourceIdx: i + 1 });
      }
    }
  }

  // Build summary with citations
  if (keyPoints.length > 0) {
    sections.push('## Key Findings\n');
    const usedPoints = new Set<string>();

    for (const point of keyPoints.slice(0, 15)) {
      const normalized = point.text.toLowerCase().slice(0, 50);
      if (!usedPoints.has(normalized)) {
        usedPoints.add(normalized);
        sections.push(`- ${point.text} [${point.sourceIdx}]`);
      }
    }
  }

  // Add sources section
  sections.push('\n## Sources\n');
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    sections.push(`[${i + 1}] ${source.title} — ${source.url}`);
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreRelevance(source: SearchResult, topic: string): number {
  const topicWords = topic.toLowerCase().split(/\s+/);
  const textToScore = `${source.title} ${source.snippet}`.toLowerCase();

  let score = 0;
  for (const word of topicWords) {
    if (word.length > 2 && textToScore.includes(word)) {
      score += 1;
    }
  }

  // Normalize by topic word count
  return Math.min(1, score / Math.max(1, topicWords.length));
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function research(topic: string, depth: ResearchDepth = 'quick'): Promise<ResearchResult> {
  const queries = generateQueries(topic, depth);
  const allResults: SearchResult[] = [];

  for (let i = 0; i < queries.length; i++) {
    try {
      const results = await webSearch(queries[i]!);
      allResults.push(...results);
    } catch {
      // Continue with other queries
    }

    // Rate limit: 500ms between searches
    if (i < queries.length - 1) {
      await delay(500);
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Score and sort by relevance
  const scored: Source[] = uniqueResults.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    relevanceScore: scoreRelevance(r, topic),
  }));
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topSources = scored.slice(0, 10);

  // Fetch content from top sources
  const contentMap = new Map<string, string>();
  const contentPromises = topSources.slice(0, 5).map(async (source) => {
    const content = await fetchPageContent(source.url);
    if (content) contentMap.set(source.url, content);
  });
  await Promise.all(contentPromises);

  const summary = synthesizeSources(topic, topSources, contentMap);

  return {
    topic,
    summary,
    sources: topSources,
    queryCount: queries.length,
    depth,
  };
}

async function researchCompare(topics: string[]): Promise<ComparisonResult> {
  if (topics.length < 2) {
    throw new Error('At least 2 topics are required for comparison');
  }
  if (topics.length > 5) {
    throw new Error('Maximum 5 topics for comparison');
  }

  const allSources: Source[] = [];
  const topicData = new Map<string, Source[]>();

  // Research each topic
  for (const topic of topics) {
    const result = await research(topic, 'quick');
    topicData.set(topic, result.sources);
    allSources.push(...result.sources);
    await delay(300);
  }

  // Generate comparison aspects
  const aspects = [
    'Definition',
    'Key Features',
    'Advantages',
    'Disadvantages',
    'Use Cases',
    'Cost / Pricing',
    'Community / Ecosystem',
  ];

  const comparison: ComparisonRow[] = aspects.map((aspect) => {
    const values: Record<string, string> = {};
    for (const topic of topics) {
      const sources = topicData.get(topic) ?? [];
      // Extract aspect-related content from snippets
      const relevant = sources
        .filter((s) => {
          const text = `${s.title} ${s.snippet}`.toLowerCase();
          return text.includes(aspect.toLowerCase()) || text.includes(topic.toLowerCase());
        })
        .map((s) => s.snippet)
        .filter(Boolean);

      values[topic] = relevant[0] ?? `(No specific data found for ${aspect.toLowerCase()})`;
    }
    return { aspect, values };
  });

  return {
    topics,
    comparison,
    sources: allSources.slice(0, 20),
  };
}

async function researchCite(claim: string): Promise<CitationResult> {
  // Generate queries to verify the claim
  const verifyQueries = [
    claim,
    `"${claim}" evidence`,
    `${claim} fact check`,
  ];

  const allResults: SearchResult[] = [];
  for (const query of verifyQueries) {
    try {
      const results = await webSearch(query);
      allResults.push(...results);
    } catch {
      // Continue
    }
    await delay(500);
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Analyze each result for support/refutation
  const citations: Citation[] = [];

  for (const result of unique.slice(0, 8)) {
    const content = await fetchPageContent(result.url);
    const text = content || result.snippet;

    if (!text) continue;

    const support = assessSupport(claim, text);

    citations.push({
      claim,
      support,
      source: {
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        relevanceScore: scoreRelevance(result, claim),
      },
      excerpt: text.slice(0, 200),
    });
  }

  // Determine verdict
  const supports = citations.filter((c) => c.support === 'supports').length;
  const refutes = citations.filter((c) => c.support === 'refutes').length;

  let verdict: CitationResult['verdict'];
  if (citations.length === 0) {
    verdict = 'insufficient-evidence';
  } else if (supports > refutes * 2) {
    verdict = 'supported';
  } else if (refutes > supports * 2) {
    verdict = 'refuted';
  } else {
    verdict = 'mixed';
  }

  return { claim, citations, verdict };
}

/**
 * Simple heuristic to assess whether content supports or refutes a claim.
 */
function assessSupport(claim: string, content: string): 'supports' | 'refutes' | 'neutral' {
  const lower = content.toLowerCase();
  const claimWords = claim.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  // Check how many claim words appear in content
  const matchCount = claimWords.filter((w) => lower.includes(w)).length;
  const matchRatio = matchCount / Math.max(1, claimWords.length);

  if (matchRatio < 0.3) return 'neutral';

  // Look for negation words near claim keywords
  const negationPatterns = [
    /\bnot\b/i, /\bfalse\b/i, /\bincorrect\b/i, /\bwrong\b/i,
    /\bmyth\b/i, /\bdisproven\b/i, /\bcontrary\b/i, /\bhowever\b/i,
    /\bdebunked\b/i, /\buntrue\b/i, /\bmisconception\b/i,
  ];

  const hasNegation = negationPatterns.some((p) => p.test(lower));
  const hasConfirmation = /\btrue\b|\bcorrect\b|\bconfirmed\b|\bproven\b|\bevidence shows\b/i.test(lower);

  if (hasNegation && !hasConfirmation) return 'refutes';
  if (hasConfirmation && !hasNegation) return 'supports';
  if (matchRatio > 0.5) return 'supports';

  return 'neutral';
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'research-agent';
export const description = 'Multi-query web search with synthesis and citation tracking';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'research',
    description: 'Research a topic using multiple web queries and synthesize results',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic to research' },
        depth: {
          type: 'string',
          enum: ['quick', 'deep'],
          description: 'Research depth: quick (3 queries) or deep (10 queries)',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'research_compare',
    description: 'Compare multiple topics side-by-side',
    parameters: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Topics to compare (2-5)',
        },
      },
      required: ['topics'],
    },
  },
  {
    name: 'research_cite',
    description: 'Find citations supporting or refuting a claim',
    parameters: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'Claim to verify' },
      },
      required: ['claim'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'research':
      return research(args.topic as string, (args.depth as ResearchDepth) ?? 'quick');
    case 'research_compare':
      return researchCompare(args.topics as string[]);
    case 'research_cite':
      return researchCite(args.claim as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
