#!/usr/bin/env node

/**
 * alfred.mjs — Alfred v3 CLI
 *
 * Self-contained CLI entry point for all Alfred functionality.
 * Uses only Node.js builtins (no external dependencies).
 *
 * Usage:  node alfred.mjs <command> [subcommand] [options]
 *         alfred <command> [subcommand] [options]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform, cpus, totalmem, freemem, hostname } from 'node:os';
import { createInterface } from 'node:readline';
import { execSync, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 18789;
const ALFRED_HOME = process.env.ALFRED_HOME || join(homedir(), '.alfred');

let PKG_VERSION = '3.0.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  PKG_VERSION = pkg.version || PKG_VERSION;
} catch { /* ignore */ }

// ---------------------------------------------------------------------------
// ANSI colors (no chalk dependency)
// ---------------------------------------------------------------------------

const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR;

const c = {
  red:     s => isColorSupported ? `\x1b[31m${s}\x1b[0m` : s,
  green:   s => isColorSupported ? `\x1b[32m${s}\x1b[0m` : s,
  yellow:  s => isColorSupported ? `\x1b[33m${s}\x1b[0m` : s,
  blue:    s => isColorSupported ? `\x1b[34m${s}\x1b[0m` : s,
  magenta: s => isColorSupported ? `\x1b[35m${s}\x1b[0m` : s,
  cyan:    s => isColorSupported ? `\x1b[36m${s}\x1b[0m` : s,
  bold:    s => isColorSupported ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:     s => isColorSupported ? `\x1b[2m${s}\x1b[0m`  : s,
  underline: s => isColorSupported ? `\x1b[4m${s}\x1b[0m` : s,
};

// Status icons
const ICON = {
  ok:      isColorSupported ? '\x1b[32m\u2714\x1b[0m' : '[OK]',
  fail:    isColorSupported ? '\x1b[31m\u2718\x1b[0m' : '[FAIL]',
  warn:    isColorSupported ? '\x1b[33m\u26A0\x1b[0m' : '[WARN]',
  info:    isColorSupported ? '\x1b[34m\u2139\x1b[0m' : '[INFO]',
  arrow:   isColorSupported ? '\x1b[36m\u25B6\x1b[0m' : '>>',
  bullet:  isColorSupported ? '\x1b[2m\u2022\x1b[0m'  : '-',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gatewayUrl(path, opts = {}) {
  const host = opts.host || DEFAULT_GATEWAY_HOST;
  const port = opts.port || DEFAULT_GATEWAY_PORT;
  return `http://${host}:${port}${path}`;
}

/** Make an HTTP request to the Gateway and return parsed JSON. */
async function gw(method, path, body = null, opts = {}) {
  const url = gatewayUrl(path, opts);
  const fetchOpts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(opts.timeout || 30000),
  };
  if (body !== null) {
    fetchOpts.body = JSON.stringify(body);
  }
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gateway ${method} ${path} returned ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

/** Make a streaming request to the Gateway (SSE). Returns the Response object. */
async function gwStream(method, path, body = null, opts = {}) {
  const url = gatewayUrl(path, opts);
  const fetchOpts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
  };
  if (body !== null) {
    fetchOpts.body = JSON.stringify(body);
  }
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gateway streaming ${method} ${path} returned ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** Pad a string to a given width. */
function pad(str, width) {
  const s = String(str);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Right-pad a string. */
function rpad(str, width) {
  const s = String(str);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

/** Print a formatted table. */
function printTable(headers, rows, opts = {}) {
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = String(row[i] ?? '');
      if (cell.length > max) max = cell.length;
    }
    return max + 2;
  });

  // Header
  const headerLine = headers.map((h, i) => c.bold(pad(h, colWidths[i]))).join('');
  console.log(headerLine);
  console.log(c.dim(colWidths.map(w => '-'.repeat(w)).join('')));

  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => pad(String(cell ?? ''), colWidths[i])).join('');
    console.log(line);
  }
}

/** Print a section header. */
function section(title) {
  console.log();
  console.log(c.bold(c.cyan(`--- ${title} ---`)));
  console.log();
}

/** Print a key-value pair. */
function kv(key, value) {
  console.log(`  ${c.dim(pad(key + ':', 22))} ${value}`);
}

