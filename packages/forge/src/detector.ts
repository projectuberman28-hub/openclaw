/**
 * @alfred/forge - Gap Detector
 *
 * Analyzes tool failures and user requests to detect capability gaps.
 * When Alfred can't handle something, the GapDetector figures out
 * what skill is missing and suggests a name + category for it.
 */

import pino from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolFailure {
  toolName: string;
  error: string;
  args: unknown;
  timestamp: Date;
}

export interface UserRequest {
  message: string;
  timestamp: Date;
  wasHandled: boolean;
  missingCapability?: string;
}

export interface CapabilityGap {
  description: string;
  category: string;
  frequency: number;
  confidence: number;
  suggestedName: string;
  examples: string[];
}

export interface GapDetectorConfig {
  /** Minimum number of occurrences before a gap is surfaced (default: 2) */
  minFrequency: number;
  /** Minimum confidence score 0..1 (default: 0.5) */
  minConfidence: number;
  /** Max age in ms for failures/requests to consider (default: 7 days) */
  maxAgeMs: number;
  /** Similarity threshold for grouping failures 0..1 (default: 0.6) */
  similarityThreshold: number;
}

const DEFAULT_CONFIG: GapDetectorConfig = {
  minFrequency: 2,
  minConfidence: 0.5,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  similarityThreshold: 0.6,
};

// ---------------------------------------------------------------------------
// Category keywords for auto-classification
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'file-management': ['file', 'directory', 'folder', 'path', 'rename', 'move', 'copy', 'delete', 'read', 'write', 'fs'],
  'web-automation': ['url', 'http', 'fetch', 'scrape', 'browser', 'page', 'download', 'api', 'request', 'web'],
  'data-processing': ['parse', 'csv', 'json', 'xml', 'transform', 'convert', 'format', 'data', 'extract', 'filter'],
  'communication': ['email', 'message', 'send', 'notify', 'slack', 'discord', 'chat', 'sms', 'webhook'],
  'system': ['process', 'service', 'daemon', 'cron', 'schedule', 'monitor', 'restart', 'kill', 'system', 'os'],
  'media': ['image', 'video', 'audio', 'resize', 'compress', 'encode', 'decode', 'thumbnail', 'media'],
  'database': ['sql', 'query', 'database', 'table', 'insert', 'update', 'migration', 'schema', 'db'],
  'security': ['encrypt', 'decrypt', 'hash', 'token', 'auth', 'password', 'certificate', 'ssl', 'security'],
  'development': ['git', 'build', 'compile', 'test', 'lint', 'deploy', 'docker', 'npm', 'code', 'debug'],
  'ai-ml': ['model', 'train', 'predict', 'classify', 'embed', 'llm', 'prompt', 'generate', 'ai', 'ml'],
};

// ---------------------------------------------------------------------------
// GapDetector
// ---------------------------------------------------------------------------

export class GapDetector {
  private readonly config: GapDetectorConfig;
  private readonly logger: pino.Logger;

