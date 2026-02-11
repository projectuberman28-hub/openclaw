/**
 * @alfred/gateway - Lifecycle Hooks
 *
 * Provides a hook system that allows plugins and extensions to intercept
 * and modify data flowing through the gateway pipeline.
 *
 * Hook events:
 *   - pre-send:    Before sending a message to the model (can modify)
 *   - post-receive: After receiving a response from the model (observe only)
 *   - pre-tool:    Before executing a tool (can modify arguments)
 *   - post-tool:   After a tool executes (observe only)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookEvent = 'pre-send' | 'post-receive' | 'pre-tool' | 'post-tool';

export interface HookContext {
  /** The hook event type. */
  event: HookEvent;
  /** Agent ID that triggered the hook. */
  agentId?: string;
  /** Session ID. */
  sessionId?: string;
  /** Timestamp of when the hook was triggered. */
  timestamp: number;
}

export type HookHandler = (data: unknown, context: HookContext) => Promise<unknown> | unknown;

interface RegisteredHook {
  id: string;
  event: HookEvent;
  handler: HookHandler;
  /** Optional name for debugging. */
  name?: string;
  /** Priority (lower = runs first). Default 100. */
  priority: number;
}

// ---------------------------------------------------------------------------
// HookManager
// ---------------------------------------------------------------------------

export class HookManager {
  private hooks = new Map<HookEvent, RegisteredHook[]>();
  private nextId = 0;

  constructor() {
    // Initialize all event buckets
    this.hooks.set('pre-send', []);
    this.hooks.set('post-receive', []);
    this.hooks.set('pre-tool', []);
    this.hooks.set('post-tool', []);
  }

  /**
   * Register a hook handler for a specific event.
   *
   * @param event - The lifecycle event to hook into.
   * @param handler - The handler function. For pre-send and pre-tool,
   *   the return value replaces the data. For post-receive and post-tool,
   *   the return value is ignored.
   * @param options - Optional name and priority.
   * @returns A hook ID that can be used to unregister.
   */
  registerHook(
    event: HookEvent,
    handler: HookHandler,
    options?: { name?: string; priority?: number },
  ): string {
    const id = `hook_${this.nextId++}`;

    const registered: RegisteredHook = {
      id,
      event,
      handler,
      name: options?.name,
      priority: options?.priority ?? 100,
    };

    const hooks = this.hooks.get(event) ?? [];
    hooks.push(registered);

    // Sort by priority (lower first)
    hooks.sort((a, b) => a.priority - b.priority);

    this.hooks.set(event, hooks);

    return id;
  }

  /**
   * Unregister a hook by its ID.
   */
  unregisterHook(hookId: string): boolean {
    for (const [event, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        this.hooks.set(event, hooks);
        return true;
      }
    }
    return false;
  }

  /**
   * Execute all hooks for a given event.
   *
   * For 'pre-send' and 'pre-tool' events, hooks can modify the data
   * (the return value of each hook is passed as input to the next).
   *
   * For 'post-receive' and 'post-tool' events, hooks observe only
   * (return values are ignored, data flows through unchanged).
   *
   * If any hook throws, it is logged and skipped -- the pipeline continues.
   */
  async executeHooks(event: HookEvent, data: unknown, context?: Partial<HookContext>): Promise<unknown> {
    const hooks = this.hooks.get(event) ?? [];
    if (hooks.length === 0) return data;

    const isModifiable = event === 'pre-send' || event === 'pre-tool';
    const fullContext: HookContext = {
      event,
      agentId: context?.agentId,
      sessionId: context?.sessionId,
      timestamp: Date.now(),
    };

    let current = data;

    for (const hook of hooks) {
      try {
        const result = await hook.handler(current, fullContext);

        if (isModifiable && result !== undefined) {
          current = result;
        }
      } catch (err) {
        const name = hook.name ?? hook.id;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[HookManager] Hook "${name}" (${event}) threw: ${message}`);
        // Continue pipeline -- don't break on hook errors
      }
    }

    return current;
  }

  /**
   * List all registered hooks, optionally filtered by event.
   */
  listHooks(event?: HookEvent): Array<{ id: string; event: HookEvent; name?: string; priority: number }> {
    const result: Array<{ id: string; event: HookEvent; name?: string; priority: number }> = [];

    const events = event ? [event] : (['pre-send', 'post-receive', 'pre-tool', 'post-tool'] as HookEvent[]);

    for (const evt of events) {
      const hooks = this.hooks.get(evt) ?? [];
      for (const hook of hooks) {
        result.push({
          id: hook.id,
          event: hook.event,
          name: hook.name,
          priority: hook.priority,
        });
      }
    }

    return result;
  }

  /**
   * Load hooks from a config array.
   * Each entry should have: { event, handler, name?, priority? }
   */
  loadFromConfig(
    hookConfigs: Array<{
      event: HookEvent;
      handler: HookHandler;
      name?: string;
      priority?: number;
    }>,
  ): string[] {
    const ids: string[] = [];

    for (const cfg of hookConfigs) {
      const id = this.registerHook(cfg.event, cfg.handler, {
        name: cfg.name,
        priority: cfg.priority,
      });
      ids.push(id);
    }

    return ids;
  }

  /**
   * Remove all hooks.
   */
  clear(): void {
    this.hooks.set('pre-send', []);
    this.hooks.set('post-receive', []);
    this.hooks.set('pre-tool', []);
    this.hooks.set('post-tool', []);
  }
}
