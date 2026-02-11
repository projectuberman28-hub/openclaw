/**
 * @alfred/tools - WebSearchTool
 *
 * Search the web with a fallback chain:
 *   1. SearXNG  (local, HTTP GET to localhost:8888)
 *   2. Grok/xAI (POST to xai API with inline citations)
 *   3. Brave    (POST to api.search.brave.com)
 *   4. DuckDuckGo scrape (HTML scrape as last resort)
 *
 * All URLs are validated through the SSRF guard from @alfred/core.
 * Perplexity model IDs are normalised; OpenRouter IDs are kept as-is.
 */

import { isUrlSafe } from '@alfred/core/security/ssrf-guard';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:web-search' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebSearchArgs {
  query: string;
  count?: number;
}

export interface WebSearchConfig {
  /** SearXNG base URL. Default http://localhost:8888 */
  searxngUrl?: string;
  /** xAI / Grok API key. */
  xaiApiKey?: string;
  /** xAI base URL. */
  xaiBaseUrl?: string;
  /** Brave Search API key. */
  braveApiKey?: string;
  /** Provider cache key for Grok. */
  grokCacheKey?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise Perplexity model IDs (e.g. "pplx-70b-online" -> "perplexity/pplx-70b-online"). */
function normaliseModelId(id: string): string {
  if (id.startsWith('pplx-')) {
    return `perplexity/${id}`;
  }
  // OpenRouter and others: keep unchanged
  return id;
}

/** Basic HTML entity decode. */
function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

/** Strip HTML tags for snippet cleaning. */
function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

export class WebSearchTool {
  private executor: SafeExecutor;
  private searxngUrl: string;
  private xaiApiKey: string;
  private xaiBaseUrl: string;
  private braveApiKey: string;
  private grokCacheKey: string;

  constructor(executor: SafeExecutor, config: WebSearchConfig = {}) {
    this.executor = executor;
    this.searxngUrl = config.searxngUrl ?? 'http://localhost:8888';
    this.xaiApiKey = config.xaiApiKey ?? process.env['XAI_API_KEY'] ?? '';
    this.xaiBaseUrl = config.xaiBaseUrl ?? 'https://api.x.ai/v1';
    this.braveApiKey = config.braveApiKey ?? process.env['BRAVE_SEARCH_API_KEY'] ?? '';
    this.grokCacheKey = config.grokCacheKey ?? '';
  }