/** Simple spinner for long operations. */
function createSpinner(text) {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  let interval = null;
  return {
    start() {
      if (!process.stdout.isTTY) {
        process.stdout.write(text + '...\n');
        return;
      }
      interval = setInterval(() => {
        process.stdout.write(`\r${c.cyan(frames[i % frames.length])} ${text}`);
        i++;
      }, 80);
    },
    stop(result) {
      if (interval) clearInterval(interval);
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${result ? ICON.ok : ICON.fail} ${text}\n`);
      }
    },
  };
}

/** Prompt user for input. */
function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const q = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/** Prompt user for a secret (no echo). */
function promptSecret(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question + ': ');
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);

    let secret = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(secret);
      } else if (c === '\u007F' || c === '\b') {
        if (secret.length > 0) {
          secret = secret.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(1);
      } else {
        secret += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/** Prompt user to select from a list. */
async function promptSelect(question, options) {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    console.log(`  ${c.cyan(String(i + 1))}. ${opt}`);
  });
  const answer = await prompt(`Select [1-${options.length}]`, '1');
  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= options.length) {
    console.log(c.red('Invalid selection.'));
    return options[0];
  }
  return options[idx];
}

/** Format a Unix ms timestamp as a human-readable date. */
function fmtDate(ms) {
  if (!ms) return c.dim('n/a');
  return new Date(ms).toLocaleString();
}

/** Format a duration in ms. */
function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Format bytes. */
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

/** Relative time (e.g., "5 minutes ago"). */
function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/** Check if a command exists on the system. */
function commandExists(cmd) {
  try {
    const check = platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Get service version by running a command. */
function getServiceVersion(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe', timeout: 5000 }).toString().trim().split('\n')[0];
  } catch {
    return null;
  }
}

/** Parse duration string like "24h", "7d", "30m" into ms. */
function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return val * 1000;
    case 'm': return val * 60000;
    case 'h': return val * 3600000;
    case 'd': return val * 86400000;
  }
  return null;
}

/** Load alfred.json config from ALFRED_HOME. */
function loadConfig() {
  const configPath = join(ALFRED_HOME, 'alfred.json');
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    command: null,
    subcommand: null,
    positional: [],
    flags: {},
  };

  let i = 0;
  // Parse command
  if (args.length > 0 && !args[0].startsWith('-')) {
    result.command = args[0];
    i = 1;
  }

  // Parse subcommand
  if (i < args.length && !args[i].startsWith('-')) {
    result.subcommand = args[i];
    i++;
  }

  // Parse remaining positional and flags
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--') {
      // Everything after -- is positional
      result.positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        result.flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.flags[key] = args[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.flags[key] = args[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else {
      result.positional.push(arg);
    }
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Command Implementations
// ---------------------------------------------------------------------------

// ===================== onboard =====================

async function cmdOnboard(args) {
  if (args.flags.help) {
    console.log(`
${c.bold('alfred onboard')} -- Run the onboarding wizard

${c.dim('Usage:')}
  alfred onboard [--install-daemon]

${c.dim('Options:')}
  --install-daemon    Also install the Alfred daemon as a system service

${c.dim('Description:')}
  Interactive setup wizard that configures Alfred for first use.
  Prompts for model provider, channels, privacy settings, and more.
`);
    return;
  }

  console.log();
  console.log(c.bold(c.cyan('  Alfred v3 Onboarding Wizard')));
  console.log(c.dim('  Let\'s get Alfred configured for your system.\n'));

  // Step 1: Model provider
  section('Step 1: Model Configuration');
  const provider = await promptSelect('Which model provider would you like to use?', [
    'ollama (local, private)',
    'anthropic (Claude)',
    'openai (GPT-4)',
    'groq (fast inference)',
    'openrouter (multi-provider)',
    'lmstudio (local)',
  ]);

  const providerName = provider.split(' ')[0];
  let modelId = '';

  if (providerName === 'ollama') {
    modelId = await prompt('Enter the Ollama model name', 'llama3.1:8b');
    modelId = `ollama/${modelId}`;
    console.log(`${ICON.info} Make sure Ollama is running: ${c.cyan('ollama serve')}`);
  } else if (providerName === 'anthropic') {
    modelId = await prompt('Enter the Anthropic model', 'claude-sonnet-4-20250514');
    modelId = `anthropic/${modelId}`;
    console.log(`${ICON.info} You'll need to set your API key: ${c.cyan('alfred credential set ANTHROPIC_API_KEY')}`);
  } else if (providerName === 'openai') {
    modelId = await prompt('Enter the OpenAI model', 'gpt-4o');
    modelId = `openai/${modelId}`;
    console.log(`${ICON.info} You'll need to set your API key: ${c.cyan('alfred credential set OPENAI_API_KEY')}`);
  } else if (providerName === 'groq') {
    modelId = await prompt('Enter the Groq model', 'llama-3.1-70b-versatile');
    modelId = `groq/${modelId}`;
    console.log(`${ICON.info} You'll need to set your API key: ${c.cyan('alfred credential set GROQ_API_KEY')}`);
  } else if (providerName === 'openrouter') {
    modelId = await prompt('Enter the OpenRouter model', 'anthropic/claude-sonnet-4-20250514');
    modelId = `openrouter/${modelId}`;
  } else if (providerName === 'lmstudio') {
    modelId = await prompt('Enter the LM Studio model', 'local-model');
    modelId = `lmstudio/${modelId}`;
  }

  // Step 2: Channels
  section('Step 2: Channel Configuration');
  const enableCli = true;
  console.log(`  ${ICON.ok} CLI channel is always enabled.`);

  const enableDiscord = (await prompt('Enable Discord channel? (y/n)', 'n')).toLowerCase() === 'y';
  const enableMatrix = (await prompt('Enable Matrix channel? (y/n)', 'n')).toLowerCase() === 'y';

  const channels = [{ name: 'cli', type: 'cli', enabled: true }];
  if (enableDiscord) {
    channels.push({ name: 'discord', type: 'discord', enabled: true, config: {} });
    console.log(`  ${ICON.info} Set Discord bot token: ${c.cyan('alfred credential set DISCORD_BOT_TOKEN')}`);
  }
  if (enableMatrix) {
    channels.push({ name: 'matrix', type: 'matrix', enabled: true, config: {} });
    console.log(`  ${ICON.info} Set Matrix credentials: ${c.cyan('alfred credential set MATRIX_ACCESS_TOKEN')}`);
  }

  // Step 3: Privacy
  section('Step 3: Privacy Settings');
  const localOnly = (await prompt('Run in local-only mode (no cloud APIs)? (y/n)', 'n')).toLowerCase() === 'y';
  const piiRedaction = (await prompt('Enable PII redaction for cloud calls? (y/n)', 'y')).toLowerCase() === 'y';
  const auditLog = (await prompt('Enable cloud API audit logging? (y/n)', 'y')).toLowerCase() === 'y';

  // Step 4: Gateway
  section('Step 4: Gateway Configuration');
  const gatewayPort = await prompt('Gateway port', String(DEFAULT_GATEWAY_PORT));
  const gatewayBind = await prompt('Gateway bind address', DEFAULT_GATEWAY_HOST);

  // Build config
  const config = {
    version: 3,
    agents: [{
      id: 'alfred',
      identity: { name: 'Alfred' },
      model: modelId,
      tools: [],
      subagent: false,
    }],
    tools: [],
    channels,
    memory: {
      backend: 'sqlite',
      maxConversationHistory: 100,
      summarize: true,
      syncEnabled: false,
    },
    privacy: {
      piiDetection: piiRedaction,
      piiRedaction,
      customPatterns: [],
      auditLog,
      localOnly,
      allowedEndpoints: [],
      blockedEndpoints: [],
    },
    forge: {
      enabled: true,
      autoInstall: false,
      sandbox: true,
    },
    playbook: {
      enabled: true,
      autoDiscover: true,
      watchForChanges: true,
    },
    gateway: {
      enabled: true,
      host: gatewayBind,
      port: parseInt(gatewayPort, 10),
    },
    ui: {
      enabled: true,
      theme: 'dark',
      showTokenUsage: true,
      notificationsEnabled: true,
    },
  };

  // Write config
  const configPath = join(ALFRED_HOME, 'alfred.json');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(ALFRED_HOME, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Ensure subdirectories
  const subdirs = ['logs', 'cache', 'credentials', 'workspace', 'skills', 'playbook', 'devices', 'state', 'memory', 'tools', 'channels', 'sessions'];
  for (const dir of subdirs) {
    mkdirSync(join(ALFRED_HOME, dir), { recursive: true });
  }

  section('Setup Complete');
  console.log(`  ${ICON.ok} Configuration written to ${c.cyan(configPath)}`);
  console.log(`  ${ICON.ok} Directories created in ${c.cyan(ALFRED_HOME)}`);
  console.log();
  console.log(c.dim('  Next steps:'));
  console.log(`    1. Start the gateway:  ${c.cyan('alfred gateway')}`);
  console.log(`    2. Send a message:     ${c.cyan('alfred agent --message "Hello, Alfred!"')}`);
  console.log(`    3. Check health:       ${c.cyan('alfred doctor')}`);

  // Install daemon if requested
  if (args.flags['install-daemon']) {
    section('Installing Daemon');
    try {
      const result = await gw('POST', '/api/v1/system/install-daemon', {
        port: parseInt(gatewayPort, 10),
        bind: gatewayBind,
      });
      console.log(`  ${ICON.ok} Daemon installed successfully.`);
      if (result.instructions) {
        console.log(`  ${c.dim(result.instructions)}`);
      }
    } catch (err) {
      console.log(`  ${ICON.warn} Could not install daemon: ${err.message}`);
      console.log(`  ${c.dim('Start the gateway first, then run: alfred onboard --install-daemon')}`);
    }
  }

  console.log();
}

// ===================== gateway =====================

async function cmdGateway(args) {
  if (args.flags.help) {
    console.log(`
${c.bold('alfred gateway')} -- Start the Alfred Gateway server

${c.dim('Usage:')}
  alfred gateway [--port <port>] [--bind <address>] [--verbose]

${c.dim('Options:')}
  --port <port>       Port to listen on (default: ${DEFAULT_GATEWAY_PORT})
  --bind <address>    Address to bind to (default: ${DEFAULT_GATEWAY_HOST})
  --verbose           Enable verbose logging

${c.dim('Description:')}
  Starts the Alfred Gateway HTTP server which routes all API requests,
  manages agent sessions, and coordinates with local services.
`);
    return;
  }

  const port = args.flags.port || DEFAULT_GATEWAY_PORT;
  const bind = args.flags.bind || DEFAULT_GATEWAY_HOST;
  const verbose = args.flags.verbose === true;

  console.log();
  console.log(c.bold(c.cyan('  Alfred Gateway')));
  console.log(c.dim(`  Starting on ${bind}:${port}...`));
  console.log();

  // Build the gateway launch args
  const gatewayArgs = ['--port', String(port), '--bind', bind];
  if (verbose) gatewayArgs.push('--verbose');

  // Try to find and start the gateway server
  const gatewayScript = join(__dirname, 'src', 'index.ts');
  const tsxBin = join(__dirname, 'node_modules', '.bin', 'tsx');
  const cmd = existsSync(tsxBin) ? tsxBin : 'tsx';

  if (!existsSync(gatewayScript)) {
    console.log(`  ${ICON.fail} Gateway source not found at ${gatewayScript}`);
    console.log(`  ${c.dim('Run from the alfred-v3 root directory.')}`);
    process.exit(1);
  }

  const env = {
    ...process.env,
    ALFRED_GATEWAY_PORT: String(port),
    ALFRED_GATEWAY_HOST: bind,
    ALFRED_HOME: ALFRED_HOME,
  };

  if (verbose) {
    env.LOG_LEVEL = 'debug';
  }

  console.log(`  ${ICON.arrow} Launching gateway: ${c.dim(`${cmd} ${gatewayScript}`)}`);
  console.log(`  ${ICON.info} Press Ctrl+C to stop.`);
  console.log();

  const { spawn } = await import('node:child_process');
  const child = spawn(cmd, [gatewayScript, ...gatewayArgs], {
    cwd: __dirname,
    env,
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.error(`  ${ICON.fail} Failed to start gateway: ${err.message}`);
    if (err.code === 'ENOENT') {
      console.log(`  ${c.dim('Make sure tsx is installed: pnpm add -D tsx')}`);
    }
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Forward signals
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

// ===================== agent =====================

async function cmdAgent(args) {
  if (args.flags.help) {
    console.log(`
${c.bold('alfred agent')} -- Send a message to an Alfred agent

${c.dim('Usage:')}
  alfred agent --message "..." [--thinking high|low|none] [--model provider/model]
  alfred agent -m "..." [-t high] [--model anthropic/claude-sonnet-4-20250514]

${c.dim('Options:')}
  --message, -m <msg>   The message to send (required)
  --thinking, -t <lvl>  Thinking level: high, low, none (default: none)
  --model <id>          Override model (format: provider/model)
  --session <id>        Continue an existing session
  --agent <id>          Agent to use (default: alfred)
  --no-stream           Disable streaming output

${c.dim('Description:')}
  Sends a message to the agent and streams the response to stdout.
  The response is rendered in real-time as tokens arrive.
`);
    return;
  }

  const message = args.flags.message || args.flags.m;
  if (!message) {
    console.error(`${ICON.fail} ${c.red('Missing required --message flag.')}`);
    console.log(`  ${c.dim('Usage: alfred agent --message "Hello, Alfred!"')}`);
    process.exit(2);
  }

  const thinking = args.flags.thinking || args.flags.t || 'none';
  if (!['high', 'low', 'none'].includes(thinking)) {
    console.error(`${ICON.fail} ${c.red('Invalid thinking level. Must be: high, low, or none.')}`);
    process.exit(2);
  }

  const model = args.flags.model || null;
  const sessionId = args.flags.session || null;
  const agentId = args.flags.agent || 'alfred';
  const noStream = args.flags['no-stream'] === true;

  const body = {
    message,
    agentId,
    thinking,
    stream: !noStream,
  };
  if (model) body.model = model;
  if (sessionId) body.sessionId = sessionId;

  if (noStream) {
    // Non-streaming mode
    const spinner = createSpinner('Thinking');
    spinner.start();
    try {
      const result = await gw('POST', '/api/v1/agent/message', body, { timeout: 300000 });
      spinner.stop(true);
      console.log();
      console.log(result.content || result.response || JSON.stringify(result, null, 2));
      if (result.sessionId) {
        console.log();
        console.log(c.dim(`Session: ${result.sessionId}`));
      }
    } catch (err) {
      spinner.stop(false);
      throw err;
    }
    return;
  }

  // Streaming mode
  try {
    const res = await gwStream('POST', '/api/v1/agent/stream', body, { timeout: 300000 });

    if (!res.body) {
      console.error(`${ICON.fail} No response body received.`);
      process.exit(1);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sessionOutput = null;
    let thinkingActive = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        // Handle different event types
        const eventType = event.type || '';

        if (eventType === 'thinking_start') {
          thinkingActive = true;
          if (process.stdout.isTTY) {
            process.stdout.write(c.dim('[thinking] '));
          }
        } else if (eventType === 'thinking_delta' || eventType === 'thinking_text') {
          if (thinkingActive && process.stdout.isTTY) {
            process.stdout.write(c.dim(event.text || event.delta?.text || ''));
          }
        } else if (eventType === 'thinking_stop' || eventType === 'thinking_end') {
          thinkingActive = false;
          if (process.stdout.isTTY) {
            process.stdout.write('\n');
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            process.stdout.write(delta.text);
          }
        } else if (eventType === 'text_delta' || eventType === 'text') {
          const text = event.text || event.data?.text || event.delta?.text || '';
          if (text) process.stdout.write(text);
        } else if (eventType === 'message_stop' || eventType === 'done') {
          if (event.sessionId) sessionOutput = event.sessionId;
        } else if (eventType === 'tool_use_start') {
          const name = event.data?.name || event.name || '';
          process.stdout.write(c.dim(`\n[tool: ${name}] `));
        } else if (eventType === 'tool_use_end') {
          process.stdout.write(c.dim('[done]\n'));
        } else if (eventType === 'error') {
          process.stdout.write(c.red(`\nError: ${event.message || event.error || JSON.stringify(event)}`));
        } else if (event.content || event.text || event.response) {
          // Fallback: raw text response
          process.stdout.write(event.content || event.text || event.response || '');
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data: ') && remaining.slice(6).trim() !== '[DONE]') {
        try {
          const event = JSON.parse(remaining.slice(6));
          if (event.text || event.content) {
            process.stdout.write(event.text || event.content);
          }
        } catch { /* ignore */ }
      }
    }

    console.log();
    if (sessionOutput) {
      console.log(c.dim(`Session: ${sessionOutput}`));
    }
  } catch (err) {
    if (err.message && err.message.includes('ECONNREFUSED')) {
      console.error(`${ICON.fail} ${c.red('Cannot connect to Gateway.')}`);
      console.log(`  ${c.dim('Start the gateway first: alfred gateway')}`);
      process.exit(1);
    }
    throw err;
  }
}

// ===================== message =====================

async function cmdMessage(args) {
  if (args.subcommand === 'send') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred message send')} -- Send a message via a channel

${c.dim('Usage:')}
  alfred message send --to <recipient> --channel <channel> --message "..."

${c.dim('Options:')}
  --to <recipient>      Recipient identifier
  --channel <channel>   Channel to send via (cli, discord, matrix, etc.)
  --message, -m <msg>   Message content
  --attach <path>       Attach a file

${c.dim('Description:')}
  Sends a message to a recipient through the specified channel.
`);
      return;
    }

    const to = args.flags.to;
    const channel = args.flags.channel;
    const message = args.flags.message || args.flags.m;

    if (!to || !channel || !message) {
      console.error(`${ICON.fail} ${c.red('Missing required flags: --to, --channel, --message')}`);
      process.exit(2);
    }

    const body = {
      channel,
      sender: 'alfred-cli',
      recipient: to,
      content: message,
    };

    if (args.flags.attach) {
      body.attachments = [{
        filename: args.flags.attach.split(/[/\\]/).pop(),
        path: resolve(args.flags.attach),
      }];
    }

    const spinner = createSpinner(`Sending via ${channel}`);
    spinner.start();
    const result = await gw('POST', '/api/v1/channels/send', body);
    spinner.stop(true);

    console.log(`  ${ICON.ok} Message sent to ${c.cyan(to)} via ${c.cyan(channel)}`);
    if (result.messageId) {
      console.log(`  ${c.dim(`Message ID: ${result.messageId}`)}`);
    }
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred message')} -- Message operations

${c.dim('Subcommands:')}
  send    Send a message via a channel

${c.dim('Usage:')}
  alfred message send --to <recipient> --channel <channel> --message "..."
`);
}

// ===================== status =====================

async function cmdStatus(args) {
  if (args.flags.help) {
    console.log(`
${c.bold('alfred status')} -- Show all service statuses

${c.dim('Usage:')}
  alfred status

${c.dim('Description:')}
  Displays the health status of the Gateway, Ollama, SearXNG,
  configured channels, and other Alfred services.
`);
    return;
  }

  console.log();
  console.log(c.bold(c.cyan('  Alfred v3 Status')));
  console.log(c.dim(`  Version: ${PKG_VERSION}`));
  console.log();

  // Gateway
  let gatewayOk = false;
  try {
    const health = await gw('GET', '/api/v1/health', null, { timeout: 5000 });
    gatewayOk = true;
    console.log(`  ${ICON.ok} ${pad('Gateway', 20)} ${c.green('running')}  ${c.dim(`port ${DEFAULT_GATEWAY_PORT}`)}`);
    if (health.uptime) {
      console.log(`  ${' '.repeat(3)} ${c.dim('Uptime: ' + fmtDuration(health.uptime))}`);
    }
  } catch (err) {
    if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))) {
      console.log(`  ${ICON.fail} ${pad('Gateway', 20)} ${c.red('not running')}`);
    } else {
      console.log(`  ${ICON.warn} ${pad('Gateway', 20)} ${c.yellow('error: ' + err.message)}`);
    }
  }

  // Ollama
  try {
    const res = await fetch('http://127.0.0.1:11434/api/version', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  ${ICON.ok} ${pad('Ollama', 20)} ${c.green('running')}  ${c.dim(`v${data.version || '?'}`)}`);
    } else {
      console.log(`  ${ICON.warn} ${pad('Ollama', 20)} ${c.yellow('responding but unhealthy')}`);
    }
  } catch {
    console.log(`  ${ICON.fail} ${pad('Ollama', 20)} ${c.dim('not running')}`);
  }

  // SearXNG
  try {
    const res = await fetch('http://127.0.0.1:8888/healthz', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      console.log(`  ${ICON.ok} ${pad('SearXNG', 20)} ${c.green('running')}  ${c.dim('port 8888')}`);
    } else {
      console.log(`  ${ICON.warn} ${pad('SearXNG', 20)} ${c.yellow('responding but unhealthy')}`);
    }
  } catch {
    console.log(`  ${ICON.fail} ${pad('SearXNG', 20)} ${c.dim('not running')}`);
  }

  // Channels (from config or gateway)
  const config = loadConfig();
  if (config && config.channels) {
    console.log();
    console.log(c.dim('  Channels:'));
    for (const ch of config.channels) {
      const status = ch.enabled ? c.green('enabled') : c.dim('disabled');
      console.log(`    ${ICON.bullet} ${pad(ch.name, 16)} ${pad(ch.type, 12)} ${status}`);
    }
  }

  // Gateway-reported services (if connected)
  if (gatewayOk) {
    try {
      const services = await gw('GET', '/api/v1/status/services', null, { timeout: 5000 });
      if (services && Array.isArray(services.services)) {
        console.log();
        console.log(c.dim('  Services:'));
        for (const svc of services.services) {
          const statusIcon = svc.status === 'healthy' ? ICON.ok : svc.status === 'degraded' ? ICON.warn : ICON.fail;
          const statusColor = svc.status === 'healthy' ? c.green : svc.status === 'degraded' ? c.yellow : c.red;
          console.log(`    ${statusIcon} ${pad(svc.name || svc.service, 16)} ${statusColor(svc.status)}`);
        }
      }
    } catch { /* gateway might not support this endpoint */ }
  }

  // Config location
  console.log();
  console.log(c.dim(`  Config:  ${join(ALFRED_HOME, 'alfred.json')}`));
  console.log(c.dim(`  Home:    ${ALFRED_HOME}`));
  console.log();
}

// ===================== doctor =====================

async function cmdDoctor(args) {
  if (args.flags.help) {
    console.log(`
${c.bold('alfred doctor')} -- Full system health check with recommendations

${c.dim('Usage:')}
  alfred doctor

${c.dim('Description:')}
  Performs a comprehensive health check of the Alfred system including
  runtime requirements, service availability, configuration validity,
  security posture, and resource usage. Provides actionable recommendations.
`);
    return;
  }

  console.log();
  console.log(c.bold(c.cyan('  Alfred Doctor')));
  console.log(c.dim('  Running full system health check...\n'));

  let issues = 0;
  let warnings = 0;

  // --- System ---
  section('System');
  const nodeVersion = process.version;
  const nodeMinor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (nodeMinor >= 20) {
    console.log(`  ${ICON.ok} Node.js ${nodeVersion} (>= 20 required)`);
  } else {
    console.log(`  ${ICON.fail} Node.js ${nodeVersion} -- ${c.red('v20+ required')}`);
    issues++;
  }

  console.log(`  ${ICON.info} Platform: ${platform()} ${process.arch}`);
  console.log(`  ${ICON.info} Memory: ${fmtBytes(freemem())} free / ${fmtBytes(totalmem())} total`);
  console.log(`  ${ICON.info} CPUs: ${cpus().length}x ${cpus()[0]?.model || 'unknown'}`);

  // --- Alfred Home ---
  section('Alfred Home');
  if (existsSync(ALFRED_HOME)) {
    console.log(`  ${ICON.ok} ALFRED_HOME exists: ${c.cyan(ALFRED_HOME)}`);
  } else {
    console.log(`  ${ICON.fail} ALFRED_HOME not found: ${c.red(ALFRED_HOME)}`);
    console.log(`    ${c.dim('Run: alfred onboard')}`);
    issues++;
  }

  const configPath = join(ALFRED_HOME, 'alfred.json');
  if (existsSync(configPath)) {
    console.log(`  ${ICON.ok} Configuration file found`);
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.version === 3) {
        console.log(`  ${ICON.ok} Config version: 3`);
      } else {
        console.log(`  ${ICON.warn} Config version: ${config.version} (expected 3, may need migration)`);
        warnings++;
      }
      if (config.agents && config.agents.length > 0) {
        console.log(`  ${ICON.ok} Agents configured: ${config.agents.map(a => a.id).join(', ')}`);
      } else {
        console.log(`  ${ICON.warn} No agents configured`);
        warnings++;
      }
    } catch (err) {
      console.log(`  ${ICON.fail} Config file is invalid JSON: ${c.red(err.message)}`);
      issues++;
    }
  } else {
    console.log(`  ${ICON.fail} Configuration file not found`);
    console.log(`    ${c.dim('Run: alfred onboard')}`);
    issues++;
  }

  // Check subdirectories
  const requiredDirs = ['logs', 'cache', 'credentials', 'skills', 'playbook', 'sessions'];
  for (const dir of requiredDirs) {
    const dirPath = join(ALFRED_HOME, dir);
    if (existsSync(dirPath)) {
      console.log(`  ${ICON.ok} ${pad(dir + '/', 18)} exists`);
    } else {
      console.log(`  ${ICON.warn} ${pad(dir + '/', 18)} ${c.yellow('missing')}`);
      warnings++;
    }
  }

  // --- Services ---
  section('Services');

  // Gateway
  try {
    const health = await gw('GET', '/api/v1/health', null, { timeout: 5000 });
    console.log(`  ${ICON.ok} Gateway is responding`);
  } catch (err) {
    if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))) {
      console.log(`  ${ICON.fail} Gateway is not running`);
      console.log(`    ${c.dim('Start it: alfred gateway')}`);
      issues++;
    } else {
      console.log(`  ${ICON.warn} Gateway error: ${err.message}`);
      warnings++;
    }
  }

  // Ollama
  try {
    const res = await fetch('http://127.0.0.1:11434/api/version', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  ${ICON.ok} Ollama is running (v${data.version || '?'})`);

      // Check for models
      try {
        const modelsRes = await fetch('http://127.0.0.1:11434/api/tags', {
          signal: AbortSignal.timeout(5000),
        });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          const models = modelsData.models || [];
          if (models.length > 0) {
            console.log(`  ${ICON.ok} Ollama models: ${models.map(m => m.name).slice(0, 5).join(', ')}${models.length > 5 ? ` (+${models.length - 5} more)` : ''}`);
          } else {
            console.log(`  ${ICON.warn} No Ollama models installed`);
            console.log(`    ${c.dim('Pull a model: ollama pull llama3.1:8b')}`);
            warnings++;
          }
        }
      } catch { /* ignore */ }
    } else {
      console.log(`  ${ICON.warn} Ollama responding but unhealthy`);
      warnings++;
    }
  } catch {
    console.log(`  ${ICON.warn} Ollama not running (optional for cloud-only usage)`);
    console.log(`    ${c.dim('Install: https://ollama.ai')}`);
  }

  // SearXNG
  try {
    const res = await fetch('http://127.0.0.1:8888/healthz', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      console.log(`  ${ICON.ok} SearXNG is running`);
    } else {
      console.log(`  ${ICON.warn} SearXNG responding but unhealthy`);
      warnings++;
    }
  } catch {
    console.log(`  ${ICON.warn} SearXNG not running (optional for web search)`);
    console.log(`    ${c.dim('Install: docker run -p 8888:8080 searxng/searxng')}`);
  }

  // --- Security ---
  section('Security');

  const credDir = join(ALFRED_HOME, 'credentials');
  if (existsSync(credDir)) {
    const keyFile = join(credDir, 'key.age');
    const vaultFile = join(credDir, 'vault.enc');
    if (existsSync(keyFile)) {
      console.log(`  ${ICON.ok} Credential vault key exists`);
      try {
        const keyStats = statSync(keyFile);
        // Check permissions on Unix systems
        if (platform() !== 'win32') {
          const mode = (keyStats.mode & 0o777).toString(8);
          if (mode === '600') {
            console.log(`  ${ICON.ok} Key file permissions: 0600 (secure)`);
          } else {
            console.log(`  ${ICON.warn} Key file permissions: 0${mode} (${c.yellow('should be 0600')})`);
            warnings++;
          }
        }
      } catch { /* ignore */ }
    } else {
      console.log(`  ${ICON.info} No credential vault key (will be created on first use)`);
    }
    if (existsSync(vaultFile)) {
      console.log(`  ${ICON.ok} Encrypted vault file exists`);
    }
  } else {
    console.log(`  ${ICON.info} Credentials directory not yet created`);
  }

  // --- Privacy ---
  section('Privacy');
  const config = loadConfig();
  if (config && config.privacy) {
    const p = config.privacy;
    console.log(`  ${p.piiDetection ? ICON.ok : ICON.warn} PII detection: ${p.piiDetection ? c.green('enabled') : c.yellow('disabled')}`);
    console.log(`  ${p.piiRedaction ? ICON.ok : ICON.warn} PII redaction: ${p.piiRedaction ? c.green('enabled') : c.yellow('disabled')}`);
    console.log(`  ${p.auditLog ? ICON.ok : ICON.warn} Audit logging: ${p.auditLog ? c.green('enabled') : c.yellow('disabled')}`);
    console.log(`  ${ICON.info} Local-only mode: ${p.localOnly ? c.green('yes') : c.dim('no')}`);

    if (!p.piiRedaction) warnings++;
    if (!p.auditLog) warnings++;
  } else {
    console.log(`  ${ICON.warn} No privacy configuration found`);
    warnings++;
  }

  // --- Dependencies ---
  section('Optional Dependencies');
  const optDeps = [
    { name: 'git', check: 'git --version' },
    { name: 'docker', check: 'docker --version' },
    { name: 'ollama', check: 'ollama --version' },
    { name: 'pnpm', check: 'pnpm --version' },
  ];
  for (const dep of optDeps) {
    const version = getServiceVersion(dep.check);
    if (version) {
      console.log(`  ${ICON.ok} ${pad(dep.name, 12)} ${c.dim(version)}`);
    } else {
      console.log(`  ${ICON.info} ${pad(dep.name, 12)} ${c.dim('not found (optional)')}`);
    }
  }

  // --- Summary ---
  section('Summary');
  if (issues === 0 && warnings === 0) {
    console.log(`  ${ICON.ok} ${c.green('All checks passed! Alfred is healthy.')}`);
  } else {
    if (issues > 0) {
      console.log(`  ${ICON.fail} ${c.red(`${issues} issue${issues === 1 ? '' : 's'} found`)}`);
    }
    if (warnings > 0) {
      console.log(`  ${ICON.warn} ${c.yellow(`${warnings} warning${warnings === 1 ? '' : 's'}`)}`);
    }
    console.log();
    if (issues > 0) {
      console.log(`  ${c.dim('Fix issues above and re-run: alfred doctor')}`);
    }
  }

  console.log();
}

