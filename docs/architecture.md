# Alfred v3 Architecture

## Overview
Alfred v3 is a privacy-first AI assistant built as a fork of OpenClaw. All data stays local by default, cloud LLM calls are privacy-gated, and every external dependency has a local fallback.

## System Architecture

### Core Principles
1. **Privacy First**: All data local by default. PII stripped before cloud calls.
2. **Offline Capable**: Every capability has a local fallback.
3. **Self-Building**: Forge system detects gaps and builds new skills.
4. **Multi-Channel**: Signal, Discord, Telegram, Slack, Matrix, WebChat, BlueBubbles.
5. **Multi-Device**: Desktop + iOS with encrypted sync.

### Component Overview

```
┌─────────────────────────────────────────────────────┐
│                    Desktop App (Tauri)                │
│              React Frontend + Rust Backend            │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket / HTTP
┌──────────────────────┴──────────────────────────────┐
│                    Gateway Server                     │
│           HTTP API + WebSocket (127.0.0.1:18789)      │
├─────────┬────────┬────────┬────────┬────────────────┤
│ Agent   │ Models │Channels│ Skills │  Auth + Health  │
│ Loop    │Provider│ Router │ Loader │                 │
└────┬────┴───┬────┴───┬────┴───┬────┴────────────────┘
     │        │        │        │
┌────┴────┐┌──┴───┐┌───┴──┐┌───┴────┐
│ Privacy ││Memory││Forge ││Playbook│
│  Gate   ││Store ││Engine││  DB    │
└─────────┘└──────┘└──────┘└────────┘
```

### Package Dependency Graph
- core → (none)
- privacy → core
- memory → core
- fallback → core
- agent → core, privacy, memory, fallback
- tools → core, privacy, memory
- forge → core
- playbook → core

### Data Flow
1. Message arrives via Channel or Desktop App
2. Channel Router determines target Agent
3. Agent Loop assembles context (system prompt + memories + messages)
4. If cloud model: Privacy Gate strips PII, logs audit entry
5. Model Provider sends to LLM (local or cloud)
6. Response streamed back through Gateway
7. Tool calls executed via Safe Executor
8. Playbook logs all operations
9. Forge monitors for capability gaps

### Security Boundaries
- All cloud calls through Privacy Gate
- SSRF guard on all outbound HTTP
- Path validation on all file operations
- Forge sandbox for untrusted skills
- Credential vault with AES-256-GCM encryption
- Gateway token auth on all connections

### Directory Layout
- ~/.alfred/ — User data home
- ~/.alfred/credentials/ — Encrypted vault
- ~/.alfred/logs/ — Audit logs, daily logs
- ~/.alfred/memory/ — Vector store
- ~/.alfred/sessions/ — Conversation sessions
- ~/.alfred/playbook/ — Operational memory DB
- ~/.alfred/workspace/ — Agent workspace
- ~/.alfred/cache/ — Model cache, embeddings
- ~/.alfred/devices.json — Paired devices
- ~/.alfred/alfred.json — Configuration

### Gateway Server

The Gateway is the central HTTP and WebSocket server that binds to `127.0.0.1:18789` by default (LAN bind supported). It provides:

- **Protocol layer** (`src/gateway/protocol.ts`): Message framing for WebSocket and HTTP SSE streaming. Handles envelope encoding, runtime shell injection, and channel routing refresh per message.
- **Auth layer** (`src/gateway/auth.ts`): Token-based authentication for all connections. Tokens are generated on first run and stored in the credential vault.
- **Health endpoint** (`src/gateway/health.ts`): Exposes `/health` for Docker healthchecks and monitoring. Reports model availability, memory usage, and channel status.
- **Cron scheduler** (`src/gateway/cron.ts`): Flat param recovery for scheduled tasks. Handles heartbeat messages, recurring skill execution, and session pruning schedules.
- **RPC layer** (`src/gateway/rpc.ts`): Agent CRUD operations (create/update/delete) with immediate routing refresh. Used by the desktop app and CLI for agent management.
- **Hooks system** (`src/gateway/hooks.ts`): Lifecycle hooks for message pre/post processing, model selection overrides, and channel-specific transformations. Migrated to tsdown build pipeline.

