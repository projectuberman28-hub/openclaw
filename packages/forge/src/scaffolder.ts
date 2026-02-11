/**
 * @alfred/forge - Skill Scaffolder
 *
 * Takes a SkillPlan and generates the directory structure and files
 * for a new forged skill under skills/forged/{name}/.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pino from 'pino';
import { nanoid } from 'nanoid';

import type { SkillPlan, ToolSpec, TestCase } from './planner.js';
import {
  fillTemplate,
  getSkillMdTemplate,
  getIndexTemplate,
  getTestTemplate,
  getFallbacksTemplate,
  getPackageJsonTemplate,
} from './templates/skill-template.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  files: string[];
  directory: string;
  skillId: string;
}

// ---------------------------------------------------------------------------
// SkillScaffolder
// ---------------------------------------------------------------------------

export class SkillScaffolder {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({ name: 'forge:scaffolder', level: 'info' });
  }

  /**
   * Create the full directory structure and files for a forged skill.
   *
   * @param plan      The skill plan produced by SkillPlanner.
   * @param outputDir Base directory (e.g. `skills/forged`).
   * @returns         Paths of all created files and the skill directory.
   */
  async scaffold(plan: SkillPlan, outputDir: string): Promise<ScaffoldResult> {
    const skillId = `forge-${nanoid(12)}`;
    const skillDir = join(outputDir, plan.name);
    const createdFiles: string[] = [];

    this.logger.info({ skillId, directory: skillDir }, 'Scaffolding skill');

    // Create the skill directory
    await mkdir(skillDir, { recursive: true });

    // Common template variables
    const vars: Record<string, string> = {
      skillName: plan.name,
      description: plan.description,
      category: plan.tools.length > 0 ? 'auto-detected' : 'general',
      complexity: plan.estimatedComplexity,
      createdAt: new Date().toISOString(),
      gapId: skillId,
      confidence: '0',
      frequency: '0',
      dependencies: plan.dependencies.length > 0
        ? plan.dependencies.map((d) => `- \`${d}\``).join('\n')
        : '_None_',
      packageName: `@alfred-skill/${plan.name}`,
    };

    // 1. SKILL.md
    const skillMd = this.buildSkillMd(plan, vars);
    const skillMdPath = join(skillDir, 'SKILL.md');
    await writeFile(skillMdPath, skillMd, 'utf-8');
    createdFiles.push(skillMdPath);

    // 2. index.ts
    const indexTs = this.buildIndexTs(plan, vars);
    const indexTsPath = join(skillDir, 'index.ts');
    await writeFile(indexTsPath, indexTs, 'utf-8');
    createdFiles.push(indexTsPath);

    // 3. test.ts
    const testTs = this.buildTestTs(plan, vars);
    const testTsPath = join(skillDir, 'test.ts');
    await writeFile(testTsPath, testTs, 'utf-8');
    createdFiles.push(testTsPath);

    // 4. fallbacks.ts
    const fallbacksTs = this.buildFallbacksTs(plan, vars);
    const fallbacksTsPath = join(skillDir, 'fallbacks.ts');
    await writeFile(fallbacksTsPath, fallbacksTs, 'utf-8');
    createdFiles.push(fallbacksTsPath);

    // 5. package.json
    const packageJson = fillTemplate(getPackageJsonTemplate(), vars);
    const packageJsonPath = join(skillDir, 'package.json');
    await writeFile(packageJsonPath, packageJson, 'utf-8');
    createdFiles.push(packageJsonPath);

    this.logger.info(
      { skillId, files: createdFiles.length },
      'Scaffold complete',
    );

    return { files: createdFiles, directory: skillDir, skillId };
  }

  // -----------------------------------------------------------------------
  // SKILL.md builder
  // -----------------------------------------------------------------------

  private buildSkillMd(plan: SkillPlan, baseVars: Record<string, string>): string {
    const toolsDocs = plan.tools
      .map((t) => {
        const params = t.parameters
          .map((p) => `  - \`${p.name}\` (${p.type}${p.required ? ', required' : ''}) - ${p.description}`)
          .join('\n');
        return `### \`${t.name}\`\n\n${t.description}\n\n**Parameters:**\n${params}\n\n**Returns:** \`${t.returnType}\``;
      })
      .join('\n\n');

    const paramsDocs = plan.tools
      .flatMap((t) => t.parameters)
      .filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i) // deduplicate
      .map((p) => `| \`${p.name}\` | \`${p.type}\` | ${p.required ? 'Yes' : 'No'} | ${p.description} |`)
      .join('\n');

    const paramsTable = paramsDocs
      ? `| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${paramsDocs}`
      : '_No parameters_';

    const testCasesDocs = plan.testCases
      .map((tc, i) => `${i + 1}. **${tc.name}** - ${tc.description}`)
      .join('\n');

    const vars: Record<string, string> = {
      ...baseVars,
      toolsDocs,
      paramsDocs: paramsTable,
      testCasesDocs: testCasesDocs || '_No test cases_',
    };

    return fillTemplate(getSkillMdTemplate(), vars);
  }

  // -----------------------------------------------------------------------
  // index.ts builder
  // -----------------------------------------------------------------------

  private buildIndexTs(plan: SkillPlan, baseVars: Record<string, string>): string {
    // Generate type definitions for tool inputs/outputs
    const toolTypes = plan.tools
      .map((tool) => this.generateToolTypes(tool))
      .join('\n\n');

    // Generate tool implementations
    const toolImplementations = plan.tools
      .map((tool) => this.generateToolImplementation(tool))
      .join('\n\n');

    // Tool names array for the manifest
    const toolNames = plan.tools
      .map((t) => `'${t.name}'`)
      .join(', ');

    const vars: Record<string, string> = {
      ...baseVars,
      toolTypes,
      toolImplementations,
      toolNames,
    };

    return fillTemplate(getIndexTemplate(), vars);
  }

  private generateToolTypes(tool: ToolSpec): string {
    const inputName = this.toPascalCase(tool.name) + 'Input';
    const outputName = this.toPascalCase(tool.name) + 'Output';

    const inputFields = tool.parameters
      .map((p) => `  ${p.name}${p.required ? '' : '?'}: ${this.tsType(p.type)};`)
      .join('\n');

    return [
      `export interface ${inputName} {`,
      inputFields,
      `}`,
      ``,
      `export type ${outputName} = ${tool.returnType};`,
    ].join('\n');
  }

  private generateToolImplementation(tool: ToolSpec): string {
    const fnName = this.toCamelCase(tool.name);
    const inputType = this.toPascalCase(tool.name) + 'Input';
    const outputType = this.toPascalCase(tool.name) + 'Output';

    const requiredChecks = tool.parameters
      .filter((p) => p.required)
      .map(
        (p) =>
          `  if (input.${p.name} === undefined || input.${p.name} === null) {\n` +
          `    throw new Error('Missing required parameter: ${p.name}');\n` +
          `  }`,
      )
      .join('\n');

    const typeValidations = tool.parameters
      .filter((p) => p.required)
      .map((p) => {
        const jsType = this.jsTypeof(p.type);
        if (!jsType) return '';
        return (
          `  if (typeof input.${p.name} !== '${jsType}') {\n` +
          `    throw new Error('Parameter "${p.name}" must be of type ${p.type}, got ' + typeof input.${p.name});\n` +
          `  }`
        );
      })
      .filter(Boolean)
      .join('\n');

    return [
      `/**`,
      ` * ${tool.description}`,
      ` */`,
      `export async function ${fnName}(input: ${inputType}): Promise<${outputType}> {`,
      `  // Validate required parameters`,
      requiredChecks,
      typeValidations ? `\n  // Type validation\n${typeValidations}` : '',
      ``,
      `  // TODO: Implement ${tool.name} logic`,
      `  // This is a scaffold — real implementation is written by the builder.`,
      `  throw new Error('Not implemented: ${tool.name}');`,
      `}`,
    ].join('\n');
  }

  // -----------------------------------------------------------------------
  // test.ts builder
  // -----------------------------------------------------------------------

  private buildTestTs(plan: SkillPlan, baseVars: Record<string, string>): string {
    // Build imports
    const fnNames = plan.tools.map((t) => this.toCamelCase(t.name));
    const testImports = `import { ${fnNames.join(', ')} } from './index.js';`;

    // Build test case functions
    const testCases = plan.testCases
      .map((tc, i) => this.generateTestFunction(tc, i, plan))
      .join('\n\n');

    // Build runner entries
    const testRunner = plan.testCases
      .map((tc, i) => {
        const fnName = `test_${i}`;
        return [
          `  try {`,
          `    await ${fnName}();`,
          `    results.push({ name: ${JSON.stringify(tc.name)}, passed: true });`,
          `  } catch (err: unknown) {`,
          `    const msg = err instanceof Error ? err.message : String(err);`,
          `    results.push({ name: ${JSON.stringify(tc.name)}, passed: false, error: msg });`,
          `  }`,
        ].join('\n');
      })
      .join('\n\n');

    const vars: Record<string, string> = {
      ...baseVars,
      testImports,
      testCases,
      testRunner,
    };

    return fillTemplate(getTestTemplate(), vars);
  }

  private generateTestFunction(tc: TestCase, index: number, plan: SkillPlan): string {
    const fnName = `test_${index}`;

    // Determine which tool function to call (match by test name prefix)
    let targetFn: string | undefined;
    for (const tool of plan.tools) {
      if (tc.name.startsWith(tool.name)) {
        targetFn = this.toCamelCase(tool.name);
        break;
      }
    }

    // Fallback: use first tool
    if (!targetFn && plan.tools.length > 0) {
      targetFn = this.toCamelCase(plan.tools[0].name);
    }

    const inputStr = JSON.stringify(tc.input, null, 2).replace(/\n/g, '\n  ');
    const expectedStr = JSON.stringify(tc.expectedOutput, null, 2).replace(/\n/g, '\n  ');
    const isErrorTest =
      typeof tc.expectedOutput === 'object' &&
      tc.expectedOutput !== null &&
      'error' in (tc.expectedOutput as Record<string, unknown>);

    if (isErrorTest) {
      return [
        `/** ${tc.description} */`,
        `async function ${fnName}(): Promise<void> {`,
        `  const input = ${inputStr};`,
        `  try {`,
        `    await ${targetFn}(input as any);`,
        `    throw new Error('Expected an error but call succeeded');`,
        `  } catch (err: unknown) {`,
        `    const msg = err instanceof Error ? err.message : String(err);`,
        `    const expected = ${expectedStr};`,
        `    if (typeof expected === 'object' && expected !== null && 'error' in expected) {`,
        `      if (!msg.toLowerCase().includes(String(expected.error).toLowerCase())) {`,
        `        throw new Error(\`Expected error containing "\${expected.error}", got: "\${msg}"\`);`,
        `      }`,
        `    }`,
        `  }`,
        `}`,
      ].join('\n');
    }

    return [
      `/** ${tc.description} */`,
      `async function ${fnName}(): Promise<void> {`,
      `  const input = ${inputStr};`,
      `  const result = await ${targetFn}(input as any);`,
      `  const expected = ${expectedStr};`,
      `  // Basic assertion: result should be truthy when success is expected`,
      `  if (result === undefined || result === null) {`,
      `    throw new Error('Expected a result but got ' + String(result));`,
      `  }`,
      `}`,
    ].join('\n');
  }

  // -----------------------------------------------------------------------
  // fallbacks.ts builder
  // -----------------------------------------------------------------------

  private buildFallbacksTs(plan: SkillPlan, baseVars: Record<string, string>): string {
    const strategies = plan.tools
      .map((tool) => {
        const toolName = tool.name;
        return [
          `// Fallback for ${toolName}`,
          `registerFallback('${toolName}', {`,
          `  name: '${toolName}-noop-fallback',`,
          `  description: 'Returns a safe no-op result when ${toolName} fails',`,
          `  execute: async (_input: unknown): Promise<FallbackResult> => {`,
          `    return {`,
          `      success: false,`,
          `      error: 'Primary implementation failed and no real fallback is available yet',`,
          `      fallbackUsed: '${toolName}-noop-fallback',`,
          `    };`,
          `  },`,
          `});`,
          ``,
          `registerFallback('${toolName}', {`,
          `  name: '${toolName}-retry-fallback',`,
          `  description: 'Retry ${toolName} with exponential backoff',`,
          `  execute: async (input: unknown): Promise<FallbackResult> => {`,
          `    const maxRetries = 3;`,
          `    let lastError = '';`,
          `    for (let attempt = 0; attempt < maxRetries; attempt++) {`,
          `      try {`,
          `        // Wait with exponential backoff`,
          `        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));`,
          `        // Re-import and retry the tool (dynamic to pick up hot fixes)`,
          `        const mod = await import('./index.js');`,
          `        const fn = (mod as Record<string, unknown>)['${this.toCamelCase(toolName)}'];`,
          `        if (typeof fn === 'function') {`,
          `          const result = await fn(input);`,
          `          return { success: true, data: result, fallbackUsed: '${toolName}-retry-fallback' };`,
          `        }`,
          `      } catch (err: unknown) {`,
          `        lastError = err instanceof Error ? err.message : String(err);`,
          `      }`,
          `    }`,
          `    return {`,
          `      success: false,`,
          `      error: \`Retry exhausted after \${maxRetries} attempts: \${lastError}\`,`,
          `      fallbackUsed: '${toolName}-retry-fallback',`,
          `    };`,
          `  },`,
          `});`,
        ].join('\n');
      })
      .join('\n\n');

    const vars: Record<string, string> = {
      ...baseVars,
      fallbackStrategies: strategies,
    };

    return fillTemplate(getFallbacksTemplate(), vars);
  }

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------

  /** Convert "my-tool-name" to "myToolName" */
  private toCamelCase(str: string): string {
    return str.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  }

  /** Convert "my-tool-name" to "MyToolName" */
  private toPascalCase(str: string): string {
    const camel = this.toCamelCase(str);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }

  /** Map a param type string to a TypeScript type. */
  private tsType(type: string): string {
    switch (type.toLowerCase()) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'string[]':
        return 'string[]';
      case 'object':
        return 'Record<string, unknown>';
      default:
        return type; // Pass through complex types
    }
  }

  /** Map a type to the expected typeof result, or null if not simple. */
  private jsTypeof(type: string): string | null {
    switch (type.toLowerCase()) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      default:
        return null;
    }
  }
}
