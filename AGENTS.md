# Agent Definitions — Alfred v3

## Default Agent: alfred-main

The primary assistant agent that handles all general-purpose interactions.

```json
{
  "id": "alfred-main",
  "name": "Alfred",
  "role": "Primary AI Assistant",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "fallback": ["openai:gpt-4o", "local:llama3"],
    "temperature": 0.7,
    "maxTokens": 8192
  },
  "tools": [
    "web-search",
    "exec",
    "file-read",
    "file-write",
    "http-request",
    "memory-search",
    "memory-store",
    "playbook-query",
    "playbook-record"
  ],
  "skills": [
    "web-monitor",
    "pdf-extract",
    "youtube-summarize",
    "research-agent",
    "meeting-notes",
    "code-review",
    "email-digest"
  ],
  "channels": ["signal", "discord", "telegram", "slack", "matrix", "webchat", "bluebubbles"],
  "memory": {
    "enabled": true,
    "autoSummarize": true,
    "vectorSearch": true,
    "maxContextMemories": 10,
    "embeddingModel": "local"
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

## Specialized Agents

### forge-builder

An internal agent used by the Forge system to generate new skills. Not user-facing.

```json
{
  "id": "forge-builder",
  "name": "Forge",
  "role": "Skill Builder",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "fallback": ["openai:gpt-4o"]
  },
  "tools": ["file-read", "file-write", "exec"],
  "skills": [],
  "channels": [],
  "memory": {
    "enabled": false
  },
  "privacy": {
    "level": "strict",
    "allowCloudCalls": true,
    "redactPII": true,
    "auditLog": true
  },
  "limits": {
    "maxTurns": 20,
    "maxToolCalls": 30,
    "sessionTTL": "1h"
  }
}
```

### research-specialist

A dedicated research agent with expanded web search capabilities and memory.

```json
{
  "id": "research-specialist",
  "name": "Scout",
  "role": "Research and Intelligence Assistant",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "fallback": ["openai:gpt-4o"]
  },
  "tools": ["web-search", "http-request", "file-read", "file-write", "memory-search", "memory-store"],
  "skills": ["research-agent", "web-monitor", "pdf-extract", "competitor-watch"],
  "channels": [],
  "memory": {
    "enabled": true,
    "autoSummarize": true,
    "vectorSearch": true,
    "maxContextMemories": 20
  },
  "privacy": {
    "level": "balanced"
  },
  "limits": {
    "maxTurns": 50,
    "maxToolCalls": 100,
    "sessionTTL": "4h"
  }
}
```

## Agent Routing

When multiple agents are configured, the channel router dispatches messages based on:

1. **Explicit mention**: "@Alfred" or "@Scout" in the message routes to the named agent.
2. **Thread context**: Replies in a thread continue with the agent that started the thread.
3. **Channel default**: Each channel has a default agent (typically `alfred-main`).
4. **Routing rules**: Custom rules in `alfred.json` can route based on keywords, channel, time, or sender.

### Routing Configuration

```json
{
  "routing": {
    "defaults": {
      "signal": "alfred-main",
      "discord": "alfred-main",
      "webchat": "alfred-main"
    },
    "rules": [
      {
        "match": { "keywords": ["research", "investigate", "look into"] },
        "agent": "research-specialist"
      },
      {
        "match": { "channel": "discord", "forum": "research" },
        "agent": "research-specialist"
      }
    ]
  }
}
```

## Creating Custom Agents

### Via CLI

```bash
# Create a new agent from a template
alfred agent create --id my-agent --name "My Agent" --role "Custom Role"

# Clone an existing agent with modifications
alfred agent clone alfred-main --id work-assistant --name "Work Assistant"

# List all agents
alfred agent list

# Update an agent
alfred agent update my-agent --model "openai:gpt-4o"

# Delete an agent
alfred agent delete my-agent
```

### Via RPC API

```bash
# Create
curl -X POST http://127.0.0.1:18789/api/agents \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "my-agent", "name": "My Agent", ...}'

# List
curl http://127.0.0.1:18789/api/agents \
  -H "Authorization: Bearer <token>"

# Update
curl -X PUT http://127.0.0.1:18789/api/agents/my-agent \
  -H "Authorization: Bearer <token>" \
  -d '{"model": {"provider": "openai", "name": "gpt-4o"}}'

# Delete
curl -X DELETE http://127.0.0.1:18789/api/agents/my-agent \
  -H "Authorization: Bearer <token>"
```

Agent changes via RPC take effect immediately. The channel router refreshes its routing table on every agent create, update, or delete operation.
