/**
 * @alfred/tools - ExecTool
 *
 * Execute shell commands with:
 *   - Configurable timeout (default 1800s foreground, 10s background wait)
 *   - Background mode (spawn detached, return PID)
 *   - ANSI code stripping from output
 *   - Process kill on timeout
 *   - SafeExecutor wrapper
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:exec' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecArgs {
  /** The shell command to execute. */
  command: string;
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Per-call timeout in ms. Overrides the tool-level default. */
  timeout?: number;
  /** If true, spawn detached and return PID immediately. */
  background?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Present only when background === true. */
  pid?: number;
}

export interface ExecToolConfig {
  /** Timeout (ms) for foreground commands. Default 1 800 000 (30 min). */
  timeoutMs?: number;
  /** How long (ms) to wait for a background process to start before returning. Default 10 000. */
  backgroundMs?: number;
}

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ---------------------------------------------------------------------------
// ExecTool
// ---------------------------------------------------------------------------

export class ExecTool {
  private executor: SafeExecutor;
  private timeoutMs: number;
  private backgroundMs: number;

  constructor(executor: SafeExecutor, config: ExecToolConfig = {}) {
    this.executor = executor;
    this.timeoutMs = config.timeoutMs ?? 1_800_000; // 30 min
    this.backgroundMs = config.backgroundMs ?? 10_000;
  }

  /** Metadata exposed to the LLM via the tool registry. */
  static definition = {
    name: 'exec',
    description:
      'Execute a shell command. Returns stdout, stderr, and exit code. ' +
      'Set background=true to run detached and receive the PID.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout: { type: 'number', description: 'Timeout in ms (optional)' },
        background: { type: 'boolean', description: 'Run in background (optional)' },
      },
      required: ['command'],
    },
  };

  /**
   * Execute a shell command.
   */
  async execute(args: ExecArgs, execOpts?: ExecuteOptions): Promise<ExecResult> {
    if (!args.command || typeof args.command !== 'string') {
      throw new Error('ExecTool: "command" is required and must be a string');
    }

    const timeout = args.timeout ?? (args.background ? this.backgroundMs : this.timeoutMs);

    const result = await this.executor.execute(
      'exec',
      () => (args.background ? this.runBackground(args) : this.runForeground(args, timeout)),
      { timeout, ...execOpts },
    );

    if (result.error) {
      return { stdout: '', stderr: result.error, exitCode: 1 };
    }

    return result.result as ExecResult;
  }

  // -----------------------------------------------------------------------
  // Foreground
  // -----------------------------------------------------------------------

  private runForeground(args: ExecArgs, timeout: number): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      const isWin = platform() === 'win32';
      const shell = isWin ? 'cmd' : '/bin/sh';
      const shellFlag = isWin ? '/c' : '-c';

      const proc = spawn(shell, [shellFlag, args.command], {
        cwd: args.cwd ?? process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // Timeout kill
      const timer = setTimeout(() => {
        logger.warn({ command: args.command, timeout }, 'Killing timed-out process');
        try {
          proc.kill('SIGKILL');
        } catch {
          // Already exited
        }
        resolve({
          stdout: stripAnsi(Buffer.concat(stdoutChunks).toString('utf-8')),
          stderr: stripAnsi(
            Buffer.concat(stderrChunks).toString('utf-8') +
              `\n[Process killed: timeout after ${timeout}ms]`,
          ),
          exitCode: 137,
        });
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout: stripAnsi(Buffer.concat(stdoutChunks).toString('utf-8')),
          stderr: stripAnsi(Buffer.concat(stderrChunks).toString('utf-8')),
          exitCode: code ?? 1,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Background
  // -----------------------------------------------------------------------

  private async runBackground(args: ExecArgs): Promise<ExecResult> {
    const isWin = platform() === 'win32';
    const shell = isWin ? 'cmd' : '/bin/sh';
    const shellFlag = isWin ? '/c' : '-c';

    const proc = spawn(shell, [shellFlag, args.command], {
      cwd: args.cwd ?? process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    // Un-ref so the parent process can exit even if the child is still running
    proc.unref();

    const pid = proc.pid;
    if (!pid) {
      throw new Error('Failed to obtain PID for background process');
    }

    logger.info({ pid, command: args.command }, 'Background process started');

    return {
      stdout: `Background process started with PID ${pid}`,
      stderr: '',
      exitCode: 0,
      pid,
    };
  }
}
