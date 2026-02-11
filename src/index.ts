/**
 * Alfred v3 - Main Entry Point
 *
 * Boots the gateway server and all subsystems:
 *   1. Load configuration from @alfred/core
 *   2. Initialize privacy gate, memory, playbook, forge references
 *   3. Start the Gateway HTTP + WebSocket server
 *   4. Start scheduled tasks (cron)
 *   5. Start channel router
 *   6. Handle graceful shutdown
 */

import { loadConfig } from '@alfred/core/config/index.js';
import { buildPaths, ensureDirectories } from '@alfred/core/config/paths.js';
import { PrivacyGate, CredentialVault } from '@alfred/privacy';

import { GatewayServer } from './gateway/server.js';
import { GatewayAuth } from './gateway/auth.js';
import { HealthMonitor } from './gateway/health.js';
import { GatewayCron } from './gateway/cron.js';
import { HookManager } from './gateway/hooks.js';

import { AgentManager } from './agents/manager.js';
import { AgentRouter } from './agents/routing.js';
import { ChannelRouter } from './channels/router.js';
import { ChannelManager } from './channels/manager.js';

import { SkillLoader } from './skills/loader.js';
import { SkillRegistry } from './skills/registry.js';
import { SkillWatcher } from './skills/watcher.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[Alfred]';
const VERSION = '3.0.0';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`${LOG_PREFIX} Alfred v${VERSION} starting...`);

  // ---- 1. Ensure directories and load config ----

  const paths = ensureDirectories();
  console.log(`${LOG_PREFIX} Home: ${paths.home}`);

  const vault = new CredentialVault();
  const { config, validation } = await loadConfig({
    resolve: async (key) => {
      const value = await vault.retrieve(key);
      return value ?? undefined;
    },
  });

  if (!validation.valid) {
    console.warn(`${LOG_PREFIX} Config validation errors:`);
    for (const err of validation.errors) {
      console.warn(`  ${err.path}: ${err.message}`);
    }
  }

  for (const warn of validation.warnings) {
    console.warn(`${LOG_PREFIX} Config warning: ${warn.path}: ${warn.message}`);
  }

  console.log(`${LOG_PREFIX} Config loaded (${config.agents.length} agents, ${config.channels.length} channels)`);

  // ---- 2. Initialize privacy gate ----

  const privacyGate = new PrivacyGate({
    enabled: config.privacy?.piiDetection ?? true,
    mode: config.privacy?.piiRedaction ? 'redact' : 'redact',
    auditEnabled: config.privacy?.auditLog ?? true,
  });

  console.log(`${LOG_PREFIX} Privacy gate initialized`);

  // ---- 3. Initialize subsystems ----

  // Auth
  const auth = new GatewayAuth(vault);
  await auth.initialize();

  // Health
  const healthMonitor = new HealthMonitor();

  // Agent management
  const agentManager = new AgentManager(config.agents);
  const agentRouter = new AgentRouter(config.agents);

  // Channel management
  const channelManager = new ChannelManager(
    paths.home + '/extensions',
    config.channels,
  );

  const channelRouter = new ChannelRouter(agentRouter);

  // Skills
  const skillLoader = new SkillLoader();
  const skillRegistry = new SkillRegistry();

  try {
    const skills = await skillLoader.loadAll();
    skillRegistry.registerAll(skills);
    console.log(`${LOG_PREFIX} ${skills.length} skills loaded`);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to load skills:`, err);
  }

  // Skill watcher
  const skillWatcher = new SkillWatcher();
  if (config.playbook?.watchForChanges ?? true) {
    skillWatcher.on('change', async () => {
      console.log(`${LOG_PREFIX} Skill change detected, reloading...`);
      try {
        const skills = await skillLoader.loadAll();
        skillRegistry.clear();
        skillRegistry.registerAll(skills);
      } catch (err) {
        console.error(`${LOG_PREFIX} Failed to reload skills:`, err);
      }
    });
    skillWatcher.start(skillLoader.getSearchDirs());
  }

  // Hooks
  const hookManager = new HookManager();

  // Cron
  const cron = new GatewayCron();
  cron.loadDefaultTasks();

  // Wire cron task events
  cron.on('task:execute', (event) => {
    console.log(`${LOG_PREFIX} Task "${event.taskId}" executing: ${event.message}`);
  });

  cron.on('task:error', (event) => {
    console.error(`${LOG_PREFIX} Task "${event.taskId}" failed: ${event.error}`);
  });

  // ---- 4. Start Gateway Server ----

  const server = new GatewayServer({
    config,
    auth,
    healthMonitor,
    agentManager,
    agentRouter,
    channelRouter,
    channelManager,
    skillRegistry,
    skillLoader,
    cron,
    hookManager,
  });

  await server.start();

  // ---- 5. Start scheduled tasks ----

  cron.start();
  console.log(`${LOG_PREFIX} Scheduled tasks started`);

  // ---- 6. Start channel router ----

  try {
    await channelManager.initialize();
    console.log(`${LOG_PREFIX} Channels initialized`);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Channel initialization warning:`, err);
  }

  // ---- 7. Print startup summary ----

  const gwConfig = config.gateway;
  const host = gwConfig?.host ?? '127.0.0.1';
  const port = gwConfig?.port ?? 18789;

  console.log('');
  console.log(`  Alfred v${VERSION} is ready`);
  console.log(`  Gateway:    http://${host}:${port}`);
  console.log(`  WebSocket:  ws://${host}:${port}`);
  console.log(`  Health:     http://${host}:${port}/health`);
  console.log(`  Agents:     ${config.agents.length}`);
  console.log(`  Skills:     ${skillRegistry.count()}`);
  console.log(`  Channels:   ${channelManager.listChannels().length}`);

  if (auth.getToken()) {
    console.log(`  Auth:       token-based (token loaded)`);
  } else {
    console.log(`  Auth:       none`);
  }
  console.log('');

  // ---- 8. Graceful shutdown ----

  let shutdownInProgress = false;

  async function shutdown(signal: string): Promise<void> {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`\n${LOG_PREFIX} Received ${signal}, shutting down...`);

    try {
      // Stop cron
      cron.stop();

      // Stop skill watcher
      skillWatcher.stop();

      // Stop channels
      await channelManager.shutdown();

      // Stop server
      await server.stop();

      console.log(`${LOG_PREFIX} Shutdown complete`);
      process.exit(0);
    } catch (err) {
      console.error(`${LOG_PREFIX} Error during shutdown:`, err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ---- 9. Error handlers -- keep server alive ----

  process.on('uncaughtException', (err) => {
    console.error(`${LOG_PREFIX} Uncaught exception (keeping server alive):`, err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`${LOG_PREFIX} Unhandled rejection (keeping server alive):`, reason);
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(`${LOG_PREFIX} Fatal error during startup:`, err);
  process.exit(1);
});
