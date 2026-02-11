/**
 * Tests for @alfred/core - Model Audit
 */
import { describe, it, expect } from 'vitest';
import { auditModel, hasHighRiskWarnings, getKnownProviders } from '@alfred/core/security';

describe('Model Audit', () => {
  // ---------------------------------------------------------------------------
  // Warns on GPT-3.5
  // ---------------------------------------------------------------------------
  describe('Warns on GPT-3.5', () => {
    it('generates warning for gpt-3.5-turbo', () => {
      const result = auditModel('openai/gpt-3.5-turbo');
      expect(result.warnings.length).toBeGreaterThan(0);
      const weakWarning = result.warnings.find((w) => w.category === 'weak-model');
      expect(weakWarning).toBeDefined();
      expect(weakWarning!.severity).toBe('medium');
    });

    it('generates warning for gpt-3.5-turbo-16k', () => {
      const result = auditModel('openai/gpt-3.5-turbo-16k');
      const weakWarning = result.warnings.find((w) => w.category === 'weak-model');
      expect(weakWarning).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Warns on small models (<7B)
  // ---------------------------------------------------------------------------
  describe('Warns on small models', () => {
    it('warns on 1.5b model', () => {
      const result = auditModel('ollama/tinyllama-1.5b');
      const smallWarning = result.warnings.find((w) => w.category === 'small-model');
      expect(smallWarning).toBeDefined();
      expect(smallWarning!.message).toContain('1.5B');
    });

    it('warns on 3b model', () => {
      const result = auditModel('ollama/phi-3b');
      const smallWarning = result.warnings.find((w) => w.category === 'small-model');
      expect(smallWarning).toBeDefined();
    });

    it('warns on 0.5b model with high severity', () => {
      const result = auditModel('ollama/qwen-0.5b');
      const smallWarning = result.warnings.find((w) => w.category === 'small-model');
      expect(smallWarning).toBeDefined();
      expect(smallWarning!.severity).toBe('high');
    });
  });

  // ---------------------------------------------------------------------------
  // No warnings on large/capable models
  // ---------------------------------------------------------------------------
  describe('No warnings on capable models', () => {
    it('no weak-model or small-model warnings for claude-sonnet-4-20250514', () => {
      const result = auditModel('anthropic/claude-sonnet-4-20250514');
      const weakWarnings = result.warnings.filter(
        (w) => w.category === 'weak-model' || w.category === 'small-model',
      );
      expect(weakWarnings.length).toBe(0);
    });

    it('no weak-model warnings for gpt-4o', () => {
      const result = auditModel('openai/gpt-4o');
      const weakWarnings = result.warnings.filter(
        (w) => w.category === 'weak-model',
      );
      expect(weakWarnings.length).toBe(0);
    });

    it('no small-model warnings for 70b models', () => {
      const result = auditModel('meta/llama-70b');
      const smallWarnings = result.warnings.filter(
        (w) => w.category === 'small-model',
      );
      expect(smallWarnings.length).toBe(0);
    });

    it('isKnownProvider is true for known providers', () => {
      const result = auditModel('anthropic/claude-sonnet-4-20250514');
      expect(result.isKnownProvider).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Warning severity levels
  // ---------------------------------------------------------------------------
  describe('Warning severity levels', () => {
    it('text-davinci has high severity', () => {
      const result = auditModel('openai/text-davinci-003');
      const deprecated = result.warnings.find((w) => w.category === 'deprecated');
      expect(deprecated).toBeDefined();
      expect(deprecated!.severity).toBe('high');
    });

    it('gpt-4o-mini has low severity', () => {
      const result = auditModel('openai/gpt-4o-mini');
      const weak = result.warnings.find((w) => w.category === 'weak-model');
      expect(weak).toBeDefined();
      expect(weak!.severity).toBe('low');
    });

    it('overall risk is high when any warning is high', () => {
      const result = auditModel('openai/text-davinci-003');
      expect(result.overallRisk).toBe('high');
    });

    it('overall risk is none when no warnings (except format)', () => {
      const result = auditModel('anthropic/claude-sonnet-4-20250514');
      // The only possible warning would be format-related, but model is in correct format
      const nonFormatWarnings = result.warnings.filter(
        (w) => w.category !== 'format',
      );
      if (nonFormatWarnings.length === 0) {
        expect(result.overallRisk).toBe('none');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // hasHighRiskWarnings helper
  // ---------------------------------------------------------------------------
  describe('hasHighRiskWarnings', () => {
    it('returns true for high-risk models', () => {
      expect(hasHighRiskWarnings('openai/text-davinci-003')).toBe(true);
    });

    it('returns false for safe models', () => {
      expect(hasHighRiskWarnings('anthropic/claude-sonnet-4-20250514')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Format warnings
  // ---------------------------------------------------------------------------
  describe('Format warnings', () => {
    it('warns when model is not in provider/model format', () => {
      const result = auditModel('just-a-model-name');
      const formatWarning = result.warnings.find((w) => w.category === 'format');
      expect(formatWarning).toBeDefined();
      expect(formatWarning!.severity).toBe('low');
    });

    it('no format warning when model has correct format', () => {
      const result = auditModel('openai/gpt-4o');
      const formatWarning = result.warnings.find((w) => w.category === 'format');
      expect(formatWarning).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown provider
  // ---------------------------------------------------------------------------
  describe('Unknown provider', () => {
    it('warns for unknown provider', () => {
      const result = auditModel('somecompany/some-model');
      const unknownWarning = result.warnings.find(
        (w) => w.category === 'unknown-provider',
      );
      expect(unknownWarning).toBeDefined();
      expect(unknownWarning!.severity).toBe('medium');
    });
  });

  // ---------------------------------------------------------------------------
  // getKnownProviders
  // ---------------------------------------------------------------------------
  describe('getKnownProviders', () => {
    it('returns a sorted array of known providers', () => {
      const providers = getKnownProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('ollama');
      // Verify it's sorted
      const sorted = [...providers].sort();
      expect(providers).toEqual(sorted);
    });
  });

  // ---------------------------------------------------------------------------
  // Parameter count extraction
  // ---------------------------------------------------------------------------
  describe('Parameter count extraction', () => {
    it('extracts parameter count from model name', () => {
      const result = auditModel('meta/llama-3.1-8b');
      expect(result.parametersBillions).toBe(8);
    });

    it('returns null when no parameter count in name', () => {
      const result = auditModel('openai/gpt-4o');
      expect(result.parametersBillions).toBeNull();
    });

    it('extracts fractional parameter counts', () => {
      const result = auditModel('ollama/phi-3.5b');
      expect(result.parametersBillions).toBe(3.5);
    });
  });
});
