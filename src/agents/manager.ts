/**
 * @alfred/agents - Agent Manager
 *
 * CRUD operations for agent configurations.
 * Agents are stored in the Alfred config (alfred.json) and managed in memory.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildPaths } from '@alfred/core/config/paths.js';
import type { AgentConfig } from '@alfred/core/types/index.js';

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

export class AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private configPath: string;

  constructor(initialAgents?: AgentConfig[]) {
    this.configPath = buildPaths().config;

    if (initialAgents) {
      for (const agent of initialAgents) {
        this.agents.set(agent.id, agent);
      }
    }
  }

  /**
   * Get an agent by ID.
   * Throws if agent not found.
   */
  getAgent(id: string): AgentConfig {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agent not found: ${id}`);
    }
    return { ...agent };
  }

  /**
   * Get an agent by ID, returning undefined if not found.
   */
  findAgent(id: string): AgentConfig | undefined {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : undefined;
  }

  /**
   * List all agents.
   */
  listAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).map((a) => ({ ...a }));
  }

  /**
   * Create a new agent.
   * Returns the created agent config.
   */
  createAgent(config: Partial<AgentConfig> & { model: string }): AgentConfig {
    const id = config.id ?? randomUUID().slice(0, 8);

    if (this.agents.has(id)) {
      throw new Error(`Agent with id "${id}" already exists`);
    }

    const agent: AgentConfig = {
      id,
      identity: config.identity ?? { name: id },
      model: config.model,
      tools: config.tools ?? [],
      subagent: config.subagent ?? false,
    };

    this.agents.set(id, agent);
    this.persistToConfig();

    return { ...agent };
  }

  /**
   * Update an existing agent's configuration.
   * Returns the updated agent config.
   */
  updateAgent(id: string, updates: Partial<AgentConfig>): AgentConfig {
    const existing = this.agents.get(id);
    if (!existing) {
      throw new Error(`Agent not found: ${id}`);
    }

    const updated: AgentConfig = {
      ...existing,
      ...updates,
      id, // ID cannot be changed
    };

    // Deep merge identity if provided
    if (updates.identity) {
      updated.identity = {
        ...existing.identity,
        ...updates.identity,
      };
    }

    this.agents.set(id, updated);
    this.persistToConfig();

    return { ...updated };
  }

  /**
   * Delete an agent by ID.
   * Throws if agent not found.
   */
  deleteAgent(id: string): void {
    if (!this.agents.has(id)) {
      throw new Error(`Agent not found: ${id}`);
    }

    this.agents.delete(id);
    this.persistToConfig();
  }

  /**
   * Get the default agent (first agent, or the one named "alfred").
   */
  getDefaultAgent(): AgentConfig | undefined {
    const alfred = this.agents.get('alfred');
    if (alfred) return { ...alfred };

    // Return the first agent
    const first = this.agents.values().next();
    return first.done ? undefined : { ...first.value };
  }

  /**
   * Reload agents from config file.
   */
  reloadFromConfig(): void {
    try {
      if (!existsSync(this.configPath)) return;

      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      const agents = raw.agents as AgentConfig[] | undefined;

      if (agents && Array.isArray(agents)) {
        this.agents.clear();
        for (const agent of agents) {
          this.agents.set(agent.id, agent);
        }
      }
    } catch (err) {
      console.error('[AgentManager] Failed to reload from config:', err);
    }
  }

  /**
   * Persist current agent list back to the config file.
   */
  private persistToConfig(): void {
    try {
      if (!existsSync(this.configPath)) return;

      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      raw.agents = this.listAgents();
      writeFileSync(this.configPath, JSON.stringify(raw, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AgentManager] Failed to persist to config:', err);
    }
  }
}
