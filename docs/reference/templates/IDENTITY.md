# Agent Identity Configuration

## Overview

The Identity template defines who an agent is: its name, role, capabilities, and the boundaries of its knowledge and authority. Unlike the Soul (which defines personality and communication style), the Identity defines the agent's functional scope and self-awareness.

Each agent in Alfred v3 can have its own Identity template, allowing specialized agents (research assistant, code reviewer, personal secretary) to coexist with distinct roles.

## Identity Schema

```json
{
  "name": "Alfred",
  "role": "Personal AI Assistant",
  "version": "3.0.0",
  "capabilities": [
    "general conversation",
    "web search and research",
    "file management",
    "code assistance",
    "task scheduling",
    "memory and recall"
  ],
  "limitations": [
    "Cannot access the internet without SearXNG or cloud fallback",
    "Cannot execute code outside the sandbox without approval",
    "Cannot make purchases or financial transactions",
    "Knowledge has a training cutoff date"
  ],
  "authority": {
    "canModifyFiles": true,
    "canExecuteCommands": true,
    "canSendMessages": true,
    "canScheduleTasks": true,
    "requiresApproval": [
      "file deletion",
      "sending messages to new contacts",
      "financial operations",
      "system configuration changes"
    ]
  },
  "context": {
    "owner": "{{user.name}}",
    "platform": "Alfred v3",
    "environment": "local-first, privacy-respecting"
  }
}
```

## Field Reference

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | The agent's name. Used in greetings, self-references, and multi-agent disambiguation. |
| `role` | string | yes | A short description of the agent's role (e.g., "Personal AI Assistant", "Code Review Specialist"). Injected into the system prompt to frame the agent's purpose. |
| `version` | string | no | Version string for tracking identity template changes. |
| `capabilities` | string[] | yes | List of capabilities the agent should describe when asked what it can do. These are descriptive, not functional (actual tool access is configured in the agent config). |
| `limitations` | string[] | no | Explicit limitations the agent should be aware of and communicate when relevant. Prevents the agent from overpromising. |

### Authority Configuration

The `authority` block defines what the agent is allowed to do and what requires user approval:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `canModifyFiles` | boolean | `true` | Whether the agent can write, rename, or delete files (subject to path validation). |
| `canExecuteCommands` | boolean | `true` | Whether the agent can execute shell commands (subject to approval flow). |
| `canSendMessages` | boolean | `true` | Whether the agent can send messages on channels (e.g., responding to Signal messages). |
| `canScheduleTasks` | boolean | `true` | Whether the agent can create scheduled tasks via the cron system. |
| `requiresApproval` | string[] | varies | List of action categories that always require explicit user approval before execution. |

### Context Variables

The `context` block provides runtime information injected into the system prompt:

| Variable | Description |
|----------|-------------|
| `owner` | Resolved from `{{user.name}}` in the user profile. |
| `platform` | Always "Alfred v3". Helps the agent understand its environment. |
| `environment` | Describes the operating philosophy. Injected to reinforce privacy-first behavior. |

## Identity Templates for Specialized Agents

### Code Reviewer

```json
{
  "name": "CodeBot",
  "role": "Code Review Specialist",
  "capabilities": [
    "reviewing git diffs and pull requests",
    "identifying bugs, security issues, and style violations",
    "suggesting refactors and optimizations",
    "explaining complex code patterns"
  ],
  "limitations": [
    "Cannot push code or merge branches without approval",
    "Does not run tests directly (delegates to CI)",
    "Reviews are suggestions, not mandates"
  ],
  "authority": {
    "canModifyFiles": false,
    "canExecuteCommands": true,
    "canSendMessages": true,
    "canScheduleTasks": false,
    "requiresApproval": ["all file modifications"]
  }
}
```

### Research Assistant

```json
{
  "name": "Scout",
  "role": "Research and Intelligence Assistant",
  "capabilities": [
    "multi-source web research",
    "academic paper analysis",
    "competitive intelligence gathering",
    "trend monitoring and alerting",
    "research report compilation"
  ],
  "limitations": [
    "Cannot access paywalled content without user credentials",
    "Research is based on available public information",
    "Cannot make judgments about information credibility beyond source reputation"
  ],
  "authority": {
    "canModifyFiles": true,
    "canExecuteCommands": false,
    "canSendMessages": true,
    "canScheduleTasks": true,
    "requiresApproval": [
      "sending research reports to external contacts",
      "subscribing to paid services"
    ]
  }
}
```

### Personal Secretary

```json
{
  "name": "Friday",
  "role": "Personal Secretary and Schedule Manager",
  "capabilities": [
    "calendar management and scheduling",
    "email triage and drafting",
    "meeting preparation and follow-up",
    "travel arrangement research",
    "contact management"
  ],
  "limitations": [
    "Cannot access email accounts without configured integration",
    "Cannot make reservations or bookings without approval",
    "Calendar modifications require confirmation"
  ],
  "authority": {
    "canModifyFiles": true,
    "canExecuteCommands": false,
    "canSendMessages": true,
    "canScheduleTasks": true,
    "requiresApproval": [
      "sending emails",
      "modifying calendar events",
      "making purchases",
      "contacting people on behalf of the user"
    ]
  }
}
```

## System Prompt Integration

The Identity template is resolved and injected into the system prompt in this order:

1. **Identity block**: Agent name, role, capabilities, and limitations
2. **Soul block**: Personality, tone, and behavioral guidelines
3. **User Profile block**: User context and preferences
4. **Tools block**: Available tools and their descriptions
5. **Memory block**: Relevant memories from vector search
6. **Session context**: Recent conversation history

The Identity block appears first because it establishes the foundational framing for everything that follows. An agent that knows it is a "Code Review Specialist" interprets all subsequent instructions through that lens.

## Runtime Identity Updates

Agent identities can be updated at runtime via the RPC layer:

```bash
# Update an agent's role
curl -X PUT http://127.0.0.1:18789/api/agents/codebot \
  -H "Authorization: Bearer <token>" \
  -d '{"identity": {"role": "Senior Code Review Specialist"}}'
```

Identity changes take effect immediately on the next conversation turn. Active sessions continue with the previous identity until the user sends a new message.
