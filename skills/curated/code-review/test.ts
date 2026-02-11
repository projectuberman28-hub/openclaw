/**
 * @alfred/skill-code-review - Test cases
 */

export default [
  {
    name: 'review_diff detects hardcoded secrets',
    input: {
      tool: 'review_diff',
      args: {
        diff: `diff --git a/config.ts b/config.ts
--- a/config.ts
+++ b/config.ts
@@ -1,3 +1,4 @@
+const API_KEY = "sk-1234567890abcdef";
 export default {};`,
      },
    },
    expected: { findings: 'array_with_critical', summary: { critical: 1 } },
  },
  {
    name: 'review_diff detects eval usage',
    input: {
      tool: 'review_diff',
      args: {
        diff: `diff --git a/handler.js b/handler.js
--- a/handler.js
+++ b/handler.js
@@ -1,2 +1,3 @@
+const result = eval(userInput);`,
      },
    },
    expected: { summary: { critical: 'number' } },
  },
  {
    name: 'review_diff detects empty catch block',
    input: {
      tool: 'review_diff',
      args: {
        diff: `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1,2 +1,4 @@
+try { doSomething(); } catch (e) {}`,
      },
    },
    expected: { findings: 'array_with_warning' },
  },
  {
    name: 'review_file throws for non-existent file',
    input: { tool: 'review_file', args: { path: '/tmp/nonexistent.ts' } },
    expected: { error: 'File not found' },
  },
  {
    name: 'review_pr rejects invalid URL',
    input: { tool: 'review_pr', args: { url: 'https://not-github.com/pr/123' } },
    expected: { error: 'Invalid GitHub PR URL' },
  },
  {
    name: 'review_diff detects SQL injection',
    input: {
      tool: 'review_diff',
      args: {
        diff: `diff --git a/db.js b/db.js
--- a/db.js
+++ b/db.js
@@ -1,2 +1,3 @@
+const q = "SELECT * FROM users WHERE name = '" + name + "'";`,
      },
    },
    expected: { summary: { critical: 'number' } },
  },
  {
    name: 'review_diff returns pass for clean code',
    input: {
      tool: 'review_diff',
      args: {
        diff: `diff --git a/util.ts b/util.ts
--- a/util.ts
+++ b/util.ts
@@ -1,2 +1,3 @@
+export function addNumbers(a: number, b: number): number { return a + b; }`,
      },
    },
    expected: { summary: { overallRating: 'pass' } },
  },
  {
    name: 'review_diff detects async forEach',
    input: {
      tool: 'review_diff',
      args: {
        diff: `diff --git a/process.ts b/process.ts
--- a/process.ts
+++ b/process.ts
@@ -1,2 +1,3 @@
+items.forEach(async (item) => { await processItem(item); });`,
      },
    },
    expected: { findings: 'array_with_warning' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
