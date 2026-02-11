/**
 * @alfred/skill-backup-manager - Test cases
 */

export default [
  {
    name: 'backup_create creates a backup with label',
    input: { tool: 'backup_create', args: { label: 'pre-update' } },
    expected: { id: 'string', path: 'string', size: 'number', label: 'pre-update', fileCount: 'number' },
  },
  {
    name: 'backup_create generates default label',
    input: { tool: 'backup_create', args: {} },
    expected: { id: 'string', label: 'string' },
  },
  {
    name: 'backup_list returns all backups',
    input: { tool: 'backup_list', args: {} },
    expected: { backups: 'array' },
  },
  {
    name: 'backup_restore throws for unknown ID',
    input: { tool: 'backup_restore', args: { id: 'nonexistent' } },
    expected: { error: 'Backup not found' },
  },
  {
    name: 'backup_restore verifies checksum',
    input: { tool: 'backup_restore', args: { id: 'valid-id' } },
    expected: { restored: true, filesCount: 'number' },
  },
  {
    name: 'backup_prune removes old backups',
    input: { tool: 'backup_prune', args: { keepCount: 2 } },
    expected: { pruned: 'number', remaining: 2 },
  },
  {
    name: 'backup_prune requires keeping at least 1',
    input: { tool: 'backup_prune', args: { keepCount: 0 } },
    expected: { error: 'Must keep at least 1' },
  },
  {
    name: 'backup_prune defaults to keeping 5',
    input: { tool: 'backup_prune', args: {} },
    expected: { remaining: 'number' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
