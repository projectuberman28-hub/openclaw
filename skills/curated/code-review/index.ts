/**
 * @alfred/skill-code-review
 *
 * Analyze code diffs, files, and pull requests for bugs, security vulnerabilities,
 * performance issues, and style violations. Provides severity-rated findings.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'critical' | 'warning' | 'info';
type Category = 'bug' | 'security' | 'performance' | 'style' | 'maintainability';

interface Finding {
  severity: Severity;
  category: Category;
  message: string;
  line?: number;
  file?: string;
  suggestion?: string;
  rule: string;
}

interface ReviewSummary {
  totalFindings: number;
  critical: number;
  warnings: number;
  info: number;
  categories: Record<Category, number>;
  overallRating: 'pass' | 'needs-work' | 'critical-issues';
}

interface ReviewResult {
  findings: Finding[];
  summary: ReviewSummary;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function detectLanguage(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.rb': 'ruby',
    '.php': 'php',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.sh': 'shell', '.bash': 'shell',
    '.sql': 'sql',
    '.yaml': 'yaml', '.yml': 'yaml',
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'css', '.less': 'css',
  };
  return langMap[ext] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Security rules
// ---------------------------------------------------------------------------

interface Rule {
  pattern: RegExp;
  severity: Severity;
  category: Category;
  message: string;
  suggestion: string;
  rule: string;
  languages?: string[];
}

const SECURITY_RULES: Rule[] = [
  {
    pattern: /(?:password|passwd|secret|api_?key|token|auth)\s*[:=]\s*['"][^'"]{3,}['"]/gi,
    severity: 'critical',
    category: 'security',
    message: 'Hardcoded credential or secret detected',
    suggestion: 'Use environment variables or a secrets manager',
    rule: 'no-hardcoded-secrets',
  },
  {
    pattern: /eval\s*\(/g,
    severity: 'critical',
    category: 'security',
    message: 'Use of eval() — potential code injection vulnerability',
    suggestion: 'Replace eval with safer alternatives like JSON.parse or Function constructor',
    rule: 'no-eval',
    languages: ['javascript', 'typescript', 'python'],
  },
  {
    pattern: /innerHTML\s*=/g,
    severity: 'warning',
    category: 'security',
    message: 'Direct innerHTML assignment — potential XSS vulnerability',
    suggestion: 'Use textContent, innerText, or a sanitization library',
    rule: 'no-inner-html',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /document\.write\s*\(/g,
    severity: 'warning',
    category: 'security',
    message: 'Use of document.write — can overwrite entire page and enables XSS',
    suggestion: 'Use DOM manipulation methods instead',
    rule: 'no-document-write',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    severity: 'warning',
    category: 'security',
    message: 'React dangerouslySetInnerHTML used — ensure content is sanitized',
    suggestion: 'Sanitize content with DOMPurify before rendering',
    rule: 'no-dangerous-html',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\([^)]*\$\{/g,
    severity: 'critical',
    category: 'security',
    message: 'Command injection risk — user input in shell command',
    suggestion: 'Use parameterized commands or escape user input',
    rule: 'no-command-injection',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /SELECT\s+.*FROM\s+.*WHERE\s+.*['"]\s*\+/gi,
    severity: 'critical',
    category: 'security',
    message: 'SQL injection risk — string concatenation in SQL query',
    suggestion: 'Use parameterized queries or prepared statements',
    rule: 'no-sql-injection',
  },
  {
    pattern: /os\.system\s*\(|subprocess\.call\s*\(\s*[^[\]]*\+/g,
    severity: 'critical',
    category: 'security',
    message: 'Command injection risk in Python system call',
    suggestion: 'Use subprocess.run with a list of arguments',
    rule: 'no-command-injection-py',
    languages: ['python'],
  },
];

// ---------------------------------------------------------------------------
// Bug detection rules
// ---------------------------------------------------------------------------

const BUG_RULES: Rule[] = [
  {
    pattern: /===?\s*undefined\s*&&/g,
    severity: 'warning',
    category: 'bug',
    message: 'Potentially inverted null check — checking undefined before accessing property',
    suggestion: 'Verify the condition logic; consider optional chaining',
    rule: 'suspicious-null-check',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g,
    severity: 'warning',
    category: 'bug',
    message: 'Empty catch block — errors are silently swallowed',
    suggestion: 'Log the error or handle it explicitly',
    rule: 'no-empty-catch',
  },
  {
    pattern: /(?:var|let)\s+\w+\s*=\s*(?:new\s+Date\(\)|Date\.now\(\))\s*;?\s*$/gm,
    severity: 'info',
    category: 'bug',
    message: 'Date captured at declaration time — may be stale in long-running code',
    suggestion: 'Capture the date at the point of use instead',
    rule: 'stale-date',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /==\s*(?:null|undefined|true|false|0|''|"")\b/g,
    severity: 'info',
    category: 'bug',
    message: 'Loose equality comparison — may cause type coercion bugs',
    suggestion: 'Use strict equality (===) instead',
    rule: 'no-loose-equality',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /(?:console\.log|print|System\.out\.println|fmt\.Print(?:ln)?)\s*\(/g,
    severity: 'info',
    category: 'style',
    message: 'Debug logging statement left in code',
    suggestion: 'Remove or replace with proper logging framework',
    rule: 'no-debug-logs',
  },
  {
    pattern: /TODO|FIXME|HACK|XXX|TEMP/g,
    severity: 'info',
    category: 'maintainability',
    message: 'TODO/FIXME comment found — unresolved technical debt',
    suggestion: 'Resolve the issue or create a tracking ticket',
    rule: 'no-todo-comments',
  },
];

// ---------------------------------------------------------------------------
// Performance rules
// ---------------------------------------------------------------------------

const PERFORMANCE_RULES: Rule[] = [
  {
    pattern: /\.forEach\s*\(\s*async/g,
    severity: 'warning',
    category: 'performance',
    message: 'Async callback in forEach — iterations run concurrently without awaiting',
    suggestion: 'Use for...of with await, or Promise.all with .map',
    rule: 'no-async-foreach',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /new RegExp\s*\(/g,
    severity: 'info',
    category: 'performance',
    message: 'Dynamic RegExp construction inside potential hot path',
    suggestion: 'Cache the RegExp if it does not change between calls',
    rule: 'cache-regex',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify/g,
    severity: 'info',
    category: 'performance',
    message: 'Deep clone via JSON round-trip — slow for large objects',
    suggestion: 'Use structuredClone() or a targeted cloning approach',
    rule: 'no-json-clone',
    languages: ['javascript', 'typescript'],
  },
  {
    pattern: /SELECT\s+\*/gi,
    severity: 'warning',
    category: 'performance',
    message: 'SELECT * query — fetches all columns unnecessarily',
    suggestion: 'Specify only the columns you need',
    rule: 'no-select-star',
  },
  {
    pattern: /(?:await|\.then)\s+.*(?:await|\.then).*(?:for|while)\s*\(/gm,
    severity: 'warning',
    category: 'performance',
    message: 'Sequential awaits inside a loop — potential N+1 query pattern',
    suggestion: 'Batch operations or use Promise.all for concurrent execution',
    rule: 'no-sequential-await-loop',
    languages: ['javascript', 'typescript'],
  },
];