### Agent System

The Agent package (`packages/agent/`) manages the conversation lifecycle:

- **System prompt assembly** (`system-prompt.ts`): Composes the system prompt from agent identity, soul definition, user profile, available tools, and active context memories.
- **Context management** (`context.ts`): Pre-emptive tool result capping for context overflow recovery. False positive overflow prevention ensures legitimate large responses are not incorrectly truncated.
- **Streaming** (`streaming.ts`): SSE and WebSocket streaming with backpressure handling. Supports partial message recovery on connection drops.
- **Compaction** (`compaction.ts`): Session compaction with parentId preservation. Generates summary messages when conversations exceed context limits while maintaining thread lineage.
- **Session management** (`session.ts`): Session creation, persistence, and restoration. Handles multi-device session handoff via the sync engine.
- **Session pruning** (`session-pruning.ts`): Automatic cleanup of stale sessions based on configurable TTL and activity thresholds.
- **Conversation intelligence** (`intelligence/conversation-analyzer.ts`): Analyzes conversation patterns to detect topic shifts, sentiment changes, and capability gaps that feed into the Forge system.

### Privacy System

The Privacy package (`packages/privacy/`) enforces data boundaries:

- **PII Detector** (`pii-detector.ts`): Pattern and ML-based detection of personally identifiable information across 20+ categories (names, emails, phone numbers, SSNs, addresses, IPs, etc.).
- **Redactor** (`redactor.ts`): Replaces detected PII with reversible tokens before cloud model calls. Tokens are restored in the response before delivery to the user.
- **Privacy Gate** (`privacy-gate.ts`): Central enforcement point. All outbound model API calls pass through the gate. Logs audit entries, applies redaction, and enforces the configured privacy level (strict/balanced/permissive).
- **Audit Log** (`audit-log.ts`): Immutable append-only log of all privacy-relevant events. Records what was redacted, which model received the call, and whether the user consented.
- **Credential Vault** (`credential-vault.ts`): AES-256-GCM encrypted storage for API keys, tokens, and secrets. Keys are derived from a user-provided passphrase via Argon2. Line break stripping on credential import.
- **Data Boundary** (`data-boundary.ts`): Defines what data can cross which boundaries (local-only, cloud-allowed, user-consented). Enforces classification at the field level.

### Memory System

The Memory package (`packages/memory/`) provides persistent context:

- **Vector Store** (`vector-store.ts`): Local vector database for semantic search over memories. Uses configurable embedding models with shared model cache. Supports Voyage AI input_type parameter.
- **Embeddings** (`embeddings.ts`): Embedding generation with local (ONNX) and cloud (OpenAI, Voyage) providers. Shared embedding model cache across all memory operations.
- **Hybrid Search** (`hybrid-search.ts`): Combines vector similarity with keyword BM25 search for optimal recall. Supports filtered queries by time range, source, and category.
- **Daily Log** (`daily-log.ts`): Automatic journaling of significant interactions. Feeds into the user profile and long-term memory synthesis.
- **Compaction** (`compaction.ts`): Memory compaction and deduplication. Merges overlapping memories and promotes frequently accessed items.

### Fallback System

The Fallback package (`packages/fallback/`) ensures offline operation:

- **Chain** (`chain.ts`): Ordered fallback chains for each capability. Tries providers in priority order, falling through on failure. HTTP 400 errors are now eligible for failover.
- **Registry** (`registry.ts`): Registers available providers and their capabilities. Tracks health status and response latency for intelligent routing.
- **Health** (`health.ts`): Periodic health checks on all registered providers. Marks providers as degraded or offline and adjusts routing accordingly.

### Forge System

The Forge package (`packages/forge/`) enables self-building:

