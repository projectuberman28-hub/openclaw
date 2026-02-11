/**
 * @alfred/agents - Agent Sandbox
 *
 * Provides workspace isolation per agent:
 *   - Each agent gets its own workspace directory
 *   - File access is constrained to the agent's workspace
 *   - Path validation prevents directory traversal
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, normalize } from 'node:path';
import { buildPaths } from '@alfred/core/config/paths.js';
import { validatePath, isWithinBase } from '@alfred/core/security/path-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxConfig {
  /** Base workspace directory. Defaults to ALFRED_HOME/workspace. */
  workspaceBase?: string;
  /** Whether to enforce strict path isolation. Default true. */
  strict?: boolean;
  /** Additional allowed read-only directories. */
  readOnlyPaths?: string[];
}

// ---------------------------------------------------------------------------
// AgentSandbox
// ---------------------------------------------------------------------------

export class AgentSandbox {
  private workspaceBase: string;
  private agentWorkspaces = new Map<string, string>();
  private strict: boolean;
  private readOnlyPaths: string[];

  constructor(config?: SandboxConfig) {
    this.workspaceBase = config?.workspaceBase ?? buildPaths().workspace;
    this.strict = config?.strict ?? true;
    this.readOnlyPaths = config?.readOnlyPaths ?? [];

    // Ensure base workspace exists
    if (!existsSync(this.workspaceBase)) {
      mkdirSync(this.workspaceBase, { recursive: true });
    }
  }

  /**
   * Get (or create) the workspace directory for an agent.
   */
  getWorkspace(agentId: string): string {
    let workspace = this.agentWorkspaces.get(agentId);

    if (!workspace) {
      // Sanitize agent ID for use in directory name
      const safeName = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
      workspace = join(this.workspaceBase, safeName);

      if (!existsSync(workspace)) {
        mkdirSync(workspace, { recursive: true });
      }

      this.agentWorkspaces.set(agentId, workspace);
    }

    return workspace;
  }

  /**
   * Validate that a file path is accessible to the given agent.
   *
   * Rules:
   *   1. Path must pass general path validation (no traversal, no suspicious chars)
   *   2. Resolved path must be within the agent's workspace directory
   *   3. Or within one of the read-only allowed paths
   */
  validateAccess(agentId: string, filePath: string): { allowed: boolean; resolvedPath: string; reason?: string } {
    // General path validation
    if (!validatePath(filePath, this.workspaceBase)) {
      return {
        allowed: false,
        resolvedPath: '',
        reason: 'Path failed security validation (traversal or suspicious characters)',
      };
    }

    const workspace = this.getWorkspace(agentId);
    const resolvedPath = resolve(workspace, filePath);
    const normalizedPath = normalize(resolvedPath);

    // Check if within agent workspace
    if (isWithinBase(normalizedPath, workspace)) {
      return { allowed: true, resolvedPath: normalizedPath };
    }

    // Check read-only paths
    if (!this.strict) {
      for (const roPath of this.readOnlyPaths) {
        if (isWithinBase(normalizedPath, roPath)) {
          return { allowed: true, resolvedPath: normalizedPath };
        }
      }
    }

    return {
      allowed: false,
      resolvedPath: normalizedPath,
      reason: `Path "${normalizedPath}" is outside agent workspace "${workspace}"`,
    };
  }

  /**
   * Resolve a relative path within an agent's workspace.
   */
  resolvePath(agentId: string, relativePath: string): string {
    const workspace = this.getWorkspace(agentId);
    return resolve(workspace, relativePath);
  }

  /**
   * Get all workspace directories currently tracked.
   */
  listWorkspaces(): Array<{ agentId: string; path: string }> {
    const result: Array<{ agentId: string; path: string }> = [];
    for (const [agentId, path] of this.agentWorkspaces.entries()) {
      result.push({ agentId, path });
    }
    return result;
  }

  /**
   * Clean up a specific agent's workspace tracking (does not delete files).
   */
  releaseWorkspace(agentId: string): void {
    this.agentWorkspaces.delete(agentId);
  }
}
