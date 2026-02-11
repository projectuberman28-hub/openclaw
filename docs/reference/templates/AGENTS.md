# Agent Configuration Reference

## Overview

Agents in Alfred v3 are configurable AI personas that handle conversations. Each agent has its own identity, model preferences, channel bindings, and behavioral parameters. Agents are defined in `~/.alfred/agents/` as JSON files and managed via the Gateway RPC layer or the desktop app.

## Agent Schema

```json
{
  "id": "alfred-main",
  "name": "Alfred",
  "description": "Primary assistant agent",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "fallback": ["openai:gpt-4o", "local:llama3"],
    "temperature": 0.7,
    "maxTokens": 8192
  },
  "identity": "IDENTITY.md",
  "soul": "SOUL.md",
  "userProfile": "USER.md",
  "tools": ["web-search", "exec", "file-read", "file-write"],
  "skills": ["web-monitor", "pdf-extract", "research-agent"],
  "channels": ["signal", "discord", "webchat"],
  "memory": {
    "enabled": true,
    "autoSummarize": true,
    "vectorSearch": true,
    "maxContextMemories": 10
  },
  "privacy": {
    "level": "balanced",
    "allowCloudCalls": true,
    "redactPII": true,
    "auditLog": true
  },
  "limits": {
    "maxTurns": 100,
    "maxToolCalls": 50,
    "sessionTTL": "24h",
    "compactionThreshold": 0.8
  }
}
```

## Field Reference

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique agent identifier. Must be URL-safe (alphanumeric, hyphens). |
| `name` | string | yes | Display name shown in conversations and the desktop app. |
| `description` | string | no | Human-readable description of the agent's purpose. |
| `model` | object | yes | Model configuration block. See below. |
| `identity` | string | no | Path to the agent's identity template (relative to templates dir). Defaults to `IDENTITY.md`. |
| `soul` | string | no | Path to the soul/personality template. Defaults to `SOUL.md`. |
| `userProfile` | string | no | Path to the user profile template. Defaults to `USER.md`. |
| `tools` | string[] | no | List of tool IDs this agent can invoke. Empty array disables all tools. |
| `skills` | string[] | no | List of skill IDs (curated or forged) available to this agent. |
| `channels` | string[] | no | Channel IDs this agent listens on. An empty array means the agent is only accessible via direct API calls or the desktop app. |
| `memory` | object | no | Memory configuration. See below. |
| `privacy` | object | no | Privacy configuration. See below. |
| `limits` | object | no | Operational limits. See below. |

### Model Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | string | `"anthropic"` | Model provider: `anthropic`, `openai`, `google`, `local`, `ollama`, `groq` |
| `name` | string | required | Model identifier within the provider (e.g., `claude-sonnet-4-20250514`) |
| `fallback` | string[] | `[]` | Ordered fallback models in `provider:model` format. Used when primary is unavailable. |
| `temperature` | number | `0.7` | Sampling temperature (0.0 - 2.0) |
| `maxTokens` | number | `8192` | Maximum response tokens |
| `topP` | number | `1.0` | Nucleus sampling parameter |
| `stopSequences` | string[] | `[]` | Custom stop sequences |

### Memory Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable persistent memory for this agent |
| `autoSummarize` | boolean | `true` | Automatically summarize sessions into long-term memory |
| `vectorSearch` | boolean | `true` | Enable semantic vector search over memories |
| `maxContextMemories` | number | `10` | Maximum memory entries injected into context per turn |
| `embeddingModel` | string | `"local"` | Embedding model for vector search. `"local"` uses ONNX, or specify a cloud provider. |

### Privacy Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"balanced"` | Privacy level: `strict` (local only), `balanced` (PII redacted for cloud), `permissive` (user-consented cloud calls) |
| `allowCloudCalls` | boolean | `true` | Whether this agent can make cloud model API calls |
| `redactPII` | boolean | `true` | Automatically redact PII before cloud calls |
| `auditLog` | boolean | `true` | Log all privacy-relevant events to the audit log |

### Limits Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxTurns` | number | `100` | Maximum conversation turns before forced compaction |
| `maxToolCalls` | number | `50` | Maximum tool calls per session |
| `sessionTTL` | string | `"24h"` | Session time-to-live. Sessions older than this are pruned. Supports `h`, `d`, `w` suffixes. |
| `compactionThreshold` | number | `0.8` | Context window fill ratio that triggers compaction (0.0 - 1.0) |

## Multi-Agent Setup

Alfred supports multiple concurrent agents. Each agent has its own identity, tools, and channel bindings. The channel router dispatches incoming messages to the appropriate agent based on channel binding and optional routing rules.

### Routing Rules

When multiple agents are bound to the same channel, routing is determined by:

1. **Explicit mention**: If the message mentions an agent by name, it routes to that agent.
2. **Thread context**: If the message is in a thread started by a specific agent, it continues with that agent.
3. **Default agent**: Each channel has a configurable default agent.
4. **Round-robin**: If no other rule matches, messages are routed to agents in round-robin order.

### Agent RPC Operations

Agents can be managed at runtime via the Gateway RPC layer:

- **Create**: `POST /api/agents` with agent JSON body. Immediately available for routing.
- **Update**: `PUT /api/agents/:id` with partial agent JSON. Routing refreshes immediately.
- **Delete**: `DELETE /api/agents/:id`. Active sessions are gracefully terminated.
- **List**: `GET /api/agents` returns all configured agents with their status.

## Example Configurations

### Minimal Agent

```json
{
  "id": "simple",
  "name": "Simple Assistant",
  "model": {
    "provider": "local",
    "name": "llama3"
  }
}
```

### Research Agent with Full Memory

```json
{
  "id": "researcher",
  "name": "Research Assistant",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "fallback": ["openai:gpt-4o"]
  },
  "tools": ["web-search", "file-read", "file-write"],
  "skills": ["research-agent", "pdf-extract", "web-monitor"],
  "memory": {
    "enabled": true,
    "autoSummarize": true,
    "vectorSearch": true,
    "maxContextMemories": 20
  },
  "privacy": {
    "level": "balanced"
  }
}
```

### Strict-Privacy Local Agent

```json
{
  "id": "private",
  "name": "Private Assistant",
  "model": {
    "provider": "ollama",
    "name": "llama3:70b"
  },
  "privacy": {
    "level": "strict",
    "allowCloudCalls": false
  },
  "channels": ["signal"]
}
```
