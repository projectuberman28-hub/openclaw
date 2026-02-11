# Web Monitor
## Description
Watch URLs for changes with configurable intervals and CSS selector targeting. Detects content changes via hashing, generates diffs, and sends alerts.

## Tools
- `monitor_add(url: string, interval: number, selector?: string)` — Add a URL to monitor. Returns `{ id: string, url: string, interval: number }`.
- `monitor_remove(url: string)` — Remove a monitored URL. Returns `{ removed: boolean }`.
- `monitor_list()` — List all monitored URLs with status. Returns `MonitorEntry[]`.
- `monitor_check(url: string)` — Force-check a URL now. Returns `{ changed: boolean, diff?: string }`.

## Dependencies
- SQLite (better-sqlite3) for persistent storage
- Node.js crypto for content hashing

## Fallbacks
- If fetch fails, retry with exponential backoff (3 attempts)
- If SQLite is unavailable, use in-memory Map with JSON file persistence
- If CSS selector fails, fall back to full-page content monitoring