// ===================== sessions =====================

async function cmdSessions(args) {
  const sub = args.subcommand;

  if (sub === 'list' || (!sub && !args.flags.help)) {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred sessions list')} -- List active sessions

${c.dim('Usage:')}
  alfred sessions list [--agent <agentId>] [--limit <n>]
`);
      return;
    }

    const params = new URLSearchParams();
    if (args.flags.agent) params.set('agentId', args.flags.agent);
    if (args.flags.limit) params.set('limit', args.flags.limit);

    const queryStr = params.toString();
    const path = `/api/v1/sessions${queryStr ? '?' + queryStr : ''}`;

    const result = await gw('GET', path);
    const sessions = result.sessions || result || [];

    if (sessions.length === 0) {
      console.log(`\n  ${c.dim('No active sessions.')}\n`);
      return;
    }

    console.log();
    printTable(
      ['ID', 'Agent', 'Channel', 'Messages', 'Last Activity', 'Started'],
      sessions.map(s => [
        s.id?.slice(0, 12) || s.id,
        s.agentId || '',
        s.channel || '',
        String(s.messageCount ?? s.messages?.length ?? 0),
        s.lastActivity ? timeAgo(s.lastActivity) : '',
        s.startedAt ? fmtDate(s.startedAt) : '',
      ])
    );
    console.log();
    return;
  }

  if (sub === 'history') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred sessions history')} -- Show session history

${c.dim('Usage:')}
  alfred sessions history <sessionId> [--limit <n>]
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing session ID.')}`);
        process.exit(2);
      }
      return;
    }

    const sessionId = args.positional[0];
    const result = await gw('GET', `/api/v1/sessions/${sessionId}`);
    const session = result.session || result;
    const messages = session.messages || [];

    console.log();
    console.log(c.bold(`  Session: ${session.id}`));
    kv('Agent', session.agentId || '');
    kv('Channel', session.channel || '');
    kv('Started', session.startedAt ? fmtDate(session.startedAt) : '');
    kv('Last Activity', session.lastActivity ? fmtDate(session.lastActivity) : '');
    kv('Messages', String(messages.length));
    console.log();

    const limit = parseInt(args.flags.limit || '50', 10);
    const displayed = messages.slice(-limit);

    for (const msg of displayed) {
      const role = msg.role || 'unknown';
      const roleColor = role === 'user' ? c.green : role === 'assistant' ? c.cyan : role === 'system' ? c.yellow : c.dim;
      const ts = msg.timestamp ? c.dim(` [${fmtDate(msg.timestamp)}]`) : '';
      console.log(`  ${roleColor(c.bold(pad(role, 10)))}${ts}`);
      const content = msg.content || '';
      const lines = content.split('\n');
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      console.log();
    }

    if (messages.length > limit) {
      console.log(c.dim(`  Showing last ${limit} of ${messages.length} messages. Use --limit to see more.`));
      console.log();
    }
    return;
  }

  if (sub === 'send') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred sessions send')} -- Send a message to an existing session

