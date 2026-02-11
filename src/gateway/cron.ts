/**
 * @alfred/gateway - Cron / Scheduled Tasks
 *
 * Manages scheduled tasks for the Alfred gateway.
 * Wraps Node.js timers into a cron-like system with named tasks,
 * cron-expression-style scheduling, and execution tracking.
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledTask {
  id: string;
  name: string;
  /** Cron-like description for display purposes. */
  schedule: string;
  /** Interval in milliseconds for the timer. */
  intervalMs: number;
  /** Whether this task is currently enabled. */
  enabled: boolean;
  /** The handler to execute. */
  handler: () => Promise<void> | void;
  /** Last execution time. */
  lastRun?: Date;
  /** Next scheduled execution. */
  nextRun?: Date;
  /** Whether the task is currently executing. */
  running: boolean;
}

interface TimerEntry {
  task: ScheduledTask;
  timer: ReturnType<typeof setInterval> | null;
  initialTimer: ReturnType<typeof setTimeout> | null;
}

export interface TaskDefinition {
  id: string;
  name: string;
  schedule: string;
  intervalMs: number;
  enabled?: boolean;
  handler: () => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Time Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate milliseconds until the next occurrence of a given hour:minute.
 */
function msUntilTime(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);

  if (target.getTime() <= now.getTime()) {
    // Already passed today, schedule for tomorrow
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Calculate ms until next Monday at a given time.
 */
function msUntilNextDayOfWeek(dayOfWeek: number, hour: number, minute: number): number {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);

  const currentDay = now.getDay();
  let daysUntil = dayOfWeek - currentDay;

  if (daysUntil < 0 || (daysUntil === 0 && target.getTime() <= now.getTime())) {
    daysUntil += 7;
  }

  target.setDate(target.getDate() + daysUntil);
  return target.getTime() - now.getTime();
}

// ---------------------------------------------------------------------------
// GatewayCron
// ---------------------------------------------------------------------------

export class GatewayCron extends EventEmitter {
  private timers = new Map<string, TimerEntry>();
  private running = false;

  constructor() {
    super();
  }

  /**
   * Load the default scheduled tasks for Alfred.
   */
  loadDefaultTasks(): void {
    // Morning Briefing - 6:00 AM daily
    this.addTask({
      id: 'morning-briefing',
      name: 'Morning Briefing',
      schedule: '0 6 * * *',
      intervalMs: 24 * 60 * 60 * 1000, // 24 hours
      handler: async () => {
        this.emit('task:execute', {
          taskId: 'morning-briefing',
          type: 'briefing',
          message: 'Generate morning briefing with calendar, weather, and priorities',
        });
      },
    });

    // End of Shift - midnight daily
    this.addTask({
      id: 'end-of-shift',
      name: 'End of Shift Summary',
      schedule: '0 0 * * *',
      intervalMs: 24 * 60 * 60 * 1000,
      handler: async () => {
        this.emit('task:execute', {
          taskId: 'end-of-shift',
          type: 'summary',
          message: 'Generate daily summary of completed tasks and key events',
        });
      },
    });

    // Weekly Strategy - Monday 9:00 AM
    this.addTask({
      id: 'weekly-strategy',
      name: 'Weekly Strategy Review',
      schedule: '0 9 * * 1',
      intervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      handler: async () => {
        this.emit('task:execute', {
          taskId: 'weekly-strategy',
          type: 'strategy',
          message: 'Analyze playbook patterns and suggest strategic adjustments',
        });
      },
    });

    // Health Check - every 30 minutes
    this.addTask({
      id: 'health-check',
      name: 'Service Health Check',
      schedule: '*/30 * * * *',
      intervalMs: 30 * 60 * 1000, // 30 minutes
      handler: async () => {
        this.emit('task:execute', {
          taskId: 'health-check',
          type: 'health',
          message: 'Check health of all Alfred services',
        });
      },
    });
  }

