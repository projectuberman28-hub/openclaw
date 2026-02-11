/**
 * @alfred/gateway - RPC Handler
 *
 * Handles JSON-RPC style WebSocket calls for agent management.
 * Supports CRUD operations on agents with immediate routing refresh.
 */

import type { AgentManager } from '../agents/manager.js';
import type { AgentRouter } from '../agents/routing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RPCRequest {
  method: string;
  params: Record<string, unknown>;
}

export interface RPCResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// RPCHandler
// ---------------------------------------------------------------------------

export class RPCHandler {
  private agentManager: AgentManager;
  private agentRouter: AgentRouter | null = null;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /**
   * Set the agent router for immediate routing refresh after mutations.
   */
  setRouter(router: AgentRouter): void {
    this.agentRouter = router;
  }

  /**
   * Handle an incoming RPC request.
   *
   * Supported methods:
   *   - agents.list() -> AgentConfig[]
   *   - agents.create(params) -> AgentConfig
   *   - agents.update(params) -> AgentConfig
   *   - agents.delete(params) -> void
   */
  async handleRPC(method: string, params: Record<string, unknown>): Promise<RPCResponse> {
    try {
      switch (method) {
        case 'agents.list':
          return this.agentsList();

        case 'agents.create':
          return await this.agentsCreate(params);

        case 'agents.update':
          return await this.agentsUpdate(params);

        case 'agents.delete':
          return await this.agentsDelete(params);

        default:
          return {
            success: false,
            error: `Unknown RPC method: ${method}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * List all agents.
   */
  private agentsList(): RPCResponse {
    const agents = this.agentManager.listAgents();
    return {
      success: true,
      result: agents,
    };
  }

  /**
   * Create a new agent and refresh routing immediately.
   */
  private async agentsCreate(params: Record<string, unknown>): Promise<RPCResponse> {
    const id = params['id'] as string | undefined;
    const model = params['model'] as string | undefined;
    const name = (params['name'] as string) ?? 'New Agent';

    if (!id) {
      return { success: false, error: 'Missing required parameter: id' };
    }

    if (!model) {
      return { success: false, error: 'Missing required parameter: model' };
    }

    const agentConfig = this.agentManager.createAgent({
      id,
      identity: {
        name,
        theme: params['theme'] as string | undefined,
        emoji: params['emoji'] as string | undefined,
      },
      model,
      tools: (params['tools'] as string[]) ?? [],
      subagent: (params['subagent'] as boolean) ?? false,
    });

    // Refresh routing immediately (no restart needed)
    this.refreshRouting();

    return {
      success: true,
      result: agentConfig,
    };
  }

  /**
   * Update an existing agent and refresh routing immediately.
   */
  private async agentsUpdate(params: Record<string, unknown>): Promise<RPCResponse> {
    const id = params['id'] as string | undefined;
    if (!id) {
      return { success: false, error: 'Missing required parameter: id' };
    }

    const updates: Record<string, unknown> = {};

    if (params['model'] !== undefined) updates['model'] = params['model'];
    if (params['name'] !== undefined) {
      updates['identity'] = {
        name: params['name'] as string,
        theme: params['theme'] as string | undefined,
        emoji: params['emoji'] as string | undefined,
      };
    }
    if (params['tools'] !== undefined) updates['tools'] = params['tools'];
    if (params['subagent'] !== undefined) updates['subagent'] = params['subagent'];

    const agentConfig = this.agentManager.updateAgent(id, updates);

    // Refresh routing immediately
    this.refreshRouting();

    return {
      success: true,
      result: agentConfig,
    };
  }

  /**
   * Delete an agent and refresh routing immediately.
   */
  private async agentsDelete(params: Record<string, unknown>): Promise<RPCResponse> {
    const id = params['id'] as string | undefined;
    if (!id) {
      return { success: false, error: 'Missing required parameter: id' };
    }

    this.agentManager.deleteAgent(id);

    // Refresh routing immediately
    this.refreshRouting();

    return {
      success: true,
    };
  }

  /**
   * Refresh agent routing bindings after a mutation.
   */
  private refreshRouting(): void {
    if (this.agentRouter) {
      this.agentRouter.refreshBindings(this.agentManager.listAgents());
    }
  }
}
