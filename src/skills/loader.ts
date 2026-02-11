/**
 * @alfred/skills - Skill Loader
 *
 * Loads skill definitions from bundled/, curated/, and forged/ directories.
 * Performs path validation on all skill paths to prevent traversal attacks.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPaths } from '@alfred/core/config/paths.js';
import { validatePath, isWithinBase } from '@alfred/core/security/path-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: SkillToolDef[];
  /** Source: bundled, curated, or forged. */
  source: 'bundled' | 'curated' | 'forged';
  /** Whether this skill is enabled. */
  enabled: boolean;
  /** Filesystem path to the skill directory. */
  path: string;
}

export interface SkillToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Entry point file (relative to skill dir). */
  entryPoint?: string;
  /** Timeout in ms. */
  timeout?: number;
}

export type Skill = SkillManifest;

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

export class SkillLoader {
  private projectRoot: string;
  private skillsHome: string;
  private searchDirs: string[];

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.skillsHome = buildPaths().skills;

    // Standard skill directories
    this.searchDirs = [
      join(this.projectRoot, 'skills', 'bundled'),
      join(this.projectRoot, 'skills', 'curated'),
      join(this.skillsHome, 'forged'),
    ];
  }

  /**
   * Load all skills from all search directories.
   */
  async loadAll(): Promise<Skill[]> {
    const skills: Skill[] = [];

    for (const dir of this.searchDirs) {
      if (!existsSync(dir)) continue;

      const source = this.getSource(dir);
      const dirEntries = readdirSync(dir, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (!entry.isDirectory()) continue;

        const skillDir = join(dir, entry.name);

        try {
          const skill = await this.loadSkill(skillDir, source);
          if (skill) {
            skills.push(skill);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[SkillLoader] Failed to load skill from ${skillDir}: ${message}`);
        }
      }
    }

    console.log(`[SkillLoader] Loaded ${skills.length} skills`);
    return skills;
  }

  /**
   * Load a single skill from a directory.
   *
   * Expects the directory to contain a skill.json manifest file.
   */
  async loadSkill(dir: string, source?: 'bundled' | 'curated' | 'forged'): Promise<Skill | null> {
    const resolvedDir = resolve(dir);

    // Path validation: ensure the skill directory is within allowed paths
    const allowed = this.searchDirs.some((searchDir) =>
      isWithinBase(resolvedDir, searchDir),
    );

    if (!allowed) {
      console.warn(`[SkillLoader] Rejected skill path outside allowed directories: ${resolvedDir}`);
      return null;
    }

    const manifestPath = join(resolvedDir, 'skill.json');

    if (!existsSync(manifestPath)) {
      // Try package.json as fallback
      const packagePath = join(resolvedDir, 'package.json');
      if (existsSync(packagePath)) {
        return this.loadFromPackageJson(resolvedDir, source ?? 'bundled');
      }
      return null;
    }

    // Validate the manifest path itself
    if (!validatePath(manifestPath)) {
      console.warn(`[SkillLoader] Manifest path failed validation: ${manifestPath}`);
      return null;
    }

    const raw = readFileSync(manifestPath, 'utf-8');
    let manifest: Record<string, unknown>;

    try {
      manifest = JSON.parse(raw);
    } catch {
      console.warn(`[SkillLoader] Invalid JSON in ${manifestPath}`);
      return null;
    }

    // Validate required fields
    const name = manifest['name'] as string;
    if (!name) {
      console.warn(`[SkillLoader] Missing "name" in ${manifestPath}`);
      return null;
    }

    // Validate tool entry points
    const tools = (manifest['tools'] as SkillToolDef[]) ?? [];
    for (const tool of tools) {
      if (tool.entryPoint) {
        const entryPath = join(resolvedDir, tool.entryPoint);
        if (!isWithinBase(entryPath, resolvedDir)) {
          console.warn(`[SkillLoader] Tool "${tool.name}" entry point escapes skill directory`);
          return null;
        }
      }
    }

    return {
      name,
      version: (manifest['version'] as string) ?? '0.0.0',
      description: (manifest['description'] as string) ?? '',
      author: manifest['author'] as string | undefined,
      tools,
      source: source ?? this.getSource(resolvedDir),
      enabled: (manifest['enabled'] as boolean) ?? true,
      path: resolvedDir,
    };
  }

  /**
   * Fallback: load skill metadata from package.json.
   */
  private loadFromPackageJson(
    dir: string,
    source: 'bundled' | 'curated' | 'forged',
  ): Skill | null {
    const packagePath = join(dir, 'package.json');
    const raw = readFileSync(packagePath, 'utf-8');

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw);
    } catch {
      return null;
    }

    const name = pkg['name'] as string;
    if (!name) return null;

    // Look for alfred.tools in package.json
    const alfredConfig = pkg['alfred'] as Record<string, unknown> | undefined;
    const tools = (alfredConfig?.['tools'] as SkillToolDef[]) ?? [];

    return {
      name,
      version: (pkg['version'] as string) ?? '0.0.0',
      description: (pkg['description'] as string) ?? '',
      author: typeof pkg['author'] === 'string' ? pkg['author'] : undefined,
      tools,
      source,
      enabled: true,
      path: dir,
    };
  }

  /**
   * Determine the source type from a directory path.
   */
  private getSource(dir: string): 'bundled' | 'curated' | 'forged' {
    if (dir.includes('bundled')) return 'bundled';
    if (dir.includes('curated')) return 'curated';
    return 'forged';
  }

  /**
   * Add a custom search directory.
   */
  addSearchDir(dir: string): void {
    const resolved = resolve(dir);
    if (!this.searchDirs.includes(resolved)) {
      this.searchDirs.push(resolved);
    }
  }

  /**
   * Get the list of search directories.
   */
  getSearchDirs(): string[] {
    return [...this.searchDirs];
  }
}
