/**
 * @alfred/core - Configuration migrator
 *
 * Supports v1 -> v2 -> v3 migration path with automatic backups.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
  changes: string[];
  success: boolean;
  error?: string;
}

const CURRENT_VERSION = 3;

/**
 * Create a timestamped backup of the config file.
 */
function backupConfig(configPath: string): string {
  const dir = dirname(configPath);
  const backupDir = join(dir, 'backups');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `alfred.json.backup-${timestamp}`);
  copyFileSync(configPath, backupPath);

  return backupPath;
}

/**
 * Migrate a v1 config to v2 format.
 *
 * v1 shape (flat):
 *   { model, api_key, system_prompt, ... }
 *
 * v2 shape:
 *   { version: 2, agents: [...], memory: {...}, privacy: {...} }
 */
function migrateV1toV2(config: Record<string, unknown>): { config: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];

  const v2: Record<string, unknown> = { version: 2 };

  // Convert flat model config to agent
  const model = (config['model'] as string) || 'openai/gpt-4';
  const apiKey = config['api_key'] as string | undefined;
  const systemPrompt = config['system_prompt'] as string | undefined;
  const name = (config['name'] as string) || 'Alfred';

  v2['agents'] = [
    {
      id: 'alfred',
      identity: { name },
      model,
      systemPrompt: systemPrompt || undefined,
      tools: Array.isArray(config['tools']) ? config['tools'] : [],
      subagent: false,
    },
  ];
  changes.push(`Migrated flat model config to agents array with model "${model}"`);

  // Migrate memory settings
  if (config['memory_backend'] || config['memory']) {
    v2['memory'] = {
      backend: (config['memory_backend'] as string) || 'sqlite',
      maxConversationHistory:
        (config['max_history'] as number) || (config['memory_limit'] as number) || 100,
      summarize: config['summarize'] !== false,
      syncEnabled: false,
    };
    changes.push('Migrated memory settings to structured memory section');
  }

  // Migrate privacy settings
  v2['privacy'] = {
    piiDetection: config['pii_detection'] !== false,
    piiRedaction: config['pii_redaction'] !== false,
    auditLog: config['audit_log'] !== false,
    localOnly: config['local_only'] === true,
    customPatterns: [],
    allowedEndpoints: [],
    blockedEndpoints: [],
  };
  changes.push('Created privacy section from legacy flags');

  // Migrate channels
  if (Array.isArray(config['channels'])) {
    v2['channels'] = (config['channels'] as Record<string, unknown>[]).map((ch) => ({
      name: ch['name'] || ch['type'] || 'unknown',
      type: ch['type'] || 'cli',
      enabled: ch['enabled'] !== false,
      config: ch['config'] || {},
    }));
    changes.push(`Migrated ${(config['channels'] as unknown[]).length} channels`);
  } else {
    v2['channels'] = [];
  }

  // Carry forward tools
  if (Array.isArray(config['tool_configs'])) {
    v2['tools'] = (config['tool_configs'] as Record<string, unknown>[]).map((t) => ({
      name: t['name'] || 'unknown',
      enabled: t['enabled'] !== false,
      timeout: t['timeout'] || 30000,
      config: t['config'] || {},
    }));
    changes.push(`Migrated ${(config['tool_configs'] as unknown[]).length} tool configurations`);
  } else {
    v2['tools'] = [];
  }

  // Carry over API keys as vault references
  if (apiKey) {
    changes.push('Converted api_key to $vault:api_key reference (remove plaintext key!)');
    // Don't store the actual key in the new config — reference the vault
    const agent = (v2['agents'] as Record<string, unknown>[])[0]!;
    (agent as Record<string, unknown>)['apiKey'] = '$vault:api_key';
  }

  return { config: v2, changes };
}

/**
 * Migrate a v2 config to v3 format.
 *
 * v2 -> v3 changes:
 *   - Add contextWindow + maxTokens to agents
 *   - Add forge, playbook, gateway, ui sections
 *   - Add vectorStore option to memory
 *   - Add temperature to agents
 *   - Agents gain fallbacks array
 */
