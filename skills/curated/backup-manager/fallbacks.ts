/**
 * @alfred/skill-backup-manager - Fallback strategies
 */

export interface FallbackStrategy {
  name: string;
  description: string;
  trigger: string;
  action: () => Promise<void> | void;
}

export function getFallbacks(): FallbackStrategy[] {
  return [
    {
      name: 'gzip-compression',
      description: 'Use Node.js built-in gzip for archive compression instead of external tar',
      trigger: 'Default compression strategy',
      action: () => {
        // Built into createBackupArchive — uses zlib.gzipSync
      },
    },
    {
      name: 'size-limit-warning',
      description: 'Warn when ~/.alfred/ exceeds 500MB and refuse to backup',
      trigger: 'Directory size exceeds MAX_SIZE',
      action: () => {
        // Built into backupCreate — checks size before proceeding
      },
    },
    {
      name: 'integrity-verification',
      description: 'Verify SHA-256 checksum on restore and abort if mismatch detected',
      trigger: 'Checksum comparison on backup_restore',
      action: () => {
        // Built into backupRestore — compares checksums before extraction
      },
    },
    {
      name: 'safety-backup-on-restore',
      description: 'Create automatic safety backup of current state before restoring',
      trigger: 'Before any backup_restore operation',
      action: () => {
        // Built into backupRestore — creates pre-restore safety backup
      },
    },
    {
      name: 'manifest-cleanup',
      description: 'Remove manifest entries for backup files that no longer exist on disk',
      trigger: 'backup_list detects missing files',
      action: () => {
        // Built into backupList — filters out entries with missing paths
      },
    },
  ];
}