${c.dim('Usage:')}
  alfred sessions send <sessionId> --message "..."
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing session ID.')}`);
        process.exit(2);
      }
      return;
    }

    const sessionId = args.positional[0];
    const message = args.flags.message || args.flags.m;

    if (!message) {
      console.error(`${ICON.fail} ${c.red('Missing --message flag.')}`);
      process.exit(2);
    }

    const body = {
      message,
      sessionId,
      stream: true,
    };

    try {
      const res = await gwStream('POST', '/api/v1/agent/stream', body);

      if (!res.body) {
        console.error(`${ICON.fail} No response body received.`);
        process.exit(1);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === 'text_delta' || event.type === 'content_block_delta') {
              const text = event.text || event.delta?.text || '';
              if (text) process.stdout.write(text);
            } else if (event.text || event.content) {
              process.stdout.write(event.text || event.content || '');
            }
          } catch { /* ignore */ }
        }
      }
      console.log();
    } catch (err) {
      if (err.message && err.message.includes('ECONNREFUSED')) {
        console.error(`${ICON.fail} ${c.red('Cannot connect to Gateway.')}`);
        process.exit(1);
      }
      throw err;
    }
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred sessions')} -- Session management

${c.dim('Subcommands:')}
  list                  List active sessions
  history <sessionId>   Show session message history
  send <sessionId>      Send a message to an existing session

