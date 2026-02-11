/**
 * @alfred/tools - FileOpsTool
 *
 * File read/write/edit/list with:
 *   - Path validation via LFI guard (no directory traversal)
 *   - Path containment to allowed roots
 *   - Offset/limit for partial reads
 *   - Patch application
 *   - Glob pattern listing
 *   - SafeExecutor integration
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative, normalize, join, sep } from 'node:path';
import { resolveAlfredHome } from '@alfred/core/config/paths';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:file-ops' });

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Guard against Local File Inclusion / directory traversal.
 * Resolves the path and ensures it stays within allowed roots.
 */
function validatePath(inputPath: string, allowedRoots?: string[]): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('FileOpsTool: path is required');
  }

  // Reject null bytes
  if (inputPath.includes('\0')) {
    throw new Error('FileOpsTool: path contains null bytes');
  }

  const resolved = resolve(inputPath);
  const normalized = normalize(resolved);

  // Check for traversal patterns in the original input
  const suspicious = ['..', '%2e', '%2E', '%252e', '%00'];
  for (const pat of suspicious) {
    if (inputPath.includes(pat) && pat === '..') {
      // Allow ".." only if the resolved path is still within an allowed root
      // (handled below)
    }
  }

  // If allowed roots are specified, ensure the resolved path is within one
  if (allowedRoots && allowedRoots.length > 0) {
    const withinRoot = allowedRoots.some((root) => {
      const resolvedRoot = resolve(root);
      const rel = relative(resolvedRoot, normalized);
      // Must not escape the root (no leading "..")
      return !rel.startsWith('..') && !rel.startsWith(sep + sep);
    });

    if (!withinRoot) {
      throw new Error(
        `FileOpsTool: path "${inputPath}" is outside allowed directories`,
      );
    }
  }

  return normalized;
}

/**
 * Build the set of allowed root directories.
 * Includes ALFRED_HOME, cwd, and any user-configured roots.
 */
