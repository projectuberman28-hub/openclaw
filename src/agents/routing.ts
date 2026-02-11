/**
 * @alfred/agents - Agent Router
 *
 * Routes incoming channel messages to the appropriate agent based on:
 *   1. Explicit agent mention (e.g., @researcher)
 *   2. Channel -> agent binding in config
 *   3. Keyword / regex matching rules
 *   4. Default agent fallback
 *
 * Bindings are refreshed per-message, so config changes take effect
 * immediately without restart.
 */

import type { AgentConfig, ChannelMessage } from '@alfred/core/types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutingRule {
  /** Agent ID to route to. */
  agentId: string;
  /** Channel names this rule applies to (empty = all channels). */
  channels: string[];
  /** Keywords that trigger this agent. */
  keywords: string[];
  /** Regex patterns that trigger this agent. */
  patterns: RegExp[];
  /** Priority (lower = checked first). */
  priority: number;
}

// ---------------------------------------------------------------------------
// AgentRouter
// ---------------------------------------------------------------------------

export class AgentRouter {
  private rules: RoutingRule[] = [];
  private channelBindings = new Map<string, string>(); // channel -> agentId
  private defaultAgentId: string = 'alfred';

  constructor(agents?: AgentConfig[]) {
    if (agents) {
      this.refreshBindings(agents);
    }
  }

  /**
   * Route a channel message to the appropriate agent ID.
   *
   * Routing order:
   *   1. Explicit @mention in message content
   *   2. Channel-specific binding
   *   3. Keyword/pattern matching rules
   *   4. Default agent
   */
  route(message: ChannelMessage): string {
    // 1. Check for explicit @mention
    const mentionMatch = message.content.match(/@(\w+)/);
    if (mentionMatch) {
      const mentioned = mentionMatch[1]!.toLowerCase();
      // Check if this matches a known agent
      const matchingRule = this.rules.find(
        (r) => r.agentId.toLowerCase() === mentioned,
      );
      if (matchingRule) {
        return matchingRule.agentId;
      }
    }

    // 2. Check channel-specific binding
    const channelBinding = this.channelBindings.get(message.channel);
    if (channelBinding) {
      return channelBinding;
    }

    // 3. Check keyword/pattern rules
    const contentLower = message.content.toLowerCase();

    for (const rule of this.rules) {
      // Check channel filter
      if (rule.channels.length > 0 && !rule.channels.includes(message.channel)) {
        continue;
      }

      // Check keywords
      for (const keyword of rule.keywords) {
        if (contentLower.includes(keyword.toLowerCase())) {
          return rule.agentId;
        }
      }

      // Check patterns
      for (const pattern of rule.patterns) {
        if (pattern.test(message.content)) {
          return rule.agentId;
        }
      }
    }

    // 4. Default agent
    return this.defaultAgentId;
  }

  /**
   * Refresh routing bindings from agent configs.
   * Called after agent create/update/delete to take immediate effect.
   */
  refreshBindings(agents: AgentConfig[]): void {
    this.rules = [];

    for (const agent of agents) {
      const rule: RoutingRule = {
        agentId: agent.id,
        channels: [],
        keywords: [],
        patterns: [],
        priority: agent.subagent ? 100 : 50,
      };

      this.rules.push(rule);
    }

    // Sort by priority
    this.rules.sort((a, b) => a.priority - b.priority);

    // Set default agent
    if (agents.length > 0) {
      const mainAgent = agents.find((a) => !a.subagent) ?? agents[0]!;
      this.defaultAgentId = mainAgent.id;
    }
  }

  /**
   * Set a channel -> agent binding.
   */
  setChannelBinding(channel: string, agentId: string): void {
    this.channelBindings.set(channel, agentId);
  }

  /**
   * Remove a channel -> agent binding.
   */
  removeChannelBinding(channel: string): void {
    this.channelBindings.delete(channel);
  }

  /**
   * Add a custom routing rule.
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the default agent ID.
   */
  getDefaultAgentId(): string {
    return this.defaultAgentId;
  }

  /**
   * Set the default agent ID.
   */
  setDefaultAgentId(agentId: string): void {
    this.defaultAgentId = agentId;
  }
}
