/**
 * @alfred/core - Path resolution and directory management
 *
 * Resolves ALFRED_HOME, ALFRED_STATE_DIR, and ensures all required
 * subdirectories exist at startup.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve the Alfred home directory.
 * Priority: ALFRED_HOME env var > ~/.alfred
 */
export function resolveAlfredHome(): string {
  const fromEnv = process.env['ALFRED_HOME'];
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return join(homedir(), '.alfred');
}

/**
 * Resolve the Alfred state directory.
 * Priority: ALFRED_STATE_DIR env var > ALFRED_HOME
 */
export function resolveStateDir(): string {
  const fromEnv = process.env['ALFRED_STATE_DIR'];
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolveAlfredHome();
}

/** Standard subdirectory names within ALFRED_HOME */
export const SUBDIR_NAMES = {
  logs: 'logs',
  cache: 'cache',
  credentials: 'credentials',
  workspace: 'workspace',
  skills: 'skills',
  playbook: 'playbook',
  devices: 'devices',
  state: 'state',
  memory: 'memory',
  tools: 'tools',
  channels: 'channels',
} as const;

export type SubdirName = keyof typeof SUBDIR_NAMES;

/** Resolved path map keyed by subdirectory name */
export interface AlfredPaths {
  home: string;
  stateDir: string;
  config: string; // alfred.json
  logs: string;
  cache: string;
  credentials: string;
  workspace: string;
  skills: string;
  playbook: string;
  devices: string;
  state: string;
  memory: string;
  tools: string;
  channels: string;
  tasksFile: string; // TASKS.md
}

/**
 * Build the full set of Alfred paths.
 * Does NOT create directories -- call `ensureDirectories` for that.
 */
export function buildPaths(): AlfredPaths {
  const home = resolveAlfredHome();
  const stateDir = resolveStateDir();

  const paths: AlfredPaths = {
    home,
    stateDir,
    config: join(home, 'alfred.json'),
    logs: join(stateDir, SUBDIR_NAMES.logs),
    cache: join(stateDir, SUBDIR_NAMES.cache),
    credentials: join(home, SUBDIR_NAMES.credentials),
    workspace: join(home, SUBDIR_NAMES.workspace),
    skills: join(home, SUBDIR_NAMES.skills),
    playbook: join(home, SUBDIR_NAMES.playbook),
    devices: join(home, SUBDIR_NAMES.devices),
    state: join(stateDir, SUBDIR_NAMES.state),
    memory: join(stateDir, SUBDIR_NAMES.memory),
    tools: join(home, SUBDIR_NAMES.tools),
    channels: join(home, SUBDIR_NAMES.channels),
    tasksFile: join(home, 'TASKS.md'),
  };

  return paths;
}

/**
 * Ensure all standard Alfred directories exist.
 * Creates them recursively if missing.
 */
export function ensureDirectories(paths?: AlfredPaths): AlfredPaths {
  const p = paths ?? buildPaths();

  const dirsToEnsure = [
    p.home,
    p.stateDir,
    p.logs,
    p.cache,
    p.credentials,
    p.workspace,
    p.skills,
    p.playbook,
    p.devices,
    p.state,
    p.memory,
    p.tools,
    p.channels,
  ];

  for (const dir of dirsToEnsure) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return p;
}

/**
 * Get a specific subdirectory path by name.
 */
export function getSubdirPath(name: SubdirName): string {
  const home = resolveAlfredHome();
  const stateDir = resolveStateDir();

  // State-related dirs live under stateDir, others under home
  const stateDirs: SubdirName[] = ['logs', 'cache', 'state', 'memory'];
  const base = stateDirs.includes(name) ? stateDir : home;

  return join(base, SUBDIR_NAMES[name]);
}
