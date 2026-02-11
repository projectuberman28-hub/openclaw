/**
 * @alfred/skills - Skill Registry
 *
 * Central registry of all loaded skills. Manages registration,
 * lookup, enable/disable state.
 */

import type { Skill } from './loader.js';

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /**
   * Register a skill in the registry.
   * Replaces any existing skill with the same name.
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Register multiple skills at once.
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * Get a skill by name.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Check if a skill exists in the registry.
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * List all skills.
   */
  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * List only enabled skills.
   */
  listEnabled(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.enabled);
  }

  /**
   * List only disabled skills.
   */
  listDisabled(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => !s.enabled);
  }

  /**
   * Enable a skill by name.
   * Returns true if the skill was found and enabled.
   */
  enable(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = true;
    return true;
  }

  /**
   * Disable a skill by name.
   * Returns true if the skill was found and disabled.
   */
  disable(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = false;
    return true;
  }

  /**
   * Remove a skill from the registry.
   */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Get the total count of registered skills.
   */
  count(): number {
    return this.skills.size;
  }

  /**
   * Get skills by source type.
   */
  getBySource(source: 'bundled' | 'curated' | 'forged'): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.source === source);
  }

  /**
   * Clear all skills from the registry.
   */
  clear(): void {
    this.skills.clear();
  }
}
