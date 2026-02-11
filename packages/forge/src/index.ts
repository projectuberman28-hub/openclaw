/**
 * @alfred/forge - Self-building skill system
 *
 * Alfred detects capability gaps and builds new skills automatically.
 *
 * Pipeline:
 *   1. GapDetector   - Analyze failures & requests to find missing capabilities
 *   2. SkillPlanner  - Create a plan: tools, params, tests, dependencies
 *   3. SkillScaffolder - Generate the directory structure and template files
 *   4. SkillBuilder  - Fill in real implementations and validate code
 *   5. SkillTester   - Run tests in a sandbox, promote or quarantine
 *   6. ForgeSandbox  - Isolated execution (Docker preferred, VM fallback)
 */

// Detector
export { GapDetector } from './detector.js';
export type {
  ToolFailure,
  UserRequest,
  CapabilityGap,
  GapDetectorConfig,
} from './detector.js';

// Planner
export { SkillPlanner } from './planner.js';
export type {
  ParamSpec,
  ToolSpec,
  TestCase,
  SkillPlan,
  PlannerConfig,
} from './planner.js';

// Scaffolder
export { SkillScaffolder } from './scaffolder.js';
export type { ScaffoldResult } from './scaffolder.js';

// Builder
export { SkillBuilder } from './builder.js';
export type { BuildResult } from './builder.js';

// Tester
export { SkillTester } from './tester.js';
export type { TestError, TestResult } from './tester.js';

// Sandbox
export { ForgeSandbox } from './sandbox.js';
export type { SandboxOptions, SandboxResult } from './sandbox.js';

// Templates
export {
  fillTemplate,
  getSkillMdTemplate,
  getIndexTemplate,
  getTestTemplate,
  getFallbacksTemplate,
  getPackageJsonTemplate,
} from './templates/skill-template.js';
