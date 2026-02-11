/**
 * @alfred/tools - Tool registry and re-exports
 *
 * All tools available to the AI agent, plus a registry that manages
 * tool instantiation, lookup, and definition exposure.
 */

import { EventEmitter } from 'node:events';
import type { ToolDefinition, ToolResult } from '@alfred/core';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { SafeExecutor, type ExecuteOptions, type SafeExecutorOptions, type OnToolComplete } from './safe-executor.js';
export { ExecTool, type ExecArgs, type ExecResult, type ExecToolConfig } from './exec.js';
export { ProcessTool, type ProcessInfo } from './process.js';
export { WebSearchTool, type SearchResult, type WebSearchArgs, type WebSearchConfig } from './web-search.js';
export { WebFetchTool, type WebFetchArgs, type WebFetchResult } from './web-fetch.js';
export { BrowserTool, type PageInfo } from './browser.js';
export { FileOpsTool, type FileReadArgs, type FileWriteArgs, type FileEditArgs, type FilePatchArgs, type FileListArgs, type FileOpsConfig } from './file-ops.js';
export { MessageTool, type MessageSendArgs, type MessageSendResult, type MessageEvent } from './message.js';
export { CronTool, type Task, type CronCreateArgs, type CronDeleteArgs } from './cron.js';
export { MemorySearchTool, type MemoryResult, type MemorySearchArgs, type HybridSearchBackend } from './memory-search.js';
export { MemoryWriteTool, type MemoryWriteArgs, type MemoryWriteResult, type MemoryEntry, type MemoryWriteBackend } from './memory-write.js';
export { ImageTool, type ImageAnalyseArgs, type ImageAnalyseResult, type ImageToolConfig, type VisionBackend, type TranscriptionBackend } from './image.js';
export { LLMTaskTool, type LLMTaskArgs, type LLMTaskResult, type LLMTaskConfig, type LLMBackend } from './llm-task.js';
export { SessionsTool, type SessionSendArgs, type SessionSpawnArgs, type SessionSpawnResult, type SessionBackend } from './sessions.js';
export { CanvasTool, type CanvasRenderArgs, type CanvasRenderResult } from './canvas.js';
export { NodesTool, type NodeInfo, type NodeCommandArgs, type NodeBackend } from './nodes.js';
export { GatewayTool, type GatewayStatus, type GatewayConfig, type GatewayBackend } from './gateway-tool.js';
export { ForgeTool, type ForgeBuildArgs, type ForgedSkill, type TestResult as ForgeTestResult, type ForgeBackend } from './forge-tool.js';
export { PlaybookTool, type PlaybookEntry, type PlaybookStats, type Strategy, type FailureEntry, type PlaybookQueryArgs, type PlaybookFailuresArgs, type PlaybookBackend } from './playbook-tool.js';

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const logger = pino({ name: 'alfred:tools:registry' });

/**
 * A tool instance that can be registered with the ToolRegistry.
 * Every tool class exposes a static `definition` and instance methods.
 */
export interface RegisteredTool {
  /** JSON-Schema-style definition for the LLM. */
  definition: ToolDefinition;
  /** Invoke the tool with the given arguments. */
  execute(args: Record<string, unknown>): Promise<any>;
}

export interface ToolRegistryOptions {
  /** Event bus for tool lifecycle events. */
  bus?: EventEmitter;
}

/**
 * Central registry that holds all tool instances, exposes their
 * definitions to the LLM, and routes invocations.
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private bus: EventEmitter;

  constructor(options: ToolRegistryOptions = {}) {
    this.bus = options.bus ?? new EventEmitter();
  }

  /**
   * Register a tool.
   */
  register(name: string, tool: RegisteredTool): void {
    if (this.tools.has(name)) {
      logger.warn({ tool: name }, 'Overwriting previously registered tool');
    }
    this.tools.set(name, tool);
    logger.debug({ tool: name }, 'Tool registered');
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      logger.debug({ tool: name }, 'Tool unregistered');
    }
    return removed;
  }

  /**
   * Get a tool by name.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names.
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool definitions for the LLM (the tools array sent to the API).
   */
  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Get definitions filtered to only the named tools.
   */
  definitionsFor(names: string[]): ToolDefinition[] {
    const nameSet = new Set(names);
    return Array.from(this.tools.entries())
      .filter(([name]) => nameSet.has(name))
      .map(([, tool]) => tool.definition);
  }

  /**
   * Invoke a tool by name.
   */
  async invoke(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    const start = performance.now();

    if (!tool) {
      const result: ToolResult = {
        name,
        error: `Tool "${name}" is not registered`,
        durationMs: 0,
      };
      this.bus.emit('tool:notfound', result);
      return result;
    }

    try {
      const value = await tool.execute(args);
      const durationMs = Math.round(performance.now() - start);

      const result: ToolResult = { name, result: value, durationMs };
      this.bus.emit('tool:complete', result);
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const error = err instanceof Error ? err.message : String(err);

      const result: ToolResult = { name, error, durationMs };
      this.bus.emit('tool:error', result);
      return result;
    }
  }

  /**
   * Get the event bus for subscribing to tool lifecycle events.
   *
   * Events:
   *   - tool:complete  (ToolResult)
   *   - tool:error     (ToolResult)
   *   - tool:notfound  (ToolResult)
   */
  getEventBus(): EventEmitter {
    return this.bus;
  }

  /**
   * Total number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}
