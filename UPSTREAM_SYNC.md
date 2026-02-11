# Upstream Sync Guide

## Repositories
- **Origin (fork):** https://github.com/projectuberman28-hub/openclaw
- **Upstream:** https://github.com/openclaw/openclaw

## Current Upstream
OpenClaw 2026.2.9

## How to Sync
1. `git fetch upstream`
2. `git merge upstream/main`
3. Resolve conflicts (Alfred-only modules always keep ours)
4. Run full test suite: `pnpm test`
5. `git push origin main`

## Alfred-Only Modules (ALWAYS keep ours)
- packages/privacy/
- packages/forge/
- packages/playbook/
- packages/fallback/
- apps/desktop-tauri/
- apps/ios/
- skills/curated/
- docs/reference/templates/SOUL.md
- docs/reference/templates/USER.md

## 2026.2.9 Features Integrated
- [x] Context overflow recovery (pre-emptive tool result capping)
- [x] False positive overflow prevention
- [x] Session compaction parentId preservation
- [x] Agent RPC (create/update/delete) with immediate routing refresh
- [x] SSRF guard, path validator, LFI guard
- [x] Model audit warnings
- [x] System prompt safety guardrails
- [x] Credential line break stripping
- [x] HTTP 400 failover eligibility
- [x] Grok search with inline citations
- [x] Cron flat param recovery
- [x] .caf audio recognition
- [x] Telegram hardening (quote parsing, stale thread recovery, spoilers)
- [x] Discord forum/media thread-create
- [x] BlueBubbles channel
- [x] Compaction divider component
- [x] Exec approval monospace display
- [x] Runtime shell in envelopes
- [x] Channel routing refresh per message
- [x] LAN bind support
- [x] Voyage AI input_type
- [x] Shared embedding model cache
- [x] Hooks fixed for tsdown migration

## Private Features
Predictive linguistics (ALTA methodology) is PRIVATE to Archon.
- Flagged PRIVATE:true
- Never ships to users
- Only loads when ALFRED_OWNER=archon
