/**
 * @alfred/skill-backup-manager
 *
 * Backup and restore the ~/.alfred/ directory with compression,
 * integrity verification, and pruning.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  copyFileSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { createGzip, createGunzip, gzipSync, gunzipSync } from 'node:zlib';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackupEntry {
  id: string;
  label: string;
  path: string;
  size: number; // bytes
  fileCount: number;
  checksum: string;
  createdAt: number;
}

interface BackupManifest {
  id: string;
  label: string;
  files: string[];
  checksum: string;
  createdAt: number;
  alfredVersion: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ALFRED_HOME = join(homedir(), '.alfred');
const BACKUP_DIR = join(ALFRED_HOME, 'backups');
const MANIFEST_FILE = join(BACKUP_DIR, 'manifest.json');

function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function loadManifest(): BackupEntry[] {
  ensureBackupDir();
  if (!existsSync(MANIFEST_FILE)) return [];
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveManifest(entries: BackupEntry[]): void {
  ensureBackupDir();
  writeFileSync(MANIFEST_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Recursively collect all files in a directory.
 * Excludes the backups directory itself.
 */
function collectFiles(dir: string, basePath: string = dir): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(basePath, fullPath);

    // Skip the backups directory to avoid recursive backup
    if (fullPath.startsWith(BACKUP_DIR)) continue;

    // Skip node_modules and .git
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, basePath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }

  return files;
}

/**
 * Calculate the total size of files.
 */
function calculateDirSize(dir: string): number {
  let total = 0;
  const files = collectFiles(dir);

  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const stat = statSync(fullPath);
      total += stat.size;
    } catch {
      // Skip inaccessible files
    }
  }

  return total;
}

/**
 * Create a checksum of the backup archive.
 */
function calculateChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Backup creation — simple compressed archive
// ---------------------------------------------------------------------------

/**
 * Create a compressed backup archive.
 * Uses a simple custom format: JSON manifest + gzipped file content.
 */
function createBackupArchive(sourceDir: string): {
  data: Buffer;
  files: string[];
  fileCount: number;
} {
  const files = collectFiles(sourceDir);
  const archive: Record<string, string> = {};

  for (const file of files) {
    const fullPath = join(sourceDir, file);
    try {
      const content = readFileSync(fullPath);
      // Store as base64 for binary safety
      archive[file] = content.toString('base64');
    } catch {
      // Skip unreadable files
    }
  }

  const jsonPayload = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(jsonPayload, 'utf-8'));

  return {
    data: compressed,
    files,
    fileCount: Object.keys(archive).length,
  };
}

/**
 * Extract a backup archive to a target directory.
 */
function extractBackupArchive(archivePath: string, targetDir: string): number {
  const compressed = readFileSync(archivePath);
  const decompressed = gunzipSync(compressed);
  const archive: Record<string, string> = JSON.parse(decompressed.toString('utf-8'));

  let fileCount = 0;

  for (const [relativePath, base64Content] of Object.entries(archive)) {
    const fullPath = join(targetDir, relativePath);
    const dir = join(fullPath, '..');

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, Buffer.from(base64Content, 'base64'));
    fileCount++;
  }

  return fileCount;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function backupCreate(
  label?: string,
): Promise<{ id: string; path: string; size: number; fileCount: number; label: string }> {
  ensureBackupDir();

  // Check source size
  const sourceSize = calculateDirSize(ALFRED_HOME);
  const MAX_SIZE = 500 * 1024 * 1024; // 500MB limit

  if (sourceSize > MAX_SIZE) {
    throw new Error(
      `Alfred home directory is ${Math.round(sourceSize / 1024 / 1024)}MB, which exceeds the 500MB backup limit. Consider cleaning up first.`,
    );
  }

  const id = generateId();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupLabel = label || `backup-${timestamp}`;
  const filename = `${backupLabel}-${id}.alfred.bak`;
  const backupPath = join(BACKUP_DIR, filename);

  // Create the archive
  const { data, files, fileCount } = createBackupArchive(ALFRED_HOME);

  // Calculate checksum
  const checksum = calculateChecksum(data);

  // Write archive
  writeFileSync(backupPath, data);

  // Update manifest
  const manifest = loadManifest();
  manifest.push({
    id,
    label: backupLabel,
    path: backupPath,
    size: data.length,
    fileCount,
    checksum,
    createdAt: Date.now(),
  });
  saveManifest(manifest);

  return {
    id,
    path: backupPath,
    size: data.length,
    fileCount,
    label: backupLabel,
  };
}

