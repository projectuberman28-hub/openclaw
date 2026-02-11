/**
 * @alfred/forge - Skill Planner
 *
 * Takes a CapabilityGap and produces a complete SkillPlan:
 * which tools the skill needs, their parameters, dependencies,
 * test cases, and an estimated complexity level.
 */

import pino from 'pino';
import type { CapabilityGap } from './detector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParamSpec {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ParamSpec[];
  returnType: string;
}

export interface TestCase {
  name: string;
  input: unknown;
  expectedOutput: unknown;
  description: string;
}

export interface SkillPlan {
  name: string;
  description: string;
  tools: ToolSpec[];
  dependencies: string[];
  testCases: TestCase[];
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export interface PlannerConfig {
  /** Maximum tools per skill (default: 8) */
  maxToolsPerSkill: number;
  /** Maximum test cases generated (default: 10) */
  maxTestCases: number;
  /** Whether to include negative / edge-case tests (default: true) */
  includeEdgeCaseTests: boolean;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  maxToolsPerSkill: 8,
  maxTestCases: 10,
  includeEdgeCaseTests: true,
};

// ---------------------------------------------------------------------------
// Category-based dependency hints
// ---------------------------------------------------------------------------

const CATEGORY_DEPENDENCIES: Record<string, string[]> = {
  'file-management': ['node:fs/promises', 'node:path'],
  'web-automation': ['node:https', 'node:url'],
  'data-processing': ['node:stream', 'node:buffer'],
  'communication': ['node:https'],
  'system': ['node:child_process', 'node:os'],
  'media': ['node:buffer', 'node:stream'],
  'database': [],
  'security': ['node:crypto'],
  'development': ['node:child_process', 'node:fs/promises'],
  'ai-ml': ['node:buffer'],
  'general': [],
};

/**
 * Maps category keywords to typical tool patterns.
 * Each entry is [toolNameSuffix, description, params, returnType].
 */
const CATEGORY_TOOL_PATTERNS: Record<
  string,
  Array<{ suffix: string; desc: string; params: ParamSpec[]; returnType: string }>
> = {
  'file-management': [
    {
      suffix: 'read',
      desc: 'Read content from the target resource',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Path to the resource' },
        { name: 'encoding', type: 'string', required: false, description: 'Text encoding (default utf-8)' },
      ],
      returnType: 'string',
    },
    {
      suffix: 'write',
      desc: 'Write content to the target resource',
      params: [
        { name: 'path', type: 'string', required: true, description: 'Path to the resource' },
        { name: 'content', type: 'string', required: true, description: 'Content to write' },
      ],
      returnType: '{ success: boolean; bytesWritten: number }',
    },
    {
      suffix: 'list',
      desc: 'List available resources',
      params: [
        { name: 'directory', type: 'string', required: true, description: 'Directory to list' },
        { name: 'pattern', type: 'string', required: false, description: 'Glob pattern filter' },
      ],
      returnType: 'string[]',
    },
  ],
  'web-automation': [
    {
      suffix: 'fetch',
      desc: 'Fetch data from a remote endpoint',
      params: [
        { name: 'url', type: 'string', required: true, description: 'URL to fetch' },
        { name: 'method', type: 'string', required: false, description: 'HTTP method (default GET)' },
        { name: 'headers', type: 'Record<string, string>', required: false, description: 'Request headers' },
      ],
      returnType: '{ status: number; body: string; headers: Record<string, string> }',
    },
    {
      suffix: 'parse',
      desc: 'Parse and extract structured data from fetched content',
      params: [
        { name: 'html', type: 'string', required: true, description: 'Raw HTML content' },
        { name: 'selector', type: 'string', required: false, description: 'CSS selector to target' },
      ],
      returnType: '{ items: unknown[] }',
    },
  ],
  'data-processing': [
    {
      suffix: 'transform',
      desc: 'Transform data from one format to another',
      params: [
        { name: 'input', type: 'unknown', required: true, description: 'Input data' },
        { name: 'format', type: 'string', required: true, description: 'Target format' },
      ],
      returnType: 'unknown',
    },
    {
      suffix: 'validate',
      desc: 'Validate data against expected schema',
      params: [
        { name: 'data', type: 'unknown', required: true, description: 'Data to validate' },
        { name: 'schema', type: 'object', required: true, description: 'Validation schema' },
      ],
      returnType: '{ valid: boolean; errors: string[] }',
    },
  ],
  'communication': [
    {
      suffix: 'send',
      desc: 'Send a message through the communication channel',
      params: [
        { name: 'to', type: 'string', required: true, description: 'Recipient identifier' },
        { name: 'message', type: 'string', required: true, description: 'Message content' },
        { name: 'subject', type: 'string', required: false, description: 'Subject line' },
      ],
      returnType: '{ sent: boolean; messageId: string }',
    },
  ],
  'system': [
    {
      suffix: 'execute',
      desc: 'Execute a system operation',
      params: [
        { name: 'command', type: 'string', required: true, description: 'Command to execute' },
        { name: 'args', type: 'string[]', required: false, description: 'Command arguments' },
        { name: 'timeout', type: 'number', required: false, description: 'Timeout in ms' },
      ],
      returnType: '{ stdout: string; stderr: string; exitCode: number }',
    },
    {
      suffix: 'status',
      desc: 'Check status of system resource',
      params: [
        { name: 'resource', type: 'string', required: true, description: 'Resource identifier' },
      ],
      returnType: '{ running: boolean; pid?: number; uptime?: number }',
    },
  ],
  'security': [
    {
      suffix: 'encrypt',
      desc: 'Encrypt the given data',
      params: [
        { name: 'data', type: 'string', required: true, description: 'Data to encrypt' },
        { name: 'algorithm', type: 'string', required: false, description: 'Encryption algorithm' },
      ],
      returnType: '{ encrypted: string; iv: string }',
    },
  ],
  'development': [
    {
      suffix: 'run',
      desc: 'Run a development command or script',
      params: [
        { name: 'script', type: 'string', required: true, description: 'Script or command to run' },
        { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
      ],
      returnType: '{ stdout: string; stderr: string; exitCode: number }',
    },
  ],
  'general': [
    {
      suffix: 'process',
      desc: 'Process the given input',
      params: [
        { name: 'input', type: 'unknown', required: true, description: 'Input data to process' },
        { name: 'options', type: 'object', required: false, description: 'Processing options' },
      ],
      returnType: 'unknown',
    },
  ],
};

// Provide fallback for categories without explicit patterns
for (const cat of Object.keys(CATEGORY_DEPENDENCIES)) {
  if (!CATEGORY_TOOL_PATTERNS[cat]) {
    CATEGORY_TOOL_PATTERNS[cat] = CATEGORY_TOOL_PATTERNS['general'];
  }
}

// ---------------------------------------------------------------------------
// SkillPlanner
// ---------------------------------------------------------------------------

export class SkillPlanner {
  private readonly config: PlannerConfig;
  private readonly logger: pino.Logger;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = { ...DEFAULT_PLANNER_CONFIG, ...config };
    this.logger = pino({ name: 'forge:planner', level: 'info' });
  }

