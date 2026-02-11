/**
 * @alfred/forge - Forge Sandbox
 *
 * Executes forged skill code in an isolated environment.
 * Two modes:
 *   1. Docker (preferred): --network none, --read-only, resource-limited
 *   2. Node.js vm (fallback): restricted global context, no dangerous modules
 *
 * ONLY curated/ and bundled/ skills skip the sandbox.
 * All forged/ skills ALWAYS run sandboxed on first execution.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as vm from 'node:vm';
import pino from 'pino';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxOptions {
  /** Execution timeout in ms (default: 60_000) */
  timeout?: number;
  /** Memory limit as Docker format string, e.g. "512m" (default: "512m") */
  memory?: string;
  /** Allow network access (default: false) */
  network?: boolean;
}

export interface SandboxResult {
  output: string;
  error?: string;
  exitCode: number;
  durationMs: number;
}

const DEFAULT_OPTIONS: Required<SandboxOptions> = {
  timeout: 60_000,
  memory: '512m',
  network: false,
};

// ---------------------------------------------------------------------------
// Blocked modules for VM sandbox
// ---------------------------------------------------------------------------

const BLOCKED_MODULES = new Set([
  'fs',
  'fs/promises',
  'child_process',
  'net',
  'http',
  'https',
  'dgram',
  'cluster',
  'worker_threads',
  'node:fs',
  'node:fs/promises',
  'node:child_process',
  'node:net',
  'node:http',
  'node:https',
  'node:dgram',
  'node:cluster',
  'node:worker_threads',
]);

// ---------------------------------------------------------------------------
// ForgeSandbox
// ---------------------------------------------------------------------------

export class ForgeSandbox {
  private readonly logger: pino.Logger;
  private dockerAvailable: boolean | null = null;

  constructor() {
    this.logger = pino({ name: 'forge:sandbox', level: 'info' });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Execute code in the safest available sandbox.
   * Tries Docker first; falls back to VM if Docker is unavailable.
   */
  async execute(code: string, options?: SandboxOptions): Promise<SandboxResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (await this.isDockerAvailable()) {
      this.logger.info('Executing in Docker sandbox');
      return this.executeInDocker(code, opts);
    }

    this.logger.info('Docker unavailable, falling back to VM sandbox');
    return this.executeInVM(code, opts);
  }

  /**
   * Execute code inside a Docker container with heavy restrictions:
   *  - --network none (no network unless explicitly allowed)
   *  - --read-only filesystem
   *  - --tmpfs /tmp:100m (writable temp, 100 MB limit)
   *  - --cpus 0.5 (half a core)
   *  - --memory 512m (configurable)
   *  - --user 1000 (non-root)
   *  - 60s timeout (configurable)
   */
  async executeInDocker(
    code: string,
    options?: SandboxOptions,
  ): Promise<SandboxResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const start = performance.now();

    // Build the docker run command
    const args = this.buildDockerArgs(code, opts);

