/**
 * @alfred/core - Configuration validator
 *
 * Validates an AlfredConfig object using TypeBox, applies business rules
 * (clamp maxTokens, validate model format, check paths).
 */

import { Value } from '@sinclair/typebox/value';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AlfredConfigSchema, type AlfredConfig } from './schema.js';
import { resolveAlfredHome } from './paths.js';

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  config: AlfredConfig;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

/** Model identifier format regex: provider/model-name */
const MODEL_FORMAT_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;

/**
 * Validate and normalise an AlfredConfig object.
 *
 * 1. TypeBox schema check
 * 2. Clamp maxTokens to contextWindow
 * 3. Validate model format (provider/model)
 * 4. Validate referenced paths exist (optional, soft warnings)
 */
export function validateConfig(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // ----- TypeBox schema validation -----
  const schemaErrors = [...Value.Errors(AlfredConfigSchema, raw)];
  for (const err of schemaErrors) {
    errors.push({
      path: err.path,
      message: err.message,
    });
  }

  // Even if there are schema errors, try to decode with defaults for partial results
  let config: AlfredConfig;
  try {
    config = Value.Decode(AlfredConfigSchema, Value.Default(AlfredConfigSchema, Value.Clone(raw)));
  } catch {
    // If decode fails completely, cast what we have
    config = raw as AlfredConfig;
  }

  // ----- Business rules -----
  if (config.agents && Array.isArray(config.agents)) {
    for (let i = 0; i < config.agents.length; i++) {
      const agent = config.agents[i]!;
      const prefix = `/agents/${i}`;

      // Validate model format
      if (agent.model && !MODEL_FORMAT_RE.test(agent.model)) {
        errors.push({
          path: `${prefix}/model`,
          message: `Model "${agent.model}" must be in provider/model format (e.g. anthropic/claude-sonnet-4-20250514)`,
        });
      }

      // Clamp maxTokens to contextWindow
      const contextWindow = agent.contextWindow ?? 128000;
      if (agent.maxTokens !== undefined && agent.maxTokens > contextWindow) {
        warnings.push({
          path: `${prefix}/maxTokens`,
          message: `maxTokens (${agent.maxTokens}) exceeds contextWindow (${contextWindow}), clamping to ${contextWindow}`,
        });
        agent.maxTokens = contextWindow;
      }

      // Validate fallback model formats
      if (agent.fallbacks) {
        for (let j = 0; j < agent.fallbacks.length; j++) {
          const fb = agent.fallbacks[j]!;
          if (!MODEL_FORMAT_RE.test(fb)) {
            errors.push({
              path: `${prefix}/fallbacks/${j}`,
              message: `Fallback model "${fb}" must be in provider/model format`,
            });
          }
        }
      }

      // Check for duplicate agent IDs
      const duplicates = config.agents.filter((a) => a.id === agent.id);
      if (duplicates.length > 1) {
        warnings.push({
          path: `${prefix}/id`,
          message: `Duplicate agent id "${agent.id}" found`,
        });
      }
    }
  }

  // ----- Path validation (soft warnings) -----
  const alfredHome = resolveAlfredHome();

  if (config.memory?.path) {
    const memPath = resolve(alfredHome, config.memory.path);
    if (!existsSync(memPath)) {
      warnings.push({
        path: '/memory/path',
        message: `Memory path "${memPath}" does not exist (will be created on first use)`,
      });
    }
  }

  if (config.forge?.skillsDir) {
    const skillsPath = resolve(alfredHome, config.forge.skillsDir);
    if (!existsSync(skillsPath)) {
      warnings.push({
        path: '/forge/skillsDir',
        message: `Skills directory "${skillsPath}" does not exist`,
      });
    }
  }

  if (config.playbook?.dir) {
    const pbPath = resolve(alfredHome, config.playbook.dir);
    if (!existsSync(pbPath)) {
      warnings.push({
        path: '/playbook/dir',
        message: `Playbook directory "${pbPath}" does not exist`,
      });
    }
  }

  if (config.privacy?.auditPath) {
    const auditPath = resolve(alfredHome, config.privacy.auditPath);
    if (!existsSync(auditPath)) {
      warnings.push({
        path: '/privacy/auditPath',
        message: `Audit path "${auditPath}" does not exist (will be created on first use)`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config,
  };
}

/**
 * Validate a single model identifier string.
 */
export function isValidModelFormat(model: string): boolean {
  return MODEL_FORMAT_RE.test(model);
}

/**
 * Clamp maxTokens to the given contextWindow.
 */
export function clampMaxTokens(maxTokens: number, contextWindow: number): number {
  return Math.min(maxTokens, contextWindow);
}
