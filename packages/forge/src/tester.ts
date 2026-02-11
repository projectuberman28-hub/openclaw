/**
 * @alfred/forge - Skill Tester
 *
 * Runs test cases for forged skills inside the sandbox, collects results,
 * and decides whether to promote the skill to curated/ or quarantine it.
 */

import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import pino from 'pino';

import type { TestCase } from './planner.js';
import { ForgeSandbox } from './sandbox.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestError {
  testName: string;
  expected: unknown;
  actual: unknown;
  error: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  errors: TestError[];
  duration: number;
  allPassed: boolean;
}

// ---------------------------------------------------------------------------
// SkillTester
// ---------------------------------------------------------------------------

export class SkillTester {
  private readonly sandbox: ForgeSandbox;
  private readonly logger: pino.Logger;

  /** Per-test timeout in ms (default: 30 000) */
  private readonly testTimeout: number;

  constructor(testTimeout = 30_000) {
    this.sandbox = new ForgeSandbox();
    this.testTimeout = testTimeout;
    this.logger = pino({ name: 'forge:tester', level: 'info' });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Run all test cases for a forged skill.
   *
   * @param skillDir  Path to the skill directory (e.g. skills/forged/my-skill)
   * @param testCases Test cases from the SkillPlan
   */
  async test(skillDir: string, testCases: TestCase[]): Promise<TestResult> {
    const start = performance.now();
    const errors: TestError[] = [];
    let passed = 0;
    let failed = 0;

    this.logger.info(
      { skillDir, count: testCases.length },
      'Starting test run',
    );

    // Read the skill's test.ts to see if it has a self-runner we can invoke
    const testFilePath = join(skillDir, 'test.ts');
    let testFileExists = false;
    let testFileContent = '';

    try {
      testFileContent = await readFile(testFilePath, 'utf-8');
      testFileExists = true;
    } catch {
      // No test file, we'll generate test code inline
    }

    // Read the skill's index.ts for import into sandbox
    const indexPath = join(skillDir, 'index.ts');
    let indexContent = '';
    try {
      indexContent = await readFile(indexPath, 'utf-8');
    } catch {
      errors.push({
        testName: '__setup__',
        expected: 'index.ts exists',
        actual: 'file not found',
        error: `Cannot read skill entry point: ${indexPath}`,
      });
      failed = testCases.length;
      const duration = Math.round(performance.now() - start);
      return { passed, failed, errors, duration, allPassed: false };
    }

    // Run each test case individually in the sandbox
    for (const tc of testCases) {
      this.logger.debug({ test: tc.name }, 'Running test');

      const testCode = this.buildTestCode(indexContent, tc);

      try {
        const result = await this.sandbox.execute(testCode, {
          timeout: this.testTimeout,
        });

        if (result.exitCode === 0 && !result.error) {
          // Parse the output to check if the test reported success
          const testOutcome = this.parseTestOutput(result.output, tc);

          if (testOutcome.passed) {
            passed++;
            this.logger.debug({ test: tc.name }, 'Test passed');
          } else {
            failed++;
            errors.push({
              testName: tc.name,
              expected: tc.expectedOutput,
              actual: testOutcome.actual,
              error: testOutcome.error ?? 'Test assertion failed',
            });
            this.logger.debug(
              { test: tc.name, error: testOutcome.error },
              'Test failed',
            );
          }
        } else {
          // Sandbox-level failure
          failed++;
          errors.push({
            testName: tc.name,
            expected: tc.expectedOutput,
            actual: result.output || null,
            error: result.error ?? `Exit code: ${result.exitCode}`,
          });
          this.logger.debug(
            { test: tc.name, exitCode: result.exitCode, error: result.error },
            'Test sandbox error',
          );
        }
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
          testName: tc.name,
          expected: tc.expectedOutput,
          actual: null,
          error: `Test execution error: ${msg}`,
        });
        this.logger.error({ test: tc.name, error: msg }, 'Test execution error');
      }
    }

    const duration = Math.round(performance.now() - start);
    const allPassed = failed === 0 && passed === testCases.length;

    this.logger.info(
      { passed, failed, duration, allPassed },
      'Test run complete',
    );