async function backupList(): Promise<{ backups: BackupEntry[] }> {
  const manifest = loadManifest();

  // Verify each backup still exists on disk
  const valid = manifest.filter((entry) => existsSync(entry.path));

  // Sort by most recent first
  valid.sort((a, b) => b.createdAt - a.createdAt);

  // Update manifest if some entries were removed
  if (valid.length !== manifest.length) {
    saveManifest(valid);
  }

  return { backups: valid };
}

async function backupRestore(
  id: string,
): Promise<{ restored: boolean; filesCount: number; warning?: string }> {
  const manifest = loadManifest();
  const entry = manifest.find((e) => e.id === id);

  if (!entry) {
    throw new Error(`Backup not found: ${id}`);
  }

  if (!existsSync(entry.path)) {
    throw new Error(`Backup file missing: ${entry.path}`);
  }

  // Verify integrity
  const archiveData = readFileSync(entry.path);
  const currentChecksum = calculateChecksum(archiveData);

  if (currentChecksum !== entry.checksum) {
    throw new Error(
      `Backup integrity check failed. Expected checksum ${entry.checksum.slice(0, 16)}... but got ${currentChecksum.slice(0, 16)}... — archive may be corrupted.`,
    );
  }

  // Create a safety backup of current state before restoring
  let safetyBackupPath: string | undefined;
  try {
    const safetyId = generateId();
    const safetyFilename = `pre-restore-safety-${safetyId}.alfred.bak`;
    safetyBackupPath = join(BACKUP_DIR, safetyFilename);
    const { data } = createBackupArchive(ALFRED_HOME);
    writeFileSync(safetyBackupPath, data);
  } catch {
    // Continue even if safety backup fails
  }

  // Extract the archive
  const filesCount = extractBackupArchive(entry.path, ALFRED_HOME);

  return {
    restored: true,
    filesCount,
    warning: safetyBackupPath
      ? `Safety backup of previous state created at: ${safetyBackupPath}`
      : undefined,
  };
}

async function backupPrune(
  keepCount: number = 5,
): Promise<{ pruned: number; remaining: number }> {
  if (keepCount < 1) {
    throw new Error('Must keep at least 1 backup');
  }

  const manifest = loadManifest();

  // Sort by most recent first
  manifest.sort((a, b) => b.createdAt - a.createdAt);

  const toKeep = manifest.slice(0, keepCount);
  const toPrune = manifest.slice(keepCount);

  // Delete pruned backup files
  let deletedCount = 0;
  for (const entry of toPrune) {
    try {
      if (existsSync(entry.path)) {
        unlinkSync(entry.path);
      }
      deletedCount++;
    } catch {
      // Skip files that can't be deleted
    }
  }

  // Save updated manifest
  saveManifest(toKeep);

  return {
    pruned: deletedCount,
    remaining: toKeep.length,
  };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'backup-manager';
export const description = 'Backup and restore the ~/.alfred/ directory with compression and integrity verification';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'backup_create',
    description: 'Create a compressed backup of ~/.alfred/',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Optional label for this backup' },
      },
    },
  },
  {
    name: 'backup_list',
    description: 'List all available backups',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'backup_restore',
    description: 'Restore from a backup (creates safety backup of current state first)',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Backup ID to restore' },
      },
      required: ['id'],
    },
  },
  {
    name: 'backup_prune',
    description: 'Remove old backups, keeping the N most recent',
    parameters: {
      type: 'object',
      properties: {
        keepCount: { type: 'number', description: 'Number of backups to keep (default: 5)' },
      },
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'backup_create':
      return backupCreate(args.label as string | undefined);
    case 'backup_list':
      return backupList();
    case 'backup_restore':
      return backupRestore(args.id as string);
    case 'backup_prune':
      return backupPrune((args.keepCount as number) ?? 5);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
