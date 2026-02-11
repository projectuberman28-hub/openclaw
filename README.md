# Alfred v3

A privacy-first AI assistant that runs locally, supports multiple communication channels, and builds new capabilities at runtime.

Alfred is built as a fork of [OpenClaw](https://github.com/open-claw/open-claw), extending it with a privacy gate, offline fallback system, self-building skill forge, and operational memory playbook. All data stays on your device by default. Cloud LLM calls are privacy-gated with PII redaction and audit logging.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/alfred-v3.git
cd alfred-v3
corepack enable
pnpm install

# Build all packages
pnpm build

# Start the Gateway server
pnpm gateway

# Or run in development mode with hot reload
pnpm gateway:dev
```

Alfred starts on `http://127.0.0.1:18789`. On first run, the bootstrap process guides you through initial setup (user profile, model provider, and channel configuration).

### Docker

```bash
docker compose up -d
```

This starts Alfred, a local SearXNG instance for private web search, and optionally a Signal CLI bridge.

## Features

### Privacy First
- All data stored locally in `~/.alfred/`
- PII detection and redaction before any cloud API call
- Immutable audit log of all cloud interactions
- AES-256-GCM encrypted credential vault
- Configurable privacy levels: strict (local only), balanced (redacted cloud), permissive (user-consented)

### Multi-Channel
- **Signal** via signal-cli REST API
- **Discord** with forum and media thread support
- **Telegram** with hardened quote parsing, stale thread recovery, and spoiler support
- **Slack** via Bolt.js
- **Matrix** via matrix-js-sdk
- **WebChat** built-in browser interface
- **BlueBubbles** iMessage bridge

### Multi-Device
- Desktop app built with Tauri v2 (React + Rust)
- iOS app (Swift/SwiftUI)
- Encrypted session sync between devices
- QR code device pairing

### Self-Building (Forge)
- Detects capability gaps during conversations
- Generates new skills with tests and security sandboxing
- Forge-built skills run in isolated containers
- 15 curated skills ship out of the box

### Offline Capable
- Every cloud capability has a local fallback
- Ordered fallback chains with health monitoring
- HTTP 400 errors eligible for failover
- Automatic failover and recovery

### Intelligent Memory
- Semantic vector search over conversation history
- Hybrid search (vector + BM25 keyword matching)
- Automatic session summarization into long-term memory
- Playbook system for operational knowledge (learned procedures, preferences, decisions)

## Architecture

```
┌──────────────────────────────────────────────────┐
│                Desktop App (Tauri)                 │
│            React Frontend + Rust Backend           │
└─────────────────────┬────────────────────────────┘
                      │ WebSocket / HTTP
┌─────────────────────┴────────────────────────────┐
│                  Gateway Server                    │
│         HTTP API + WebSocket (127.0.0.1:18789)     │
├────────┬────────┬────────┬────────┬──────────────┤
│ Agent  │ Models │Channels│ Skills │ Auth + Health │
│ Loop   │Provider│ Router │ Loader │               │
└───┬────┴───┬────┴───┬────┴───┬────┴──────────────┘
    │        │        │        │
┌───┴───┐┌───┴──┐┌────┴─┐┌────┴───┐
│Privacy││Memory││Forge ││Playbook│
│ Gate  ││Store ││Engine││  DB    │
└───────┘└──────┘└──────┘└────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full architecture documentation.

## Project Structure

```
alfred-v3/
├── packages/           # Core monorepo packages
│   ├── core/           # Types, config, security, scheduler, sync
│   ├── privacy/        # PII detection, redaction, audit, credential vault
│   ├── memory/         # Vector store, embeddings, hybrid search
│   ├── fallback/       # Offline fallback chains and health monitoring
│   ├── agent/          # Agent loop, context, compaction, sessions
│   ├── tools/          # Safe executor, shell exec, web search
│   ├── forge/          # Gap detection, skill planning, templates
│   └── playbook/       # Operational memory database
├── src/gateway/        # HTTP + WebSocket gateway server
├── extensions/         # Channel plugins
│   ├── signal/
│   ├── discord/
│   ├── telegram/
│   ├── slack/
│   ├── matrix/
│   ├── webchat/
│   └── bluebubbles/
├── skills/
│   ├── curated/        # 15 built-in skills
│   └── bundled/        # User-installed skills
├── apps/
│   ├── desktop-tauri/  # Tauri v2 desktop app
│   └── ios/            # iOS app (Swift/SwiftUI)
├── test/               # Test suites (unit, integration, e2e, security, smoke)
└── docs/               # Architecture and reference documentation
```

## Build Commands

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages
pnpm test                 # Run all tests
pnpm test:watch           # Run tests in watch mode
pnpm test:coverage        # Run tests with coverage report
pnpm test:security        # Run security-specific tests
pnpm typecheck            # TypeScript type checking
pnpm lint                 # ESLint
pnpm clean                # Clean build artifacts
pnpm dev:desktop          # Start Tauri desktop app in dev mode
```

## Configuration

Alfred is configured through `~/.alfred/alfred.json`. Key settings:

```json
{
  "boot": {
    "bind": "127.0.0.1",
    "port": 18789,
    "logLevel": "info"
  },
  "privacy": {
    "level": "balanced"
  },
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-20250514",
    "fallback": ["local:llama3"]
  }
}
```

See [docs/reference/templates/](docs/reference/templates/) for complete configuration reference.

## Curated Skills

| Skill | Description |
|-------|-------------|
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

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes following the existing code style
4. Add tests for new functionality
5. Run the full test suite: `pnpm test`
6. Run type checking: `pnpm typecheck`
7. Submit a pull request

### Development Guidelines

- TypeScript strict mode throughout
- All cloud interactions must go through the Privacy Gate
- All file operations must go through the Path Validator
- All HTTP requests must go through the SSRF Guard
- Never store secrets in plaintext
- Never log PII values
- Write tests for security-critical code paths

## License

Private. See LICENSE for details.
