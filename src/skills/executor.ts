/**
 * @alfred/skills - Skill Executor
 *
 * Executes skill tool invocations with sandboxing for forged skills.
 * Bundled and curated skills run in the main process.
 * Forged skills can optionally run in a separate context.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { isWithinBase } from '@alfred/core/security/path-validator.js';
import type { Skill, SkillToolDef } from './loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ExecutorOptions {
  /** Default timeout for tool execution in ms. */
  defaultTimeoutMs?: number;
  /** Whether to sandbox forged skills. Default true. */
  sandboxForged?: boolean;
}

// ---------------------------------------------------------------------------
// SkillExecutor
// ---------------------------------------------------------------------------

export class SkillExecutor {
  private defaultTimeoutMs: number;
  private sandboxForged: boolean;
  private loadedModules = new Map<string, Record<string, (...args: unknown[]) => unknown>>();

  constructor(options?: ExecutorOptions) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30_000;
    this.sandboxForged = options?.sandboxForged ?? true;
  }

  /**
   * Execute a tool from a skill.
   *
   * @param skill - The skill containing the tool.
   * @param toolName - The name of the tool to execute.
   * @param args - Arguments to pass to the tool.
   */
  async execute(
    skill: Skill,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const start = Date.now();

    // Find the tool definition
    const toolDef = skill.tools.find((t) => t.name === toolName);
    if (!toolDef) {
      return {
        success: false,
        error: `Tool "${toolName}" not found in skill "${skill.name}"`,
        durationMs: Date.now() - start,
      };
    }

    const timeoutMs = toolDef.timeout ?? this.defaultTimeoutMs;

    // For forged skills, use sandboxed execution if enabled
    if (skill.source === 'forged' && this.sandboxForged) {
      return this.executeSandboxed(skill, toolDef, args, timeoutMs, start);
    }

    // Regular execution for bundled/curated skills
    return this.executeRegular(skill, toolDef, args, timeoutMs, start);
  }

  /**
   * Execute a tool in the regular (trusted) context.
   */
  private async executeRegular(
    skill: Skill,
    toolDef: SkillToolDef,
    args: Record<string, unknown>,
    timeoutMs: number,
    start: number,
  ): Promise<ExecutionResult> {
    try {
      // Resolve the entry point
      const handler = await this.resolveHandler(skill, toolDef);
      if (!handler) {
        return {
          success: false,
          error: `No handler found for tool "${toolDef.name}" in skill "${skill.name}"`,
          durationMs: Date.now() - start,
        };
      }

      // Execute with timeout
      const result = await this.withTimeout(
        handler(args),
        timeoutMs,
        `${skill.name}:${toolDef.name}`,
      );

      return {
        success: true,
        result,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Execute a tool in a sandboxed context (for forged skills).
   *
   * Sandboxing strategy:
   *   - Validate all paths
   *   - Run with a timeout
   *   - Catch and contain errors
   */
  private async executeSandboxed(
    skill: Skill,
    toolDef: SkillToolDef,
    args: Record<string, unknown>,
    timeoutMs: number,
    start: number,
  ): Promise<ExecutionResult> {
    try {
      // Validate that the skill's entry point stays within its directory
      if (toolDef.entryPoint) {
        const entryPath = join(skill.path, toolDef.entryPoint);
        if (!isWithinBase(entryPath, skill.path)) {
          return {
            success: false,
            error: `Sandboxed tool "${toolDef.name}" entry point escapes skill directory`,
            durationMs: Date.now() - start,
          };
        }
      }

      // Execute with strict timeout (shorter for forged)
      const sandboxTimeout = Math.min(timeoutMs, 15_000);
      const handler = await this.resolveHandler(skill, toolDef);

      if (!handler) {
        return {
          success: false,
          error: `No handler found for sandboxed tool "${toolDef.name}"`,
          durationMs: Date.now() - start,
        };
      }

      const result = await this.withTimeout(
        handler(args),
        sandboxTimeout,
        `[sandboxed] ${skill.name}:${toolDef.name}`,
      );

      return {
        success: true,
        result,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Sandboxed execution failed: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Resolve the handler function for a tool.
   */
  private async resolveHandler(
    skill: Skill,
    toolDef: SkillToolDef,
  ): Promise<((args: Record<string, unknown>) => Promise<unknown>) | null> {
    const cacheKey = `${skill.path}:${toolDef.name}`;

    // Check cache
    const cached = this.loadedModules.get(skill.path);
    if (cached && typeof cached[toolDef.name] === 'function') {
      return cached[toolDef.name] as (args: Record<string, unknown>) => Promise<unknown>;
    }

    // Determine entry point file
    const entryFile = toolDef.entryPoint ?? 'index.js';
    const entryPath = join(skill.path, 'dist', entryFile);
    const srcPath = join(skill.path, 'src', entryFile.replace('.js', '.ts'));

    // Try compiled output first, then source
    const modulePath = existsSync(entryPath) ? entryPath : null;

    if (!modulePath) {
      console.warn(
        `[SkillExecutor] No compiled entry point for ${skill.name}:${toolDef.name} ` +
        `(expected: ${entryPath})`,
      );
      return null;
    }

    try {
      const mod = await import(modulePath);

      // Cache the module
      this.loadedModules.set(skill.path, mod);

      // Look for the tool function by name
      const handler = mod[toolDef.name] ?? mod['default'];
      if (typeof handler === 'function') {
        return handler;
      }

      // Look for an execute function
      if (typeof mod['execute'] === 'function') {
        return (args: Record<string, unknown>) => mod['execute'](toolDef.name, args);
      }

      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SkillExecutor] Failed to import ${modulePath}: ${message}`);
      return null;
    }
  }

  /**
   * Execute a promise with a timeout.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool "${label}" timed out after ${ms}ms`));
      }, ms);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /**
   * Clear the module cache.
   */
  clearCache(): void {
    this.loadedModules.clear();
  }
}