// ---------------------------------------------------------------------------
// Style rules
// ---------------------------------------------------------------------------

const STYLE_RULES: Rule[] = [
  {
    pattern: /function\s+\w{1,2}\s*\(/g,
    severity: 'info',
    category: 'style',
    message: 'Very short function name — may harm readability',
    suggestion: 'Use descriptive function names',
    rule: 'descriptive-names',
  },
  {
    pattern: /^\s{0,3}(?:if|for|while)\s*\([^)]{80,}\)/gm,
    severity: 'info',
    category: 'style',
    message: 'Long conditional expression — consider extracting into a named variable',
    suggestion: 'Extract condition into a descriptively named boolean',
    rule: 'long-condition',
  },
  {
    pattern: /\)\s*\{[^\n]{100,}/gm,
    severity: 'info',
    category: 'style',
    message: 'Very long line (>100 characters)',
    suggestion: 'Break long lines for readability',
    rule: 'max-line-length',
  },
  {
    pattern: /\/\/\s*@ts-ignore/g,
    severity: 'warning',
    category: 'style',
    message: '@ts-ignore suppresses TypeScript checking — may hide real errors',
    suggestion: 'Use @ts-expect-error with a description, or fix the type error',
    rule: 'no-ts-ignore',
    languages: ['typescript'],
  },
  {
    pattern: /any(?:\s*[;,\]\)}\|&]|\s*$)/gm,
    severity: 'info',
    category: 'style',
    message: 'Use of "any" type reduces type safety',
    suggestion: 'Use a more specific type or "unknown"',
    rule: 'no-any-type',
    languages: ['typescript'],
  },
];

const ALL_RULES: Rule[] = [...SECURITY_RULES, ...BUG_RULES, ...PERFORMANCE_RULES, ...STYLE_RULES];

// ---------------------------------------------------------------------------
// Analysis engine
// ---------------------------------------------------------------------------

