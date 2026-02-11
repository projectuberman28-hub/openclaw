# Backup Manager
## Description
Backup and restore the ~/.alfred/ directory. Creates compressed tar.gz archives with labels, supports listing, restoring, and pruning old backups. Verifies backup integrity via checksums.

## Tools
- `backup_create(label?: string)` — Create a backup of ~/.alfred/. Returns `{ id: string, path: string, size: number, label: string }`.
- `backup_list()` — List all backups. Returns `{ backups: BackupEntry[] }`.
- `backup_restore(id: string)` — Restore from a backup. Returns `{ restored: boolean, filesCount: number }`.
- `backup_prune(keepCount: number)` — Remove old backups, keeping N most recent. Returns `{ pruned: number, remaining: number }`.

## Dependencies
- Node.js zlib and tar modules for compression
- Node.js crypto for integrity checksums

## Fallbacks
- If tar compression fails, fall back to zip format
- If backup directory is too large, warn and offer selective backup
- Integrity check on restore; abort if checksum mismatch
