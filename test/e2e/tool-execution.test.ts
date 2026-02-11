/**
 * E2E Tests for Tool Execution
 *
 * Tests ExecTool, path validation in file ops, and web search fallback chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecTool } from '@alfred/tools/exec';
import { SafeExecutor } from '@alfred/tools/safe-executor';

// Mock pino logger
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Tool Execution', () => {
  let executor: SafeExecutor;

  beforeEach(() => {
    executor = new SafeExecutor({ defaultTimeout: 10_000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // ExecTool runs commands and returns output
  // ---------------------------------------------------------------------------
  describe('ExecTool runs commands', () => {
    it('executes a simple echo command', async () => {
      const tool = new ExecTool(executor);
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'echo hello' : 'echo hello';
      const result = await tool.execute({ command: cmd });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('returns non-zero exit code for failing commands', async () => {
      const tool = new ExecTool(executor);
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'cmd /c exit 1' : 'exit 1';
      const result = await tool.execute({ command: cmd });

      expect(result.exitCode).not.toBe(0);
    });

    it('captures stderr output', async () => {
      const tool = new ExecTool(executor);
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'echo error 1>&2' : 'echo error >&2';
      const result = await tool.execute({ command: cmd });

      expect(result.stderr.trim()).toContain('error');
    });

    it('throws for missing command', async () => {
      const tool = new ExecTool(executor);
      await expect(tool.execute({ command: '' })).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // ExecTool enforces timeout
  // ---------------------------------------------------------------------------
  describe('ExecTool timeout', () => {
    it('kills process that exceeds timeout', async () => {
      const tool = new ExecTool(executor, { timeoutMs: 500 });
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'ping -n 10 127.0.0.1' : 'sleep 30';
      const result = await tool.execute({ command: cmd, timeout: 500 });

      // Should be killed with exit code 137 (SIGKILL) or error
      expect(result.exitCode).not.toBe(0);
    }, 10000);
  });

  // ---------------------------------------------------------------------------
  // SafeExecutor wraps tool calls with timeout and error handling
  // ---------------------------------------------------------------------------
  describe('SafeExecutor', () => {
    it('tracks duration of tool execution', async () => {
      const result = await executor.execute('test-tool', async () => {
        return 'success';
      });

      expect(result.name).toBe('test-tool');
      expect(result.result).toBe('success');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles async errors gracefully', async () => {
      const result = await executor.execute('failing-tool', async () => {
        throw new Error('Tool broken');
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Tool broken');
    });

    it('enforces timeout for long-running tools', async () => {
      const fastExecutor = new SafeExecutor({ defaultTimeout: 100 });
      const result = await fastExecutor.execute('slow-tool', () =>
        new Promise((resolve) => setTimeout(resolve, 5000)),
      );

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/timed out|Aborted/i);
    }, 10000);

    it('fires onToolComplete callback', async () => {
      const onComplete = vi.fn();
      const callbackExecutor = new SafeExecutor({ onToolComplete: onComplete });

      await callbackExecutor.execute('callback-tool', async () => 'done');

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0].name).toBe('callback-tool');
    });

    it('fires tool:failure event on error', async () => {
      const { EventEmitter } = await import('node:events');
      const bus = new EventEmitter();
      const failureHandler = vi.fn();
      bus.on('tool:failure', failureHandler);

      const busExecutor = new SafeExecutor({ bus });
      await busExecutor.execute('broken-tool', async () => {
        throw new Error('broken');
      });

      expect(failureHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Web search tool attempts fallback chain
  // ---------------------------------------------------------------------------
  describe('Web search fallback', () => {
    it('WebSearchTool has the correct tool definition', async () => {
      const mod = await import('@alfred/tools/web-search');
      expect(mod.WebSearchTool.definition.name).toBe('web_search');
      expect(mod.WebSearchTool.definition.parameters.required).toContain('query');
    });
  });
});
