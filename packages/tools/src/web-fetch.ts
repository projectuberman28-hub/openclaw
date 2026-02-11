/**
 * @alfred/tools - WebFetchTool
 *
 * Fetch web page content with:
 *   - SSRF guard on URL before fetching
 *   - HTML-to-text conversion (regex + entity decode)
 *   - Optional CSS selector extraction
 *   - Truncation to maxChars (default 50 000)
 *   - Redirect following (max 5 hops)
 *   - 30 s timeout
 */

import { isUrlSafe } from '@alfred/core/security/ssrf-guard';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:web-fetch' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebFetchArgs {
  /** URL to fetch. */
  url: string;
  /** Optional CSS selector to narrow extraction (basic matching). */
  selector?: string;
  /** Max characters to return. Default 50 000. */
  maxChars?: number;
}

export interface WebFetchResult {
  content: string;
  title: string;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// HTML processing
// ---------------------------------------------------------------------------

/** Decode common HTML entities. */
function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Strip HTML tags and convert to readable text. */
function htmlToText(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Convert block-level elements to newlines
  text = text.replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr|blockquote)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode entities
  text = decodeEntities(text);

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

/** Extract title from HTML. */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeEntities(match[1].replace(/<[^>]+>/g, '').trim());
}

/** Very basic CSS selector extraction (id, class, tag). */
function extractBySelector(html: string, selector: string): string {
  let pattern: RegExp;

  if (selector.startsWith('#')) {
    // ID selector
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)(?=<\\/[^>]+>\\s*$)`, 'i');
  } else if (selector.startsWith('.')) {
    // Class selector
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(
      `<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)(?=<\\/[^>]+>)`,
      'i',
    );
  } else {
    // Tag selector
    const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  }

  const matches: string[] = [];
  let match: RegExpExecArray | null;

  // For global regex, collect all matches
  if (pattern.global) {
    while ((match = pattern.exec(html)) !== null) {
      matches.push(match[1]);
    }
  } else {
    match = pattern.exec(html);
    if (match) matches.push(match[1]);
  }

  return matches.join('\n\n');
}

// ---------------------------------------------------------------------------
// WebFetchTool
// ---------------------------------------------------------------------------

export class WebFetchTool {
  private executor: SafeExecutor;

  constructor(executor: SafeExecutor) {
    this.executor = executor;
  }

  static definition = {
    name: 'web_fetch',
    description:
      'Fetch a web page and return its text content. ' +
      'Optionally provide a CSS selector to narrow extraction.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        selector: { type: 'string', description: 'CSS selector to extract (optional)' },
        maxChars: { type: 'number', description: 'Max characters to return (default 50000)' },
      },
      required: ['url'],
    },
  };

  /**
   * Fetch a web page and return cleaned text content.
   */
  async fetch(args: WebFetchArgs, execOpts?: ExecuteOptions): Promise<WebFetchResult> {
    if (!args.url || typeof args.url !== 'string') {
      throw new Error('WebFetchTool: "url" is required');
    }

    const maxChars = args.maxChars ?? 50_000;

    const result = await this.executor.execute(
      'web_fetch',
      () => this.doFetch(args.url, args.selector, maxChars),
      { timeout: 30_000, ...execOpts },
    );

    if (result.error) {
      return { content: result.error, title: '', statusCode: 0 };
    }

    return result.result as WebFetchResult;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async doFetch(
    url: string,
    selector: string | undefined,
    maxChars: number,
  ): Promise<WebFetchResult> {
    // SSRF guard
    const safe = await isUrlSafe(url);
    if (!safe) {
      throw new Error(`URL blocked by SSRF guard: ${url}`);
    }

    // Follow redirects manually to cap at 5 hops
    let currentUrl = url;
    let resp: Response | undefined;
    let redirectCount = 0;
    const maxRedirects = 5;

    while (redirectCount < maxRedirects) {
      resp = await fetch(currentUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AlfredBot/3.0; +https://github.com/alfred)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location) break;

        // Resolve relative redirects
        currentUrl = new URL(location, currentUrl).href;

        // SSRF guard on redirect target
        const redirectSafe = await isUrlSafe(currentUrl);
        if (!redirectSafe) {
          throw new Error(`Redirect target blocked by SSRF guard: ${currentUrl}`);
        }

        redirectCount++;
        continue;
      }

      break;
    }

    if (!resp) {
      throw new Error('No response received');
    }

    const statusCode = resp.status;
    const contentType = resp.headers.get('content-type') ?? '';

    // For non-HTML content, return raw text
    if (!contentType.includes('html') && !contentType.includes('xml')) {
      const text = await resp.text();
      return {
        content: text.slice(0, maxChars),
        title: '',
        statusCode,
      };
    }

    const html = await resp.text();
    const title = extractTitle(html);

    // Apply selector if provided
    let targetHtml = html;
    if (selector) {
      const extracted = extractBySelector(html, selector);
      if (extracted) {
        targetHtml = extracted;
      }
    }

    // Convert to text
    let content = htmlToText(targetHtml);

    // Truncate
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + '\n\n[Truncated]';
    }

    return { content, title, statusCode };
  }
}