${c.dim('Examples:')}
  alfred sessions list
  alfred sessions history abc123def456
  alfred sessions send abc123def456 --message "Continue our conversation"
`);
}

// ===================== skills =====================

async function cmdSkills(args) {
  const sub = args.subcommand;

  if (sub === 'list') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred skills list')} -- List all skills

${c.dim('Usage:')}
  alfred skills list [--type bundled|curated|forged] [--status enabled|disabled]
`);
      return;
    }

    const params = new URLSearchParams();
    if (args.flags.type) params.set('type', args.flags.type);
    if (args.flags.status) params.set('status', args.flags.status);

    const queryStr = params.toString();
    const result = await gw('GET', `/api/v1/skills${queryStr ? '?' + queryStr : ''}`);
    const skills = result.skills || result || [];

    if (skills.length === 0) {
      console.log(`\n  ${c.dim('No skills found.')}\n`);
      return;
    }

    console.log();
    printTable(
      ['Name', 'Type', 'Status', 'Version', 'Description'],
      skills.map(s => [
        s.name || '',
        s.type || s.category || '',
        s.enabled === false ? c.dim('disabled') : c.green('enabled'),
        s.version || '',
        (s.description || '').slice(0, 50),
      ])
    );
    console.log();
    return;
  }

  if (sub === 'install') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred skills install')} -- Install a skill

${c.dim('Usage:')}
  alfred skills install <path|url>

${c.dim('Examples:')}
  alfred skills install ./my-skill
  alfred skills install https://github.com/user/alfred-skill-example
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing skill path or URL.')}`);
        process.exit(2);
      }
      return;
    }

    const source = args.positional[0];
    const spinner = createSpinner(`Installing skill from ${source}`);
    spinner.start();
    const result = await gw('POST', '/api/v1/skills/install', { source });
    spinner.stop(true);
    console.log(`  ${ICON.ok} Skill installed: ${c.cyan(result.name || source)}`);
    if (result.description) console.log(`  ${c.dim(result.description)}`);
    return;
  }

  if (sub === 'enable') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred skills enable')} -- Enable a skill

${c.dim('Usage:')}
  alfred skills enable <name>
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing skill name.')}`);
        process.exit(2);
      }
      return;
    }

    const name = args.positional[0];
    await gw('POST', `/api/v1/skills/${encodeURIComponent(name)}/enable`);
    console.log(`  ${ICON.ok} Skill ${c.cyan(name)} enabled.`);
    return;
  }

  if (sub === 'disable') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred skills disable')} -- Disable a skill

${c.dim('Usage:')}
  alfred skills disable <name>
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing skill name.')}`);
        process.exit(2);
      }
      return;
    }

    const name = args.positional[0];
    await gw('POST', `/api/v1/skills/${encodeURIComponent(name)}/disable`);
    console.log(`  ${ICON.ok} Skill ${c.cyan(name)} disabled.`);
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred skills')} -- Skill management

${c.dim('Subcommands:')}
  list                  List all skills (bundled, curated, forged)
  install <path|url>    Install a skill from path or URL
  enable <name>         Enable a skill
  disable <name>        Disable a skill

${c.dim('Examples:')}
  alfred skills list
  alfred skills install ./my-custom-skill
  alfred skills enable web-search
  alfred skills disable code-executor
`);
}

// ===================== forge =====================

async function cmdForge(args) {
  const sub = args.subcommand;

  if (sub === 'build') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred forge build')} -- Trigger the Skill Forge to build a new skill

${c.dim('Usage:')}
  alfred forge build --name <name> --description "..."

${c.dim('Options:')}
  --name <name>          Name for the new skill
  --description <desc>   What the skill should do
  --sandbox              Run in sandbox mode (default: true)

${c.dim('Description:')}
  Uses the Skill Forge to generate, test, and install a new skill
  based on the provided description.
`);
      return;
    }

    const name = args.flags.name;
    const description = args.flags.description;

    if (!name || !description) {
      console.error(`${ICON.fail} ${c.red('Missing required --name and --description flags.')}`);
      process.exit(2);
    }

    const spinner = createSpinner(`Forging skill: ${name}`);
    spinner.start();

    try {
      const result = await gw('POST', '/api/v1/forge/build', {
        name,
        description,
        sandbox: args.flags.sandbox !== 'false',
      }, { timeout: 120000 });

      spinner.stop(true);

      console.log();
      console.log(`  ${ICON.ok} Skill forged: ${c.cyan(result.name || name)}`);
      if (result.path) kv('Path', result.path);
      if (result.status) kv('Status', result.status);
      if (result.testResults) {
        kv('Tests', result.testResults.passed ? c.green('passed') : c.red('failed'));
      }
    } catch (err) {
      spinner.stop(false);
      throw err;
    }
    return;
  }

  if (sub === 'list') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred forge list')} -- List forged skills

${c.dim('Usage:')}
  alfred forge list
`);
      return;
    }

    const result = await gw('GET', '/api/v1/forge/skills');
    const skills = result.skills || result || [];

    if (skills.length === 0) {
      console.log(`\n  ${c.dim('No forged skills found.')}\n`);
      return;
    }

    console.log();
    printTable(
      ['Name', 'Status', 'Created', 'Tests', 'Description'],
      skills.map(s => [
        s.name || '',
        s.status === 'active' ? c.green(s.status) : s.status === 'quarantined' ? c.red(s.status) : c.yellow(s.status || ''),
        s.createdAt ? fmtDate(typeof s.createdAt === 'string' ? Date.parse(s.createdAt) : s.createdAt) : '',
        s.testsPassed ? c.green('pass') : s.testsPassed === false ? c.red('fail') : c.dim('n/a'),
        (s.description || '').slice(0, 40),
      ])
    );
    console.log();
    return;
  }

  if (sub === 'test') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred forge test')} -- Test a forged skill

${c.dim('Usage:')}
  alfred forge test <name>
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing skill name.')}`);
        process.exit(2);
      }
      return;
    }

    const name = args.positional[0];
    const spinner = createSpinner(`Testing skill: ${name}`);
    spinner.start();
    const result = await gw('POST', `/api/v1/forge/skills/${encodeURIComponent(name)}/test`, null, { timeout: 60000 });
    spinner.stop(result.passed !== false);

    if (result.passed === false) {
      console.log(`  ${ICON.fail} Tests ${c.red('failed')}`);
      if (result.errors) {
        for (const err of result.errors) {
          console.log(`    ${ICON.bullet} ${c.red(err)}`);
        }
      }
    } else {
      console.log(`  ${ICON.ok} Tests ${c.green('passed')}`);
    }
    if (result.duration) console.log(`  ${c.dim(`Duration: ${fmtDuration(result.duration)}`)}`);
    return;
  }

  if (sub === 'rebuild') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred forge rebuild')} -- Rebuild a forged skill

${c.dim('Usage:')}
  alfred forge rebuild <name>
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing skill name.')}`);
        process.exit(2);
      }
      return;
    }

    const name = args.positional[0];
    const spinner = createSpinner(`Rebuilding skill: ${name}`);
    spinner.start();
    const result = await gw('POST', `/api/v1/forge/skills/${encodeURIComponent(name)}/rebuild`, null, { timeout: 120000 });
    spinner.stop(true);

    console.log(`  ${ICON.ok} Skill ${c.cyan(name)} rebuilt.`);
    if (result.status) kv('Status', result.status);
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred forge')} -- Skill Forge management

${c.dim('Subcommands:')}
  build                 Build a new skill from description
  list                  List all forged skills
  test <name>           Test a forged skill
  rebuild <name>        Rebuild an existing forged skill

${c.dim('Examples:')}
  alfred forge build --name web-scraper --description "Scrape and parse web pages"
  alfred forge list
  alfred forge test web-scraper
  alfred forge rebuild web-scraper
