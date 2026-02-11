/**
 * @alfred/core - Task Scheduler
 *
 * node-cron based scheduler that loads tasks from a TASKS.md file,
 * watches for live changes via chokidar, and manages scheduled execution.
 *
 * TASKS.md format (parsed from markdown):
 * ```
 * ## Tasks
 *
 * - [x] Daily backup | 0 2 * * * | backup-all
 * - [ ] Weekly report | 0 9 * * 1 | generate-report
 * - [x] Hourly health check | 0 * * * * | health-check
 * ```
 *
 * Each line: `- [x|_] Name | cron expression | command`
 *   [x] = enabled, [ ] = disabled
 */

import cron from 'node-cron';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { watch, type FSWatcher } from 'chokidar';
import { EventEmitter } from 'node:events';
import { buildPaths } from '../config/paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  lastRun: number | null;
  lastResult: string | null;
}

export interface TaskSchedulerOptions {
  tasksFilePath?: string;
  watchFile?: boolean;
  onTaskRun?: (task: ScheduledTask) => Promise<string>;
}

// ---------------------------------------------------------------------------
// TASKS.md parser
// ---------------------------------------------------------------------------

const TASK_LINE_RE = /^-\s*\[([ xX])\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$/;

function parseTasksFile(content: string): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(TASK_LINE_RE);
    if (!match) continue;

    const enabled = match[1]!.toLowerCase() === 'x';
    const name = match[2]!.trim();
    const cronExpr = match[3]!.trim();
    const command = match[4]!.trim();

    // Generate a stable ID from the name
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Validate cron expression
    if (!cron.validate(cronExpr)) {
      continue; // Skip invalid cron expressions
    }

    tasks.push({
      id,
      name,
      cron: cronExpr,
      command,
      enabled,
      lastRun: null,
      lastResult: null,
    });
  }

  return tasks;
}

