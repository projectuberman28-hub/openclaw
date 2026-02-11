/**
 * @alfred/skills - Skill Injector
 *
 * Injects skill tools into an agent's tool context.
 * Converts skill tool definitions into the ToolDefinition format
 * expected by the agent context assembler.
 */

import type { ToolDefinition } from '@alfred/core/types/index.js';
import type { AgentConfig } from '@alfred/core/types/index.js';
import type { Skill, SkillToolDef } from './loader.js';

// ---------------------------------------------------------------------------
// SkillInjector
// ---------------------------------------------------------------------------

export class SkillInjector {
  /**
   * Inject skill tools into an agent's tool context.
   *
   * Returns an array of ToolDefinition objects that can be passed to
   * the model's chat method.
   *
   * @param agentConfig - The agent configuration (used to filter tools).
   * @param skills - The enabled skills to inject.
   * @returns Array of tool definitions ready for the agent.
   */
  inject(agentConfig: AgentConfig, skills: Skill[]): ToolDefinition[] {
    const toolDefs: ToolDefinition[] = [];
    const agentTools = new Set(agentConfig.tools);

    for (const skill of skills) {
      if (!skill.enabled) continue;

      for (const tool of skill.tools) {
        // If agent has explicit tool list, only inject matching tools
        if (agentTools.size > 0) {
          const qualifiedName = `${skill.name}:${tool.name}`;
          if (!agentTools.has(tool.name) && !agentTools.has(qualifiedName) && !agentTools.has(skill.name)) {
            continue;
          }
        }

        toolDefs.push(this.convertTool(skill, tool));
      }
    }

    return toolDefs;
  }

  /**
   * Inject all tools from all enabled skills (no agent filtering).
   */
  injectAll(skills: Skill[]): ToolDefinition[] {
    const toolDefs: ToolDefinition[] = [];

    for (const skill of skills) {
      if (!skill.enabled) continue;

      for (const tool of skill.tools) {
        toolDefs.push(this.convertTool(skill, tool));
      }
    }

    return toolDefs;
  }

  /**
   * Convert a SkillToolDef into a ToolDefinition.
   */
  private convertTool(skill: Skill, tool: SkillToolDef): ToolDefinition {
    return {
      name: tool.name,
      description: `[${skill.name}] ${tool.description}`,
      parameters: tool.parameters,
      timeout: tool.timeout,
    };
  }
}
