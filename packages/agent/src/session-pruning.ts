/**
 * @alfred/agent - Session Pruning
 *
 * Manages lifecycle cleanup of old sessions: archiving or deleting
 * sessions that exceed age or count thresholds. Never prunes active sessions.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAlfredHome } from '@alfred/core';
import type { Session } from './session.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PruneOptions {
  /** Maximum age in ms. Sessions older than this are eligible for pruning. */
  maxAge?: number;
  /** Maximum number of sessions to retain. Oldest sessions beyond this count are pruned. */
  maxSessions?: number;
  /** If true, never prune sessions that are still active (default: true) */
  keepActive: boolean;
}

export interface PruneResult {
  /** Number of sessions permanently deleted */
  pruned: number;
  /** Number of sessions moved to archive */
  archived: number;
  /** Number of sessions kept */
  kept: number;
}

// ---------------------------------------------------------------------------
// SessionPruner
// ---------------------------------------------------------------------------

export class SessionPruner {
  private sessionsDir: string;
  private archiveDir: string;

  /**
   * Create a new SessionPruner.
   *
   * @param sessionsDir - Override the sessions directory (defaults to ALFRED_HOME/sessions/)
   */
  constructor(sessionsDir?: string) {
    const home = resolveAlfredHome();
    this.sessionsDir = sessionsDir ?? join(home, 'sessions');
    this.archiveDir = join(this.sessionsDir, 'archive');

    // Ensure directories exist
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
    if (!existsSync(this.archiveDir)) {
      mkdirSync(this.archiveDir, { recursive: true });
    }
  }

  /**
   * Prune sessions based on the provided options.
   *
   * Strategy:
   *   1. Load all session files from the sessions directory.
   *   2. Sort by lastActivity (most recent first).
   *   3. Mark sessions as "prunable" if they exceed maxAge OR exceed maxSessions count.
   *   4. Never prune sessions with recent activity if keepActive is true.
   *   5. Archive prunable sessions (move to archive/).
   *   6. Optionally delete very old archived sessions.
   */
  async prune(options: PruneOptions): Promise<PruneResult> {
    const sessions = this.loadAllSessions();
    const now = Date.now();

    // Default activity threshold: 5 minutes
    const activeThreshold = 5 * 60 * 1000;

    // Sort by lastActivity descending (most recent first)
    sessions.sort((a, b) => b.lastActivity - a.lastActivity);

    let pruned = 0;
    let archived = 0;
    let kept = 0;

    const toArchive: Session[] = [];
    const toKeep: Session[] = [];

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const age = now - session.lastActivity;
      const isActive = options.keepActive && age < activeThreshold;

      // Never prune active sessions
      if (isActive) {
        toKeep.push(session);
        continue;
      }

      let shouldPrune = false;

      // Check age threshold
      if (options.maxAge !== undefined && age > options.maxAge) {
        shouldPrune = true;
      }

      // Check count threshold (sessions beyond maxSessions are prunable)
      if (options.maxSessions !== undefined) {
        // Count how many we've already decided to keep
        const keptCount = toKeep.length;
        if (keptCount >= options.maxSessions) {
          shouldPrune = true;
        }
      }

      if (shouldPrune) {
        toArchive.push(session);
      } else {
        toKeep.push(session);
      }
    }

    // Perform archival
    for (const session of toArchive) {
      try {
        this.archiveSession(session);
        archived++;
      } catch (err) {
        console.error(`Failed to archive session ${session.id}:`, err);
      }
    }

    kept = toKeep.length;

    // Clean up very old archives (older than 30 days)
    pruned = this.cleanOldArchives(30 * 24 * 60 * 60 * 1000);

    return { pruned, archived, kept };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Load all sessions from the sessions directory.
   */
  private loadAllSessions(): Session[] {
    const sessions: Session[] = [];

    try {
      if (!existsSync(this.sessionsDir)) return sessions;

      const files = readdirSync(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.sessionsDir, file);
        try {
          // Skip directories (like 'archive/')
          const stat = statSync(filePath);
          if (stat.isDirectory()) continue;

          const data = readFileSync(filePath, 'utf-8');
          const session: Session = JSON.parse(data);
          if (session.id) {
            sessions.push(session);
          }
        } catch (err) {
          console.error(`Failed to load session from ${file}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to read sessions directory:', err);
    }

    return sessions;
  }

  /**
   * Archive a session by moving its JSON file to the archive directory.
   */
  private archiveSession(session: Session): void {
    const sourcePath = join(this.sessionsDir, `${session.id}.json`);
    const archivePath = join(this.archiveDir, `${session.id}.json`);

    // Write to archive
    writeFileSync(archivePath, JSON.stringify(session, null, 2), 'utf-8');

    // Remove original
    if (existsSync(sourcePath)) {
      unlinkSync(sourcePath);
    }
  }

  /**
   * Delete archived sessions that are older than the specified age.
   * Returns the number of files deleted.
   */
  private cleanOldArchives(maxAge: number): number {
    const now = Date.now();
    let deleted = 0;

    try {
      if (!existsSync(this.archiveDir)) return 0;

      const files = readdirSync(this.archiveDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.archiveDir, file);
        try {
          const data = readFileSync(filePath, 'utf-8');
          const session: Session = JSON.parse(data);

          if (now - session.lastActivity > maxAge) {
            unlinkSync(filePath);
            deleted++;
          }
        } catch (err) {
          // If we can't parse the file, check file modification time instead
          try {
            const stat = statSync(filePath);
            if (now - stat.mtimeMs > maxAge) {
              unlinkSync(filePath);
              deleted++;
            }
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch (err) {
      console.error('Failed to clean old archives:', err);
    }

    return deleted;
  }
}
