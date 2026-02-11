# First-Run Bootstrap Guide

## Overview

The Bootstrap process runs on Alfred's first launch and sets up the essential configuration, user profile, credential vault, and initial agent. It is a conversational onboarding flow that guides the user through the minimum required setup while allowing immediate use with sensible defaults.

Bootstrap is designed to take under 2 minutes. Every question has a reasonable default, and the user can skip any step and configure it later.

## Bootstrap Sequence

### Phase 1: Data Directory Initialization

Before any user interaction, Alfred creates the data directory structure:

```
~/.alfred/
├── alfred.json          (default configuration)
├── credentials/         (encrypted vault, created empty)
├── logs/                (audit and daily log directories)
├── memory/              (vector store directory)
├── sessions/            (conversation session storage)
├── playbook/            (operational memory database)
├── workspace/           (agent working directory)
├── cache/               (model and embedding cache)
├── agents/              (agent configuration directory)
└── devices.json         (device registry, initialized with current device)
```

All directories are created with restrictive permissions (`0700` on Unix, user-only on Windows). If `~/.alfred/` already exists, Bootstrap checks for a valid `alfred.json` and skips to Phase 4 (configuration validation).

### Phase 2: User Profile

Alfred introduces itself and asks for basic profile information:

```
Hello! I'm Alfred, your privacy-first AI assistant. Let me get to know you
so I can be more helpful.

What should I call you?
> Mike

What timezone are you in? (I'll use this for scheduling and time references)
> America/New_York

What do you do for work? (Helps me calibrate my responses — skip with Enter)
> Software engineer

How technical should I be by default?
  1. Keep it simple (beginner)
  2. Normal explanations (intermediate)  [default]
  3. Expert-level, skip the basics (expert)
> 3

Do you prefer short, concise answers or detailed explanations?
  1. Terse (just the facts)
  2. Concise (brief but complete)  [default]
  3. Detailed (thorough explanations)
> 2
```

This creates `~/.alfred/user-profile.json` with the collected information. Skipped fields use defaults.

### Phase 3: Model Configuration

Alfred asks about LLM provider preferences:

```
Now let's set up your AI model. Alfred works with both local and cloud models.

Which is your primary model provider?
  1. Local only (Ollama/llama.cpp — full privacy, needs local GPU)
  2. Anthropic (Claude — recommended for best quality)
  3. OpenAI (GPT-4o)
  4. Google (Gemini)
  5. Groq (fast inference)
  6. I'll configure this later  [default]
> 2

Enter your Anthropic API key (stored encrypted locally, never sent anywhere else):
> sk-ant-...

Would you like a local model as fallback when cloud is unavailable?
  1. Yes, set up Ollama (I have it installed)
  2. No, cloud only is fine  [default]
> 1
```

API keys are immediately stored in the credential vault using AES-256-GCM encryption. The user is prompted to set a vault passphrase if one has not been configured.

### Phase 4: Channel Setup

Alfred asks about communication channels:

```
Alfred can communicate through multiple channels. Which would you like to set up?
(You can add more later with 'alfred channel add')

  [1] Signal (via signal-cli)
  [2] Discord
  [3] Telegram
  [4] Slack
  [5] Matrix
  [6] WebChat (built-in browser UI)
  [7] BlueBubbles (iMessage bridge)
  [S] Skip for now — I'll use the desktop app  [default]
> S
```

Each channel selection triggers a channel-specific configuration flow (API tokens, bot setup instructions, phone number registration, etc.). The WebChat channel requires no additional configuration.

### Phase 5: Configuration Validation

Alfred validates the complete configuration:

```
Validating configuration...
  ✓ Data directory structure
  ✓ User profile
  ✓ Model provider (Anthropic: connected)
  ✓ Credential vault (encrypted, 1 key stored)
  ✓ Default agent (alfred-main: ready)
  ✓ Privacy gate (level: balanced)
  ✓ Memory system (vector store: initialized)
  ✓ Playbook database (SQLite: created)

Alfred is ready! Here's what I can do:
  - Chat with me through the desktop app or any configured channel
  - Run 'alfred help' for CLI commands
  - Ask me to search the web, manage files, or run commands
  - I'll learn your preferences over time

What would you like to do first?
```

### Phase 6: Optional Quick Wins

After validation, Alfred offers to demonstrate capabilities:

```
Want me to set up any of these right now?
  [1] Morning briefing (daily summary at 8 AM)
  [2] Web monitoring (track changes on websites you care about)
  [3] Quick file workspace setup (organize a project directory)
  [4] Skip — I'll explore on my own
```

These are one-shot configurations that showcase Alfred's capabilities and provide immediate value.

## Headless Bootstrap

For automated deployments, Bootstrap can be run non-interactively using a configuration file:

```bash
alfred bootstrap --config bootstrap.json
```

Bootstrap configuration file:

```json
{
  "user": {
    "name": "Michael",
    "preferredName": "Mike",
    "timezone": "America/New_York",
    "expertise": "expert",
    "verbosity": "concise"
  },
  "model": {
    "provider": "anthropic",
    "apiKey": "env:ANTHROPIC_API_KEY",
    "fallback": "ollama"
  },
  "channels": [],
  "heartbeat": {
    "morningBriefing": false
  }
}
```

The `env:` prefix reads the value from an environment variable, avoiding API keys in configuration files.

## Re-Bootstrap

To re-run Bootstrap on an existing installation:

```bash
# Full re-bootstrap (preserves existing data, re-runs config flow)
alfred bootstrap --reconfigure

# Reset everything (DESTRUCTIVE: deletes all data and starts fresh)
alfred bootstrap --reset

# Reset only specific components
alfred bootstrap --reset-profile
alfred bootstrap --reset-credentials
alfred bootstrap --reset-channels
```

## Docker Bootstrap

When running Alfred in Docker, Bootstrap is handled via environment variables:

```yaml
environment:
  - ALFRED_USER_NAME=Mike
  - ALFRED_TIMEZONE=America/New_York
  - ALFRED_MODEL_PROVIDER=anthropic
  - ANTHROPIC_API_KEY=sk-ant-...
  - ALFRED_PRIVACY_LEVEL=balanced
  - ALFRED_BOOTSTRAP_HEADLESS=true
```

The Docker entrypoint detects `ALFRED_BOOTSTRAP_HEADLESS=true` and runs the headless bootstrap with environment variable values, creating all necessary configuration files in the mounted volume.

## Bootstrap Events

The Bootstrap process emits events that can be observed via the Gateway WebSocket:

| Event | Description |
|-------|-------------|
| `bootstrap:start` | Bootstrap process started |
| `bootstrap:phase` | Phase transition (includes phase number and name) |
| `bootstrap:profile-created` | User profile created |
| `bootstrap:model-configured` | Model provider configured and validated |
| `bootstrap:channel-added` | A channel was configured |
| `bootstrap:validated` | Configuration validation complete |
| `bootstrap:complete` | Bootstrap finished successfully |
| `bootstrap:error` | An error occurred during bootstrap (includes details) |

These events allow the desktop app to display a real-time progress UI during first-run setup.