function buildAllowedRoots(extraRoots?: string[]): string[] {
  const roots = [
    resolveAlfredHome(),
    process.cwd(),
  ];

  if (extraRoots) {
    roots.push(...extraRoots);
  }

  return roots.map((r) => resolve(r));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export interface FileWriteArgs {
  path: string;
  content: string;
}

export interface FileEditArgs {
  path: string;
  oldText: string;
  newText: string;
}

export interface FilePatchArgs {
  path: string;
  patch: string;
}

export interface FileListArgs {
  path: string;
  pattern?: string;
}

export interface FileOpsConfig {
  /** Additional allowed root directories. */
  allowedRoots?: string[];
}

// ---------------------------------------------------------------------------
// FileOpsTool
// ---------------------------------------------------------------------------

export class FileOpsTool {
  private executor: SafeExecutor;
  private allowedRoots: string[];

  constructor(executor: SafeExecutor, config: FileOpsConfig = {}) {
    this.executor = executor;
    this.allowedRoots = buildAllowedRoots(config.allowedRoots);
  }

  static definition = {
    name: 'file_ops',
    description:
      'Read, write, edit, patch, or list files. ' +
      'All paths are validated to prevent directory traversal.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'edit', 'applyPatch', 'list'],
          description: 'File operation to perform',
        },
        path: { type: 'string', description: 'File or directory path' },
        content: { type: 'string', description: 'Content to write (for write action)' },
        oldText: { type: 'string', description: 'Text to find (for edit action)' },
        newText: { type: 'string', description: 'Replacement text (for edit action)' },
        patch: { type: 'string', description: 'Unified diff patch (for applyPatch action)' },
        offset: { type: 'number', description: 'Line offset for read (optional)' },
        limit: { type: 'number', description: 'Max lines for read (optional)' },
        pattern: { type: 'string', description: 'Glob pattern for list (optional)' },
      },
      required: ['action', 'path'],
    },
  };

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  async read(args: FileReadArgs, execOpts?: ExecuteOptions): Promise<string> {
    const safePath = validatePath(args.path, this.allowedRoots);

    const result = await this.executor.execute(
      'file_ops.read',
      async () => {
        const content = await readFile(safePath, 'utf-8');

        if (args.offset !== undefined || args.limit !== undefined) {
          const lines = content.split('\n');
          const start = args.offset ?? 0;
          const end = args.limit !== undefined ? start + args.limit : lines.length;
          return lines.slice(start, end).join('\n');
        }

        return content;
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as string;
  }

  // -----------------------------------------------------------------------
  // Write
  // -----------------------------------------------------------------------

  async write(args: FileWriteArgs, execOpts?: ExecuteOptions): Promise<void> {
    if (typeof args.content !== 'string') {
      throw new Error('FileOpsTool.write: "content" is required');
    }

    const safePath = validatePath(args.path, this.allowedRoots);

    const result = await this.executor.execute(
      'file_ops.write',
      async () => {
        // Ensure parent directory exists
        const dir = dirname(safePath);
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }

        await writeFile(safePath, args.content, 'utf-8');
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  // -----------------------------------------------------------------------
  // Edit (find & replace)
  // -----------------------------------------------------------------------

  async edit(args: FileEditArgs, execOpts?: ExecuteOptions): Promise<void> {
    if (typeof args.oldText !== 'string' || typeof args.newText !== 'string') {
      throw new Error('FileOpsTool.edit: "oldText" and "newText" are required');
    }

    const safePath = validatePath(args.path, this.allowedRoots);

    const result = await this.executor.execute(
      'file_ops.edit',
      async () => {
        const content = await readFile(safePath, 'utf-8');

        if (!content.includes(args.oldText)) {
          throw new Error(
            'FileOpsTool.edit: oldText not found in file. ' +
              'Ensure the text matches exactly, including whitespace.',
          );
        }

        // Replace first occurrence
        const updated = content.replace(args.oldText, args.newText);
        await writeFile(safePath, updated, 'utf-8');
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  // -----------------------------------------------------------------------
  // Apply patch (unified diff)
  // -----------------------------------------------------------------------

  async applyPatch(args: FilePatchArgs, execOpts?: ExecuteOptions): Promise<void> {
    if (!args.patch || typeof args.patch !== 'string') {
      throw new Error('FileOpsTool.applyPatch: "patch" is required');
    }

    const safePath = validatePath(args.path, this.allowedRoots);

    const result = await this.executor.execute(
      'file_ops.applyPatch',
      async () => {
        const content = await readFile(safePath, 'utf-8');
        const lines = content.split('\n');
        const patchLines = args.patch.split('\n');

        let lineIdx = 0;
        const output: string[] = [...lines];
        let offset = 0;

        for (const pLine of patchLines) {
          // Skip diff headers
          if (
            pLine.startsWith('---') ||
            pLine.startsWith('+++') ||
            pLine.startsWith('diff ') ||
            pLine.startsWith('index ')
          ) {
            continue;
          }

          // Parse hunk header
          const hunkMatch = pLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (hunkMatch) {
            lineIdx = parseInt(hunkMatch[1], 10) - 1 + offset;
            continue;
          }

          if (pLine.startsWith('-')) {
            // Remove line
            if (lineIdx < output.length) {
              output.splice(lineIdx, 1);
              offset--;
            }
          } else if (pLine.startsWith('+')) {
            // Add line
            output.splice(lineIdx, 0, pLine.slice(1));
            lineIdx++;
            offset++;
          } else if (pLine.startsWith(' ') || pLine === '') {
            // Context line – advance pointer
            lineIdx++;
          }
        }

        await writeFile(safePath, output.join('\n'), 'utf-8');
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  async list(args: FileListArgs, execOpts?: ExecuteOptions): Promise<string[]> {
    const safePath = validatePath(args.path, this.allowedRoots);

    const result = await this.executor.execute(
      'file_ops.list',
      async () => {
        const info = await stat(safePath);

        if (!info.isDirectory()) {
          return [safePath];
        }

        const entries = await readdir(safePath, { withFileTypes: true, recursive: false });
        let files = entries.map((e) => join(safePath, e.name));

        // Apply pattern filter
        if (args.pattern) {
          const pattern = args.pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
          const re = new RegExp(pattern, 'i');
          files = files.filter((f) => re.test(f));
        }

        return files.sort();
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as string[];
  }
}