  /**
   * Generate a complete SkillPlan from a detected capability gap.
   */
  async plan(gap: CapabilityGap): Promise<SkillPlan> {
    this.logger.info({ gap: gap.suggestedName, category: gap.category }, 'Planning skill');

    const tools = this.generateTools(gap);
    const dependencies = this.resolveDependencies(gap, tools);
    const testCases = this.generateTestCases(gap, tools);
    const estimatedComplexity = this.estimateComplexity(tools, dependencies);

    const plan: SkillPlan = {
      name: gap.suggestedName,
      description: gap.description,
      tools,
      dependencies,
      testCases,
      estimatedComplexity,
    };

    this.logger.info(
      { name: plan.name, tools: tools.length, tests: testCases.length, complexity: estimatedComplexity },
      'Skill plan generated',
    );

    return plan;
  }

  // -----------------------------------------------------------------------
  // Tool generation
  // -----------------------------------------------------------------------

  private generateTools(gap: CapabilityGap): ToolSpec[] {
    const patterns = CATEGORY_TOOL_PATTERNS[gap.category] ?? CATEGORY_TOOL_PATTERNS['general'];

    // Pick patterns relevant to the gap; limit by config
    const selected = patterns.slice(0, this.config.maxToolsPerSkill);

    return selected.map((pattern) => {
      const toolName = `${gap.suggestedName}-${pattern.suffix}`;

      // Augment parameters based on gap examples (look for hinted params)
      const extraParams = this.extractHintedParams(gap);
      const allParams = [...pattern.params];

      for (const ep of extraParams) {
        if (!allParams.some((p) => p.name === ep.name)) {
          allParams.push(ep);
        }
      }

      return {
        name: toolName,
        description: `${pattern.desc} for ${gap.suggestedName}`,
        parameters: allParams,
        returnType: pattern.returnType,
      };
    });
  }

  /**
   * Look through gap examples for hints about additional parameters.
   * e.g., if examples mention "format" or "timeout", add those as params.
   */
  private extractHintedParams(gap: CapabilityGap): ParamSpec[] {
    const hints: ParamSpec[] = [];
    const combined = gap.examples.join(' ').toLowerCase();

    const hintMap: Record<string, { type: string; desc: string }> = {
      timeout: { type: 'number', desc: 'Operation timeout in milliseconds' },
      format: { type: 'string', desc: 'Output format' },
      recursive: { type: 'boolean', desc: 'Whether to operate recursively' },
      verbose: { type: 'boolean', desc: 'Enable verbose output' },
      limit: { type: 'number', desc: 'Maximum number of results' },
      filter: { type: 'string', desc: 'Filter expression' },
      retry: { type: 'number', desc: 'Number of retries on failure' },
    };

    for (const [keyword, spec] of Object.entries(hintMap)) {
      if (combined.includes(keyword)) {
        hints.push({
          name: keyword,
          type: spec.type,
          required: false,
          description: spec.desc,
        });
      }
    }

    return hints;
  }

  // -----------------------------------------------------------------------
  // Dependencies
  // -----------------------------------------------------------------------

