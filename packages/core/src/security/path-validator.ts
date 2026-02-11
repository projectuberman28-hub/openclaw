/**
 * @alfred/core - Path Validator
 *
 * Prevents path traversal and directory escape attacks.
 * Rejects ".." components, absolute paths outside ALFRED_HOME,
 * null bytes, and other suspicious characters.
 */

import { resolve, normalize, isAbsolute, relative, sep } from 'node:path';
import { resolveAlfredHome } from '../config/paths.js';

// ---------------------------------------------------------------------------
// Suspicious patterns
// ---------------------------------------------------------------------------

/** Characters / sequences that should never appear in user-supplied paths */
const SUSPICIOUS_PATTERNS = [
  '\0',         // Null byte
  '%00',        // URL-encoded null byte
  '%2e%2e',     // URL-encoded ..
  '%2f',        // URL-encoded /
  '%5c',        // URL-encoded \
  '\r',         // Carriage return
  '\n',         // Newline
];

/** Check if a path contains suspicious characters */
function hasSuspiciousChars(p: string): boolean {
  const lower = p.toLowerCase();
  return SUSPICIOUS_PATTERNS.some((pat) => lower.includes(pat));
}

/** Check if a path contains ".." traversal */
function hasTraversal(p: string): boolean {
  const segments = p.split(/[/\\]/);
  return segments.includes('..');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that a path is safe to use.
 *
 * Rules:
 * 1. No ".." components (path traversal)
 * 2. No suspicious chars (null bytes, encoded sequences)
 * 3. If allowedBase is specified, resolved path must be within that base
 * 4. If path is absolute and no allowedBase given, it must be within ALFRED_HOME
 *
 * @param inputPath - The path to validate
 * @param allowedBase - Optional base directory to constrain the path to
 * @returns true if the path is safe
 */
export function validatePath(inputPath: string, allowedBase?: string): boolean {
  if (!inputPath || inputPath.trim().length === 0) {
    return false;
  }

  // Check suspicious characters
  if (hasSuspiciousChars(inputPath)) {
    return false;
  }

  // Check traversal
  if (hasTraversal(inputPath)) {
    return false;
  }

  // If an allowed base is specified, ensure the resolved path is within it
  if (allowedBase) {
    return isWithinBase(inputPath, allowedBase);
  }

  // For absolute paths without an explicit base, verify within ALFRED_HOME
  if (isAbsolute(inputPath)) {
    const home = resolveAlfredHome();
    return isWithinBase(inputPath, home);
  }

  // Relative paths without a base are allowed (they'll be resolved relative to a safe CWD)
  return true;
}

/**
 * Sanitize a path by normalizing separators, removing dangerous components,
 * and stripping suspicious characters.
 *
 * @param inputPath - The raw path to sanitize
 * @returns A cleaned path string
 */
export function sanitizePath(inputPath: string): string {
  let cleaned = inputPath;

  // Remove null bytes
  cleaned = cleaned.replace(/\0/g, '');

  // Remove URL-encoded suspicious sequences
  cleaned = cleaned.replace(/%00/gi, '');
  cleaned = cleaned.replace(/%2e%2e/gi, '');
  cleaned = cleaned.replace(/%2f/gi, '/');
  cleaned = cleaned.replace(/%5c/gi, '\\');

  // Remove carriage returns and newlines
  cleaned = cleaned.replace(/[\r\n]/g, '');

  // Normalize the path (collapses "." and resolves separator inconsistencies)
  cleaned = normalize(cleaned);

  // Remove any remaining ".." segments by splitting and filtering
  const segments = cleaned.split(/[/\\]/).filter((seg) => seg !== '..');
  cleaned = segments.join(sep);

  // Remove leading separator if the original wasn't absolute
  if (!isAbsolute(inputPath) && cleaned.startsWith(sep)) {
    cleaned = cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Check if a resolved path is within the given base directory.
 *
 * @param inputPath - Path to check (can be relative or absolute)
 * @param base - The base directory it must stay within
 * @returns true if the path, when resolved, is a descendant of base
 */
export function isWithinBase(inputPath: string, base: string): boolean {
  const resolvedBase = resolve(base);
  const resolvedPath = resolve(base, inputPath);

  // Normalize both so separator differences don't cause false negatives
  const normalizedBase = normalize(resolvedBase);
  const normalizedPath = normalize(resolvedPath);

  // The resolved path must start with the base path
  if (!normalizedPath.startsWith(normalizedBase)) {
    return false;
  }

  // Ensure it's not just a prefix match (e.g. /home/alfred vs /home/alfred-evil)
  const remainder = normalizedPath.slice(normalizedBase.length);
  if (remainder.length > 0 && !remainder.startsWith(sep)) {
    return false;
  }

  // Double-check with relative() — result should not start with ".."
  const rel = relative(resolvedBase, resolvedPath);
  if (rel.startsWith('..')) {
    return false;
  }

  return true;
}
