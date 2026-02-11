# System Boot Sequence

## Overview

The Boot sequence is the startup process that runs every time Alfred launches (after the initial Bootstrap). It initializes all subsystems in dependency order, validates configuration, restores state from disk, and opens the Gateway for connections.

Boot is designed to be fast (under 3 seconds on modern hardware) and resilient (degraded subsystems do not block startup).

## Boot Phases

### Phase 0: Environment Detection (< 50ms)

```
[BOOT] Detecting environment...
  Platform: linux/darwin/win32
  Node.js: v22.x.x
  Data home: ~/.alfred/
  PID: 12345
```

Alfred detects:
- Operating system and architecture
- Node.js version (minimum: 20.0.0)
- Data directory location (`ALFRED_HOME` env var or `~/.alfred/`)
- Whether running in Docker (checks for `/.dockerenv`)
- Whether running as a service (checks parent process)
- Available system resources (CPU cores, memory, disk space)

### Phase 1: Configuration Loading (< 100ms)

```
[BOOT] Loading configuration...
  Config: ~/.alfred/alfred.json (v3.0.0)
  Schema validation: passed
  Migration: none required
```

Steps:
1. Read `~/.alfred/alfred.json`
2. Validate against the configuration schema (`packages/core/src/config/schema.ts`)
3. Run config migrator if the schema version is outdated (`packages/core/src/config/migrator.ts`)
4. Merge with environment variable overrides (`ALFRED_*` prefix)
5. Freeze the configuration object (immutable for the lifetime of the process)

If `alfred.json` does not exist or is corrupted, Boot falls back to default configuration and logs a warning. If Bootstrap has never run, Boot redirects to the Bootstrap flow.

### Phase 2: Credential Vault Unlock (< 200ms)

```
[BOOT] Unlocking credential vault...
  Vault: ~/.alfred/credentials/vault.enc
  Keys available: 3
  Vault status: unlocked
```

Steps:
1. Check if the vault file exists
2. If passphrase-protected, prompt for passphrase (CLI) or use cached key (desktop app)
3. Derive decryption key via Argon2
4. Decrypt vault and load credentials into memory
5. Validate credential integrity (HMAC check)
6. Strip line breaks from credential values (handles copy-paste artifacts)

If the vault cannot be unlocked (wrong passphrase, corrupted file), Boot continues with no credentials. Cloud model calls will fail gracefully with a clear error message.

### Phase 3: Core Subsystem Initialization (< 500ms)

Subsystems initialize in dependency order:

```
[BOOT] Initializing subsystems...
  [1/8] Core utilities         ✓  (12ms)
  [2/8] Privacy gate           ✓  (34ms)
  [3/8] Memory store           ✓  (89ms)
  [4/8] Fallback registry      ✓  (23ms)
  [5/8] Agent system           ✓  (45ms)
  [6/8] Tools system           ✓  (31ms)
  [7/8] Forge engine           ✓  (56ms)
  [8/8] Playbook database      ✓  (67ms)
```

Each subsystem:
1. Loads its configuration from the frozen config object
2. Initializes internal state
3. Registers health check endpoints
4. Reports ready status

If a non-critical subsystem fails to initialize, Boot logs the error and marks it as degraded. The Gateway will report degraded status on the health endpoint.

**Initialization Order and Dependencies:**

| Order | Subsystem | Dependencies | Critical |
|-------|-----------|-------------|----------|
| 1 | Core utilities | none | yes |
| 2 | Privacy gate | core | yes |
| 3 | Memory store | core | no |
| 4 | Fallback registry | core | no |
| 5 | Agent system | core, privacy, memory, fallback | yes |
| 6 | Tools system | core, privacy, memory | no |
| 7 | Forge engine | core | no |
| 8 | Playbook database | core | no |

Critical subsystems failing will abort Boot with an error message and exit code 1.

### Phase 4: Model Provider Validation (< 1000ms)

```
[BOOT] Validating model providers...
  Anthropic (claude-sonnet-4-20250514): connected (latency: 180ms)
  Ollama (llama3): connected (latency: 12ms)
  Model audit: no warnings
```

Steps:
1. For each configured provider, send a lightweight validation request
2. Measure response latency for fallback routing
3. Run model audit checks (warns about deprecated models, known issues)
4. Register providers with the fallback registry
5. If primary provider is unreachable, promote fallback and log warning

Model validation runs with a 5-second timeout per provider. Unreachable providers are marked as offline in the fallback registry and will be retried periodically by the health system.

### Phase 5: Channel Initialization (< 2000ms)

```
[BOOT] Initializing channels...
  Signal: connected (via signal-cli at localhost:8080)
  Discord: connected (bot online, 3 guilds)
  WebChat: ready (will start with Gateway)
  Telegram: skipped (not configured)
  Slack: skipped (not configured)
  Matrix: skipped (not configured)
  BlueBubbles: skipped (not configured)
```

Steps:
1. Load channel extension modules from `extensions/`
2. For each configured channel, initialize the connection
3. Register message handlers with the channel router
4. Verify channel health (can send/receive messages)
5. Load channel-specific routing rules

Channels that fail to connect are retried on a backoff schedule (5s, 15s, 30s, 60s, then every 5 minutes). Channel failures do not block Boot.

### Phase 6: Skill Loading (< 500ms)