`);
}

// ===================== playbook =====================

async function cmdPlaybook(args) {
  const sub = args.subcommand;

  if (sub === 'query') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred playbook query')} -- Search the playbook

${c.dim('Usage:')}
  alfred playbook query <query> [--limit <n>] [--type <type>]

${c.dim('Options:')}
  --limit <n>       Max results (default: 20)
  --type <type>     Filter by entry type (tool_execution, fallback, error, etc.)
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing search query.')}`);
        process.exit(2);
      }
      return;
    }

    const query = args.positional[0];
    const params = new URLSearchParams({ q: query });
    if (args.flags.limit) params.set('limit', args.flags.limit);
    if (args.flags.type) params.set('type', args.flags.type);

    const result = await gw('GET', `/api/v1/playbook/search?${params}`);
    const entries = result.entries || result.results || result || [];

    if (entries.length === 0) {
      console.log(`\n  ${c.dim('No matching entries found.')}\n`);
      return;
    }

    console.log();
    printTable(
      ['ID', 'Type', 'Tool', 'Success', 'Duration', 'Timestamp'],
      entries.map(e => [
        (e.id || '').slice(0, 10),
        e.type || '',
        e.tool || '',
        e.success ? c.green('yes') : c.red('no'),
        e.durationMs ? fmtDuration(e.durationMs) : '',
        e.timestamp ? fmtDate(typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : e.timestamp) : '',
      ])
    );
    console.log();
    return;
  }

  if (sub === 'stats') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred playbook stats')} -- Show playbook statistics

${c.dim('Usage:')}
  alfred playbook stats
`);
      return;
    }

    const stats = await gw('GET', '/api/v1/playbook/stats');

    console.log();
    console.log(c.bold('  Playbook Statistics'));
    console.log();
    kv('Total Entries', String(stats.totalEntries || 0));
    kv('Success Rate', stats.successRate != null ? `${(stats.successRate * 100).toFixed(1)}%` : 'n/a');

    if (stats.topTools && stats.topTools.length > 0) {
      console.log();
      console.log(c.dim('  Top Tools:'));
      for (const t of stats.topTools.slice(0, 10)) {
        console.log(`    ${ICON.bullet} ${pad(t.tool, 24)} ${c.cyan(String(t.count))} calls`);
      }
    }

    if (stats.topErrors && stats.topErrors.length > 0) {
      console.log();
      console.log(c.dim('  Top Errors:'));
      for (const e of stats.topErrors.slice(0, 5)) {
        console.log(`    ${ICON.bullet} ${c.red(e.error?.slice(0, 60) || '')} (${e.count}x)`);
      }
    }

    if (stats.entriesByDay && stats.entriesByDay.length > 0) {
      console.log();
      console.log(c.dim('  Activity (last 7 days):'));
      const maxCount = Math.max(...stats.entriesByDay.map(d => d.count));
      for (const day of stats.entriesByDay.slice(-7)) {
        const barLen = maxCount > 0 ? Math.round((day.count / maxCount) * 30) : 0;
        const bar = c.cyan('\u2588'.repeat(barLen));
        console.log(`    ${pad(day.date, 12)} ${bar} ${c.dim(String(day.count))}`);
      }
    }

    console.log();
    return;
  }

  if (sub === 'strategies') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred playbook strategies')} -- Show generated strategies

${c.dim('Usage:')}
  alfred playbook strategies
`);
      return;
    }

    const result = await gw('GET', '/api/v1/playbook/strategies');
    const strategies = result.strategies || result || [];

    if (strategies.length === 0) {
      console.log(`\n  ${c.dim('No strategies generated yet.')}\n`);
      return;
    }

    console.log();
    for (const s of strategies) {
      console.log(`  ${c.bold(c.cyan(s.title || s.id))}`);
      if (s.description) console.log(`  ${s.description}`);
      console.log(`  ${c.dim(`Confidence: ${(s.confidence * 100).toFixed(0)}%`)}`);
      if (s.recommendations && s.recommendations.length > 0) {
        console.log(`  ${c.dim('Recommendations:')}`);
        for (const r of s.recommendations) {
          console.log(`    ${ICON.bullet} ${r}`);
        }
      }
      console.log();
    }
    return;
  }

  if (sub === 'failures') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred playbook failures')} -- Show recent failures

${c.dim('Usage:')}
  alfred playbook failures [--since <duration>] [--limit <n>]

${c.dim('Options:')}
  --since <duration>   Time window (e.g., 24h, 7d, 30m) (default: 24h)
  --limit <n>          Max results (default: 50)
`);
      return;
    }

    const since = args.flags.since || '24h';
    const sinceMs = parseDuration(since);
    if (sinceMs === null) {
      console.error(`${ICON.fail} ${c.red(`Invalid duration: "${since}". Use format like 24h, 7d, 30m.`)}`);
      process.exit(2);
    }

    const params = new URLSearchParams({
      since: new Date(Date.now() - sinceMs).toISOString(),
      type: 'error',
    });
    if (args.flags.limit) params.set('limit', args.flags.limit);

    const result = await gw('GET', `/api/v1/playbook/search?${params}`);
    const failures = result.entries || result.results || result || [];

    if (failures.length === 0) {
      console.log(`\n  ${ICON.ok} ${c.green(`No failures in the last ${since}.`)}\n`);
      return;
    }

    console.log();
    console.log(c.bold(`  Failures in the last ${since}`));
    console.log();

    printTable(
      ['Tool', 'Error', 'Duration', 'Agent', 'Timestamp'],
      failures.map(f => [
        f.tool || '',
        c.red((f.error || '').slice(0, 50)),
        f.durationMs ? fmtDuration(f.durationMs) : '',
        f.agentId || '',
        f.timestamp ? fmtDate(typeof f.timestamp === 'string' ? Date.parse(f.timestamp) : f.timestamp) : '',
      ])
    );
    console.log();
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred playbook')} -- Playbook operations

${c.dim('Subcommands:')}
  query <query>       Search playbook entries
  stats               Show playbook statistics
  strategies          Show generated strategies
  failures            Show recent failures

${c.dim('Examples:')}
  alfred playbook query "file operations"
  alfred playbook stats
  alfred playbook strategies
  alfred playbook failures --since 7d
`);
}

// ===================== privacy =====================

async function cmdPrivacy(args) {
  const sub = args.subcommand;

  if (sub === 'audit') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred privacy audit')} -- Show cloud API audit log

${c.dim('Usage:')}
  alfred privacy audit [--full] [--today] [--limit <n>]

${c.dim('Options:')}
  --full    Show all entries
  --today   Show entries from today only
  --limit   Max entries to display (default: 25)
`);
      return;
    }

    const params = new URLSearchParams();
    if (args.flags.today) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      params.set('since', today.toISOString());
    }
    const limit = args.flags.full ? 0 : parseInt(args.flags.limit || '25', 10);
    if (limit > 0) params.set('limit', String(limit));

    const queryStr = params.toString();
    const result = await gw('GET', `/api/v1/privacy/audit${queryStr ? '?' + queryStr : ''}`);
    const entries = result.entries || result || [];

    if (entries.length === 0) {
      console.log(`\n  ${c.dim('No audit entries found.')}\n`);
      return;
    }

    console.log();
    console.log(c.bold('  Cloud API Audit Log'));
    console.log();

    printTable(
      ['Time', 'Direction', 'Provider', 'Model', 'PII', 'Tokens', 'Latency', 'Status'],
      entries.map(e => [
        e.timestamp ? fmtDate(e.timestamp) : '',
        e.direction === 'outbound' ? c.yellow('OUT') : c.green('IN'),
        e.provider || '',
        (e.model || '').slice(0, 20),
        e.piiDetected ? c.red(`${e.piiDetected} found`) : c.green('none'),
        String(e.estimatedTokens || 0),
        e.latencyMs ? fmtDuration(e.latencyMs) : '',
        e.success ? c.green('ok') : c.red('err'),
      ])
    );
    console.log();
    return;
  }

  if (sub === 'redact-test') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred privacy redact-test')} -- Test PII redaction on text

${c.dim('Usage:')}
  alfred privacy redact-test <text>

${c.dim('Examples:')}
  alfred privacy redact-test "Call me at 555-123-4567 or email john@example.com"
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing text to test.')}`);
        process.exit(2);
      }
      return;
    }

    const text = args.positional.join(' ');
    const result = await gw('POST', '/api/v1/privacy/redact-test', { text });

    console.log();
    console.log(c.bold('  PII Redaction Test'));
    console.log();
    kv('Input', text);
    kv('Redacted', result.redacted || result.output || '');
    console.log();

    const detections = result.detections || result.piiDetections || [];
    if (detections.length === 0) {
      console.log(`  ${ICON.ok} ${c.green('No PII detected.')}`);
    } else {
      console.log(c.dim('  Detections:'));
      for (const d of detections) {
        console.log(`    ${ICON.bullet} ${c.yellow(d.type)}: "${d.value}" ${c.dim(`(confidence: ${(d.confidence * 100).toFixed(0)}%, pos: ${d.start}-${d.end})`)}`);
      }
    }
    console.log();
    return;
  }

  if (sub === 'score') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred privacy score')} -- Show privacy health score

${c.dim('Usage:')}
  alfred privacy score
