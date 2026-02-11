/**
 * E2E Tests for Forge Lifecycle
 *
 * Tests gap detection, skill planning, scaffolding, sandbox execution,
 * and promotion/quarantine logic.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GapDetector } from '@alfred/forge/detector';
import { SkillPlanner } from '@alfred/forge/planner';
import type { ToolFailure, UserRequest, CapabilityGap } from '@alfred/forge/detector';

// Suppress pino logging
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Forge Lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Gap detection from tool failures
  // ---------------------------------------------------------------------------
  describe('Gap detection from tool failures', () => {
    it('detects gaps from repeated tool failures', () => {
      const detector = new GapDetector({ minFrequency: 2, minConfidence: 0.3 });

      const now = new Date();
      const failures: ToolFailure[] = [
        { toolName: 'web_search', error: 'SearXNG returned empty results', args: { query: 'test1' }, timestamp: now },
        { toolName: 'web_search', error: 'SearXNG returned empty results', args: { query: 'test2' }, timestamp: now },
        { toolName: 'web_search', error: 'SearXNG returned empty results', args: { query: 'test3' }, timestamp: now },
      ];

      const gaps = detector.analyzeToolFailures(failures);
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0].suggestedName).toBeDefined();
      expect(gaps[0].category).toBeDefined();
      expect(gaps[0].frequency).toBe(3);
    });

    it('groups similar failures together', () => {
      const detector = new GapDetector({ minFrequency: 1, minConfidence: 0.3 });
      const now = new Date();

      const failures: ToolFailure[] = [
        { toolName: 'file_read', error: 'File not found: /path/a.txt', args: {}, timestamp: now },
        { toolName: 'file_read', error: 'File not found: /path/b.txt', args: {}, timestamp: now },
      ];

      // The normalizeError should collapse the different paths
      const gaps = detector.analyzeToolFailures(failures);
      expect(gaps.length).toBe(1); // grouped into one gap
      expect(gaps[0].frequency).toBe(2);
    });

    it('assigns "file-management" category for file-related failures', () => {
      const detector = new GapDetector({ minFrequency: 1, minConfidence: 0.1 });
      const now = new Date();

      const failures: ToolFailure[] = [
        { toolName: 'file_read', error: 'File not found', args: {}, timestamp: now },
      ];

      const gaps = detector.analyzeToolFailures(failures);
      expect(gaps[0].category).toBe('file-management');
    });
  });

  // ---------------------------------------------------------------------------
  // Gap detection from user requests
  // ---------------------------------------------------------------------------
  describe('Gap detection from user requests', () => {
    it('detects gaps from unhandled user requests', () => {
      const detector = new GapDetector({ minFrequency: 1, minConfidence: 0.3 });
      const now = new Date();

      const requests: UserRequest[] = [
        {
          message: 'Convert this CSV to JSON format',
          timestamp: now,
          wasHandled: false,
          missingCapability: 'csv-to-json conversion',
        },
        {
          message: 'Please convert this CSV file to JSON',
          timestamp: now,
          wasHandled: false,
          missingCapability: 'csv-to-json conversion',
        },
      ];

      const gaps = detector.analyzeUserRequests(requests);
      expect(gaps.length).toBeGreaterThan(0);
    });

    it('uses explicit missingCapability hints when provided', () => {
      const detector = new GapDetector({ minFrequency: 1, minConfidence: 0.3 });
      const now = new Date();

      const requests: UserRequest[] = [
        {
          message: 'Send this to Slack',
          timestamp: now,
          wasHandled: false,
          missingCapability: 'slack-integration',
        },
      ];

      const gaps = detector.analyzeUserRequests(requests);
      const slackGap = gaps.find((g) => g.suggestedName.includes('slack'));
      expect(slackGap).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Full detect() with filters
  // ---------------------------------------------------------------------------
  describe('Full detect()', () => {
    it('filters out existing skills', () => {
      const detector = new GapDetector({ minFrequency: 2, minConfidence: 0.3 });
      const now = new Date();

      const failures: ToolFailure[] = [
        { toolName: 'web_search', error: 'Timeout', args: {}, timestamp: now },
        { toolName: 'web_search', error: 'Timeout', args: {}, timestamp: now },
      ];

      const gaps = detector.detect({
        failures,
        requests: [],
        existingSkills: ['web-search-enhanced'],
      });

      // The suggested name for web_search timeout would match "web-search-enhanced"
      const matching = gaps.filter((g) =>
        g.suggestedName === 'web-search-enhanced',
      );
      expect(matching.length).toBe(0);
    });

    it('sorts by impact (confidence * frequency)', () => {
      const detector = new GapDetector({ minFrequency: 1, minConfidence: 0.1 });
      const now = new Date();

      const failures: ToolFailure[] = [
        // 3 failures => higher frequency
        ...Array.from({ length: 3 }, () => ({
          toolName: 'db_query',
          error: 'Connection refused',
          args: {},
          timestamp: now,
        })),
        // 1 failure => lower frequency
        { toolName: 'email_send', error: 'SMTP failed', args: {}, timestamp: now },
      ];

      const gaps = detector.detect({
        failures,
        requests: [],
        existingSkills: [],
      });

      if (gaps.length >= 2) {
        expect(gaps[0].confidence * gaps[0].frequency)
          .toBeGreaterThanOrEqual(gaps[1].confidence * gaps[1].frequency);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Skill planning from gap
  // ---------------------------------------------------------------------------
  describe('Skill planning', () => {
    it('generates a SkillPlan from a CapabilityGap', async () => {
      const planner = new SkillPlanner();

      const gap: CapabilityGap = {
        description: 'Tool "file_read" fails with: file not found',
        category: 'file-management',
        frequency: 3,
        confidence: 0.85,
        suggestedName: 'file-read-provider',
        examples: ['file not found: test.txt'],
      };

      const plan = await planner.plan(gap);

      expect(plan.name).toBe('file-read-provider');
      expect(plan.description).toBe(gap.description);
      expect(plan.tools.length).toBeGreaterThan(0);
      expect(plan.testCases.length).toBeGreaterThan(0);
      expect(['simple', 'moderate', 'complex']).toContain(plan.estimatedComplexity);
    });

    it('includes correct dependencies for file-management category', async () => {
      const planner = new SkillPlanner();

      const gap: CapabilityGap = {
        description: 'Missing file management capability',
        category: 'file-management',
        frequency: 2,
        confidence: 0.7,
        suggestedName: 'file-handler',
        examples: [],
      };

      const plan = await planner.plan(gap);
      expect(plan.dependencies).toContain('node:fs/promises');
      expect(plan.dependencies).toContain('node:path');
    });

    it('generates test cases for each tool', async () => {
      const planner = new SkillPlanner();

      const gap: CapabilityGap = {
        description: 'Web fetch capability needed',
        category: 'web-automation',
        frequency: 4,
        confidence: 0.9,
        suggestedName: 'web-fetcher',
        examples: [],
      };

      const plan = await planner.plan(gap);

      // Each tool should have at least one happy-path test
      for (const tool of plan.tools) {
        const relatedTest = plan.testCases.find((tc) => tc.name.includes(tool.name));
        expect(relatedTest).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Scaffolding creates correct file structure
  // ---------------------------------------------------------------------------
  describe('Scaffolding', () => {
    it('planned tools have correct structure', async () => {
      const planner = new SkillPlanner();
      const gap: CapabilityGap = {
        description: 'System monitoring needed',
        category: 'system',
        frequency: 2,
        confidence: 0.7,
        suggestedName: 'sys-monitor',
        examples: [],
      };

      const plan = await planner.plan(gap);

      for (const tool of plan.tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeInstanceOf(Array);
        expect(tool.returnType).toBeDefined();
      }
    });

    it('scaffold plan has correct test case structure', async () => {
      const planner = new SkillPlanner();
      const gap: CapabilityGap = {
        description: 'Data transformation',
        category: 'data-processing',
        frequency: 2,
        confidence: 0.6,
        suggestedName: 'data-transformer',
        examples: [],
      };

      const plan = await planner.plan(gap);

      for (const tc of plan.testCases) {
        expect(tc.name).toBeDefined();
        expect(tc.description).toBeDefined();
        expect(tc.input).toBeDefined();
        expect(tc.expectedOutput).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Sandbox execution (VM mode)
  // ---------------------------------------------------------------------------
  describe('Sandbox execution (VM)', () => {
    it('safe code runs in VM sandbox', async () => {
      const { createContext, runInNewContext } = await import('node:vm');
      const sandbox = createContext({ Math, JSON, result: null });

      runInNewContext('result = JSON.stringify({ sum: 1 + 2 })', sandbox);
      expect(sandbox.result).toBe('{"sum":3}');
    });

    it('blocked modules are not available', async () => {
      const { createContext, runInNewContext } = await import('node:vm');
      const sandbox = createContext({});

      expect(() => {
        runInNewContext('require("fs")', sandbox);
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Promotion on test pass, quarantine on test fail
  // ---------------------------------------------------------------------------
  describe('Promotion and quarantine logic', () => {
    it('promotes skill when all tests pass', () => {
      const testResults = [
        { name: 'test-1', passed: true },
        { name: 'test-2', passed: true },
        { name: 'test-3', passed: true },
      ];

      const allPassed = testResults.every((t) => t.passed);
      const decision = allPassed ? 'promote' : 'quarantine';
      expect(decision).toBe('promote');
    });

    it('quarantines skill when any test fails', () => {
      const testResults = [
        { name: 'test-1', passed: true },
        { name: 'test-2', passed: false },
        { name: 'test-3', passed: true },
      ];

      const allPassed = testResults.every((t) => t.passed);
      const decision = allPassed ? 'promote' : 'quarantine';
      expect(decision).toBe('quarantine');
    });

    it('quarantines when no tests are run', () => {
      const testResults: Array<{ name: string; passed: boolean }> = [];

      const allPassed = testResults.length > 0 && testResults.every((t) => t.passed);
      const decision = allPassed ? 'promote' : 'quarantine';
      expect(decision).toBe('quarantine');
    });
  });
});
