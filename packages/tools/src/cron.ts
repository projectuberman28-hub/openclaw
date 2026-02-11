/**
 * @alfred/tools - CronTool
 *
 * Manage scheduled tasks with:
 *   - Cron expression validation
 *   - In-memory task registry
 *   - Flat-param recovery (when LLM omits the job wrapper)
 *   - Create / list / delete operations
 *   - SafeExecutor integration
 */

import { nanoid } from 'nanoid';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:cron' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  name: string;
  schedule: string;
  command: string;
  createdAt: number;
  nextRun?: number;
  enabled: boolean;
}

export interface CronCreateArgs {
  /** Structured job parameter. */
  job?: {
    name: string;
    schedule: string;
    command: string;
  };
  /** Flat params – recovered when LLM omits job wrapper. */
  name?: string;
  schedule?: string;
  command?: string;
}

export interface CronDeleteArgs {
  name: string;
}

// ---------------------------------------------------------------------------
// Cron expression validation
// ---------------------------------------------------------------------------

/**
 * Validate a cron expression (5 or 6 fields).
 * Accepts standard cron (minute hour dom month dow) and
 * extended (second minute hour dom month dow).
 */
function isValidCron(expr: string): boolean {
  if (!expr || typeof expr !== 'string') return false;

  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return false;

  // Regex for a single cron field: number, range, step, list, wildcard, named
  const fieldRe =
    /^(\*|[0-9]{1,2}(-[0-9]{1,2})?(\/[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?(\/[0-9]{1,2})?)*)$/;
  // Named months/days
  const namedRe =
    /^(\*|[a-zA-Z]{3}(-[a-zA-Z]{3})?(,[a-zA-Z]{3}(-[a-zA-Z]{3})?)*)$/;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!fieldRe.test(part) && !namedRe.test(part) && part !== '?' && part !== 'L' && part !== 'W') {
      return false;
    }
  }

  return true;
}

/**
 * Compute a rough next-run timestamp from a cron expression.
 * This is a simplified calculation for display purposes only.
 */
function estimateNextRun(schedule: string): number {
  // Simple: return next minute boundary as a rough estimate
  const now = Date.now();
  return now + 60_000 - (now % 60_000);
}

// ---------------------------------------------------------------------------
// CronTool
// ---------------------------------------------------------------------------

export class CronTool {
  private executor: SafeExecutor;
  private tasks: Map<string, Task> = new Map();

  constructor(executor: SafeExecutor) {
    this.executor = executor;
  }

  static definition = {
    name: 'cron',
    description:
      'Create, list, or delete scheduled tasks. ' +
      'Schedule uses standard cron expressions (5 fields).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'delete'],
          description: 'Cron action',
        },
        job: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            schedule: { type: 'string' },
            command: { type: 'string' },
          },
          description: 'Job definition (for create)',
        },
        name: { type: 'string', description: 'Task name (for create flat / delete)' },
        schedule: { type: 'string', description: 'Cron expression (for create flat)' },
        command: { type: 'string', description: 'Command to run (for create flat)' },
      },
      required: ['action'],
    },
  };

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  async create(args: CronCreateArgs, execOpts?: ExecuteOptions): Promise<Task> {
    // Recover flat params when LLM omits job wrapper
    let name: string;
    let schedule: string;
    let command: string;

    if (args.job) {
      name = args.job.name;
      schedule = args.job.schedule;
      command = args.job.command;
    } else if (args.name && args.schedule && args.command) {
      // Flat param recovery
      name = args.name;
      schedule = args.schedule;
      command = args.command;
    } else {
      throw new Error(
        'CronTool.create: requires either a "job" object or "name", "schedule", and "command" fields',
      );
    }

    if (!name || typeof name !== 'string') {
      throw new Error('CronTool.create: "name" is required');
    }
    if (!schedule || typeof schedule !== 'string') {
      throw new Error('CronTool.create: "schedule" is required');
    }
    if (!command || typeof command !== 'string') {
      throw new Error('CronTool.create: "command" is required');
    }

    if (!isValidCron(schedule)) {
      throw new Error(`CronTool.create: invalid cron expression "${schedule}"`);
    }

    // Check for duplicate name
    if (this.tasks.has(name)) {
      throw new Error(`CronTool.create: task "${name}" already exists`);
    }

    const result = await this.executor.execute(
      'cron.create',
      async () => {
        const task: Task = {
          id: nanoid(),
          name,
          schedule,
          command,
          createdAt: Date.now(),
          nextRun: estimateNextRun(schedule),
          enabled: true,
        };

        this.tasks.set(name, task);
        logger.info({ task: name, schedule }, 'Scheduled task created');
        return task;
      },
      { timeout: 5_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as Task;
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  async list(execOpts?: ExecuteOptions): Promise<Task[]> {
    const result = await this.executor.execute(
      'cron.list',
      async () => {
        return Array.from(this.tasks.values());
      },
      { timeout: 5_000, ...execOpts },
    );

    if (result.error) {
      return [];
    }

    return result.result as Task[];
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  async delete(args: CronDeleteArgs, execOpts?: ExecuteOptions): Promise<boolean> {
    if (!args.name || typeof args.name !== 'string') {
      throw new Error('CronTool.delete: "name" is required');
    }

    const result = await this.executor.execute(
      'cron.delete',
      async () => {
        if (!this.tasks.has(args.name)) {
          logger.warn({ task: args.name }, 'Task not found for deletion');
          return false;
        }

        this.tasks.delete(args.name);
        logger.info({ task: args.name }, 'Scheduled task deleted');
        return true;
      },
      { timeout: 5_000, ...execOpts },
    );

    if (result.error) {
      return false;
    }

    return result.result as boolean;
  }

  /**
   * Get a task by name (for internal use / testing).
   */
  getTask(name: string): Task | undefined {
    return this.tasks.get(name);
  }
}
