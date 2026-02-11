/**
 * @alfred/core - Local File Inclusion Guard
 *
 * Prevents path traversal attacks in media/file operations.
 * Ensures requested files stay within their allowed base directory.
 */

import { resolve, normalize, relative, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { validatePath, isWithinBase } from './path-validator.js';

// ---------------------------------------------------------------------------
// Dangerous extensions that should be blocked in media operations
// ---------------------------------------------------------------------------

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.sh', '.bash', '.zsh', '.fish',
  '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.reg', '.inf', '.lnk',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a media file path request against a base directory.
 *
 * Ensures:
 * 1. No path traversal ("..") or suspicious characters
 * 2. Resolved path is within the allowedBase
 * 3. File extension is not in the blocked list
 * 4. The resulting file actually exists (optional, controlled by requireExists)
 *
 * @param requested - The requested file path (relative or absolute)
 * @param allowedBase - The directory the file must reside within
 * @param options - Additional options
 * @returns The resolved, safe absolute path or null if the request is rejected
 */
export function sanitizeMediaPath(
  requested: string,
  allowedBase: string,
  options: {
    requireExists?: boolean;
    allowBlockedExtensions?: boolean;
  } = {},
): string | null {
  const { requireExists = false, allowBlockedExtensions = false } = options;

  // Basic validation
  if (!requested || requested.trim().length === 0) {
    return null;
  }

  if (!allowedBase || allowedBase.trim().length === 0) {
    return null;
  }

  // Run through path-validator checks
  if (!validatePath(requested, allowedBase)) {
    return null;
  }

  // Resolve to absolute path within the base
  const resolvedBase = resolve(allowedBase);
  const resolvedPath = resolve(resolvedBase, normalize(requested));

  // Double-check containment
  if (!isWithinBase(resolvedPath, resolvedBase)) {
    return null;
  }

  // Check the relative path doesn't escape
  const rel = relative(resolvedBase, resolvedPath);
  if (rel.startsWith('..')) {
    return null;
  }

  // Extension check
  if (!allowBlockedExtensions) {
    const ext = extname(resolvedPath).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return null;
    }
  }

  // Existence check
  if (requireExists && !existsSync(resolvedPath)) {
    return null;
  }

  return resolvedPath;
}

/**
 * Validate that a set of media paths are all within the allowed base.
 *
 * @returns An object mapping each requested path to its sanitized result (or null).
 */
export function sanitizeMediaPaths(
  requested: string[],
  allowedBase: string,
  options: {
    requireExists?: boolean;
    allowBlockedExtensions?: boolean;
  } = {},
): Map<string, string | null> {
  const results = new Map<string, string | null>();

  for (const req of requested) {
    results.set(req, sanitizeMediaPath(req, allowedBase, options));
  }

  return results;
}

/**
 * Quick check: is a file path safe for a media operation?
 */
export function isMediaPathSafe(
  requested: string,
  allowedBase: string,
): boolean {
  return sanitizeMediaPath(requested, allowedBase) !== null;
}
