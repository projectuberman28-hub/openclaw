/**
 * @alfred/skills - Skill Watcher
 *
 * Watches skill directories for changes and triggers auto-reload.
 * Uses Node.js fs.watch (chokidar-compatible interface without the dependency).
 */

import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatcherOptions {
  /** Debounce delay in ms for change events. Default 500. */
  debounceMs?: number;
  /** File patterns to watch (defaults to ['skill.json', '*.ts', '*.js']). */
  patterns?: string[];
}

export type WatchEvent = 'skill:added' | 'skill:changed' | 'skill:removed';

// ---------------------------------------------------------------------------
// SkillWatcher
// ---------------------------------------------------------------------------

export class SkillWatcher extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private debounceMs: number;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private watching = false;
  private watchDirs: string[] = [];

  constructor(options?: WatcherOptions) {
    super();
    this.debounceMs = options?.debounceMs ?? 500;
  }

  /**
   * Start watching the given directories for skill changes.
   */
  start(dirs: string[]): void {
    if (this.watching) {
      this.stop();
    }

    this.watchDirs = dirs.filter((dir) => existsSync(dir));

    for (const dir of this.watchDirs) {
      try {
        const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;

          // Only react to relevant file changes
          const base = basename(filename);
          if (
            base === 'skill.json' ||
            base === 'package.json' ||
            base.endsWith('.ts') ||
            base.endsWith('.js')
          ) {
            this.debouncedEmit(dir, eventType, filename);
          }
        });

        watcher.on('error', (err) => {
          console.error(`[SkillWatcher] Watch error on ${dir}:`, err);
        });

        this.watchers.push(watcher);
      } catch (err) {
        console.error(`[SkillWatcher] Failed to watch ${dir}:`, err);
      }
    }

    this.watching = true;
    console.log(`[SkillWatcher] Watching ${this.watchDirs.length} directories`);
  }

  /**
   * Stop watching all directories.
   */
  stop(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    }

    this.watchers = [];
    this.watching = false;

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.log('[SkillWatcher] Stopped');
  }

  /**
   * Check if the watcher is currently active.
   */
  isWatching(): boolean {
    return this.watching;
  }

  /**
   * Get the list of directories being watched.
   */
  getWatchedDirs(): string[] {
    return [...this.watchDirs];
  }

  /**
   * Debounced event emission to avoid rapid-fire reloads.
   */
  private debouncedEmit(dir: string, eventType: string, filename: string): void {
    const key = `${dir}:${filename}`;

    // Clear existing timer for this file
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);

      // Determine the event type
      const watchEvent: WatchEvent =
        eventType === 'rename' ? 'skill:added' : 'skill:changed';

      this.emit(watchEvent, {
        dir,
        filename,
        eventType,
      });

      // Also emit a generic change event
      this.emit('change', {
        event: watchEvent,
        dir,
        filename,
      });
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }
}