function analyzeCode(
  code: string,
  filename: string = 'unknown',
  onlyAddedLines: boolean = false,
): Finding[] {
  const findings: Finding[] = [];
  const language = detectLanguage(filename);
  const lines = code.split('\n');

  for (const rule of ALL_RULES) {
    // Skip rules that don't apply to this language
    if (rule.languages && language !== 'unknown' && !rule.languages.includes(language)) {
      continue;
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;

      // In diff mode, only analyze added lines
      if (onlyAddedLines && !line.startsWith('+')) {
        continue;
      }

      const lineContent = onlyAddedLines ? line.slice(1) : line;

      // Reset regex lastIndex
      rule.pattern.lastIndex = 0;

      if (rule.pattern.test(lineContent)) {
        findings.push({
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          line: lineIdx + 1,
          file: filename,
          suggestion: rule.suggestion,
          rule: rule.rule,
        });
      }
    }
  }

  // Deduplicate findings on same line with same rule
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSummary(findings: Finding[]): ReviewSummary {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;

  const categories: Record<Category, number> = {
    bug: 0,
    security: 0,
    performance: 0,
    style: 0,
    maintainability: 0,
  };

  for (const f of findings) {
    categories[f.category]++;
  }

  let overallRating: 'pass' | 'needs-work' | 'critical-issues';
  if (critical > 0) {
    overallRating = 'critical-issues';
  } else if (warnings > 3) {
    overallRating = 'needs-work';
  } else {
    overallRating = 'pass';
  }

  return {
    totalFindings: findings.length,
    critical,
    warnings,
    info,
    categories,
    overallRating,
  };
}

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

interface DiffFile {
  filename: string;
  addedLines: string[];
  hunks: string;
}

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileSections = diff.split(/^diff --git /gm).filter(Boolean);

  for (const section of fileSections) {
    // Extract filename
    const fileMatch = section.match(/a\/(.+?)\s+b\/(.+)/);
    const filename = fileMatch?.[2] ?? 'unknown';

    // Extract added lines
    const addedLines: string[] = [];
    const lines = section.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines.push(line);
      }
    }

    files.push({
      filename,
      addedLines,
      hunks: section,
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function reviewDiff(diff: string): Promise<ReviewResult> {
  const files = parseDiff(diff);
  const allFindings: Finding[] = [];

  for (const file of files) {
    const content = file.addedLines.join('\n');
    const findings = analyzeCode(content, file.filename, true);
    allFindings.push(...findings);
  }

  return {
    findings: allFindings,
    summary: buildSummary(allFindings),
  };
}

async function reviewFile(path: string): Promise<ReviewResult> {
  const filePath = resolve(path);
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');

  // Check file size
  if (content.length > 100_000) {
    // Analyze in chunks for large files
    const chunks = [];
    const chunkSize = 50_000;
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }

    const allFindings: Finding[] = [];
    for (const chunk of chunks) {
      allFindings.push(...analyzeCode(chunk, path));
    }

    return {
      findings: allFindings.slice(0, 100), // Cap at 100 findings
      summary: buildSummary(allFindings),
    };
  }

  const findings = analyzeCode(content, path);
  return {
    findings,
    summary: buildSummary(findings),
  };
}

async function reviewPr(url: string): Promise<ReviewResult & { filesChanged: number }> {
  // Parse GitHub PR URL: https://github.com/owner/repo/pull/123
  const prMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!prMatch) {
    throw new Error(`Invalid GitHub PR URL: ${url}`);
  }

  const [, owner, repo, prNumber] = prMatch;

  let diff: string;

  // Try GitHub API first
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3.diff',
        'User-Agent': 'Alfred/3.0 CodeReview',
        ...(process.env['GITHUB_TOKEN']
          ? { Authorization: `token ${process.env['GITHUB_TOKEN']}` }
          : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    diff = await response.text();
  } catch (apiError) {
    // Fallback: try gh CLI
    try {
      diff = execSync(
        `gh pr diff ${prNumber} --repo ${owner}/${repo}`,
        { encoding: 'utf-8', timeout: 15_000 },
      );
    } catch {
      throw new Error(
        `Could not fetch PR diff. GitHub API failed: ${apiError instanceof Error ? apiError.message : String(apiError)}. gh CLI also unavailable.`,
      );
    }
  }

  const files = parseDiff(diff);
  const allFindings: Finding[] = [];

  for (const file of files) {
    const content = file.addedLines.join('\n');
    const findings = analyzeCode(content, file.filename, true);
    allFindings.push(...findings);
  }

  return {
    findings: allFindings,
    summary: buildSummary(allFindings),
    filesChanged: files.length,
  };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'code-review';
export const description =
  'Analyze code diffs, files, and pull requests for bugs, security issues, performance, and style';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'review_diff',
    description: 'Analyze a unified diff for code quality issues',
    parameters: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Unified diff content to analyze' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'review_file',
    description: 'Analyze a single file for code quality issues',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to review' },
      },
      required: ['path'],
    },
  },
  {
    name: 'review_pr',
    description: 'Analyze a GitHub pull request for code quality issues',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)' },
      },
      required: ['url'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'review_diff':
      return reviewDiff(args.diff as string);
    case 'review_file':
      return reviewFile(args.path as string);
    case 'review_pr':
      return reviewPr(args.url as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