  private resolveDependencies(gap: CapabilityGap, tools: ToolSpec[]): string[] {
    const deps = new Set<string>();

    // Add category-based dependencies
    const catDeps = CATEGORY_DEPENDENCIES[gap.category] ?? [];
    for (const d of catDeps) deps.add(d);

    // Check tool parameters for dependency hints
    for (const tool of tools) {
      for (const param of tool.parameters) {
        if (param.name === 'url' || param.type.includes('URL')) {
          deps.add('node:url');
          deps.add('node:https');
        }
        if (param.name === 'path' || param.type.includes('path')) {
          deps.add('node:path');
          deps.add('node:fs/promises');
        }
      }
    }

    return [...deps].sort();
  }

  // -----------------------------------------------------------------------
  // Test-case generation
  // -----------------------------------------------------------------------

  private generateTestCases(gap: CapabilityGap, tools: ToolSpec[]): TestCase[] {
    const cases: TestCase[] = [];

    for (const tool of tools) {
      // Happy-path test
      cases.push(this.happyPathTest(tool));

      // Missing required param test
      const requiredParams = tool.parameters.filter((p) => p.required);
      if (requiredParams.length > 0) {
        cases.push(this.missingParamTest(tool, requiredParams[0]));
      }

      // Edge-case tests
      if (this.config.includeEdgeCaseTests) {
        cases.push(this.edgeCaseTest(tool));
      }

      if (cases.length >= this.config.maxTestCases) break;
    }

    return cases.slice(0, this.config.maxTestCases);
  }

  private happyPathTest(tool: ToolSpec): TestCase {
    const input: Record<string, unknown> = {};
    for (const param of tool.parameters) {
      if (param.required) {
        input[param.name] = this.sampleValue(param);
      }
    }

    return {
      name: `${tool.name} - happy path`,
      input,
      expectedOutput: { success: true },
      description: `Verify ${tool.name} works with valid required parameters`,
    };
  }

  private missingParamTest(tool: ToolSpec, missingParam: ParamSpec): TestCase {
    const input: Record<string, unknown> = {};
    for (const param of tool.parameters) {
      if (param.required && param.name !== missingParam.name) {
        input[param.name] = this.sampleValue(param);
      }
    }

    return {
      name: `${tool.name} - missing ${missingParam.name}`,
      input,
      expectedOutput: { error: `Missing required parameter: ${missingParam.name}` },
      description: `Verify ${tool.name} rejects call without required param "${missingParam.name}"`,
    };
  }

  private edgeCaseTest(tool: ToolSpec): TestCase {
    const input: Record<string, unknown> = {};
    for (const param of tool.parameters) {
      if (param.required) {
        input[param.name] = this.edgeValue(param);
      }
    }

    return {
      name: `${tool.name} - edge case`,
      input,
      expectedOutput: { error: 'edge-case input should be handled gracefully' },
      description: `Verify ${tool.name} handles edge-case inputs gracefully`,
    };
  }

  /** Generate a plausible sample value for a parameter. */
  private sampleValue(param: ParamSpec): unknown {
    switch (param.type.toLowerCase()) {
      case 'string':
        if (param.name === 'path') return '/tmp/test-file.txt';
        if (param.name === 'url') return 'https://example.com/api';
        if (param.name === 'encoding') return 'utf-8';
        if (param.name === 'method') return 'GET';
        if (param.name === 'format') return 'json';
        return 'test-value';
      case 'number':
        if (param.name === 'timeout') return 5000;
        if (param.name === 'limit') return 10;
        if (param.name === 'retry') return 3;
        return 1;
      case 'boolean':
        return true;
      case 'string[]':
        return ['arg1', 'arg2'];
      case 'object':
        return {};
      default:
        if (param.type.startsWith('Record')) return {};
        return 'test-value';
    }
  }

  /** Generate an edge-case value for testing boundary conditions. */
  private edgeValue(param: ParamSpec): unknown {
    switch (param.type.toLowerCase()) {
      case 'string':
        return ''; // Empty string
      case 'number':
        return -1; // Negative number
      case 'boolean':
        return false;
      case 'string[]':
        return []; // Empty array
      case 'object':
        return null; // Null object
      default:
        return '';
    }
  }

  // -----------------------------------------------------------------------
  // Complexity estimation
  // -----------------------------------------------------------------------

  private estimateComplexity(
    tools: ToolSpec[],
    dependencies: string[],
  ): 'simple' | 'moderate' | 'complex' {
    let score = 0;

    // Tool count contributes
    score += tools.length;

    // Dependency count contributes
    score += dependencies.length * 0.5;

    // Total parameters across all tools
    const totalParams = tools.reduce((sum, t) => sum + t.parameters.length, 0);
    score += totalParams * 0.3;

    // Network-related tools are more complex
    if (dependencies.some((d) => d.includes('https') || d.includes('http'))) {
      score += 2;
    }

    // System/child_process is complex
    if (dependencies.some((d) => d.includes('child_process'))) {
      score += 2;
    }

    if (score <= 4) return 'simple';
    if (score <= 8) return 'moderate';
    return 'complex';
  }
}