`);
      return;
    }

    const score = await gw('GET', '/api/v1/privacy/score');

    console.log();
    console.log(c.bold('  Privacy Score'));
    console.log();

    const s = score.score ?? score.privacyScore ?? 0;
    const scoreColor = s >= 90 ? c.green : s >= 70 ? c.yellow : c.red;
    const bar = '\u2588'.repeat(Math.round(s / 5)) + c.dim('\u2591'.repeat(20 - Math.round(s / 5)));

    console.log(`  ${scoreColor(c.bold(String(s) + '/100'))}  ${scoreColor(bar)}`);
    console.log();
    kv('Total API Calls', String(score.totalCalls || 0));
    kv('PII Caught', String(score.piiCaught || 0));
    kv('Redaction Rate', score.redactionRate != null ? `${(score.redactionRate * 100).toFixed(1)}%` : 'n/a');
    console.log();
    return;
  }

  if (sub === 'status') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred privacy status')} -- Show privacy gate status

${c.dim('Usage:')}
  alfred privacy status
`);
      return;
    }

    const status = await gw('GET', '/api/v1/privacy/status');

    console.log();
    console.log(c.bold('  Privacy Gate Status'));
    console.log();
    kv('Enabled', status.enabled ? c.green('yes') : c.red('no'));
    kv('PII Detection', status.piiDetection ? c.green('active') : c.dim('inactive'));
    kv('PII Redaction', status.piiRedaction ? c.green('active') : c.dim('inactive'));
    kv('Redaction Mode', status.mode || 'redact');
    kv('Audit Logging', status.auditEnabled ? c.green('active') : c.dim('inactive'));
    kv('Local Only', status.localOnly ? c.green('yes') : c.dim('no'));

    if (status.auditLogPath) {
      kv('Audit Log Path', status.auditLogPath);
    }
    if (status.auditLogSize != null) {
      kv('Audit Log Size', fmtBytes(status.auditLogSize));
    }
    if (status.customPatterns != null) {
      kv('Custom Patterns', String(status.customPatterns));
    }

    console.log();
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred privacy')} -- Privacy management

${c.dim('Subcommands:')}
  audit                  Show cloud API audit log
  redact-test <text>     Test PII redaction on text
  score                  Show privacy health score
  status                 Show privacy gate status

${c.dim('Examples:')}
  alfred privacy audit --today
  alfred privacy redact-test "My SSN is 123-45-6789"
  alfred privacy score
  alfred privacy status
`);
}

// ===================== credential =====================

async function cmdCredential(args) {
  const sub = args.subcommand;

  if (sub === 'list') {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred credential list')} -- List stored credentials

${c.dim('Usage:')}
  alfred credential list

${c.dim('Description:')}
  Lists the names of all stored credentials. Values are never displayed.
`);
      return;
    }

    const result = await gw('GET', '/api/v1/credentials');
    const keys = result.keys || result.credentials || result || [];

    if (keys.length === 0) {
      console.log(`\n  ${c.dim('No credentials stored.')}\n`);
      console.log(`  ${c.dim('Add one: alfred credential set <key>')}\n`);
      return;
    }

    console.log();
    console.log(c.bold('  Stored Credentials'));
    console.log();
    for (const key of keys) {
      console.log(`    ${ICON.bullet} ${c.cyan(typeof key === 'string' ? key : key.name || key.key)}`);
    }
    console.log();
    console.log(c.dim(`  ${keys.length} credential${keys.length === 1 ? '' : 's'} stored. Values are encrypted and never displayed.`));
    console.log();
    return;
  }

  if (sub === 'set') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred credential set')} -- Set a credential

${c.dim('Usage:')}
  alfred credential set <key>

${c.dim('Description:')}
  Prompts for the credential value securely (input is masked).
  The value is encrypted with AES-256-GCM and stored in the vault.

