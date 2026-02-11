# CLAUDE.md — Alfred v3

You have FULL permission to create, edit, delete any file, run any command, install any package, start/stop services.

## Project Structure
- Monorepo with pnpm workspaces
- TypeScript throughout (except Tauri Rust backend and iOS Swift)
- Packages: core, privacy, memory, fallback, agent, tools, forge, playbook
- Apps: desktop-tauri (Tauri v2), ios (Swift/SwiftUI)
- Extensions: channel plugins (signal, discord, telegram, slack, matrix, webchat, bluebubbles)
- Skills: bundled, curated (15), forged (runtime)

## Build
- `pnpm install` then `pnpm build`
- `pnpm test` to run all tests
- `cd apps/desktop-tauri && pnpm tauri dev` for desktop

## Key Rules
- NEVER send data to cloud without privacy gate
- NEVER store secrets in plaintext
- NEVER log actual PII values
- Security is always on, even in dev mode
