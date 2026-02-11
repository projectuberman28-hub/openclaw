/**
 * @alfred/forge - Skill Builder
 *
 * Takes a SkillPlan + ScaffoldResult and fills in the actual
 * implementation code.  Validates generated code with basic syntax
 * checking, writes the final files, and reports build status.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import pino from 'pino';

import type { SkillPlan, ToolSpec } from './planner.js';
import type { ScaffoldResult } from './scaffolder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildResult {
  success: boolean;
  skillId: string;
  errors: string[];
  warnings: string[];
  outputFiles: string[];
}

// ---------------------------------------------------------------------------
// SkillBuilder
// ---------------------------------------------------------------------------

export class SkillBuilder {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({ name: 'forge:builder', level: 'info' });
  }

  /**
   * Build a skill by generating concrete implementation code from the plan,
   * validating it, and writing the final files to the scaffold directory.
   */
  async build(plan: SkillPlan, scaffoldResult: ScaffoldResult): Promise<BuildResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const outputFiles: string[] = [];
    const { directory, skillId } = scaffoldResult;

    this.logger.info({ skillId, name: plan.name }, 'Building skill');

    try {
      // 1. Read the scaffolded index.ts
      const indexPath = join(directory, 'index.ts');
      const scaffoldedIndex = await readFile(indexPath, 'utf-8');

      // 2. Generate real implementations to replace the throw stubs
      const implementedIndex = this.generateImplementations(scaffoldedIndex, plan);

      // 3. Validate generated code
      const validationErrors = this.validateTypeScript(implementedIndex);
      if (validationErrors.length > 0) {
        warnings.push(...validationErrors.map((e) => `Validation warning: ${e}`));
        this.logger.warn({ warnings: validationErrors }, 'Validation warnings found');
      }

      // 4. Check for critical syntax errors that would prevent execution
      const criticalErrors = this.checkCriticalSyntax(implementedIndex);
      if (criticalErrors.length > 0) {
        errors.push(...criticalErrors);
        this.logger.error({ errors: criticalErrors }, 'Critical syntax errors');
        return { success: false, skillId, errors, warnings, outputFiles };
      }

      // 5. Write the implemented index.ts
      await writeFile(indexPath, implementedIndex, 'utf-8');
      outputFiles.push(indexPath);

      // 6. Generate and write a utilities file if the skill needs helpers
      if (plan.dependencies.length > 0) {
        const utilsCode = this.generateUtils(plan);
        const utilsPath = join(directory, 'utils.ts');
        await writeFile(utilsPath, utilsCode, 'utf-8');
        outputFiles.push(utilsPath);
      }

      // 7. Update package.json with actual dependencies
      const pkgPath = join(directory, 'package.json');
      await this.updatePackageJson(pkgPath, plan);
      outputFiles.push(pkgPath);

      // 8. Add remaining scaffold files to output
      for (const f of scaffoldResult.files) {
        if (!outputFiles.includes(f)) {
          outputFiles.push(f);
        }
      }

      this.logger.info(
        { skillId, outputFiles: outputFiles.length },
        'Build complete',
      );

      return { success: true, skillId, errors, warnings, outputFiles };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Build failed: ${msg}`);
      this.logger.error({ error: msg }, 'Build failed');
      return { success: false, skillId, errors, warnings, outputFiles };
    }
  }

  // -----------------------------------------------------------------------
  // Implementation generation
  // -----------------------------------------------------------------------

  /**
   * Replace `throw new Error('Not implemented: ...')` stubs in the
   * scaffolded code with real (albeit simple) implementations.
   */
  private generateImplementations(code: string, plan: SkillPlan): string {
    let result = code;

    for (const tool of plan.tools) {
      const fnName = this.toCamelCase(tool.name);
      const stubPattern = `  // TODO: Implement ${tool.name} logic\n  // This is a scaffold — real implementation is written by the builder.\n  throw new Error('Not implemented: ${tool.name}');`;
      const implementation = this.buildToolBody(tool);

      if (result.includes(stubPattern)) {
        result = result.replace(stubPattern, implementation);
      }
    }

    return result;
  }

  /**
   * Build the body of a tool function based on its specification.
   * Creates a working implementation that handles the tool's parameters.
   */
  private buildToolBody(tool: ToolSpec): string {
    const lines: string[] = [];

    // Determine what kind of tool this is by suffix
    const suffix = tool.name.split('-').pop() ?? '';

    switch (suffix) {
      case 'read':
        lines.push(...this.buildReadBody(tool));
        break;
      case 'write':
        lines.push(...this.buildWriteBody(tool));
        break;
      case 'list':
        lines.push(...this.buildListBody(tool));
        break;
      case 'fetch':
        lines.push(...this.buildFetchBody(tool));
        break;
      case 'parse':
        lines.push(...this.buildParseBody(tool));
        break;
      case 'transform':
        lines.push(...this.buildTransformBody(tool));
        break;
      case 'validate':
        lines.push(...this.buildValidateBody(tool));
        break;
      case 'send':
        lines.push(...this.buildSendBody(tool));
        break;
      case 'execute':
        lines.push(...this.buildExecuteBody(tool));
        break;
      case 'status':
        lines.push(...this.buildStatusBody(tool));
        break;
      case 'encrypt':
        lines.push(...this.buildEncryptBody(tool));
        break;
      case 'run':
        lines.push(...this.buildRunBody(tool));
        break;
      case 'process':
      default:
        lines.push(...this.buildGenericBody(tool));
        break;
    }

    return lines.map((l) => `  ${l}`).join('\n');
  }

  // --- Specific tool body generators ---

  private buildReadBody(tool: ToolSpec): string[] {
    return [
      `const { readFile: rf } = await import('node:fs/promises');`,
      `const encoding = (input as any).encoding ?? 'utf-8';`,
      `const content = await rf((input as any).path, { encoding: encoding as BufferEncoding });`,
      `return content as any;`,
    ];
  }

  private buildWriteBody(tool: ToolSpec): string[] {
    return [
      `const { writeFile: wf } = await import('node:fs/promises');`,
      `const content = String((input as any).content);`,
      `await wf((input as any).path, content, 'utf-8');`,
      `return { success: true, bytesWritten: Buffer.byteLength(content, 'utf-8') } as any;`,
    ];
  }

  private buildListBody(tool: ToolSpec): string[] {
    return [
      `const { readdir } = await import('node:fs/promises');`,
      `const { join } = await import('node:path');`,
      `const dir = (input as any).directory;`,
      `const entries = await readdir(dir);`,
      `const pattern = (input as any).pattern;`,
      `if (pattern) {`,
      `  // Simple glob: convert * to regex`,
      `  const regex = new RegExp('^' + pattern.replace(/\\*/g, '.*').replace(/\\?/g, '.') + '$');`,
      `  return entries.filter((e: string) => regex.test(e)) as any;`,
      `}`,
      `return entries as any;`,
    ];
  }

  private buildFetchBody(tool: ToolSpec): string[] {
    return [
      `const url = new URL((input as any).url);`,
      `const method = ((input as any).method ?? 'GET').toUpperCase();`,
      `const headers = (input as any).headers ?? {};`,
      ``,
      `const mod = url.protocol === 'https:' ? await import('node:https') : await import('node:http');`,
      ``,
      `return new Promise((resolve, reject) => {`,
      `  const req = mod.request(url, { method, headers }, (res) => {`,
      `    const chunks: Buffer[] = [];`,
      `    res.on('data', (chunk: Buffer) => chunks.push(chunk));`,
      `    res.on('end', () => {`,
      `      const body = Buffer.concat(chunks).toString('utf-8');`,
      `      const responseHeaders: Record<string, string> = {};`,
      `      for (const [k, v] of Object.entries(res.headers)) {`,
      `        if (typeof v === 'string') responseHeaders[k] = v;`,
      `        else if (Array.isArray(v)) responseHeaders[k] = v.join(', ');`,
      `      }`,
      `      resolve({ status: res.statusCode ?? 0, body, headers: responseHeaders } as any);`,
      `    });`,
      `    res.on('error', reject);`,
      `  });`,
      `  req.on('error', reject);`,
      `  req.end();`,
      `});`,
    ];
  }

  private buildParseBody(tool: ToolSpec): string[] {
    return [
      `const html = String((input as any).html);`,
      `// Simple tag-stripping parser (real impl would use a DOM parser)`,
      `const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();`,
      `const items = textContent.split(/[.!?]/).map(s => s.trim()).filter(Boolean);`,
      `return { items } as any;`,
    ];
  }

  private buildTransformBody(tool: ToolSpec): string[] {
    return [
      `const data = (input as any).input;`,
      `const format = String((input as any).format).toLowerCase();`,
      ``,
      `switch (format) {`,
      `  case 'json':`,
      `    return (typeof data === 'string' ? JSON.parse(data) : JSON.stringify(data, null, 2)) as any;`,
      `  case 'csv': {`,
      `    if (Array.isArray(data) && data.length > 0) {`,
      `      const keys = Object.keys(data[0]);`,
      `      const header = keys.join(',');`,
      `      const rows = data.map((row: any) => keys.map(k => String(row[k] ?? '')).join(','));`,
      `      return [header, ...rows].join('\\n') as any;`,
      `    }`,
      `    return String(data) as any;`,
      `  }`,
      `  case 'string':`,
      `    return String(data) as any;`,
      `  default:`,
      `    return data as any;`,
      `}`,
    ];
  }

  private buildValidateBody(tool: ToolSpec): string[] {
    return [
      `const data = (input as any).data;`,
      `const schema = (input as any).schema as Record<string, unknown>;`,
      `const errors: string[] = [];`,
      ``,
      `if (schema && typeof schema === 'object') {`,
      `  // Basic type validation against schema`,
      `  for (const [key, expectedType] of Object.entries(schema)) {`,
      `    if (data === null || data === undefined || !(key in (data as Record<string, unknown>))) {`,
      `      errors.push(\`Missing field: \${key}\`);`,
      `    } else if (typeof expectedType === 'string') {`,
      `      const actualType = typeof (data as Record<string, unknown>)[key];`,
      `      if (actualType !== expectedType) {`,
      `        errors.push(\`Field "\${key}" expected \${expectedType}, got \${actualType}\`);`,
      `      }`,
      `    }`,
      `  }`,
      `}`,
      ``,
      `return { valid: errors.length === 0, errors } as any;`,
    ];
  }

  private buildSendBody(tool: ToolSpec): string[] {
    return [
      `const to = String((input as any).to);`,
      `const message = String((input as any).message);`,
      `const subject = (input as any).subject ?? '';`,
      ``,
      `// Stub: log the send operation (real implementation would use an API)`,
      `console.log(\`[SEND] To: \${to}, Subject: \${subject}, Message: \${message.slice(0, 50)}...\`);`,
      `const messageId = 'msg-' + Date.now().toString(36);`,
      `return { sent: true, messageId } as any;`,
    ];
  }

  private buildExecuteBody(tool: ToolSpec): string[] {
    return [
      `const { execFile } = await import('node:child_process');`,
      `const { promisify } = await import('node:util');`,
      `const execFileAsync = promisify(execFile);`,
      ``,
      `const command = String((input as any).command);`,
      `const args: string[] = (input as any).args ?? [];`,
      `const timeout = (input as any).timeout ?? 30000;`,
      ``,
      `try {`,
      `  const { stdout, stderr } = await execFileAsync(command, args, {`,
      `    timeout,`,
      `    maxBuffer: 10 * 1024 * 1024,`,
      `  });`,
      `  return { stdout, stderr, exitCode: 0 } as any;`,
      `} catch (err: any) {`,
      `  return {`,
      `    stdout: err.stdout ?? '',`,
      `    stderr: err.stderr ?? err.message,`,
      `    exitCode: err.code ?? 1,`,
      `  } as any;`,
      `}`,
    ];
  }

  private buildStatusBody(tool: ToolSpec): string[] {
    return [
      `const resource = String((input as any).resource);`,
      ``,
      `// Basic process check (Unix-like)`,
      `try {`,
      `  const { execFile } = await import('node:child_process');`,
      `  const { promisify } = await import('node:util');`,
      `  const execFileAsync = promisify(execFile);`,
      `  const { stdout } = await execFileAsync('pgrep', ['-f', resource]);`,
      `  const pids = stdout.trim().split('\\n').map(Number).filter(Boolean);`,
      `  return { running: pids.length > 0, pid: pids[0], uptime: undefined } as any;`,
      `} catch {`,
      `  return { running: false } as any;`,
      `}`,
    ];
  }

  private buildEncryptBody(tool: ToolSpec): string[] {
    return [
      `const crypto = await import('node:crypto');`,
      `const data = String((input as any).data);`,
      `const algorithm = (input as any).algorithm ?? 'aes-256-cbc';`,
      ``,
      `const key = crypto.randomBytes(32);`,
      `const iv = crypto.randomBytes(16);`,
      `const cipher = crypto.createCipheriv(algorithm, key, iv);`,
      `let encrypted = cipher.update(data, 'utf-8', 'hex');`,
      `encrypted += cipher.final('hex');`,
      ``,
      `return { encrypted, iv: iv.toString('hex') } as any;`,
    ];
  }

  private buildRunBody(tool: ToolSpec): string[] {
    return [
      `const { execFile } = await import('node:child_process');`,
      `const { promisify } = await import('node:util');`,
      `const execFileAsync = promisify(execFile);`,
      ``,
      `const script = String((input as any).script);`,
      `const cwd = (input as any).cwd ?? process.cwd();`,
      ``,
      `// Determine shell`,
      `const isWindows = process.platform === 'win32';`,
      `const shell = isWindows ? 'cmd.exe' : '/bin/sh';`,
      `const shellArgs = isWindows ? ['/c', script] : ['-c', script];`,
      ``,
      `try {`,
      `  const { stdout, stderr } = await execFileAsync(shell, shellArgs, {`,
      `    cwd,`,
      `    timeout: 60000,`,
      `    maxBuffer: 10 * 1024 * 1024,`,
      `  });`,
      `  return { stdout, stderr, exitCode: 0 } as any;`,
      `} catch (err: any) {`,
      `  return {`,
      `    stdout: err.stdout ?? '',`,
      `    stderr: err.stderr ?? err.message,`,
      `    exitCode: err.code ?? 1,`,
      `  } as any;`,
      `}`,
    ];
  }

  private buildGenericBody(tool: ToolSpec): string[] {
    return [
      `// Generic implementation: echo inputs for now`,
      `const result: Record<string, unknown> = {};`,
      `for (const [key, value] of Object.entries(input as Record<string, unknown>)) {`,
      `  result[key] = value;`,
      `}`,
      `result._processed = true;`,
      `result._tool = '${tool.name}';`,
      `result._timestamp = Date.now();`,
      `return result as any;`,
    ];
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  /**
   * Basic TypeScript syntax validation.
   * Returns an array of warning messages (non-fatal).
   */
  private validateTypeScript(code: string): string[] {
    const warnings: string[] = [];

    // Check balanced braces
    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      const prev = i > 0 ? code[i - 1] : '';

      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      // Skip single-line comments
      if (ch === '/' && i + 1 < code.length && code[i + 1] === '/') {
        const nl = code.indexOf('\n', i);
        i = nl === -1 ? code.length : nl;
        continue;
      }

      // Skip block comments
      if (ch === '/' && i + 1 < code.length && code[i + 1] === '*') {
        const end = code.indexOf('*/', i + 2);
        i = end === -1 ? code.length : end + 1;
        continue;
      }

      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
    }

    if (braceDepth !== 0) warnings.push(`Unbalanced braces (depth: ${braceDepth})`);
    if (parenDepth !== 0) warnings.push(`Unbalanced parentheses (depth: ${parenDepth})`);
    if (bracketDepth !== 0) warnings.push(`Unbalanced brackets (depth: ${bracketDepth})`);

    // Check for common issues
    if (code.includes('require(') && !code.includes('import')) {
      warnings.push('Uses require() instead of ESM imports');
    }

    return warnings;
  }

  /**
   * Check for critical syntax errors that would prevent the file from
   * being parsed at all.
   */
  private checkCriticalSyntax(code: string): string[] {
    const errors: string[] = [];

    // Empty file
    if (code.trim().length === 0) {
      errors.push('Generated file is empty');
      return errors;
    }

    // Severely unbalanced braces (allows +-1 for template strings)
    let braceCount = 0;
    let inStr = false;
    let strCh = '';
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (inStr) {
        if (ch === strCh && code[i - 1] !== '\\') inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = true;
        strCh = ch;
        continue;
      }
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }

    if (Math.abs(braceCount) > 2) {
      errors.push(`Severely unbalanced braces (off by ${braceCount})`);
    }

    // Check for duplicate exports
    const exportNames = new Set<string>();
    const exportRegex = /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = exportRegex.exec(code)) !== null) {
      const name = match[1];
      if (exportNames.has(name)) {
        errors.push(`Duplicate export: ${name}`);
      }
      exportNames.add(name);
    }

    return errors;
  }

  // -----------------------------------------------------------------------
  // Utilities file generation
  // -----------------------------------------------------------------------

  private generateUtils(plan: SkillPlan): string {
    const lines: string[] = [
      `/**`,
      ` * ${plan.name} - Utility helpers`,
      ` *`,
      ` * Auto-generated by @alfred/forge`,
      ` */`,
      ``,
    ];

    // Add common utility functions based on dependencies
    if (plan.dependencies.some((d) => d.includes('fs'))) {
      lines.push(
        `import { stat } from 'node:fs/promises';`,
        ``,
        `export async function fileExists(path: string): Promise<boolean> {`,
        `  try {`,
        `    await stat(path);`,
        `    return true;`,
        `  } catch {`,
        `    return false;`,
        `  }`,
        `}`,
        ``,
      );
    }

    if (plan.dependencies.some((d) => d.includes('path'))) {
      lines.push(
        `import { resolve, extname } from 'node:path';`,
        ``,
        `export function safePath(base: string, relative: string): string {`,
        `  const resolved = resolve(base, relative);`,
        `  if (!resolved.startsWith(resolve(base))) {`,
        `    throw new Error('Path traversal detected');`,
        `  }`,
        `  return resolved;`,
        `}`,
        ``,
        `export function getExtension(filePath: string): string {`,
        `  return extname(filePath).toLowerCase();`,
        `}`,
        ``,
      );
    }

    if (plan.dependencies.some((d) => d.includes('crypto'))) {
      lines.push(
        `import { randomBytes, createHash } from 'node:crypto';`,
        ``,
        `export function generateId(length = 16): string {`,
        `  return randomBytes(length).toString('hex');`,
        `}`,
        ``,
        `export function hashString(data: string, algorithm = 'sha256'): string {`,
        `  return createHash(algorithm).update(data).digest('hex');`,
        `}`,
        ``,
      );
    }

    // Always include timing utility
    lines.push(
      `export function withTimeout<T>(`,
      `  promise: Promise<T>,`,
      `  timeoutMs: number,`,
      `  message = 'Operation timed out',`,
      `): Promise<T> {`,
      `  let timer: ReturnType<typeof setTimeout>;`,
      `  const timeoutPromise = new Promise<never>((_, reject) => {`,
      `    timer = setTimeout(() => reject(new Error(message)), timeoutMs);`,
      `  });`,
      `  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));`,
      `}`,
    );

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // package.json update
  // -----------------------------------------------------------------------

  private async updatePackageJson(pkgPath: string, plan: SkillPlan): Promise<void> {
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;

      // Add actual dependencies (external ones only, not node: built-ins)
      const externalDeps = plan.dependencies.filter((d) => !d.startsWith('node:'));
      if (externalDeps.length > 0) {
        const deps: Record<string, string> = {};
        for (const d of externalDeps) deps[d] = '*';
        pkg.dependencies = deps;
      }

      // Update alfred metadata
      const alfredMeta = (pkg.alfred ?? {}) as Record<string, unknown>;
      alfredMeta.tools = plan.tools.map((t) => t.name);
      alfredMeta.complexity = plan.estimatedComplexity;
      alfredMeta.builtAt = new Date().toISOString();
      pkg.alfred = alfredMeta;

      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    } catch {
      // Non-fatal: package.json update failure
      this.logger.warn({ pkgPath }, 'Could not update package.json');
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private toCamelCase(str: string): string {
    return str.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  }
}