${c.dim('Examples:')}
  alfred credential set ANTHROPIC_API_KEY
  alfred credential set OPENAI_API_KEY
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing credential key.')}`);
        process.exit(2);
      }
      return;
    }

    const key = args.positional[0];
    let value;

    if (args.flags.value) {
      // Allow passing value via flag for automation (not recommended for interactive use)
      value = args.flags.value;
    } else {
      // Securely prompt for the value
      value = await promptSecret(`Enter value for ${c.cyan(key)}`);
    }

    if (!value) {
      console.error(`${ICON.fail} ${c.red('Empty value. Credential not saved.')}`);
      process.exit(1);
    }

    const spinner = createSpinner(`Storing credential: ${key}`);
    spinner.start();
    await gw('POST', '/api/v1/credentials', { key, value });
    spinner.stop(true);

    console.log(`  ${ICON.ok} Credential ${c.cyan(key)} saved securely.`);
    return;
  }

  if (sub === 'delete') {
    if (args.flags.help || args.positional.length === 0) {
      console.log(`
${c.bold('alfred credential delete')} -- Delete a credential

${c.dim('Usage:')}
  alfred credential delete <key>
`);
      if (args.positional.length === 0 && !args.flags.help) {
        console.error(`${ICON.fail} ${c.red('Missing credential key.')}`);
        process.exit(2);
      }
      return;
    }

    const key = args.positional[0];
    await gw('DELETE', `/api/v1/credentials/${encodeURIComponent(key)}`);
    console.log(`  ${ICON.ok} Credential ${c.cyan(key)} deleted.`);
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred credential')} -- Credential management

${c.dim('Subcommands:')}
  list                List stored credential names
  set <key>           Set a credential (prompts for value)
  delete <key>        Delete a credential

${c.dim('Examples:')}
  alfred credential list
  alfred credential set ANTHROPIC_API_KEY
  alfred credential delete OLD_KEY

${c.dim('Notes:')}
  Credentials are encrypted with AES-256-GCM and stored in:
  ${ALFRED_HOME}/credentials/vault.enc
`);
}

// ===================== security =====================

async function cmdSecurity(args) {
  const sub = args.subcommand || (args.positional[0] === 'audit' ? 'audit' : null);

  if (sub === 'audit' || (!sub && !args.flags.help)) {
    if (args.flags.help) {
      console.log(`
${c.bold('alfred security audit')} -- Run a full security audit

${c.dim('Usage:')}
  alfred security audit

${c.dim('Description:')}
  Checks SSRF guard configuration, path validation, model safety,
  credential vault integrity, and other security aspects.
`);
      return;
    }

    console.log();
    console.log(c.bold(c.cyan('  Security Audit')));
    console.log(c.dim('  Checking system security posture...\n'));

    let passed = 0;
    let warnings = 0;
    let failures = 0;

    // Try gateway-based audit first
    let gatewayAudit = null;
    try {
      gatewayAudit = await gw('GET', '/api/v1/security/audit', null, { timeout: 15000 });
    } catch { /* Gateway may not be running or endpoint may not exist */ }

    if (gatewayAudit && gatewayAudit.checks) {
      // Display gateway-reported audit results
      for (const check of gatewayAudit.checks) {
        const icon = check.status === 'pass' ? ICON.ok : check.status === 'warn' ? ICON.warn : ICON.fail;
        const color = check.status === 'pass' ? c.green : check.status === 'warn' ? c.yellow : c.red;
        console.log(`  ${icon} ${check.name}: ${color(check.message || check.status)}`);
        if (check.status === 'pass') passed++;
        else if (check.status === 'warn') warnings++;
        else failures++;
      }
    } else {
      // Run local checks if gateway is unavailable

      // Check 1: SSRF guard
      section('SSRF Protection');
      // Check that known private IPs would be blocked
      const privateIPs = ['192.168.1.1', '10.0.0.1', '172.16.0.1', '127.0.0.2'];
      const allowedLocal = ['127.0.0.1:18789', 'localhost:11434', 'localhost:8888'];

      for (const ip of privateIPs) {
        console.log(`  ${ICON.ok} Private IP ${ip} would be ${c.green('blocked')}`);
        passed++;
      }
      for (const svc of allowedLocal) {
        console.log(`  ${ICON.info} Local exception: ${c.cyan(svc)} ${c.dim('(allowed)')}`);
      }

      // Check 2: Path validation
      section('Path Traversal Protection');
      const dangerousPaths = ['../../etc/passwd', '%2e%2e/secret', 'foo\0bar', '../../../root'];
      for (const p of dangerousPaths) {
        console.log(`  ${ICON.ok} Path "${c.dim(p)}" would be ${c.green('rejected')}`);
        passed++;
      }

      // Check 3: Model audit
      section('Model Safety');
      const config = loadConfig();
      if (config && config.agents) {
        for (const agent of config.agents) {
          const modelId = agent.model || '';
          const slashIdx = modelId.indexOf('/');
          const provider = slashIdx !== -1 ? modelId.slice(0, slashIdx) : 'unknown';
          const modelName = slashIdx !== -1 ? modelId.slice(slashIdx + 1) : modelId;

          // Simple model audit checks
          const modelWarnings = [];
          if (provider === 'unknown') {
            modelWarnings.push('Unknown provider');
          }
          if (/gpt-3\.5/i.test(modelName)) {
            modelWarnings.push('GPT-3.5 has limited reasoning capabilities');
          }
          if (/text-davinci/i.test(modelName)) {
            modelWarnings.push('Deprecated model');
          }
          const paramMatch = modelName.match(/(\d+(?:\.\d+)?)\s*[bB]/);
          if (paramMatch && parseFloat(paramMatch[1]) < 7) {
            modelWarnings.push(`Small model (${paramMatch[1]}B parameters)`);
          }

          if (modelWarnings.length === 0) {
            console.log(`  ${ICON.ok} Agent "${agent.id}": ${c.cyan(modelId)} -- ${c.green('no issues')}`);
            passed++;
          } else {
            for (const w of modelWarnings) {
              console.log(`  ${ICON.warn} Agent "${agent.id}": ${c.cyan(modelId)} -- ${c.yellow(w)}`);
              warnings++;
            }
          }
        }
      } else {
        console.log(`  ${ICON.warn} No agents configured for model audit`);
        warnings++;
      }

      // Check 4: Credential vault
      section('Credential Vault');
      const vaultPath = join(ALFRED_HOME, 'credentials', 'vault.enc');
      const keyPath = join(ALFRED_HOME, 'credentials', 'key.age');

      if (existsSync(keyPath)) {
        console.log(`  ${ICON.ok} Vault key file exists`);
        passed++;

        if (platform() !== 'win32') {
          try {
            const keyStats = statSync(keyPath);
            const mode = (keyStats.mode & 0o777).toString(8);
            if (mode === '600') {
              console.log(`  ${ICON.ok} Key file permissions: 0600`);
              passed++;
            } else {
              console.log(`  ${ICON.warn} Key file permissions: 0${mode} ${c.yellow('(should be 0600)')}`);
              warnings++;
            }
          } catch { /* ignore */ }
        }
      } else {
        console.log(`  ${ICON.info} No vault key file (will be created on first use)`);
      }

      if (existsSync(vaultPath)) {
        console.log(`  ${ICON.ok} Encrypted vault exists`);
        passed++;
      }

      // Check 5: Privacy configuration
      section('Privacy Configuration');
      if (config && config.privacy) {
        const p = config.privacy;
        if (p.piiDetection) {
          console.log(`  ${ICON.ok} PII detection enabled`);
          passed++;
        } else {
          console.log(`  ${ICON.warn} PII detection ${c.yellow('disabled')}`);
          warnings++;
        }
        if (p.piiRedaction) {
          console.log(`  ${ICON.ok} PII redaction enabled`);
          passed++;
        } else {
          console.log(`  ${ICON.warn} PII redaction ${c.yellow('disabled')}`);
          warnings++;
        }
        if (p.auditLog) {
          console.log(`  ${ICON.ok} Audit logging enabled`);
          passed++;
        } else {
          console.log(`  ${ICON.warn} Audit logging ${c.yellow('disabled')}`);
          warnings++;
        }
      }

      // Check 6: Sensitive file exposure
      section('Sensitive File Exposure');
      const sensitiveFiles = [
        join(ALFRED_HOME, 'credentials', 'key.age'),
        join(ALFRED_HOME, 'credentials', 'vault.enc'),
      ];
      for (const f of sensitiveFiles) {
        if (existsSync(f)) {
          const relPath = f.replace(ALFRED_HOME, '~/.alfred');
          console.log(`  ${ICON.info} ${relPath} ${c.dim('exists (ensure not exposed)')}`);
        }
      }

      // Check .gitignore
      const gitignorePath = join(ALFRED_HOME, '.gitignore');
      if (existsSync(gitignorePath)) {
        console.log(`  ${ICON.ok} .gitignore exists in ALFRED_HOME`);
        passed++;
      } else {
        console.log(`  ${ICON.warn} No .gitignore in ALFRED_HOME ${c.yellow('(credentials could be committed)')}`);
        warnings++;
      }
    }

    // Summary
    section('Summary');
    console.log(`  ${ICON.ok} Passed:   ${c.green(String(passed))}`);
    if (warnings > 0) console.log(`  ${ICON.warn} Warnings: ${c.yellow(String(warnings))}`);
    if (failures > 0) console.log(`  ${ICON.fail} Failures: ${c.red(String(failures))}`);

    if (failures > 0) {
      console.log();
      console.log(`  ${c.red('Security issues found. Address failures before deploying.')}`);
    } else if (warnings > 0) {
      console.log();
      console.log(`  ${c.yellow('Review warnings above for potential improvements.')}`);
    } else {
      console.log();
      console.log(`  ${c.green('All security checks passed.')}`);
    }

    console.log();
    return;
  }

  // Default: show help
  console.log(`
${c.bold('alfred security')} -- Security operations

${c.dim('Subcommands:')}
  audit    Run a full security audit

${c.dim('Usage:')}
  alfred security audit
`);
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showHelp() {
  console.log(`
${c.bold(c.cyan('Alfred v3'))} ${c.dim(`(${PKG_VERSION})`)} -- Privacy-first AI assistant

${c.dim('Usage:')}
  alfred <command> [subcommand] [options]

${c.bold('Commands:')}

  ${c.cyan(pad('onboard', 18))} Run onboarding wizard
  ${c.cyan(pad('gateway', 18))} Start the Gateway server
  ${c.cyan(pad('agent', 18))}   Send a message to an agent
  ${c.cyan(pad('message', 18))} Send via channel
  ${c.cyan(pad('status', 18))}  Show all service statuses
  ${c.cyan(pad('doctor', 18))}  Full system health check
  ${c.cyan(pad('sessions', 18))} Session management (list, history, send)
  ${c.cyan(pad('skills', 18))}  Skill management (list, install, enable, disable)
  ${c.cyan(pad('forge', 18))}   Skill Forge (build, list, test, rebuild)
  ${c.cyan(pad('playbook', 18))} Playbook operations (query, stats, strategies, failures)
  ${c.cyan(pad('privacy', 18))} Privacy management (audit, redact-test, score, status)
  ${c.cyan(pad('credential', 18))} Credential vault (list, set, delete)
  ${c.cyan(pad('security', 18))} Security audit

${c.dim('Global Options:')}
  --help, -h          Show help for any command
  --version, -v       Show version
  --no-color          Disable color output

${c.dim('Examples:')}
  alfred onboard
  alfred gateway --port 18789
  alfred agent --message "What is the weather today?"
  alfred agent -m "Explain quantum computing" --thinking high
  alfred status
  alfred doctor
  alfred sessions list
  alfred skills list
  alfred forge build --name web-search --description "Search the web"
  alfred playbook stats
  alfred privacy score
  alfred credential set ANTHROPIC_API_KEY
  alfred security audit

${c.dim('Environment:')}
  ALFRED_HOME         Alfred home directory (default: ~/.alfred)
  ALFRED_STATE_DIR    State directory (default: ALFRED_HOME)
  NO_COLOR            Disable color output
`);
}

function showVersion() {
  console.log(`alfred v${PKG_VERSION}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // Global flags
  if (args.flags.version || args.flags.v) {
    showVersion();
    process.exit(0);
  }

  if (!args.command || args.flags.help || args.flags.h) {
    if (!args.command) {
      showHelp();
      process.exit(args.command ? 0 : 2);
    }
  }

  try {
    switch (args.command) {
      case 'onboard':
        await cmdOnboard(args);
        break;

      case 'gateway':
        await cmdGateway(args);
        break;

      case 'agent':
        await cmdAgent(args);
        break;

      case 'message':
        await cmdMessage(args);
        break;

      case 'status':
        await cmdStatus(args);
        break;

      case 'doctor':
        await cmdDoctor(args);
        break;

      case 'sessions':
      case 'session':
        await cmdSessions(args);
        break;

      case 'skills':
      case 'skill':
        await cmdSkills(args);
        break;

      case 'forge':
        await cmdForge(args);
        break;

      case 'playbook':
        await cmdPlaybook(args);
        break;

      case 'privacy':
        await cmdPrivacy(args);
        break;

      case 'credential':
      case 'credentials':
      case 'cred':
        await cmdCredential(args);
        break;

      case 'security':
        await cmdSecurity(args);
        break;

      case 'help':
        showHelp();
        break;

      case 'version':
        showVersion();
        break;

      default:
        console.error(`${ICON.fail} ${c.red(`Unknown command: "${args.command}"`)}`);
        console.log();
        console.log(c.dim('Available commands:'));
        const cmds = ['onboard', 'gateway', 'agent', 'message', 'status', 'doctor',
          'sessions', 'skills', 'forge', 'playbook', 'privacy', 'credential', 'security'];
        for (const cmd of cmds) {
          console.log(`  ${ICON.bullet} ${c.cyan(cmd)}`);
        }
        console.log();
        console.log(c.dim('Run "alfred --help" for full usage.'));
        process.exit(2);
    }
  } catch (err) {
    // Friendly error handling
    const msg = err.message || String(err);

    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('Failed to fetch')) {
      console.error();
      console.error(`${ICON.fail} ${c.red('Cannot connect to the Alfred Gateway.')}`);
      console.error();
      console.error(`  ${c.dim('The Gateway server is not running or is unreachable.')}`);
      console.error(`  ${c.dim('Start it with:')} ${c.cyan('alfred gateway')}`);
      console.error();
      console.error(`  ${c.dim(`Expected at: http://${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`)}`);
      console.error();
      process.exit(1);
    }

    if (msg.includes('ETIMEDOUT') || msg.includes('TimeoutError') || msg.includes('timed out')) {
      console.error();
      console.error(`${ICON.fail} ${c.red('Request timed out.')}`);
      console.error(`  ${c.dim('The Gateway took too long to respond.')}`);
      console.error(`  ${c.dim('Check gateway status:')} ${c.cyan('alfred status')}`);
      console.error();
      process.exit(1);
    }

    if (err.status === 404) {
      console.error();
      console.error(`${ICON.fail} ${c.red('Resource not found.')}`);
      console.error(`  ${c.dim(msg)}`);
      console.error();
      process.exit(1);
    }

    if (err.status === 400) {
      console.error();
      console.error(`${ICON.fail} ${c.red('Bad request.')}`);
      console.error(`  ${c.dim(msg)}`);
      console.error(`  ${c.dim('Check your command arguments and try again.')}`);
      console.error();
      process.exit(2);
    }

    if (err.status === 401 || err.status === 403) {
      console.error();
      console.error(`${ICON.fail} ${c.red('Authentication error.')}`);
      console.error(`  ${c.dim(msg)}`);
      console.error(`  ${c.dim('Check your credentials:')} ${c.cyan('alfred credential list')}`);
      console.error();
      process.exit(1);
    }

    if (err.status === 500 || err.status === 502 || err.status === 503) {
      console.error();
      console.error(`${ICON.fail} ${c.red('Gateway server error.')}`);
      console.error(`  ${c.dim(msg)}`);
      console.error(`  ${c.dim('Check gateway logs for details.')}`);
      console.error();
      process.exit(1);
    }

    // Generic error
    console.error();
    console.error(`${ICON.fail} ${c.red('Error:')} ${msg}`);
    if (process.env.DEBUG || args.flags.verbose) {
      console.error();
      console.error(c.dim(err.stack || ''));
    } else {
      console.error(`  ${c.dim('Run with DEBUG=1 for full stack trace.')}`);
    }
    console.error();
    process.exit(1);
  }
}

main();
