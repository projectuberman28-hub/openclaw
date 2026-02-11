/**
 * @alfred/core - Configuration loader
 *
 * Loads alfred.json from ALFRED_HOME, merges with defaults, validates,
 * resolves $vault: references, and clamps maxTokens.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { AlfredConfigSchema, DEFAULT_CONFIG, type AlfredConfig } from './schema.js';
import { validateConfig, type ValidationResult } from './validator.js';
import { buildPaths, ensureDirectories } from './paths.js';

/**
 * Credential vault resolver interface.
 * The real implementation lives in @alfred/privacy — here we define the contract.
 */
export interface VaultResolver {
  resolve(key: string): Promise<string | undefined>;
}

/** Default no-op vault that returns the reference unchanged */
const noopVault: VaultResolver = {
  resolve: async (key: string) => `$vault:${key}`,
};

/**
 * Deep-merge two objects.  Arrays are replaced (not concatenated).
 */
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    const overVal = (override as Record<string, unknown>)[key];
    const baseVal = result[key];

    if (
      overVal !== null &&
      typeof overVal === 'object' &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }

  return result as T;
}

/**
 * Recursively walk an object and resolve any string values beginning with "$vault:".
 */
async function resolveVaultRefs(
  obj: unknown,
  vault: VaultResolver,
): Promise<unknown> {
  if (typeof obj === 'string' && obj.startsWith('$vault:')) {
    const key = obj.slice('$vault:'.length);
    const resolved = await vault.resolve(key);
    return resolved ?? obj; // keep original ref if vault doesn't have it
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map((item) => resolveVaultRefs(item, vault)));
  }

  if (obj !== null && typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    const resolved = await Promise.all(
      entries.map(async ([k, v]) => [k, await resolveVaultRefs(v, vault)] as const),
    );
    return Object.fromEntries(resolved);
  }

  return obj;
}

/**
 * Load the Alfred configuration.
 *
 * 1. Read ALFRED_HOME/alfred.json (create with defaults if missing)
 * 2. Deep-merge with DEFAULT_CONFIG
 * 3. Decode through TypeBox defaults
 * 4. Resolve $vault: references
 * 5. Validate
 * 6. Clamp maxTokens to contextWindow for every agent
 */
export async function loadConfig(
  vault?: VaultResolver,
): Promise<{ config: AlfredConfig; validation: ValidationResult }> {
  const paths = ensureDirectories();
  const configPath = paths.config;
  const effectiveVault = vault ?? noopVault;

  // ----- Read or create config file -----
  let rawJson: unknown;

  if (existsSync(configPath)) {
    const text = readFileSync(configPath, 'utf-8');
    try {
      rawJson = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // Create default config
    rawJson = DEFAULT_CONFIG;
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }

  // ----- Merge with defaults -----
  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    rawJson as Record<string, unknown>,
  );

  // Apply TypeBox defaults to fill any missing optional fields
  const withDefaults = Value.Default(AlfredConfigSchema, Value.Clone(merged));

  // ----- Resolve vault references -----
  const resolved = (await resolveVaultRefs(withDefaults, effectiveVault)) as AlfredConfig;

  // ----- Validate -----
  const validation = validateConfig(resolved);
  const config = validation.config;

  // ----- Final clamp pass -----
  if (config.agents) {
    for (const agent of config.agents) {
      const ctxWin = agent.contextWindow ?? 128000;
      if (agent.maxTokens !== undefined && agent.maxTokens > ctxWin) {
        agent.maxTokens = ctxWin;
      }
    }
  }

  return { config, validation };
}

/**
 * Synchronous config read -- no vault resolution, useful for quick reads.
 */
export function loadConfigSync(): { config: AlfredConfig; validation: ValidationResult } {
  const paths = ensureDirectories();
  const configPath = paths.config;

  let rawJson: unknown;

  if (existsSync(configPath)) {
    const text = readFileSync(configPath, 'utf-8');
    try {
      rawJson = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    rawJson = DEFAULT_CONFIG;
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }

  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    rawJson as Record<string, unknown>,
  );

  const withDefaults = Value.Default(AlfredConfigSchema, Value.Clone(merged));
  const validation = validateConfig(withDefaults);
  const config = validation.config;

  if (config.agents) {
    for (const agent of config.agents) {
      const ctxWin = agent.contextWindow ?? 128000;
      if (agent.maxTokens !== undefined && agent.maxTokens > ctxWin) {
        agent.maxTokens = ctxWin;
      }
    }
  }

  return { config, validation };
}