    try {
      const { stdout, stderr } = await execFile('docker', args, {
        timeout: opts.timeout + 5000, // Allow a small buffer above container timeout
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });

      const durationMs = Math.round(performance.now() - start);

      return {
        output: stdout,
        error: stderr || undefined,
        exitCode: 0,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - start);

      if (this.isExecError(err)) {
        // Docker container exited with non-zero
        const timedOut = err.killed || durationMs >= opts.timeout;

        return {
          output: err.stdout ?? '',
          error: timedOut
            ? `Execution timed out after ${opts.timeout}ms`
            : (err.stderr || err.message),
          exitCode: typeof err.code === 'number' ? err.code : 1,
          durationMs,
        };
      }

      return {
        output: '',
        error: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs,
      };
    }
  }

  /**
   * Execute code in a Node.js VM context with restricted globals.
   *
   * Blocked: fs, child_process, net, http, https, dgram, cluster, worker_threads
   * Allowed: console, setTimeout, clearTimeout, setInterval, clearInterval,
   *          Buffer, JSON, Math, Date, crypto.randomUUID, TextEncoder, TextDecoder,
   *          Promise, Array, Object, String, Number, RegExp, Map, Set,
   *          Error, TypeError, RangeError, URL, URLSearchParams
   */
  async executeInVM(
    code: string,
    options?: SandboxOptions,
  ): Promise<SandboxResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const start = performance.now();

    // Collect console output
    const outputLines: string[] = [];
    const errorLines: string[] = [];

    const sandboxConsole = {
      log: (...args: unknown[]) => outputLines.push(args.map(String).join(' ')),
      info: (...args: unknown[]) => outputLines.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => outputLines.push(`[WARN] ${args.map(String).join(' ')}`),
      error: (...args: unknown[]) => errorLines.push(args.map(String).join(' ')),
      debug: (...args: unknown[]) => outputLines.push(`[DEBUG] ${args.map(String).join(' ')}`),
    };

    // Build a restricted require that blocks dangerous modules
    const sandboxRequire = (moduleName: string): never => {
      if (BLOCKED_MODULES.has(moduleName)) {
        throw new Error(
          `Module "${moduleName}" is blocked in the forge sandbox`,
        );
      }
      throw new Error(
        `Dynamic require is not available in the forge sandbox. Module: "${moduleName}"`,
      );
    };

    // Create the sandbox context with allowed globals
    const sandbox: Record<string, unknown> = {
      console: sandboxConsole,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Buffer,
      JSON,
      Math,
      Date,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      ReferenceError,
      URIError,
      EvalError,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      structuredClone: typeof structuredClone !== 'undefined' ? structuredClone : undefined,
      atob: typeof atob !== 'undefined' ? atob : undefined,
      btoa: typeof btoa !== 'undefined' ? btoa : undefined,
      crypto: { randomUUID: () => globalThis.crypto?.randomUUID?.() ?? this.fallbackUUID() },
      require: sandboxRequire,
      // Prevent access to process
      process: undefined,
      // Prevent eval / Function constructor escape
      eval: undefined,
    };

    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });

    try {
      // Wrap code in an async IIFE so top-level await works
      const wrappedCode = `
(async () => {
${code}
})();
`;

      const script = new vm.Script(wrappedCode, {
        filename: 'forge-sandbox.js',
      });

      const resultPromise = script.runInContext(context, {
        timeout: opts.timeout,
        displayErrors: true,
      });

      // If the script returns a promise, await it with a timeout
      if (resultPromise && typeof resultPromise === 'object' && 'then' in resultPromise) {
        await Promise.race([
          resultPromise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`VM execution timed out after ${opts.timeout}ms`)),
              opts.timeout,
            ),
          ),
        ]);
      }

      const durationMs = Math.round(performance.now() - start);

      return {
        output: outputLines.join('\n'),
        error: errorLines.length > 0 ? errorLines.join('\n') : undefined,
        exitCode: 0,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);

      const isTimeout =
        message.includes('timed out') ||
        message.includes('Script execution timed out');

      return {
        output: outputLines.join('\n'),
        error: isTimeout
          ? `Execution timed out after ${opts.timeout}ms`
          : message,
        exitCode: isTimeout ? 124 : 1,
        durationMs,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Docker helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether Docker is available and running.
   * Caches the result after the first probe.
   */
  private async isDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;

    try {
      await execFile('docker', ['info'], {
        timeout: 5000,
        windowsHide: true,
      });
      this.dockerAvailable = true;
    } catch {
      this.dockerAvailable = false;
      this.logger.debug('Docker not available');
    }

    return this.dockerAvailable;
  }

  /**
   * Build the full `docker run` argument list.
   */
  private buildDockerArgs(code: string, opts: Required<SandboxOptions>): string[] {
    const timeoutSec = Math.ceil(opts.timeout / 1000);

    const args: string[] = [
      'run',
      '--rm',                           // Auto-remove container
      '--read-only',                     // Read-only root filesystem
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=100m', // Writable temp
      '--cpus', '0.5',                   // Half a CPU core
      '--memory', opts.memory,           // Memory limit
      '--user', '1000',                  // Non-root user
      '--pids-limit', '64',             // Prevent fork bombs
      '--no-new-privileges',            // Security: no privilege escalation
    ];

    // Network isolation
    if (!opts.network) {
      args.push('--network', 'none');
    }

    // Container-level timeout via timeout command
    args.push(
      'node:20-slim',                   // Minimal Node.js image
      'node',
      '-e',
      // Wrap the code with a timeout guard
      `const t=setTimeout(()=>{console.error("Timeout");process.exit(124)},${opts.timeout});` +
      `(async()=>{try{${this.escapeForShell(code)}}catch(e){console.error(e.message);process.exit(1)}finally{clearTimeout(t)}})();`,
    );

    return args;
  }

  /**
   * Escape code for safe embedding in a shell single-argument string
   * passed to `node -e`.
   */
  private escapeForShell(code: string): string {
    return code
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  // -----------------------------------------------------------------------
  // Misc helpers
  // -----------------------------------------------------------------------

  /** Narrow an unknown caught value to an exec error shape. */
  private isExecError(
    err: unknown,
  ): err is { code: unknown; stdout: string; stderr: string; message: string; killed?: boolean } {
    return (
      typeof err === 'object' &&
      err !== null &&
      'message' in err
    );
  }

  /** Fallback UUID generation when crypto.randomUUID is unavailable. */
  private fallbackUUID(): string {
    const hex = '0123456789abcdef';
    let uuid = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-';
      } else if (i === 14) {
        uuid += '4';
      } else if (i === 19) {
        uuid += hex[(Math.random() * 4) | 8];
      } else {
        uuid += hex[(Math.random() * 16) | 0];
      }
    }
    return uuid;
  }
}
