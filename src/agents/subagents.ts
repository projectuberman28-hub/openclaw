/**
 * @alfred/agents - Subagent Manager
 *
 * Manages the lifecycle of subagents: spawning, tracking, archiving, and
 * enforcing concurrency limits.
 *
 * Subagents are short-lived agents spawned by a parent agent to perform
 * a specific task. They are automatically archived after a configurable
 * timeout period.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubagentConfig {
  /** Model to use for the subagent. */
  model: string;
  /** System prompt for the subagent. */
  systemPrompt?: string;
  /** Tools available to the subagent. */
  tools?: string[];
  /** Task description. */
  task: string;
  /** Timeout in milliseconds before auto-archival. Default 300000 (5 min). */
  timeoutMs?: number;
}

export interface SubagentInstance {
  id: string;
  parentId: string;
  config: SubagentConfig;
  status: 'active' | 'archived' | 'error';
  createdAt: number;
  archivedAt?: number;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// SubagentManager
// ---------------------------------------------------------------------------

export class SubagentManager {
  private instances = new Map<string, SubagentInstance>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private maxConcurrent: number;
  private defaultTimeoutMs: number;

  constructor(options?: { maxConcurrent?: number; defaultTimeoutMs?: number }) {
    this.maxConcurrent = options?.maxConcurrent ?? 5;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 300_000; // 5 minutes
  }

  /**
   * Spawn a new subagent.
   *
   * @param parentId - The ID of the parent agent.
   * @param config - Subagent configuration.
   * @returns The ID of the spawned subagent.
   * @throws If max concurrent subagents would be exceeded.
   */
  async spawn(parentId: string, config: SubagentConfig): Promise<string> {
    // Check concurrency limit
    const activeCount = this.getActiveCount();
    if (activeCount >= this.maxConcurrent) {
      throw new Error(
        `Max concurrent subagents (${this.maxConcurrent}) reached. ` +
        `Active: ${activeCount}. Archive or wait for existing subagents.`,
      );
    }

    const id = `sub_${randomUUID().slice(0, 8)}`;
    const timeoutMs = config.timeoutMs ?? this.defaultTimeoutMs;

    const instance: SubagentInstance = {
      id,
      parentId,
      config,
      status: 'active',
      createdAt: Date.now(),
    };

    this.instances.set(id, instance);

    // Set auto-archive timer
    const timer = setTimeout(() => {
      this.archive(id, 'Timed out');
    }, timeoutMs);

    this.timers.set(id, timer);

    console.log(
      `[SubagentManager] Spawned subagent "${id}" (parent: ${parentId}, ` +
      `timeout: ${timeoutMs}ms, task: ${config.task.slice(0, 80)})`,
    );

    return id;
  }

  /**
   * Archive a subagent (mark as done).
   */
  archive(id: string, result?: unknown): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    if (instance.status === 'archived') return;

    instance.status = 'archived';
    instance.archivedAt = Date.now();
    instance.result = result;

    // Clear the auto-archive timer
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    console.log(`[SubagentManager] Archived subagent "${id}"`);
  }

  /**
   * Mark a subagent as errored.
   */
  markError(id: string, error: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    instance.status = 'error';
    instance.error = error;
    instance.archivedAt = Date.now();

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    console.error(`[SubagentManager] Subagent "${id}" error: ${error}`);
  }

  /**
   * Get a subagent instance by ID.
   */
  getInstance(id: string): SubagentInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * List all subagents for a given parent.
   */
  listByParent(parentId: string): SubagentInstance[] {
    const result: SubagentInstance[] = [];
    for (const instance of this.instances.values()) {
      if (instance.parentId === parentId) {
        result.push({ ...instance });
      }
    }
    return result;
  }

  /**
   * List all active subagents.
   */
  listActive(): SubagentInstance[] {
    const result: SubagentInstance[] = [];
    for (const instance of this.instances.values()) {
      if (instance.status === 'active') {
        result.push({ ...instance });
      }
    }
    return result;
  }

  /**
   * Get the count of active subagents.
   */
  getActiveCount(): number {
    let count = 0;
    for (const instance of this.instances.values()) {
      if (instance.status === 'active') count++;
    }
    return count;
  }

  /**
   * Clean up archived subagents older than the given age.
   */
  cleanup(maxAgeMs: number = 3600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, instance] of this.instances.entries()) {
      if (
        instance.status !== 'active' &&
        instance.archivedAt &&
        instance.archivedAt < cutoff
      ) {
        this.instances.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Shut down all active subagents.
   */
  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const instance of this.instances.values()) {
      if (instance.status === 'active') {
        instance.status = 'archived';
        instance.archivedAt = Date.now();
        instance.result = 'Shutdown';
      }
    }
  }
}