  constructor(config: Partial<GapDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = pino({ name: 'forge:detector', level: 'info' });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Main entry point: detect capability gaps from failures, requests,
   * and the list of skills that already exist.
   */
  detect(context: {
    failures: ToolFailure[];
    requests: UserRequest[];
    existingSkills: string[];
  }): CapabilityGap[] {
    const { failures, requests, existingSkills } = context;

    const failureGaps = this.analyzeToolFailures(failures);
    const requestGaps = this.analyzeUserRequests(requests);

    // Merge overlapping gaps
    const merged = this.mergeGaps([...failureGaps, ...requestGaps]);

    // Filter out gaps that match existing skills
    const existingLower = new Set(existingSkills.map((s) => s.toLowerCase()));
    const novel = merged.filter(
      (gap) => !existingLower.has(gap.suggestedName.toLowerCase()),
    );

    // Apply thresholds
    const filtered = novel.filter(
      (gap) =>
        gap.frequency >= this.config.minFrequency &&
        gap.confidence >= this.config.minConfidence,
    );

    // Sort by confidence * frequency (most impactful first)
    filtered.sort((a, b) => b.confidence * b.frequency - a.confidence * a.frequency);

    this.logger.info(
      { total: failureGaps.length + requestGaps.length, merged: merged.length, filtered: filtered.length },
      'Gap detection complete',
    );

    return filtered;
  }

  /**
   * Analyze tool failures to discover missing or broken capabilities.
   * Groups similar failures together, counts frequency, and proposes
   * a skill name for each cluster.
   */
  analyzeToolFailures(failures: ToolFailure[]): CapabilityGap[] {
    const recent = this.filterRecent(failures);
    if (recent.length === 0) return [];

    // Group by tool + normalised error
    const groups = new Map<string, ToolFailure[]>();
    for (const f of recent) {
      const key = this.failureKey(f);
      const arr = groups.get(key) ?? [];
      arr.push(f);
      groups.set(key, arr);
    }

    const gaps: CapabilityGap[] = [];
    for (const [key, items] of groups) {
      const representative = items[0];
      const errorSummary = this.normalizeError(representative.error);
      const category = this.categorize(
        `${representative.toolName} ${errorSummary}`,
      );
      const suggestedName = this.suggestName(
        representative.toolName,
        errorSummary,
      );

      // Confidence: based on how consistently the same failure occurs
      // More failures with same signature => higher confidence
      const confidence = Math.min(1, 0.4 + items.length * 0.15);

      gaps.push({
        description: `Tool "${representative.toolName}" fails with: ${errorSummary}`,
        category,
        frequency: items.length,
        confidence: parseFloat(confidence.toFixed(2)),
        suggestedName,
        examples: items.slice(0, 5).map(
          (f) => `[${f.timestamp.toISOString()}] ${f.toolName}: ${f.error.slice(0, 120)}`,
        ),
      });
    }

    return gaps;
  }

  /**
   * Analyze user requests that were not handled to find missing capabilities.
   * Looks at explicit missingCapability hints and at unhandled request patterns.
   */
  analyzeUserRequests(requests: UserRequest[]): CapabilityGap[] {
    const recent = this.filterRecent(requests);
    const unhandled = recent.filter((r) => !r.wasHandled);
    if (unhandled.length === 0) return [];

    // Group requests by explicit missingCapability first
    const explicitGroups = new Map<string, UserRequest[]>();
    const implicitRequests: UserRequest[] = [];

    for (const r of unhandled) {
      if (r.missingCapability) {
        const key = r.missingCapability.toLowerCase().trim();
        const arr = explicitGroups.get(key) ?? [];
        arr.push(r);
        explicitGroups.set(key, arr);
      } else {
        implicitRequests.push(r);
      }
    }

    const gaps: CapabilityGap[] = [];

    // Explicit gaps (higher confidence)
    for (const [capability, items] of explicitGroups) {
      const category = this.categorize(capability);
      const suggestedName = this.toSkillName(capability);
      gaps.push({
        description: `Users requested missing capability: ${capability}`,
        category,
        frequency: items.length,
        confidence: parseFloat(Math.min(1, 0.6 + items.length * 0.1).toFixed(2)),
        suggestedName,
        examples: items.slice(0, 5).map(
          (r) => `[${r.timestamp.toISOString()}] "${r.message.slice(0, 120)}"`,
        ),
      });
    }

    // Implicit gaps: cluster by keyword similarity
    const clusters = this.clusterRequests(implicitRequests);
    for (const cluster of clusters) {
      const combined = cluster.map((r) => r.message).join(' ');
      const category = this.categorize(combined);
      const keywords = this.extractKeywords(combined);
      const suggestedName = this.toSkillName(keywords.slice(0, 3).join('-'));

      gaps.push({
        description: `Unhandled requests related to: ${keywords.slice(0, 5).join(', ')}`,
        category,
        frequency: cluster.length,
        confidence: parseFloat(Math.min(1, 0.3 + cluster.length * 0.12).toFixed(2)),
        suggestedName,
        examples: cluster.slice(0, 5).map(
          (r) => `[${r.timestamp.toISOString()}] "${r.message.slice(0, 120)}"`,
        ),
      });
    }

    return gaps;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Filter items to only include those within the configured age window. */
  private filterRecent<T extends { timestamp: Date }>(items: T[]): T[] {
    const cutoff = Date.now() - this.config.maxAgeMs;
    return items.filter((i) => i.timestamp.getTime() >= cutoff);
  }

  /** Create a grouping key for a tool failure. */
  private failureKey(f: ToolFailure): string {
    return `${f.toolName}::${this.normalizeError(f.error)}`;
  }

  /** Normalize an error string so small differences collapse. */
  private normalizeError(error: string): string {
    return error
      .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')   // hex ids
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[:\d.]*/g, '<time>') // timestamps
      .replace(/\/[\w/.-]+/g, '<path>')           // file paths
      .replace(/\d+/g, '<n>')                     // numbers
      .trim()
      .toLowerCase()
      .slice(0, 200);
  }

  /** Categorize text into one of the predefined categories. */
  private categorize(text: string): string {
    const lower = text.toLowerCase();
    let bestCategory = 'general';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  /** Suggest a skill name from a tool name and error context. */
  private suggestName(toolName: string, errorContext: string): string {
    // If the error indicates a "not found" scenario, suggest a new provider skill
    if (
      errorContext.includes('not found') ||
      errorContext.includes('not implemented') ||
      errorContext.includes('unsupported')
    ) {
      return this.toSkillName(`${toolName}-provider`);
    }

    // If the error indicates permissions, suggest a permissions skill
    if (
      errorContext.includes('permission') ||
      errorContext.includes('denied') ||
      errorContext.includes('unauthorized')
    ) {
      return this.toSkillName(`${toolName}-auth`);
    }

    // If the error indicates a format or parse issue, suggest a converter
    if (
      errorContext.includes('parse') ||
      errorContext.includes('format') ||
      errorContext.includes('invalid')
    ) {
      return this.toSkillName(`${toolName}-converter`);
    }

    // Generic fallback
    return this.toSkillName(`${toolName}-enhanced`);
  }

  /** Convert an arbitrary string to a valid kebab-case skill name. */
  private toSkillName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 50);
  }

