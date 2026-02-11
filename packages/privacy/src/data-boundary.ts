/**
 * @alfred/privacy - Data Boundary
 *
 * Enforce data locality rules to prevent sensitive files from
 * leaving the machine or being accessed by tools that shouldn't see them.
 */

import { resolve, normalize, relative, sep } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataBoundaryOptions {
  /** Base ALFRED_HOME directory. Defaults to ~/.alfred */
  alfredHome?: string;
}

export interface ValidationResult {
  safe: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Path patterns
// ---------------------------------------------------------------------------

/**
 * Glob-like patterns for path matching.
 * Uses simple prefix/suffix matching (not full minimatch).
 */
interface PathRule {
  /** Pattern to match against. */
  pattern: string;
  /** Description of why this rule exists. */
  description: string;
}

// ---------------------------------------------------------------------------
// DataBoundary class
// ---------------------------------------------------------------------------

export class DataBoundary {
  private alfredHome: string;
  private allowedPrefixes: string[];
  private blockedPatterns: PathRule[];
  private neverSyncPatterns: PathRule[];

  constructor(options: DataBoundaryOptions = {}) {
    this.alfredHome = resolve(options.alfredHome ?? `${homedir()}/.alfred`);

    // Allowed paths: ALFRED_HOME and its workspace subdirectory
    this.allowedPrefixes = [
      this.alfredHome,
      resolve(this.alfredHome, 'workspace'),
    ];

    // Blocked paths: never allow direct access to these
    this.blockedPatterns = [
      { pattern: 'credentials/', description: 'Credential storage directory' },
      { pattern: 'credentials\\', description: 'Credential storage directory (Windows)' },
      { pattern: 'vault.enc', description: 'Encrypted vault file' },
      { pattern: 'key.age', description: 'Encryption key file' },
    ];

    // Never sync patterns: files that must never be transmitted externally
    this.neverSyncPatterns = [
      { pattern: 'credentials/', description: 'Credential storage' },
      { pattern: 'credentials\\', description: 'Credential storage (Windows)' },
      { pattern: '.key', description: 'Key files' },
      { pattern: '.pem', description: 'PEM certificate files' },
      { pattern: '.env', description: 'Environment variable files' },
    ];
  }

  /**
   * Normalize a path for consistent comparison.
   */
  private normalizePath(inputPath: string): string {
    return resolve(normalize(inputPath));
  }

  /**
   * Check if a path is within the allowed ALFRED_HOME boundaries
   * and not in a blocked location.
   *
   * A safe path must:
   * 1. Be within ALFRED_HOME or ALFRED_HOME/workspace
   * 2. Not match any blocked patterns
   * 3. Not attempt path traversal outside boundaries
   */
  isPathSafe(inputPath: string): boolean {
    const normalized = this.normalizePath(inputPath);

    // Check if within allowed prefixes
    const isWithinAllowed = this.allowedPrefixes.some((prefix) =>
      normalized.startsWith(prefix),
    );

    if (!isWithinAllowed) return false;

    // Check against blocked patterns
    if (this.matchesBlockedPattern(normalized)) return false;

    // Check for path traversal (.. in the relative path)
    const rel = relative(this.alfredHome, normalized);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) return false;

    return true;
  }

  /**
   * Check if a path can be safely synced/transmitted externally.
   *
   * Sync-safe means it can be sent to cloud services, backup systems, etc.
   * More restrictive than isPathSafe — blocks additional file types.
   */
  isSyncSafe(inputPath: string): boolean {
    const normalized = this.normalizePath(inputPath);
    const basename = normalized.split(sep).pop() ?? '';

    // Must first be path-safe
    if (!this.isPathSafe(normalized)) return false;

    // Check never-sync patterns
    for (const rule of this.neverSyncPatterns) {
      const pattern = rule.pattern;

      // Directory patterns (ending with / or \)
      if (pattern.endsWith('/') || pattern.endsWith('\\')) {
        const dirName = pattern.replace(/[/\\]$/, '');
        if (normalized.includes(`${sep}${dirName}${sep}`) || normalized.includes(`/${dirName}/`)) {
          return false;
        }
      }
      // Extension/suffix patterns (starting with .)
      else if (pattern.startsWith('.')) {
        // Match both exact extension and prefix pattern (.env matches .env, .env.local, etc.)
        if (basename.endsWith(pattern) || basename.startsWith(pattern)) {
          return false;
        }
      }
      // Exact filename match
      else if (basename === pattern) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate tool arguments to ensure they don't access restricted paths.
   *
   * Scans all string values in the args object for path-like strings
   * that might reference blocked locations.
   */
  validateToolArgs(
    toolName: string,
    args: Record<string, unknown>,
  ): ValidationResult {
    const pathKeys = ['path', 'file', 'filepath', 'filename', 'directory', 'dir', 'target', 'source', 'dest', 'destination', 'input', 'output'];

    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string') continue;

      // Check known path argument names
      const isPathArg = pathKeys.some(
        (pk) => key.toLowerCase().includes(pk),
      );

      if (isPathArg) {
        // Validate this is a safe path
        if (!this.isPathSafe(value)) {
          return {
            safe: false,
            reason: `Tool "${toolName}" argument "${key}" references a path outside allowed boundaries or in a blocked location: ${value}`,
          };
        }
      }

      // Also check any string value that looks like an absolute path
      if (this.looksLikePath(value)) {
        if (this.matchesBlockedPattern(this.normalizePath(value))) {
          return {
            safe: false,
            reason: `Tool "${toolName}" argument "${key}" references a blocked path: ${value}`,
          };
        }
      }
    }

    return { safe: true };
  }

  /**
   * Check if a normalized path matches any blocked pattern.
   */
  private matchesBlockedPattern(normalizedPath: string): boolean {
    const basename = normalizedPath.split(sep).pop() ?? '';

    for (const rule of this.blockedPatterns) {
      const pattern = rule.pattern;

      // Directory patterns (ending with / or \)
      if (pattern.endsWith('/') || pattern.endsWith('\\')) {
        const dirName = pattern.replace(/[/\\]$/, '');
        if (
          normalizedPath.includes(`${sep}${dirName}${sep}`) ||
          normalizedPath.includes(`/${dirName}/`) ||
          normalizedPath.endsWith(`${sep}${dirName}`) ||
          normalizedPath.endsWith(`/${dirName}`)
        ) {
          return true;
        }
      }
      // Exact filename patterns
      else if (basename === pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Heuristic check if a string looks like a filesystem path.
   */
  private looksLikePath(value: string): boolean {
    // Unix absolute path
    if (value.startsWith('/')) return true;
    // Windows absolute path (C:\, D:\, etc.)
    if (/^[a-zA-Z]:[/\\]/.test(value)) return true;
    // Relative path with directory separators
    if (value.includes(sep) && !value.includes(' ')) return true;
    return false;
  }

  /**
   * Get the configured ALFRED_HOME path.
   */
  getAlfredHome(): string {
    return this.alfredHome;
  }

  /**
   * Get all allowed path prefixes.
   */
  getAllowedPrefixes(): string[] {
    return [...this.allowedPrefixes];
  }
}