  /**
   * Add a scheduled task.
   */
  addTask(definition: TaskDefinition): void {
    const task: ScheduledTask = {
      id: definition.id,
      name: definition.name,
      schedule: definition.schedule,
      intervalMs: definition.intervalMs,
      enabled: definition.enabled ?? true,
      handler: definition.handler,
      running: false,
    };

    // Stop existing task with same ID if any
    if (this.timers.has(task.id)) {
      this.removeTask(task.id);
    }

    const entry: TimerEntry = {
      task,
      timer: null,
      initialTimer: null,
    };

    this.timers.set(task.id, entry);

    // If cron is running, start the timer immediately
    if (this.running && task.enabled) {
      this.startTimer(entry);
    }
  }

  /**
   * Remove a scheduled task by ID.
   */
  removeTask(id: string): boolean {
    const entry = this.timers.get(id);
    if (!entry) return false;

    this.stopTimer(entry);
    this.timers.delete(id);
    return true;
  }

  /**
   * Start all enabled scheduled tasks.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    for (const entry of this.timers.values()) {
      if (entry.task.enabled) {
        this.startTimer(entry);
      }
    }

    console.log(`[GatewayCron] Started ${this.timers.size} scheduled tasks`);
  }

  /**
   * Stop all scheduled tasks.
   */
  stop(): void {
    this.running = false;

    for (const entry of this.timers.values()) {
      this.stopTimer(entry);
    }

    console.log('[GatewayCron] All tasks stopped');
  }

  /**
   * List all registered tasks.
   */
  listTasks(): ScheduledTask[] {
    return Array.from(this.timers.values()).map((entry) => ({ ...entry.task }));
  }

  /**
   * Get a specific task by ID.
   */
  getTask(id: string): ScheduledTask | undefined {
    const entry = this.timers.get(id);
    return entry ? { ...entry.task } : undefined;
  }

  /**
   * Enable or disable a task.
   */
  setTaskEnabled(id: string, enabled: boolean): boolean {
    const entry = this.timers.get(id);
    if (!entry) return false;

    entry.task.enabled = enabled;

    if (this.running) {
      if (enabled) {
        this.startTimer(entry);
      } else {
        this.stopTimer(entry);
      }
    }

    return true;
  }

  /**
   * Start the timer for a single task entry.
   */
  private startTimer(entry: TimerEntry): void {
    const { task } = entry;

    // Calculate initial delay based on schedule
    let initialDelayMs = 0;

    // Parse simple cron-like patterns for initial delay
    if (task.schedule.startsWith('*/')) {
      // Interval-based: run after intervalMs
      initialDelayMs = task.intervalMs;
    } else {
      const parts = task.schedule.split(' ');
      if (parts.length >= 5) {
        const minute = parseInt(parts[0] ?? '0', 10);
        const hour = parseInt(parts[1] ?? '0', 10);
        const dayOfWeek = parts[4] !== '*' ? parseInt(parts[4] ?? '0', 10) : -1;

        if (dayOfWeek >= 0) {
          initialDelayMs = msUntilNextDayOfWeek(dayOfWeek, hour, minute);
        } else {
          initialDelayMs = msUntilTime(hour, minute);
        }
      }
    }

    task.nextRun = new Date(Date.now() + initialDelayMs);

    // Set initial delay, then repeat at interval
    entry.initialTimer = setTimeout(() => {
      this.executeTask(entry);

      // Set up recurring timer
      entry.timer = setInterval(() => {
        this.executeTask(entry);
      }, task.intervalMs);
    }, initialDelayMs);
  }

  /**
   * Stop the timer for a single task entry.
   */
  private stopTimer(entry: TimerEntry): void {
    if (entry.initialTimer) {
      clearTimeout(entry.initialTimer);
      entry.initialTimer = null;
    }
    if (entry.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  }

  /**
   * Execute a task, tracking state and catching errors.
   */
  private async executeTask(entry: TimerEntry): Promise<void> {
    const { task } = entry;

    if (task.running) {
      console.warn(`[GatewayCron] Task "${task.name}" is already running, skipping`);
      return;
    }

    task.running = true;
    task.lastRun = new Date();
    task.nextRun = new Date(Date.now() + task.intervalMs);

    try {
      await task.handler();
      this.emit('task:completed', { taskId: task.id, name: task.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[GatewayCron] Task "${task.name}" failed:`, message);
      this.emit('task:error', { taskId: task.id, name: task.name, error: message });
    } finally {
      task.running = false;
    }
  }
}
