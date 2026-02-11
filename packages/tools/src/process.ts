/**
 * @alfred/tools - ProcessTool
 *
 * Manage running processes:
 *   - list()      – enumerate running processes with CPU/memory info
 *   - kill(pid)   – terminate a process by PID
 *   - isRunning() – check whether a given PID is still alive
 */

import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:process' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
}

// ---------------------------------------------------------------------------
// ProcessTool
// ---------------------------------------------------------------------------

export class ProcessTool {
  private executor: SafeExecutor;

  constructor(executor: SafeExecutor) {
    this.executor = executor;
  }

  static definition = {
    name: 'process',
    description: 'List, check, or kill running processes.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'kill', 'isRunning'],
          description: 'Action to perform',
        },
        pid: { type: 'number', description: 'Process ID (required for kill / isRunning)' },
      },
      required: ['action'],
    },
  };

  /**
   * List running processes.
   */
  async list(execOpts?: ExecuteOptions): Promise<ProcessInfo[]> {
    const result = await this.executor.execute(
      'process.list',
      async () => {
        const isWin = platform() === 'win32';

        if (isWin) {
          return this.listWindows();
        }
        return this.listUnix();
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      logger.error({ error: result.error }, 'Failed to list processes');
      return [];
    }

    return result.result as ProcessInfo[];
  }

  /**
   * Kill a process by PID.
   */
  async kill(pid: number, execOpts?: ExecuteOptions): Promise<boolean> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error('ProcessTool.kill: pid must be a positive integer');
    }

    const result = await this.executor.execute(
      'process.kill',
      async () => {
        try {
          process.kill(pid, 'SIGTERM');

          // Give it a moment, then force-kill if still alive
          await new Promise((r) => setTimeout(r, 2000));
          if (this.isRunning(pid)) {
            process.kill(pid, 'SIGKILL');
          }
          return true;
        } catch (err: any) {
          if (err?.code === 'ESRCH') {
            // Process already gone
            return true;
          }
          throw err;
        }
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      logger.warn({ pid, error: result.error }, 'Failed to kill process');
      return false;
    }

    return result.result as boolean;
  }

  /**
   * Check whether a PID is alive.
   */
  isRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;

    try {
      // signal 0 tests existence without actually sending a signal
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Platform-specific listing
  // -----------------------------------------------------------------------

  private listUnix(): ProcessInfo[] {
    try {
      const raw = execSync('ps -eo pid,pcpu,pmem,comm,args --no-headers', {
        encoding: 'utf-8',
        timeout: 10_000,
      });

      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[0] ?? '0', 10);
          const cpu = parseFloat(parts[1] ?? '0');
          const memory = parseFloat(parts[2] ?? '0');
          const name = parts[3] ?? '';
          const command = parts.slice(4).join(' ') || name;
          return { pid, name, command, cpu, memory };
        })
        .filter((p) => p.pid > 0);
    } catch {
      return [];
    }
  }

  private listWindows(): ProcessInfo[] {
    try {
      const raw = execSync(
        'wmic process get ProcessId,Name,CommandLine,PercentProcessorTime,WorkingSetSize /format:csv',
        { encoding: 'utf-8', timeout: 15_000 },
      );

      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      // First non-empty line is headers
      const dataLines = lines.slice(1);

      return dataLines
        .map((line) => {
          const parts = line.split(',');
          // CSV format: Node,CommandLine,Name,PercentProcessorTime,ProcessId,WorkingSetSize
          if (parts.length < 6) return null;
          const command = (parts[1] ?? '').trim();
          const name = (parts[2] ?? '').trim();
          const cpu = parseFloat(parts[3] ?? '0') || 0;
          const pid = parseInt(parts[4] ?? '0', 10);
          const memBytes = parseInt(parts[5] ?? '0', 10) || 0;
          const memory = Math.round((memBytes / 1024 / 1024) * 100) / 100; // MB
          return { pid, name, command: command || name, cpu, memory };
        })
        .filter((p): p is ProcessInfo => p !== null && p.pid > 0);
    } catch {
      // Fallback: tasklist
      try {
        const raw = execSync('tasklist /fo csv /nh', {
          encoding: 'utf-8',
          timeout: 10_000,
        });

        return raw
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const match = line.match(/"([^"]*)".*?"(\d+)".*?"([^"]*)".*?"([^"]*)"/);
            if (!match) return null;
            return {
              pid: parseInt(match[2], 10),
              name: match[1],
              command: match[1],
              cpu: 0,
              memory: parseInt(match[4].replace(/[^\d]/g, ''), 10) / 1024 || 0,
            };
          })
          .filter((p): p is ProcessInfo => p !== null && p.pid > 0);
      } catch {
        return [];
      }
    }
  }
}