  /** Extract significant keywords from text for clustering. */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'it', 'its', 'this', 'that',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
      'and', 'or', 'but', 'not', 'no', 'if', 'so', 'up', 'out', 'about',
      'what', 'which', 'who', 'how', 'when', 'where', 'why', 'all', 'each',
      'just', 'please', 'want', 'need', 'like', 'get', 'make', 'help',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // Count frequencies
    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    // Return by frequency desc
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
  }

  /** Simple token-overlap similarity between two strings. */
  private similarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/));
    const tokensB = new Set(b.toLowerCase().split(/\s+/));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let overlap = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) overlap++;
    }

    return overlap / Math.max(tokensA.size, tokensB.size);
  }

  /** Cluster user requests by message similarity (single-linkage). */
  private clusterRequests(requests: UserRequest[]): UserRequest[][] {
    if (requests.length === 0) return [];

    const assigned = new Set<number>();
    const clusters: UserRequest[][] = [];

    for (let i = 0; i < requests.length; i++) {
      if (assigned.has(i)) continue;

      const cluster: UserRequest[] = [requests[i]];
      assigned.add(i);

      for (let j = i + 1; j < requests.length; j++) {
        if (assigned.has(j)) continue;

        // Check similarity against any member of the cluster
        const similar = cluster.some(
          (member) =>
            this.similarity(member.message, requests[j].message) >=
            this.config.similarityThreshold,
        );

        if (similar) {
          cluster.push(requests[j]);
          assigned.add(j);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /** Merge overlapping gaps by suggestedName similarity. */
  private mergeGaps(gaps: CapabilityGap[]): CapabilityGap[] {
    if (gaps.length <= 1) return gaps;

    const merged: CapabilityGap[] = [];
    const used = new Set<number>();

    for (let i = 0; i < gaps.length; i++) {
      if (used.has(i)) continue;

      const current = { ...gaps[i], examples: [...gaps[i].examples] };
      used.add(i);

      for (let j = i + 1; j < gaps.length; j++) {
        if (used.has(j)) continue;

        // Merge if names are similar or descriptions overlap significantly
        if (
          this.similarity(current.suggestedName.replace(/-/g, ' '), gaps[j].suggestedName.replace(/-/g, ' ')) >= 0.5 ||
          this.similarity(current.description, gaps[j].description) >= 0.6
        ) {
          current.frequency += gaps[j].frequency;
          current.confidence = Math.max(current.confidence, gaps[j].confidence);
          current.examples.push(...gaps[j].examples);
          if (gaps[j].description.length > current.description.length) {
            current.description = gaps[j].description;
          }
          used.add(j);
        }
      }

      // Cap examples
      current.examples = current.examples.slice(0, 10);
      merged.push(current);
    }

    return merged;
  }
}
