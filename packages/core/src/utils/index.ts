/**
 * @alfred/core - Common utilities
 *
 * Shared helper functions used across the Alfred system.
 */

import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry options
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        onRetry?.(lastError, attempt + 1);

        // Add jitter: +/- 25% of delay
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        await sleep(Math.min(delay + jitter, maxDelayMs));

        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a string to a maximum length, appending an ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number, suffix = '...'): string {
  if (str.length <= maxLength) return str;
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  return str.slice(0, maxLength - suffix.length) + suffix;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hash of the input string.
 *
 * @param input - The string to hash
 * @param encoding - The output encoding (default: hex)
 * @returns The hash string
 */
export function hash(input: string, encoding: 'hex' | 'base64' = 'hex'): string {
  return createHash('sha256').update(input, 'utf-8').digest(encoding);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique identifier.
 *
 * Format: `{prefix}_{timestamp_hex}_{random_hex}`
 *
 * @param prefix - Optional prefix (default: "alf")
 * @returns A unique ID string
 */
export function generateId(prefix = 'alf'): string {
  const timestamp = Date.now().toString(16);
  const random = randomBytes(6).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a byte count into a human-readable string.
 *
 * @param bytes - The number of bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g. "1.23 GB")
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return `-${formatBytes(-bytes, decimals)}`;

  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, units.length - 1);

  const value = bytes / Math.pow(k, idx);
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

// ---------------------------------------------------------------------------
// Model ID parsing
// ---------------------------------------------------------------------------

export interface ParsedModelId {
  provider: string;
  model: string;
  raw: string;
}

/**
 * Parse a model identifier in "provider/model" format.
 *
 * @param modelId - The model ID string (e.g. "anthropic/claude-sonnet-4-20250514")
 * @returns Parsed provider and model name
 * @throws Error if the format is invalid
 */
export function parseModelId(modelId: string): ParsedModelId {
  const slashIndex = modelId.indexOf('/');

  if (slashIndex === -1) {
    throw new Error(
      `Invalid model ID "${modelId}": expected format "provider/model" (e.g. "anthropic/claude-sonnet-4-20250514")`,
    );
  }

  const provider = modelId.slice(0, slashIndex);
  const model = modelId.slice(slashIndex + 1);

  if (!provider || !model) {
    throw new Error(
      `Invalid model ID "${modelId}": provider and model name must not be empty`,
    );
  }

  return { provider, model, raw: modelId };
}

/**
 * Safely parse a model ID, returning null instead of throwing.
 */
export function tryParseModelId(modelId: string): ParsedModelId | null {
  try {
    return parseModelId(modelId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Object helpers
// ---------------------------------------------------------------------------

/**
 * Check if a value is a non-null object (not an array).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pick specified keys from an object.
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specified keys from an object.
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}