- **Detector** (`detector.ts`): Monitors conversations and tool call failures to detect capability gaps. When Alfred cannot fulfill a request, the detector logs it as a forge candidate.
- **Planner** (`planner.ts`): Takes a detected gap and produces a skill specification. Determines required inputs, outputs, dependencies, and security requirements.
- **Skill Template** (`templates/skill-template.ts`): Standard template for generated skills. Includes the skill manifest, handler function, test scaffold, and security sandbox configuration.

Forge-generated skills run in an isolated sandbox container (`Dockerfile.sandbox`) with no network access, no filesystem access outside `/sandbox`, and a strict execution timeout.

### Playbook System

The Playbook package (`packages/playbook/`) provides operational memory:

- **Types** (`types.ts`): Defines the schema for playbook entries: procedures, preferences, decisions, and their metadata (confidence, source, last-used).
- **Database** (`database.ts`): SQLite-backed storage for operational knowledge. Supports full-text search and temporal queries.

The Playbook stores learned procedures ("when the user asks X, do Y"), user preferences, and operational decisions that persist across sessions and inform future agent behavior.

### Tools System

The Tools package (`packages/tools/`) provides safe execution:

- **Safe Executor** (`safe-executor.ts`): Sandboxed execution environment for tool calls. Applies timeouts, resource limits, and output size caps.
- **Exec** (`exec.ts`): Shell command execution with approval workflows. Displays commands in monospace for user review. Exec approval with monospace display.
- **Process** (`process.ts`): Long-running process management. Handles background tasks, progress reporting, and graceful termination.
- **Web Search** (`web-search.ts`): Privacy-respecting web search via local SearXNG instance. Supports Grok search with inline citations as a cloud fallback.

### Channel Extensions

All channel extensions live in `extensions/` and implement a common Channel interface:

| Channel | Directory | Protocol |
|---------|-----------|----------|
| Signal | `extensions/signal/` | signal-cli REST API |
| Discord | `extensions/discord/` | Discord.js, forum/media thread-create |
| Telegram | `extensions/telegram/` | Telegraf, hardened quote parsing, stale thread recovery, spoiler support |
| Slack | `extensions/slack/` | Bolt.js |
| Matrix | `extensions/matrix/` | matrix-js-sdk |
| WebChat | `extensions/webchat/` | Built-in WebSocket |
| BlueBubbles | `extensions/bluebubbles/` | BlueBubbles REST API |

Channel routing is refreshed per message, allowing runtime agent reassignment without restart.

### Curated Skills

Fifteen curated skills ship with Alfred, each in `skills/curated/`:

| Skill | Purpose |
|-------|---------|
| backup-manager | Automated local backup orchestration |
| code-review | Git diff analysis and code review |
| competitor-watch | Competitive intelligence monitoring |
| email-digest | Email summarization and priority sorting |
| expense-tracker | Receipt scanning and expense categorization |
| fitness-log | Workout and health metric tracking |
| habit-tracker | Habit streak monitoring and reminders |
| invoice-generator | PDF invoice creation from templates |
| meeting-notes | Meeting transcription and action item extraction |
| pdf-extract | PDF text extraction and summarization |
| recipe-scaler | Recipe ingredient scaling and conversion |
| research-agent | Multi-source research compilation |
| social-drafter | Social media post drafting and scheduling |
| web-monitor | Website change detection and alerting |
| youtube-summarize | YouTube video transcription and summary |

### Desktop Application

The desktop app (`apps/desktop-tauri/`) is built with Tauri v2:

- **Frontend**: React with TypeScript
- **Backend**: Rust (Tauri)
- **Communication**: WebSocket to the Gateway server
- **Features**: System tray, global hotkey, native notifications, auto-update

### Sync Engine

The Sync Engine (`packages/core/src/sync/`) handles multi-device operation:

- Encrypted session sync between Desktop and iOS
- Conflict resolution with last-write-wins + merge for non-conflicting fields
- Device pairing via QR code exchange
- Sync state tracked in `~/.alfred/devices.json`

### Scheduler

The Task Scheduler (`packages/core/src/scheduler/`) manages timed operations:

- Cron-based task scheduling with flat param recovery
- Heartbeat message delivery
- Periodic memory compaction
- Session pruning on configurable intervals
- Health check polling for fallback providers
