/**
 * E2E Tests for Agent Management
 *
 * Tests create, update, delete agents via RPC-like operations,
 * and routing refresh after agent changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AlfredConfig } from '@alfred/core/config/schema.js';
import { DEFAULT_CONFIG } from '@alfred/core/config/schema.js';

/**
 * AgentManager: manages agent CRUD operations on the config.
 * This simulates the RPC operations that the gateway would expose.
 */
class AgentManager {
  private config: AlfredConfig;
  private configPath: string;
  private onRoutingRefresh?: () => void;

  constructor(config: AlfredConfig, configPath: string, onRoutingRefresh?: () => void) {
    this.config = structuredClone(config);
    this.configPath = configPath;
    this.onRoutingRefresh = onRoutingRefresh;
  }

  getAgents() {
    return this.config.agents;
  }

  createAgent(agent: AlfredConfig['agents'][0]) {
    // Validate no duplicate ID
    if (this.config.agents.some((a) => a.id === agent.id)) {
      throw new Error(`Agent with id "${agent.id}" already exists`);
    }
    this.config.agents.push(agent);
    this.onRoutingRefresh?.();
    return agent;
  }

  updateAgent(id: string, updates: Partial<AlfredConfig['agents'][0]>) {
    const idx = this.config.agents.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`Agent "${id}" not found`);
    this.config.agents[idx] = { ...this.config.agents[idx], ...updates };
    this.onRoutingRefresh?.();
    return this.config.agents[idx];
  }

  deleteAgent(id: string) {
    const idx = this.config.agents.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`Agent "${id}" not found`);
    this.config.agents.splice(idx, 1);
    this.onRoutingRefresh?.();
  }

  async save() {
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }
}

describe('Agent Management', () => {
  let tempDir: string;
  let configPath: string;
  let manager: AgentManager;
  let routingRefreshCount: number;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'alfred-agent-test-'));
    configPath = join(tempDir, 'alfred.json');
    routingRefreshCount = 0;

    const config = structuredClone(DEFAULT_CONFIG);
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    manager = new AgentManager(config, configPath, () => {
      routingRefreshCount++;
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Create agent via RPC
  // ---------------------------------------------------------------------------
  describe('Create agent', () => {
    it('creates a new agent successfully', () => {
      const newAgent = {
        id: 'researcher',
        identity: { name: 'Researcher' },
        model: 'anthropic/claude-sonnet-4-20250514',
        tools: ['web_search', 'file_read'],
        subagent: true,
        contextWindow: 200000,
        maxTokens: 4096,
        temperature: 0.5,
      };

      const created = manager.createAgent(newAgent);
      expect(created.id).toBe('researcher');

      const agents = manager.getAgents();
      const found = agents.find((a) => a.id === 'researcher');
      expect(found).toBeDefined();
      expect(found!.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(found!.subagent).toBe(true);
    });

    it('rejects duplicate agent IDs', () => {
      // Default config already has an 'alfred' agent
      const duplicate = {
        id: 'alfred',
        identity: { name: 'Alfred Clone' },
        model: 'openai/gpt-4o',
        tools: [],
        subagent: false,
      };

      expect(() => manager.createAgent(duplicate)).toThrow('already exists');
    });

    it('triggers routing refresh on create', () => {
      manager.createAgent({
        id: 'new-agent',
        identity: { name: 'New' },
        model: 'openai/gpt-4o',
        tools: [],
        subagent: false,
      });

      expect(routingRefreshCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Update agent via RPC
  // ---------------------------------------------------------------------------
  describe('Update agent', () => {
    it('updates agent model', () => {
      const updated = manager.updateAgent('alfred', {
        model: 'openai/gpt-4o',
      });

      expect(updated.model).toBe('openai/gpt-4o');
    });

    it('updates agent tools list', () => {
      const updated = manager.updateAgent('alfred', {
        tools: ['exec', 'web_search', 'file_read'],
      });

      expect(updated.tools).toContain('exec');
      expect(updated.tools).toContain('web_search');
      expect(updated.tools).toContain('file_read');
    });

    it('throws when updating non-existent agent', () => {
      expect(() =>
        manager.updateAgent('nonexistent', { model: 'some/model' }),
      ).toThrow('not found');
    });

    it('triggers routing refresh on update', () => {
      manager.updateAgent('alfred', { temperature: 0.3 });
      expect(routingRefreshCount).toBe(1);
    });

    it('preserves existing fields when updating partially', () => {
      const original = manager.getAgents().find((a) => a.id === 'alfred')!;
      const originalModel = original.model;

      manager.updateAgent('alfred', { temperature: 0.1 });

      const after = manager.getAgents().find((a) => a.id === 'alfred')!;
      expect(after.model).toBe(originalModel);
      expect(after.temperature).toBe(0.1);
    });
  });

  // ---------------------------------------------------------------------------
  // Delete agent via RPC
  // ---------------------------------------------------------------------------
  describe('Delete agent', () => {
    it('deletes an existing agent', () => {
      // First create an extra agent
      manager.createAgent({
        id: 'to-delete',
        identity: { name: 'Delete Me' },
        model: 'openai/gpt-4o',
        tools: [],
        subagent: false,
      });

      const beforeCount = manager.getAgents().length;
      manager.deleteAgent('to-delete');
      const afterCount = manager.getAgents().length;

      expect(afterCount).toBe(beforeCount - 1);
      expect(manager.getAgents().find((a) => a.id === 'to-delete')).toBeUndefined();
    });

    it('throws when deleting non-existent agent', () => {
      expect(() => manager.deleteAgent('ghost')).toThrow('not found');
    });

    it('triggers routing refresh on delete', () => {
      manager.createAgent({
        id: 'temp',
        identity: { name: 'Temp' },
        model: 'openai/gpt-4o',
        tools: [],
        subagent: false,
      });
      routingRefreshCount = 0; // reset from create

      manager.deleteAgent('temp');
      expect(routingRefreshCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Routing refresh after agent change
  // ---------------------------------------------------------------------------
  describe('Routing refresh', () => {
    it('routing refreshes are cumulative across operations', () => {
      routingRefreshCount = 0;

      manager.createAgent({
        id: 'agent-a',
        identity: { name: 'A' },
        model: 'openai/gpt-4o',
        tools: [],
        subagent: false,
      });

      manager.updateAgent('agent-a', { temperature: 0.5 });
      manager.deleteAgent('agent-a');

      expect(routingRefreshCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  describe('Persistence', () => {
    it('saves config to disk', async () => {
      manager.createAgent({
        id: 'persisted',
        identity: { name: 'Persisted' },
        model: 'openai/gpt-4o',
        tools: [],
        subagent: false,
      });

      await manager.save();

      const data = JSON.parse(await readFile(configPath, 'utf-8'));
      const found = data.agents.find((a: any) => a.id === 'persisted');
      expect(found).toBeDefined();
      expect(found.model).toBe('openai/gpt-4o');
    });
  });
});
