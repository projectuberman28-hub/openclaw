/**
 * @alfred/tools - ForgeTool
 *
 * Trigger skill building (the "Forge"):
 *   - build()  – create a new skill from a description
 *   - list()   – list all forged skills
 *   - test()   – run tests on a forged skill
 *
 * Skills are self-contained, sandboxed modules that extend Alfred's capabilities.
 */

import { nanoid } from 'nanoid';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:forge' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForgeBuildArgs {
  /** Natural language description of the skill to build. */
  description: string;
  /** Name for the skill. */
  name: string;
}

export interface ForgedSkill {
  id: string;
  name: string;
  description: string;
  status: 'building' | 'ready' | 'failed' | 'testing';
  createdAt: number;
  version: string;
  entrypoint?: string;
}

export interface TestResult {
  skillId: string;
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  errors: string[];
  duration: number;
}

/**
 * Backend interface for the Forge.
 */
export interface ForgeBackend {
  build(name: string, description: string): Promise<ForgedSkill>;
  list(): Promise<ForgedSkill[]>;
  test(skillId: string): Promise<TestResult>;
}

// ---------------------------------------------------------------------------
// ForgeTool
// ---------------------------------------------------------------------------

export class ForgeTool {
  private executor: SafeExecutor;
  private backend: ForgeBackend | null;
  /** In-memory registry for when no backend is configured. */
  private skills: Map<string, ForgedSkill> = new Map();

  constructor(executor: SafeExecutor, backend?: ForgeBackend) {
    this.executor = executor;
    this.backend = backend ?? null;
  }

  static definition = {
    name: 'forge',
    description:
      'Build, list, or test AI-generated skills. ' +
      'The Forge creates self-contained modules from natural language descriptions.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['build', 'list', 'test'],
          description: 'Forge action',
        },
        name: { type: 'string', description: 'Skill name (for build)' },
        description: { type: 'string', description: 'Skill description (for build)' },
        skillId: { type: 'string', description: 'Skill ID (for test)' },
      },
      required: ['action'],
    },
  };

  /**
   * Set the forge backend.
   */
  setBackend(backend: ForgeBackend): void {
    this.backend = backend;
  }

  // -----------------------------------------------------------------------
  // Build
  // -----------------------------------------------------------------------

  async build(args: ForgeBuildArgs, execOpts?: ExecuteOptions): Promise<ForgedSkill> {
    if (!args.name || typeof args.name !== 'string') {
      throw new Error('ForgeTool.build: "name" is required');
    }
    if (!args.description || typeof args.description !== 'string') {
      throw new Error('ForgeTool.build: "description" is required');
    }

    if (this.backend) {
      const result = await this.executor.execute(
        'forge.build',
        async () => this.backend!.build(args.name, args.description),
        { timeout: 120_000, ...execOpts },
      );

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result as ForgedSkill;
    }

    // In-memory fallback
    const result = await this.executor.execute(
      'forge.build',
      async () => {
        const skill: ForgedSkill = {
          id: nanoid(),
          name: args.name,
          description: args.description,
          status: 'building',
          createdAt: Date.now(),
          version: '0.1.0',
        };

        this.skills.set(skill.id, skill);

        logger.info({ skillId: skill.id, name: args.name }, 'Skill build initiated');

        // Simulate build completion
        setTimeout(() => {
          const s = this.skills.get(skill.id);
          if (s) {
            s.status = 'ready';
            s.entrypoint = `skills/${args.name}/index.js`;
          }
        }, 1000);

        return skill;
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as ForgedSkill;
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  async list(execOpts?: ExecuteOptions): Promise<ForgedSkill[]> {
    if (this.backend) {
      const result = await this.executor.execute(
        'forge.list',
        async () => this.backend!.list(),
        { timeout: 10_000, ...execOpts },
      );

      if (result.error) {
        return [];
      }

      return result.result as ForgedSkill[];
    }

    return Array.from(this.skills.values());
  }

  // -----------------------------------------------------------------------
  // Test
  // -----------------------------------------------------------------------

  async test(args: { skillId: string }, execOpts?: ExecuteOptions): Promise<TestResult> {
    if (!args.skillId || typeof args.skillId !== 'string') {
      throw new Error('ForgeTool.test: "skillId" is required');
    }

    if (this.backend) {
      const result = await this.executor.execute(
        'forge.test',
        async () => this.backend!.test(args.skillId),
        { timeout: 60_000, ...execOpts },
      );

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result as TestResult;
    }

    // In-memory fallback
    const skill = this.skills.get(args.skillId);
    if (!skill) {
      throw new Error(`ForgeTool.test: skill "${args.skillId}" not found`);
    }

    return {
      skillId: args.skillId,
      passed: skill.status === 'ready',
      totalTests: 1,
      passedTests: skill.status === 'ready' ? 1 : 0,
      failedTests: skill.status === 'ready' ? 0 : 1,
      errors: skill.status !== 'ready' ? [`Skill is in "${skill.status}" state`] : [],
      duration: 0,
    };
  }
}