function migrateV2toV3(config: Record<string, unknown>): { config: Record<string, unknown>; changes: string[] } {
  const changes: string[] = [];
  const v3: Record<string, unknown> = { ...config, version: 3 };

  // Update agents
  if (Array.isArray(v3['agents'])) {
    v3['agents'] = (v3['agents'] as Record<string, unknown>[]).map((agent) => {
      const updated = { ...agent };

      if (!updated['contextWindow']) {
        updated['contextWindow'] = 128000;
        changes.push(`Agent "${updated['id']}": added contextWindow=128000`);
      }
      if (!updated['maxTokens']) {
        updated['maxTokens'] = 8192;
        changes.push(`Agent "${updated['id']}": added maxTokens=8192`);
      }
      if (updated['temperature'] === undefined) {
        updated['temperature'] = 0.7;
        changes.push(`Agent "${updated['id']}": added temperature=0.7`);
      }
      if (!updated['fallbacks']) {
        updated['fallbacks'] = [];
        changes.push(`Agent "${updated['id']}": added empty fallbacks array`);
      }

      return updated;
    });
  }

  // Add forge section
  if (!v3['forge']) {
    v3['forge'] = {
      enabled: true,
      autoInstall: false,
      sandbox: true,
    };
    changes.push('Added forge section with defaults');
  }

  // Add playbook section
  if (!v3['playbook']) {
    v3['playbook'] = {
      enabled: true,
      autoDiscover: true,
      watchForChanges: true,
    };
    changes.push('Added playbook section with defaults');
  }

  // Add gateway section
  if (!v3['gateway']) {
    v3['gateway'] = {
      enabled: true,
      host: '127.0.0.1',
      port: 18789,
    };
    changes.push('Added gateway section with defaults');
  }

  // Add ui section
  if (!v3['ui']) {
    v3['ui'] = {
      enabled: true,
      theme: 'dark',
      showTokenUsage: true,
      notificationsEnabled: true,
    };
    changes.push('Added ui section with defaults');
  }

  // Enhance memory with vectorStore
  if (v3['memory'] && typeof v3['memory'] === 'object') {
    const mem = v3['memory'] as Record<string, unknown>;
    if (!mem['vectorStore']) {
      mem['vectorStore'] = { enabled: false };
      changes.push('Added vectorStore option to memory section');
    }
  }

  return { config: v3, changes };
}

/**
 * Detect the version of a config object.
 */
export function detectVersion(config: Record<string, unknown>): number {
  if (typeof config['version'] === 'number') {
    return config['version'];
  }

  // Heuristic: v1 configs have flat model/api_key fields
  if ('model' in config && 'api_key' in config && !('agents' in config)) {
    return 1;
  }

  // Heuristic: v2 configs have agents but no forge/gateway
  if ('agents' in config && !('forge' in config)) {
    return 2;
  }

  // Default to current
  return CURRENT_VERSION;
}

/**
 * Migrate a config file to the current version.
 *
 * Performs a backup before any migration, then applies v1->v2->v3 steps as needed.
 */
export function migrateConfig(configPath: string): MigrationResult {
  if (!existsSync(configPath)) {
    return {
      fromVersion: CURRENT_VERSION,
      toVersion: CURRENT_VERSION,
      backupPath: null,
      changes: ['Config file does not exist, no migration needed'],
      success: true,
    };
  }

  let raw: Record<string, unknown>;
  try {
    const text = readFileSync(configPath, 'utf-8');
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    return {
      fromVersion: 0,
      toVersion: CURRENT_VERSION,
      backupPath: null,
      changes: [],
      success: false,
      error: `Failed to read config: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const fromVersion = detectVersion(raw);

  if (fromVersion >= CURRENT_VERSION) {
    return {
      fromVersion,
      toVersion: CURRENT_VERSION,
      backupPath: null,
      changes: ['Config is already at the current version'],
      success: true,
    };
  }

  // Backup before migration
  const backupPath = backupConfig(configPath);
  const allChanges: string[] = [`Backed up config to ${backupPath}`];
  let current = raw;

  try {
    // v1 -> v2
    if (fromVersion <= 1) {
      const result = migrateV1toV2(current);
      current = result.config;
      allChanges.push(...result.changes);
    }

    // v2 -> v3
    if (fromVersion <= 2) {
      const result = migrateV2toV3(current);
      current = result.config;
      allChanges.push(...result.changes);
    }

    // Write migrated config
    writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf-8');
    allChanges.push(`Wrote migrated config (v${fromVersion} -> v${CURRENT_VERSION})`);

    return {
      fromVersion,
      toVersion: CURRENT_VERSION,
      backupPath,
      changes: allChanges,
      success: true,
    };
  } catch (err) {
    return {
      fromVersion,
      toVersion: CURRENT_VERSION,
      backupPath,
      changes: allChanges,
      success: false,
      error: `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check whether a config file needs migration.
 */
export function needsMigration(configPath: string): boolean {
  if (!existsSync(configPath)) return false;

  try {
    const text = readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(text) as Record<string, unknown>;
    return detectVersion(raw) < CURRENT_VERSION;
  } catch {
    return false;
  }
}