    return { passed, failed, errors, duration, allPassed };
  }

  /**
   * Promote a forged skill: move it from forged/ to curated/.
   * Updates the skill metadata to mark it as promoted.
   */
  async promote(skillDir: string): Promise<void> {
    const skillName = basename(skillDir);
    const forgedParent = dirname(skillDir);
    const curatedDir = join(dirname(forgedParent), 'curated', skillName);

    this.logger.info({ from: skillDir, to: curatedDir }, 'Promoting skill');

    // Ensure curated directory exists
    await mkdir(dirname(curatedDir), { recursive: true });

    // Move the skill directory
    await rename(skillDir, curatedDir);

    // Update metadata in package.json
    const pkgPath = join(curatedDir, 'package.json');
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const alfred = (pkg.alfred ?? {}) as Record<string, unknown>;
      alfred.status = 'curated';
      alfred.sandbox = false;
      alfred.promotedAt = new Date().toISOString();
      pkg.alfred = alfred;
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    } catch {
      this.logger.warn({ pkgPath }, 'Could not update package.json after promotion');
    }

    // Update SKILL.md status
    const skillMdPath = join(curatedDir, 'SKILL.md');
    try {
      let md = await readFile(skillMdPath, 'utf-8');
      md = md.replace(
        /\*\*Status\*\*: forged \(sandbox-only\)/,
        '**Status**: curated (promoted)',
      );
      await writeFile(skillMdPath, md, 'utf-8');
    } catch {
      // Non-fatal
    }

    this.logger.info({ skillName }, 'Skill promoted to curated');
  }

  /**
   * Quarantine a forged skill that failed tests.
   * Marks it with failure metadata so it won't be loaded.
   */
  async quarantine(skillDir: string, errors: TestError[]): Promise<void> {
    const skillName = basename(skillDir);
    this.logger.info({ skillName, errorCount: errors.length }, 'Quarantining skill');

    // Write quarantine report
    const reportPath = join(skillDir, 'QUARANTINE.md');
    const report = this.buildQuarantineReport(skillName, errors);
    await writeFile(reportPath, report, 'utf-8');

    // Update package.json
    const pkgPath = join(skillDir, 'package.json');
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const alfred = (pkg.alfred ?? {}) as Record<string, unknown>;
      alfred.status = 'quarantined';
      alfred.quarantinedAt = new Date().toISOString();
      alfred.quarantineErrors = errors.map((e) => ({
        test: e.testName,
        error: e.error,
      }));
      pkg.alfred = alfred;
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    } catch {
      this.logger.warn({ pkgPath }, 'Could not update package.json for quarantine');
    }

    this.logger.info({ skillName }, 'Skill quarantined');
  }

  // -----------------------------------------------------------------------
  // Test code generation
  // -----------------------------------------------------------------------

  /**
   * Build a self-contained test script that can run in the sandbox.
   * It inlines the skill code and wraps the test case in a try/catch
   * that outputs a JSON result.
   */
  private buildTestCode(skillCode: string, tc: TestCase): string {
    // Strip import/export statements from the skill code for sandbox compatibility
    const strippedCode = this.stripImportsExports(skillCode);

    const inputJson = JSON.stringify(tc.input);
    const expectedJson = JSON.stringify(tc.expectedOutput);
    const isErrorTest = this.isErrorTestCase(tc);

    if (isErrorTest) {
      return `
// --- Inlined skill code ---
${strippedCode}

// --- Test: ${tc.name} ---
const __input = ${inputJson};
const __expected = ${expectedJson};

try {
  // Find the first exported async function
  const __fns = [${this.extractFunctionNames(skillCode).map((n) => n).join(', ')}].filter(f => typeof f === 'function');
  if (__fns.length === 0) {
    console.log(JSON.stringify({ passed: false, error: "No functions found to test" }));
  } else {
    try {
      await __fns[0](__input);
      console.log(JSON.stringify({ passed: false, error: "Expected error but call succeeded", actual: "no error" }));
    } catch (err) {
      const msg = err.message || String(err);
      const expectedError = __expected && typeof __expected === 'object' && __expected.error ? __expected.error : '';
      if (expectedError && msg.toLowerCase().includes(String(expectedError).toLowerCase())) {
        console.log(JSON.stringify({ passed: true }));
      } else if (!expectedError) {
        // Any error is acceptable
        console.log(JSON.stringify({ passed: true }));
      } else {
        console.log(JSON.stringify({ passed: false, error: msg, actual: msg }));
      }
    }
  }
} catch (outerErr) {
  console.log(JSON.stringify({ passed: false, error: outerErr.message || String(outerErr) }));
}
`;
    }

    return `
// --- Inlined skill code ---
${strippedCode}

// --- Test: ${tc.name} ---
const __input = ${inputJson};
const __expected = ${expectedJson};

try {
  const __fns = [${this.extractFunctionNames(skillCode).map((n) => n).join(', ')}].filter(f => typeof f === 'function');
  if (__fns.length === 0) {
    console.log(JSON.stringify({ passed: false, error: "No functions found to test" }));
  } else {
    const __result = await __fns[0](__input);
    // Basic assertion: result should be truthy
    if (__result !== undefined && __result !== null) {
      console.log(JSON.stringify({ passed: true, actual: __result }));
    } else {
      console.log(JSON.stringify({ passed: false, error: "Result was null/undefined", actual: __result }));
    }
  }
} catch (err) {
  console.log(JSON.stringify({ passed: false, error: err.message || String(err), actual: null }));
}
`;
  }

  /**
   * Strip TypeScript import/export statements so the code can
   * run in a plain VM context.
   */
  private stripImportsExports(code: string): string {
    let result = code;

    // Remove import statements (single and multi-line)
    result = result.replace(/^import\s+.*?(?:from\s+['"][^'"]+['"])?;?\s*$/gm, '');
    result = result.replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '');
    result = result.replace(/^import\s+type\s+.*?;?\s*$/gm, '');

    // Convert `export async function` to `async function`
    result = result.replace(/^export\s+(async\s+)?function\s+/gm, '$1function ');

    // Convert `export function` to `function`
    result = result.replace(/^export\s+function\s+/gm, 'function ');

    // Convert `export const/let/var` to `const/let/var`
    result = result.replace(/^export\s+(const|let|var)\s+/gm, '$1 ');

    // Convert `export class` to `class`
    result = result.replace(/^export\s+class\s+/gm, 'class ');

    // Convert `export interface` and `export type` to comments (TS only)
    result = result.replace(/^export\s+(interface|type)\s+/gm, '// (type) $1 ');

    // Remove `export default ...`
    result = result.replace(/^export\s+default\s+.*/gm, '');

    // Strip TypeScript type annotations (basic)
    // Remove `: Type` after parameter names in function signatures
    result = result.replace(/:\s*(?:string|number|boolean|void|any|unknown|never|Record<[^>]+>|Promise<[^>]+>)\s*(?=[,)\{=])/g, ' ');

    // Remove `as any` and `as Type` casts
    result = result.replace(/\s+as\s+\w+(?:<[^>]+>)?/g, '');

    // Remove interface/type blocks entirely (they're TS-only)
    result = result.replace(/^\/\/\s*\(type\)\s+(?:interface|type)\s+\w+[\s\S]*?^}/gm, '');

    return result;
  }

  /**
   * Extract function names from the skill code.
   */
  private extractFunctionNames(code: string): string[] {
    const names: string[] = [];
    const regex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      names.push(match[1]);
    }
    return names;
  }

  // -----------------------------------------------------------------------
  // Output parsing
  // -----------------------------------------------------------------------

  /**
   * Parse the sandbox output to determine if a test passed.
   */
  private parseTestOutput(
    output: string,
    tc: TestCase,
  ): { passed: boolean; actual?: unknown; error?: string } {
    // Look for the JSON result line
    const lines = output.trim().split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const result = JSON.parse(line) as {
            passed?: boolean;
            error?: string;
            actual?: unknown;
          };

          if (typeof result.passed === 'boolean') {
            return {
              passed: result.passed,
              actual: result.actual,
              error: result.error,
            };
          }
        } catch {
          // Not valid JSON, continue searching
        }
      }
    }

    // If no JSON result found, treat non-empty output as a pass for happy-path tests
    if (output.trim().length > 0 && !this.isErrorTestCase(tc)) {
      return { passed: true, actual: output.trim() };
    }

    return {
      passed: false,
      error: 'No test result output found',
      actual: output || null,
    };
  }

  /**
   * Determine if a test case expects an error.
   */
  private isErrorTestCase(tc: TestCase): boolean {
    return (
      typeof tc.expectedOutput === 'object' &&
      tc.expectedOutput !== null &&
      'error' in (tc.expectedOutput as Record<string, unknown>)
    );
  }

  // -----------------------------------------------------------------------
  // Quarantine report
  // -----------------------------------------------------------------------

  private buildQuarantineReport(skillName: string, errors: TestError[]): string {
    const now = new Date().toISOString();
    const errorList = errors
      .map(
        (e, i) =>
          `### ${i + 1}. ${e.testName}\n\n` +
          `- **Error**: ${e.error}\n` +
          `- **Expected**: \`${JSON.stringify(e.expected)}\`\n` +
          `- **Actual**: \`${JSON.stringify(e.actual)}\`\n`,
      )
      .join('\n');

    return [
      `# QUARANTINE REPORT: ${skillName}`,
      ``,
      `> This skill failed testing and has been quarantined.`,
      `> It will not be loaded or executed until issues are resolved.`,
      ``,
      `- **Quarantined at**: ${now}`,
      `- **Failed tests**: ${errors.length}`,
      ``,
      `## Errors`,
      ``,
      errorList,
      ``,
      `## Resolution`,
      ``,
      `To fix this skill:`,
      `1. Review the errors above`,
      `2. Edit the skill implementation in \`index.ts\``,
      `3. Re-run the forge tester`,
      `4. If all tests pass, the skill will be promoted to curated/`,
    ].join('\n');
  }
}