function serializeTasksFile(tasks: ScheduledTask[]): string {
  const lines = ['## Tasks', ''];

  for (const task of tasks) {
    const check = task.enabled ? 'x' : ' ';
    lines.push(`- [${check}] ${task.name} | ${task.cron} | ${task.command}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// TaskScheduler
// ---------------------------------------------------------------------------

export class TaskScheduler extends EventEmitter {
  private tasks: Map<string, ScheduledTask> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private watcher: FSWatcher | null = null;
  private tasksFilePath: string;
  private watchEnabled: boolean;
  private onTaskRun: (task: ScheduledTask) => Promise<string>;
  private running = false;

  constructor(options: TaskSchedulerOptions = {}) {
    super();
    const paths = buildPaths();
    this.tasksFilePath = options.tasksFilePath ?? paths.tasksFile;
    this.watchEnabled = options.watchFile ?? true;
    this.onTaskRun = options.onTaskRun ?? defaultTaskRunner;
  }

  /**
   * Start the scheduler: load tasks, schedule cron jobs, start file watcher.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.loadFromFile();
    this.scheduleAll();

    if (this.watchEnabled) {
      this.startWatcher();
    }

    this.emit('started');
  }

  /**
   * Stop the scheduler: cancel all cron jobs and stop file watcher.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    // Stop all cron jobs
    for (const [id, job] of this.cronJobs) {
      job.stop();
      this.cronJobs.delete(id);
    }

    // Stop file watcher
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }

    this.emit('stopped');
  }

  /**
   * Load tasks from the TASKS.md file.
   */
  private loadFromFile(): void {
    if (!existsSync(this.tasksFilePath)) {
      return;
    }

    try {
      const content = readFileSync(this.tasksFilePath, 'utf-8');
      const parsed = parseTasksFile(content);

      // Preserve lastRun/lastResult from existing tasks
      for (const task of parsed) {
        const existing = this.tasks.get(task.id);
        if (existing) {
          task.lastRun = existing.lastRun;
          task.lastResult = existing.lastResult;
        }
        this.tasks.set(task.id, task);
      }

      // Remove tasks no longer in the file
      const parsedIds = new Set(parsed.map((t) => t.id));
      for (const id of this.tasks.keys()) {
        if (!parsedIds.has(id)) {
          this.tasks.delete(id);
        }
      }
    } catch (err) {
      this.emit('error', new Error(`Failed to load tasks: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  /**
   * Start watching the TASKS.md file for changes.
   */
  private startWatcher(): void {
    this.watcher = watch(this.tasksFilePath, {
      persistent: false,
      ignoreInitial: true,
    });

    this.watcher.on('change', () => {
      this.emit('file-changed');
      this.reload();
    });

    this.watcher.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Reload tasks from file and reschedule.
   */
  private reload(): void {
    // Cancel existing jobs
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();

    // Reload and reschedule
    this.loadFromFile();
    this.scheduleAll();

    this.emit('reloaded', this.listTasks());
  }

  /**
   * Schedule cron jobs for all enabled tasks.
   */
  private scheduleAll(): void {
    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.scheduleCronJob(task);
      }
    }
  }

  /**
   * Schedule a single cron job.
   */
  private scheduleCronJob(task: ScheduledTask): void {
    // Remove existing job if any
    const existing = this.cronJobs.get(task.id);
    if (existing) {
      existing.stop();
    }

    const job = cron.schedule(task.cron, async () => {
      const startTime = Date.now();
      task.lastRun = startTime;

      this.emit('task-running', task);

      try {
        const result = await this.onTaskRun(task);
        task.lastResult = result;
        this.emit('task-completed', task, result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        task.lastResult = `ERROR: ${errorMsg}`;
        this.emit('task-failed', task, errorMsg);
      }
    });

    this.cronJobs.set(task.id, job);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Add a new task and persist to TASKS.md.
   */
  addTask(task: Omit<ScheduledTask, 'lastRun' | 'lastResult'>): ScheduledTask {
    if (!cron.validate(task.cron)) {
      throw new Error(`Invalid cron expression: "${task.cron}"`);
    }

    const fullTask: ScheduledTask = {
      ...task,
      lastRun: null,
      lastResult: null,
    };

    this.tasks.set(task.id, fullTask);

    if (task.enabled && this.running) {
      this.scheduleCronJob(fullTask);
    }

    this.persistToFile();
    this.emit('task-added', fullTask);

    return fullTask;
  }

  /**
   * Remove a task by ID and persist.
   */
  removeTask(id: string): boolean {
    const existed = this.tasks.delete(id);

    if (existed) {
      const job = this.cronJobs.get(id);
      if (job) {
        job.stop();
        this.cronJobs.delete(id);
      }

      this.persistToFile();
      this.emit('task-removed', id);
    }

    return existed;
  }

  /**
   * List all tasks.
   */
  listTasks(): ScheduledTask[] {
    return [...this.tasks.values()];
  }

  /**
   * Get the next scheduled run time for a task.
   */
  getNextRun(id: string): Date | null {
    const task = this.tasks.get(id);
    if (!task || !task.enabled) return null;

    // Use node-cron's internal parser to compute next run
    // node-cron v3 doesn't expose a next-run API directly,
    // so we compute it ourselves from the cron expression.
    return computeNextRun(task.cron);
  }

  /**
   * Get a single task by ID.
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Enable or disable a task.
   */
  setTaskEnabled(id: string, enabled: boolean): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.enabled = enabled;

    if (enabled && this.running) {
      this.scheduleCronJob(task);
    } else {
      const job = this.cronJobs.get(id);
      if (job) {
        job.stop();
        this.cronJobs.delete(id);
      }
    }

    this.persistToFile();
    return true;
  }

  /**
   * Persist current tasks to the TASKS.md file.
   */
  private persistToFile(): void {
    try {
      const content = serializeTasksFile([...this.tasks.values()]);
      writeFileSync(this.tasksFilePath, content, 'utf-8');
    } catch (err) {
      this.emit('error', new Error(`Failed to persist tasks: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default task runner - just logs the command.
 */
async function defaultTaskRunner(task: ScheduledTask): Promise<string> {
  return `Task "${task.name}" executed command: ${task.command}`;
}

/**
 * Compute the next run time from a cron expression.
 * Simple implementation for standard 5-field cron expressions.
 */
function computeNextRun(cronExpr: string): Date | null {
  try {
    const now = new Date();
    const parts = cronExpr.split(/\s+/);
    if (parts.length < 5) return null;

    // Start from the next minute
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    // Try up to 527040 minutes (1 year) to find the next match
    const maxIterations = 527040;
    for (let i = 0; i < maxIterations; i++) {
      if (matchesCron(candidate, parts)) {
        return candidate;
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a date matches a 5-field cron expression.
 */
function matchesCron(date: Date, parts: string[]): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay(); // 0=Sun

  return (
    matchesField(minute, parts[0]!, 0, 59) &&
    matchesField(hour, parts[1]!, 0, 23) &&
    matchesField(dayOfMonth, parts[2]!, 1, 31) &&
    matchesField(month, parts[3]!, 1, 12) &&
    matchesField(dayOfWeek, parts[4]!, 0, 7) // 0 and 7 both mean Sunday
  );
}

/**
 * Check if a value matches a cron field (supports *, ranges, steps, lists).
 */
function matchesField(value: number, field: string, min: number, max: number): boolean {
  if (field === '*') return true;

  // Handle lists (comma-separated)
  const parts = field.split(',');

  for (const part of parts) {
    // Handle step values (*/n or range/n)
    const stepParts = part.split('/');
    const rangePart = stepParts[0]!;
    const step = stepParts[1] ? parseInt(stepParts[1], 10) : 1;

    if (isNaN(step) || step <= 0) continue;

    let rangeStart: number;
    let rangeEnd: number;

    if (rangePart === '*') {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes('-')) {
      const [s, e] = rangePart.split('-').map((n) => parseInt(n, 10));
      rangeStart = s ?? min;
      rangeEnd = e ?? max;
    } else {
      const exact = parseInt(rangePart, 10);
      if (!isNaN(exact) && exact === value) return true;
      continue;
    }

    // Check if value falls in range with step
    for (let i = rangeStart; i <= rangeEnd; i += step) {
      if (i === value) return true;
    }
  }

  return false;
}
