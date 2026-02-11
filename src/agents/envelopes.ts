/**
 * @alfred/agents - Agent Envelopes
 *
 * Wraps messages with runtime shell info to provide context about
 * the execution environment to the agent.
 */

import { platform, arch, release } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShellInfo {
  os: string;
  arch: string;
  osRelease: string;
  nodeVersion: string;
  platform: string;
}

export interface AgentEnvelope {
  /** The agent this envelope is addressed to. */
  agentId: string;
  /** Envelope creation timestamp (Unix epoch ms). */
  timestamp: number;
  /** Shell/runtime info. */
  shell: ShellInfo;
  /** The wrapped message content. */
  message: unknown;
}

// ---------------------------------------------------------------------------
// Shell info (cached at module load)
// ---------------------------------------------------------------------------

let cachedShellInfo: ShellInfo | null = null;

function getShellInfo(): ShellInfo {
  if (!cachedShellInfo) {
    cachedShellInfo = {
      os: platform(),
      arch: arch(),
      osRelease: release(),
      nodeVersion: process.version,
      platform: `${platform()}-${arch()}`,
    };
  }
  return cachedShellInfo;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap a message in an agent envelope with runtime shell info.
 *
 * @param agentId - The target agent ID.
 * @param message - The message payload to wrap.
 * @returns An AgentEnvelope containing the message and runtime info.
 */
export function wrapEnvelope(agentId: string, message: unknown): AgentEnvelope {
  return {
    agentId,
    timestamp: Date.now(),
    shell: getShellInfo(),
    message,
  };
}

/**
 * Unwrap an envelope to extract the message payload.
 */
export function unwrapEnvelope(envelope: AgentEnvelope): unknown {
  return envelope.message;
}

/**
 * Create a system prompt addendum with shell info.
 * Can be appended to an agent's system prompt to inform it about the environment.
 */
export function shellInfoPrompt(): string {
  const info = getShellInfo();
  return [
    '## Runtime Environment',
    `- OS: ${info.os} (${info.osRelease})`,
    `- Architecture: ${info.arch}`,
    `- Node.js: ${info.nodeVersion}`,
    `- Platform: ${info.platform}`,
  ].join('\n');
}