```
[BOOT] Loading skills...
  Bundled: 0 skills
  Curated: 15 skills loaded
  Forged: 2 skills loaded (sandbox verified)
  Total: 17 skills available
```

Steps:
1. Scan `skills/bundled/` for bundled skills
2. Scan `skills/curated/` for curated skills
3. Scan `~/.alfred/skills/forged/` for forge-generated skills
4. Validate each skill manifest
5. For forged skills, verify sandbox container availability
6. Register skill tools with the tools system

Skills with invalid manifests are skipped with a warning.

### Phase 7: Session Restoration (< 200ms)

```
[BOOT] Restoring sessions...
  Active sessions: 3
  Pruned (expired): 7
  Restored: 3 sessions across 2 agents
```

Steps:
1. Scan `~/.alfred/sessions/` for session files
2. Check each session against the TTL configuration
3. Prune expired sessions (move to archive, then delete after retention period)
4. Restore active sessions into the agent system
5. Rebuild in-memory session indices

### Phase 8: Scheduler Startup (< 100ms)

```
[BOOT] Starting scheduler...
  Cron jobs: 4 registered
  Heartbeats: 2 active
  Next scheduled: morning-briefing at 08:00 (in 2h 15m)
```

Steps:
1. Load cron schedules from configuration
2. Load heartbeat schedules
3. Register periodic maintenance tasks (memory compaction, session pruning, health checks)
4. Calculate next fire times
5. Start the scheduler loop

### Phase 9: Gateway Startup (< 100ms)

```
[BOOT] Starting Gateway...
  HTTP:  http://127.0.0.1:18789
  WS:    ws://127.0.0.1:18789/ws
  Auth:  token required
  Health: http://127.0.0.1:18789/health

[BOOT] Alfred v3.0.0 ready. (total boot time: 1.8s)
```

Steps:
1. Create HTTP server
2. Register API routes (agent RPC, health, auth)
3. Create WebSocket upgrade handler
4. Bind to configured address and port (default: `127.0.0.1:18789`, LAN bind supported)
5. Generate and display auth token (or use existing token from vault)
6. Start accepting connections

## Boot Configuration

Boot behavior can be configured in `alfred.json`:

```json
{
  "boot": {
    "bind": "127.0.0.1",
    "port": 18789,
    "lanBind": false,
    "logLevel": "info",
    "sessionRestore": true,
    "modelValidation": true,
    "modelValidationTimeout": 5000,
    "channelRetryInterval": 300000,
    "startupTimeout": 30000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bind` | string | `"127.0.0.1"` | IP address to bind to. Use `"0.0.0.0"` for LAN access. |
| `port` | number | `18789` | Port for the Gateway server. |
| `lanBind` | boolean | `false` | Shortcut for `bind: "0.0.0.0"`. Enables LAN access with a warning. |
| `logLevel` | string | `"info"` | Log verbosity: `debug`, `info`, `warn`, `error`. |
| `sessionRestore` | boolean | `true` | Whether to restore active sessions from disk on boot. |
| `modelValidation` | boolean | `true` | Whether to validate model providers on boot. Disable for faster offline starts. |
| `modelValidationTimeout` | number | `5000` | Timeout in ms for model provider validation requests. |
| `channelRetryInterval` | number | `300000` | Interval in ms between channel reconnection attempts (default: 5 minutes). |
| `startupTimeout` | number | `30000` | Maximum time in ms for the entire boot sequence. If exceeded, Boot aborts. |

## Graceful Shutdown

When Alfred receives SIGTERM or SIGINT:

```
[SHUTDOWN] Graceful shutdown initiated...
  [1/5] Closing Gateway (draining connections)...
  [2/5] Stopping scheduler...
  [3/5] Saving active sessions...
  [4/5] Flushing memory writes...
  [5/5] Closing database connections...

[SHUTDOWN] Alfred stopped cleanly. (shutdown time: 0.4s)
```

Steps:
1. Stop accepting new connections on the Gateway
2. Drain active WebSocket connections (send close frame, wait up to 5 seconds)
3. Stop the scheduler (cancel pending cron jobs)
4. Persist all active sessions to disk
5. Flush pending memory store writes
6. Close the Playbook database
7. Lock the credential vault
8. Exit with code 0

If shutdown exceeds 10 seconds, Alfred forces an exit with code 1 and logs a warning about potential data loss.

## Health Endpoint

After Boot, the health endpoint at `/health` reports system status:

```json
{
  "status": "healthy",
  "version": "3.0.0",
  "uptime": 3600,
  "subsystems": {
    "core": "healthy",
    "privacy": "healthy",
    "memory": "healthy",
    "fallback": "healthy",
    "agent": "healthy",
    "tools": "healthy",
    "forge": "healthy",
    "playbook": "healthy"
  },
  "models": {
    "anthropic": { "status": "connected", "latency": 180 },
    "ollama": { "status": "connected", "latency": 12 }
  },
  "channels": {
    "signal": "connected",
    "discord": "connected",
    "webchat": "ready"
  },
  "sessions": {
    "active": 3,
    "total": 142
  }
}
```

Status values: `healthy`, `degraded` (non-critical subsystem down), `unhealthy` (critical subsystem down). Docker HEALTHCHECK monitors this endpoint.
