/**
 * @alfred/fallback - FallbackChain
 *
 * Generic fallback chain that tries providers in priority order,
 * with configurable timeouts, failover-eligible HTTP status detection,
 * and detailed attempt tracking.
 */

import pino from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A provider that can be registered into a FallbackChain. */
export interface FallbackProvider<T> {
  /** Human-readable name (e.g. "Ollama", "OpenAI"). */
  name: string;
  /** Execute the provider logic and return a result. */
  execute: (input: unknown) => Promise<T>;
  /** Returns true when the provider is reachable / configured. */
  isAvailable: () => Promise<boolean>;
  /** Lower number = tried first. */
  priority: number;
}

/** Record of a single attempt within a chain execution. */
export interface FallbackAttempt {
  provider: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

/** Successful chain execution result. */
export interface FallbackResult<T> {
  result: T;
  provider: string;
  attempts: FallbackAttempt[];
}

/** Options accepted by FallbackChain constructor. */
export interface FallbackChainOptions<T> {
  /** Ordered list of providers (will be sorted by priority internally). */
  providers: FallbackProvider<T>[];
  /** Per-provider timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Called whenever we fall back from one provider to the next. */
  onFallback?: (from: string, to: string, error: string) => void;
  /** Custom pino logger instance. */
  logger?: pino.Logger;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Custom error that carries an HTTP status code so the chain can decide
 * whether to fail over or stop.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Determine whether a given HTTP status code is eligible for failover.
 *
 * Failover-eligible (we try the next provider):
 *   - 400 Bad Request
 *   - 408 Request Timeout
 *   - 429 Too Many Requests
 *   - 5xx Server errors
 *   - 0   (connection refused / network error represented as 0)
 *
 * NOT failover-eligible (stop immediately):
 *   - 401 Unauthorized
 *   - 403 Forbidden
 *   - 404 Not Found (resource-level, not infra)
 */
export function isHttpFailoverEligible(statusCode: number): boolean {
  // Auth errors -- hard stop
  if (statusCode === 401 || statusCode === 403) {
    return false;
  }
  // Explicit failover-eligible client errors
  if (statusCode === 400 || statusCode === 408 || statusCode === 429) {
    return true;
  }
  // All 5xx errors
  if (statusCode >= 500 && statusCode <= 599) {
    return true;
  }
  // Network / connection error (often represented as 0)
  if (statusCode === 0) {
    return true;
  }
  // Everything else (e.g. 404, 405, 409, etc.) -- not failover-eligible
  return false;
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout. Rejects with a descriptive error when
 * the timeout fires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Provider "${label}" timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// FallbackChain
// ---------------------------------------------------------------------------

/**
 * Executes providers in priority order until one succeeds.
 *
 * ```ts
 * const chain = new FallbackChain({
 *   providers: [onnxProvider, transformersProvider, ollamaProvider],
 *   timeoutMs: 15_000,
 *   onFallback: (from, to, err) => console.warn(`${from} -> ${to}: ${err}`),
 * });
 * const { result, provider, attempts } = await chain.execute(input);
 * ```
 */
export class FallbackChain<T> {
  private readonly providers: FallbackProvider<T>[];
  private readonly timeoutMs: number;
  private readonly onFallback?: (from: string, to: string, error: string) => void;
  private readonly log: pino.Logger;

  constructor(options: FallbackChainOptions<T>) {
    // Sort providers ascending by priority (lower = first)
    this.providers = [...options.providers].sort((a, b) => a.priority - b.priority);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.onFallback = options.onFallback;
    this.log = options.logger ?? pino({ name: '@alfred/fallback' });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Execute the chain against `input`. Tries each provider in priority order,
   * skipping unavailable ones and those that fail with failover-eligible
   * errors. Stops immediately for auth errors (401/403).
   */
  async execute(input: unknown): Promise<FallbackResult<T>> {
    const attempts: FallbackAttempt[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!;

      // --- availability check ------------------------------------------------
      let available: boolean;
      try {
        available = await provider.isAvailable();
      } catch {
        this.log.warn({ provider: provider.name }, 'isAvailable() threw -- treating as unavailable');
        available = false;
      }

      if (!available) {
        this.log.info({ provider: provider.name }, 'Provider unavailable, skipping');
        attempts.push({
          provider: provider.name,
          success: false,
          error: 'Provider unavailable',
          durationMs: 0,
        });

        // Fire onFallback if there is a next provider
        if (this.onFallback && i + 1 < this.providers.length) {
          this.onFallback(provider.name, this.providers[i + 1]!.name, 'Provider unavailable');
        }
        continue;
      }

      // --- execution ---------------------------------------------------------
      const start = performance.now();
      try {
        const result = await withTimeout(provider.execute(input), this.timeoutMs, provider.name);
        const durationMs = Math.round(performance.now() - start);

        this.log.info({ provider: provider.name, durationMs }, 'Provider succeeded');

        attempts.push({
          provider: provider.name,
          success: true,
          durationMs,
        });

        return { result, provider: provider.name, attempts };
      } catch (err: unknown) {
        const durationMs = Math.round(performance.now() - start);
        const errorMessage = err instanceof Error ? err.message : String(err);

        this.log.warn({ provider: provider.name, durationMs, error: errorMessage }, 'Provider failed');

        attempts.push({
          provider: provider.name,
          success: false,
          error: errorMessage,
          durationMs,
        });

        lastError = errorMessage;

        // Check for non-failover-eligible HTTP errors (auth errors)
        if (err instanceof HttpError && !isHttpFailoverEligible(err.statusCode)) {
          this.log.error(
            { provider: provider.name, statusCode: err.statusCode },
            'Non-failover-eligible HTTP error -- stopping chain',
          );
          throw new FallbackChainError(
            `Provider "${provider.name}" returned HTTP ${err.statusCode}: ${errorMessage}`,
            attempts,
          );
        }

        // Fire onFallback callback
        if (this.onFallback && i + 1 < this.providers.length) {
          this.onFallback(provider.name, this.providers[i + 1]!.name, errorMessage);
        }
      }
    }

    // All providers exhausted
    throw new FallbackChainError(
      `All ${this.providers.length} providers failed. Last error: ${lastError ?? 'unknown'}`,
      attempts,
    );
  }

  /**
   * Return the ordered list of provider names (by priority).
   */
  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  /**
   * Check availability of every provider in the chain.
   */
  async checkAvailability(): Promise<Array<{ name: string; available: boolean }>> {
    const results: Array<{ name: string; available: boolean }> = [];
    for (const provider of this.providers) {
      let available: boolean;
      try {
        available = await provider.isAvailable();
      } catch {
        available = false;
      }
      results.push({ name: provider.name, available });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// FallbackChainError
// ---------------------------------------------------------------------------

/** Error thrown when the entire chain is exhausted or a hard stop occurs. */
export class FallbackChainError extends Error {
  public readonly attempts: FallbackAttempt[];

  constructor(message: string, attempts: FallbackAttempt[]) {
    super(message);
    this.name = 'FallbackChainError';
    this.attempts = attempts;
  }
}