  static definition = {
    name: 'web_search',
    description:
      'Search the web for information. Returns a list of results with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  };

  /**
   * Run a web search with the fallback chain.
   */
  async search(args: WebSearchArgs, execOpts?: ExecuteOptions): Promise<SearchResult[]> {
    if (!args.query || typeof args.query !== 'string') {
      throw new Error('WebSearchTool: "query" is required');
    }

    const count = args.count ?? 10;
    const result = await this.executor.execute(
      'web_search',
      () => this.searchWithFallback(args.query, count),
      { timeout: 30_000, ...execOpts },
    );

    if (result.error) {
      logger.error({ error: result.error }, 'All search providers failed');
      return [];
    }

    return result.result as SearchResult[];
  }

  // -----------------------------------------------------------------------
  // Fallback chain
  // -----------------------------------------------------------------------

  private async searchWithFallback(query: string, count: number): Promise<SearchResult[]> {
    const errors: string[] = [];

    // 1. SearXNG
    try {
      const results = await this.searchSearXNG(query, count);
      if (results.length > 0) return results;
    } catch (err) {
      errors.push(`SearXNG: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Grok / xAI
    if (this.xaiApiKey) {
      try {
        const results = await this.searchGrok(query, count);
        if (results.length > 0) return results;
      } catch (err) {
        errors.push(`Grok: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Brave
    if (this.braveApiKey) {
      try {
        const results = await this.searchBrave(query, count);
        if (results.length > 0) return results;
      } catch (err) {
        errors.push(`Brave: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. DuckDuckGo scrape
    try {
      const results = await this.searchDuckDuckGo(query, count);
      if (results.length > 0) return results;
    } catch (err) {
      errors.push(`DuckDuckGo: ${err instanceof Error ? err.message : String(err)}`);
    }

    logger.warn({ errors }, 'All search providers failed');
    return [];
  }

  // -----------------------------------------------------------------------
  // SearXNG
  // -----------------------------------------------------------------------

  private async searchSearXNG(query: string, count: number): Promise<SearchResult[]> {
    const url = `${this.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;

    // SearXNG on localhost is allowed by SSRF guard
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`SearXNG responded with ${resp.status}`);
    }

    const data = (await resp.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.slice(0, count).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      source: 'searxng',
    }));
  }

  // -----------------------------------------------------------------------
  // Grok / xAI
  // -----------------------------------------------------------------------

  private async searchGrok(query: string, count: number): Promise<SearchResult[]> {
    const apiUrl = `${this.xaiBaseUrl}/chat/completions`;

    // SSRF guard on xAI URL
    if (!(await isUrlSafe(apiUrl))) {
      throw new Error('xAI URL blocked by SSRF guard');
    }

    const body = {
      model: normaliseModelId('grok-3'),
      messages: [
        {
          role: 'user' as const,
          content: `Search the web for: ${query}\n\nReturn the top ${count} results as a JSON array with fields: title, url, snippet. Only return the JSON array, no other text.`,
        },
      ],
      max_tokens: 2048,
      search_parameters: {
        mode: 'auto',
        return_citations: true,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.xaiApiKey}`,
    };

    if (this.grokCacheKey) {
      headers['X-Cache-Key'] = this.grokCacheKey;
    }

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`Grok API responded with ${resp.status}`);
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: Array<{ url?: string; title?: string }>;
    };

    // Try to extract citations first
    if (data.citations && Array.isArray(data.citations) && data.citations.length > 0) {
      return data.citations.slice(0, count).map((c) => ({
        title: c.title ?? '',
        url: c.url ?? '',
        snippet: '',
        source: 'grok',
      }));
    }

    // Fall back to parsing the LLM response as JSON
    const content = data.choices?.[0]?.message?.content ?? '';
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          title?: string;
          url?: string;
          snippet?: string;
        }>;
        return parsed.slice(0, count).map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.snippet ?? '',
          source: 'grok',
        }));
      }
    } catch {
      // Could not parse
    }

    return [];
  }

  // -----------------------------------------------------------------------
  // Brave Search
  // -----------------------------------------------------------------------

  private async searchBrave(query: string, count: number): Promise<SearchResult[]> {
    const apiUrl = 'https://api.search.brave.com/res/v1/web/search';

    if (!(await isUrlSafe(apiUrl))) {
      throw new Error('Brave URL blocked by SSRF guard');
    }

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(count, 20)),
    });

    const resp = await fetch(`${apiUrl}?${params}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.braveApiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`Brave Search responded with ${resp.status}`);
    }

    const data = (await resp.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
        }>;
      };
    };

    if (!data.web?.results) return [];

    return data.web.results.slice(0, count).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
      source: 'brave',
    }));
  }

  // -----------------------------------------------------------------------
  // DuckDuckGo HTML scrape (last resort)
  // -----------------------------------------------------------------------

  private async searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    if (!(await isUrlSafe(url))) {
      throw new Error('DuckDuckGo URL blocked by SSRF guard');
    }

    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`DuckDuckGo responded with ${resp.status}`);
    }

    const html = await resp.text();

    // Parse result blocks from the HTML
    const results: SearchResult[] = [];
    const resultBlocks = html.split(/class="result\s/);

    for (let i = 1; i < resultBlocks.length && results.length < count; i++) {
      const block = resultBlocks[i];

      // Extract title
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleMatch ? stripHtml(titleMatch[1]) : '';

      // Extract URL
      const urlMatch = block.match(/href="([^"]+)"/);
      let resultUrl = urlMatch ? urlMatch[1] : '';
      // DuckDuckGo wraps URLs in a redirect – extract the actual URL
      if (resultUrl.includes('uddg=')) {
        const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          resultUrl = decodeURIComponent(uddgMatch[1]);
        }
      }

      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[at]/);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';

      if (title && resultUrl) {
        results.push({ title, url: resultUrl, snippet, source: 'duckduckgo' });
      }
    }

    return results;
  }
}
