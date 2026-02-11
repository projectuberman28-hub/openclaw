/**
 * @alfred/gateway - Gateway Server
 *
 * HTTP + WebSocket server that ties together all Alfred subsystems.
 * Uses Node.js built-in http module with a manual router.
 *
 * HTTP routes handle REST API requests.
 * WebSocket handles real-time streaming and RPC.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { AlfredConfig } from '@alfred/core/config/schema.js';
import { getSystemSnapshot, type SystemSnapshot } from '@alfred/core/system/resources.js';

import { GatewayAuth } from './auth.js';
import { HealthMonitor, type HealthReport } from './health.js';
import { GatewayCron } from './cron.js';
import { HookManager } from './hooks.js';
import { RPCHandler } from './rpc.js';
import { encode, decode, serverMsg, type ServerMessage, type ClientMessage } from './protocol.js';

import { AgentManager } from '../agents/manager.js';
import { AgentRouter } from '../agents/routing.js';
import { ChannelRouter } from '../channels/router.js';
import { ChannelManager } from '../channels/manager.js';
import { SkillRegistry } from '../skills/registry.js';
import { SkillLoader } from '../skills/loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayServerOptions {
  config: AlfredConfig;
  host?: string;
  port?: number;
  auth?: GatewayAuth;
  healthMonitor?: HealthMonitor;
  agentManager?: AgentManager;
  agentRouter?: AgentRouter;
  channelRouter?: ChannelRouter;
  channelManager?: ChannelManager;
  skillRegistry?: SkillRegistry;
  skillLoader?: SkillLoader;
  cron?: GatewayCron;
  hookManager?: HookManager;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[Gateway]';
const VERSION = '3.0.0';

// ---------------------------------------------------------------------------
// GatewayServer
// ---------------------------------------------------------------------------

export class GatewayServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private config: AlfredConfig;
  private host: string;
  private port: number;
  private startTime: number = Date.now();

  // Subsystems
  private auth: GatewayAuth;
  private healthMonitor: HealthMonitor;
  private cron: GatewayCron;
  private hookManager: HookManager;
  private rpcHandler: RPCHandler;
  private agentManager: AgentManager;
  private agentRouter: AgentRouter;
  private channelRouter: ChannelRouter;
  private channelManager: ChannelManager;
  private skillRegistry: SkillRegistry;
  private skillLoader: SkillLoader;

  // Route table
  private routes: Route[] = [];

  // Connected WebSocket clients
  private wsClients = new Set<WebSocket>();

  constructor(options: GatewayServerOptions) {
    this.config = options.config;
    this.host = options.host ?? options.config.gateway?.host ?? '127.0.0.1';
    this.port = options.port ?? options.config.gateway?.port ?? 18789;

    // Initialize subsystems
    this.auth = options.auth ?? new GatewayAuth();
    this.healthMonitor = options.healthMonitor ?? new HealthMonitor();
    this.cron = options.cron ?? new GatewayCron();
    this.hookManager = options.hookManager ?? new HookManager();

    this.agentManager = options.agentManager ?? new AgentManager(options.config.agents);
    this.agentRouter = options.agentRouter ?? new AgentRouter(options.config.agents);
    this.channelRouter = options.channelRouter ?? new ChannelRouter(this.agentRouter);
    this.channelManager = options.channelManager ?? new ChannelManager(
      process.cwd() + '/extensions',
      options.config.channels,
    );
    this.skillRegistry = options.skillRegistry ?? new SkillRegistry();
    this.skillLoader = options.skillLoader ?? new SkillLoader();

    this.rpcHandler = new RPCHandler(this.agentManager);
    this.rpcHandler.setRouter(this.agentRouter);

    // Register all HTTP routes
    this.registerRoutes();
  }

  /**
   * Start the HTTP + WebSocket server.
   */
  async start(): Promise<void> {
    // Initialize auth
    await this.auth.initialize();

    // Create HTTP server
    this.server = createServer((req, res) => this.handleHttpRequest(req, res));

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));

    // Wire health monitor to channel status
    this.healthMonitor.setChannelStatusProvider(() => this.channelManager.getStatus());

    this.startTime = Date.now();

    return new Promise<void>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(this.port, this.host, () => {
        console.log(`${LOG_PREFIX} Listening on ${this.host}:${this.port}`);
        console.log(`${LOG_PREFIX} WebSocket endpoint: ws://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server gracefully.
   */
  async stop(): Promise<void> {
    // Close all WebSocket connections
    for (const ws of this.wsClients) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // Ignore close errors
      }
    }
    this.wsClients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server!.close(() => {
          console.log(`${LOG_PREFIX} Server stopped`);
          this.server = null;
          resolve();
        });
      });
    }
  }

  // -----------------------------------------------------------------------
  // Getters for subsystems
  // -----------------------------------------------------------------------

  getAuth(): GatewayAuth { return this.auth; }
  getHealthMonitor(): HealthMonitor { return this.healthMonitor; }
  getCron(): GatewayCron { return this.cron; }
  getHookManager(): HookManager { return this.hookManager; }
  getAgentManager(): AgentManager { return this.agentManager; }
  getAgentRouter(): AgentRouter { return this.agentRouter; }
  getChannelRouter(): ChannelRouter { return this.channelRouter; }
  getChannelManager(): ChannelManager { return this.channelManager; }
  getSkillRegistry(): SkillRegistry { return this.skillRegistry; }

  // -----------------------------------------------------------------------
  // HTTP Request Handler
  // -----------------------------------------------------------------------

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const start = Date.now();
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    // Set CORS headers
    this.setCorsHeaders(res);

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Request logging
    console.log(`${LOG_PREFIX} ${method} ${url}`);

    // Auth check (skip /health for load balancer probes)
    if (url !== '/health' && !this.auth.validateHttp(req)) {
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    // Route matching
    const urlPath = url.split('?')[0] ?? '/';

    for (const route of this.routes) {
      if (route.method !== method && route.method !== '*') continue;

      const match = urlPath.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        // Extract named groups
        if (match.groups) {
          Object.assign(params, match.groups);
        }

        try {
          await route.handler(req, res, params);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`${LOG_PREFIX} Error handling ${method} ${url}: ${message}`);
          this.sendJson(res, 500, { error: 'Internal server error' });
        }

        const elapsed = Date.now() - start;
        console.log(`${LOG_PREFIX} ${method} ${url} -> ${res.statusCode} (${elapsed}ms)`);
        return;
      }
    }

    // No route matched
    this.sendJson(res, 404, { error: 'Not found' });
  }

  // -----------------------------------------------------------------------
  // WebSocket Handler
  // -----------------------------------------------------------------------

  private handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = req.socket.remoteAddress ?? 'unknown';
    console.log(`${LOG_PREFIX} WebSocket connected from ${ip}`);

    let authenticated = false;

    // If auth is required, the first message must be an auth frame
    if (this.auth.getToken()) {
      // Wait for auth message
      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          ws.close(4001, 'Authentication timeout');
        }
      }, 10_000);

      ws.once('message', (data: RawData) => {
        clearTimeout(authTimeout);

        try {
          const raw = data.toString();
          const frame = JSON.parse(raw);

          if (this.auth.validateWs(frame)) {
            authenticated = true;
            ws.send(encode(serverMsg('status', '0', { authenticated: true })));
            this.wsClients.add(ws);
            this.setupWsHandlers(ws);
          } else {
            ws.close(4001, 'Invalid token');
          }
        } catch {
          ws.close(4001, 'Invalid auth frame');
        }
      });
    } else {
      // No auth required
      authenticated = true;
      this.wsClients.add(ws);
      this.setupWsHandlers(ws);
    }

    ws.on('close', () => {
      this.wsClients.delete(ws);
      console.log(`${LOG_PREFIX} WebSocket disconnected from ${ip}`);
    });

    ws.on('error', (err) => {
      console.error(`${LOG_PREFIX} WebSocket error from ${ip}:`, err.message);
      this.wsClients.delete(ws);
    });
  }

  private setupWsHandlers(ws: WebSocket): void {
    ws.on('message', async (data: RawData) => {
      const msg = decode(data.toString());
      if (!msg) {
        ws.send(encode(serverMsg('error', '0', { code: 'INVALID_MESSAGE', message: 'Invalid message format' })));
        return;
      }

      await this.handleWsMessage(ws, msg);
    });
  }

  private async handleWsMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'ping':
        ws.send(encode(serverMsg('pong', msg.id, { timestamp: Date.now() })));
        break;

      case 'command': {
        const payload = msg.payload as Record<string, unknown> | null;
        const method = payload?.['method'] as string;
        const params = (payload?.['params'] as Record<string, unknown>) ?? {};

        if (method) {
          const result = await this.rpcHandler.handleRPC(method, params);
          const type = result.success ? 'done' : 'error';
          ws.send(encode(serverMsg(type, msg.id, result)));
        } else {
          ws.send(encode(serverMsg('error', msg.id, { code: 'INVALID_COMMAND', message: 'Missing method' })));
        }
        break;
      }

      case 'chat': {
        // Chat messages are forwarded to the channel router
        const payload = msg.payload as Record<string, unknown> | null;
        const content = (payload?.['content'] as string) ?? '';
        const agentId = payload?.['agentId'] as string | undefined;

        // Route through the channel router
        await this.channelRouter.route({
          channel: 'websocket',
          sender: 'user',
          content,
          metadata: { wsMessageId: msg.id, agentId },
        });

        // Acknowledge receipt
        ws.send(encode(serverMsg('status', msg.id, { queued: true })));
        break;
      }

      case 'subscribe': {
        // Subscriptions are handled by adding the client to topic groups
        // For now, acknowledge the subscription
        ws.send(encode(serverMsg('status', msg.id, { subscribed: true })));
        break;
      }

      default:
        ws.send(encode(serverMsg('error', msg.id, {
          code: 'UNKNOWN_TYPE',
          message: `Unknown message type: ${msg.type}`,
        })));
    }
  }

  /**
   * Broadcast a message to all connected WebSocket clients.
   */
  broadcast(msg: ServerMessage): void {
    const data = encode(msg);
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Route Registration
  // -----------------------------------------------------------------------

  private registerRoutes(): void {
    // Health
    this.addRoute('GET', /^\/health$/, this.handleHealth.bind(this));

    // Hardware / Resources
    this.addRoute('GET', /^\/api\/hardware$/, this.handleHardware.bind(this));
    this.addRoute('GET', /^\/api\/resources$/, this.handleResources.bind(this));

    // Ollama proxy
    this.addRoute('GET', /^\/api\/ollama\/models$/, this.handleOllamaModels.bind(this));
    this.addRoute('POST', /^\/api\/ollama\/pull$/, this.handleOllamaPull.bind(this));

    // Status
    this.addRoute('GET', /^\/api\/status$/, this.handleStatus.bind(this));

    // Privacy
    this.addRoute('GET', /^\/api\/privacy\/score$/, this.handlePrivacyScore.bind(this));
    this.addRoute('GET', /^\/api\/privacy\/audit$/, this.handlePrivacyAudit.bind(this));

    // Config
    this.addRoute('GET', /^\/api\/config$/, this.handleGetConfig.bind(this));
    this.addRoute('PUT', /^\/api\/config$/, this.handleUpdateConfig.bind(this));

    // Skills
    this.addRoute('GET', /^\/api\/skills$/, this.handleListSkills.bind(this));
    this.addRoute('POST', /^\/api\/skills\/(?<id>[^/]+)\/enable$/, this.handleEnableSkill.bind(this));
    this.addRoute('POST', /^\/api\/skills\/(?<id>[^/]+)\/disable$/, this.handleDisableSkill.bind(this));

    // Forge
    this.addRoute('POST', /^\/api\/forge\/build$/, this.handleForgeBuild.bind(this));
    this.addRoute('GET', /^\/api\/forge\/status$/, this.handleForgeStatus.bind(this));

    // Playbook
    this.addRoute('GET', /^\/api\/playbook\/query$/, this.handlePlaybookQuery.bind(this));
    this.addRoute('GET', /^\/api\/playbook\/stats$/, this.handlePlaybookStats.bind(this));

    // Sessions
    this.addRoute('GET', /^\/api\/sessions$/, this.handleListSessions.bind(this));

    // Agents
    this.addRoute('GET', /^\/api\/agents$/, this.handleListAgents.bind(this));
    this.addRoute('POST', /^\/api\/agents$/, this.handleCreateAgent.bind(this));
    this.addRoute('PUT', /^\/api\/agents\/(?<id>[^/]+)$/, this.handleUpdateAgent.bind(this));
    this.addRoute('DELETE', /^\/api\/agents\/(?<id>[^/]+)$/, this.handleDeleteAgent.bind(this));

    // Tasks
    this.addRoute('GET', /^\/api\/tasks$/, this.handleListTasks.bind(this));
    this.addRoute('POST', /^\/api\/tasks$/, this.handleCreateTask.bind(this));
    this.addRoute('DELETE', /^\/api\/tasks\/(?<id>[^/]+)$/, this.handleDeleteTask.bind(this));
  }

  private addRoute(
    method: string,
    pattern: RegExp,
    handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>,
  ): void {
    this.routes.push({ method, pattern, handler });
  }

  // -----------------------------------------------------------------------
  // Route Handlers
  // -----------------------------------------------------------------------

  private async handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    this.sendJson(res, 200, {
      status: 'ok',
      uptime,
      version: VERSION,
    });
  }

  private async handleHardware(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const snapshot = await getSystemSnapshot();
      this.sendJson(res, 200, snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handleResources(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const snapshot = await getSystemSnapshot();
      this.sendJson(res, 200, snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handleOllamaModels(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) {
        this.sendJson(res, response.status, { error: `Ollama returned ${response.status}` });
        return;
      }
      const data = await response.json();
      this.sendJson(res, 200, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 503, { error: `Ollama unavailable: ${message}` });
    }
  }

  private async handleOllamaPull(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const modelName = body?.['model'] as string;

    if (!modelName) {
      this.sendJson(res, 400, { error: 'Missing "model" in request body' });
      return;
    }

    try {
      // Proxy the streaming pull request to Ollama
      const ollamaRes = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      });

      if (!ollamaRes.ok) {
        this.sendJson(res, ollamaRes.status, { error: `Ollama pull failed: ${ollamaRes.status}` });
        return;
      }

      // Stream the response through to the client
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      });

      if (ollamaRes.body) {
        const reader = ollamaRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }

      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        this.sendJson(res, 503, { error: `Ollama unavailable: ${message}` });
      }
    }
  }

  private async handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const health = await this.healthMonitor.check();
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);

      this.sendJson(res, 200, {
        uptime,
        version: VERSION,
        services: health,
        wsClients: this.wsClients.size,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handlePrivacyScore(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const { AuditLog } = await import('@alfred/privacy');
      const auditLog = new AuditLog();
      const score = await auditLog.getPrivacyScore();
      this.sendJson(res, 200, score);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handlePrivacyAudit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

      const { AuditLog } = await import('@alfred/privacy');
      const auditLog = new AuditLog();
      const entries = await auditLog.getEntries(limit + offset);

      // Apply offset pagination
      const paginated = entries.slice(offset, offset + limit);

      this.sendJson(res, 200, {
        entries: paginated,
        total: entries.length,
        limit,
        offset,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handleGetConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Return config with secrets redacted
    const redacted = JSON.parse(JSON.stringify(this.config));

    // Redact any values that look like tokens/keys
    this.redactSecrets(redacted);

    this.sendJson(res, 200, redacted);
  }

  private async handleUpdateConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    try {
      const { validateConfig } = await import('@alfred/core/config/validator.js');
      const merged = { ...this.config, ...body };
      const validation = validateConfig(merged);

      if (!validation.valid) {
        this.sendJson(res, 400, {
          error: 'Validation failed',
          errors: validation.errors,
        });
        return;
      }

      // Save to disk
      const { readFileSync, writeFileSync } = await import('node:fs');
      const { buildPaths } = await import('@alfred/core/config/paths.js');
      const paths = buildPaths();

      writeFileSync(paths.config, JSON.stringify(validation.config, null, 2), 'utf-8');

      // Update in-memory config
      this.config = validation.config;

      // Refresh agents
      this.agentManager.reloadFromConfig();
      this.agentRouter.refreshBindings(this.agentManager.listAgents());

      this.sendJson(res, 200, {
        success: true,
        warnings: validation.warnings,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handleListSkills(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const skills = this.skillRegistry.listAll().map((s) => ({
      name: s.name,
      version: s.version,
      description: s.description,
      source: s.source,
      enabled: s.enabled,
      toolCount: s.tools.length,
    }));

    this.sendJson(res, 200, { skills });
  }

  private async handleEnableSkill(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const id = params['id'];
    if (!id) {
      this.sendJson(res, 400, { error: 'Missing skill id' });
      return;
    }

    const success = this.skillRegistry.enable(id);
    if (success) {
      this.sendJson(res, 200, { success: true, id });
    } else {
      this.sendJson(res, 404, { error: `Skill "${id}" not found` });
    }
  }

  private async handleDisableSkill(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const id = params['id'];
    if (!id) {
      this.sendJson(res, 400, { error: 'Missing skill id' });
      return;
    }

    const success = this.skillRegistry.disable(id);
    if (success) {
      this.sendJson(res, 200, { success: true, id });
    } else {
      this.sendJson(res, 404, { error: `Skill "${id}" not found` });
    }
  }

  private async handleForgeBuild(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const skillName = body?.['skill'] as string;

    if (!skillName) {
      this.sendJson(res, 400, { error: 'Missing "skill" in request body' });
      return;
    }

    // Emit build event for forge to pick up
    this.cron.emit('task:execute', {
      taskId: 'forge-build',
      type: 'forge',
      message: `Build skill: ${skillName}`,
      skill: skillName,
    });

    this.sendJson(res, 202, {
      status: 'queued',
      skill: skillName,
      message: 'Build request queued',
    });
  }

  private async handleForgeStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      enabled: this.config.forge?.enabled ?? true,
      sandbox: this.config.forge?.sandbox ?? true,
      queue: [],
    });
  }

  private async handlePlaybookQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const query = url.searchParams.get('q') ?? '';

    this.sendJson(res, 200, {
      query,
      results: [],
      message: 'Playbook query endpoint ready',
    });
  }

  private async handlePlaybookStats(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      enabled: this.config.playbook?.enabled ?? true,
      entriesCount: 0,
      lastUpdated: null,
    });
  }

  private async handleListSessions(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      sessions: [],
      total: 0,
    });
  }

  private async handleListAgents(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const agents = this.agentManager.listAgents();
    this.sendJson(res, 200, { agents });
  }

  private async handleCreateAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    try {
      const agent = this.agentManager.createAgent(body as { model: string } & Record<string, unknown>);
      this.agentRouter.refreshBindings(this.agentManager.listAgents());
      this.sendJson(res, 201, { agent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 400, { error: message });
    }
  }

  private async handleUpdateAgent(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const id = params['id'];
    if (!id) {
      this.sendJson(res, 400, { error: 'Missing agent id' });
      return;
    }

    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    try {
      const agent = this.agentManager.updateAgent(id, body);
      this.agentRouter.refreshBindings(this.agentManager.listAgents());
      this.sendJson(res, 200, { agent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 404, { error: message });
    }
  }

  private async handleDeleteAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const id = params['id'];
    if (!id) {
      this.sendJson(res, 400, { error: 'Missing agent id' });
      return;
    }

    try {
      this.agentManager.deleteAgent(id);
      this.agentRouter.refreshBindings(this.agentManager.listAgents());
      this.sendJson(res, 200, { success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 404, { error: message });
    }
  }

  private async handleListTasks(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const tasks = this.cron.listTasks().map((t) => ({
      id: t.id,
      name: t.name,
      schedule: t.schedule,
      enabled: t.enabled,
      running: t.running,
      lastRun: t.lastRun?.toISOString() ?? null,
      nextRun: t.nextRun?.toISOString() ?? null,
    }));

    this.sendJson(res, 200, { tasks });
  }

  private async handleCreateTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body) {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const id = (body['id'] as string) ?? `task_${Date.now()}`;
    const name = (body['name'] as string) ?? id;
    const schedule = (body['schedule'] as string) ?? '*/60 * * * *';
    const intervalMs = (body['intervalMs'] as number) ?? 3600_000;

    this.cron.addTask({
      id,
      name,
      schedule,
      intervalMs,
      handler: async () => {
        this.cron.emit('task:execute', {
          taskId: id,
          type: 'custom',
          message: `Execute custom task: ${name}`,
        });
      },
    });

    this.sendJson(res, 201, { id, name, schedule });
  }

  private async handleDeleteTask(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    const id = params['id'];
    if (!id) {
      this.sendJson(res, 400, { error: 'Missing task id' });
      return;
    }

    const removed = this.cron.removeTask(id);
    if (removed) {
      this.sendJson(res, 200, { success: true });
    } else {
      this.sendJson(res, 404, { error: `Task "${id}" not found` });
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Set CORS headers for localhost development.
   */
  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  /**
   * Send a JSON response.
   */
  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    if (res.headersSent) return;

    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Read and parse a JSON request body.
   */
  private readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;
      const maxBodySize = 10 * 1024 * 1024; // 10 MB

      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > maxBodySize) {
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (!body.trim()) {
            resolve({});
            return;
          }
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });

      req.on('error', () => resolve(null));
    });
  }

  /**
   * Recursively redact values that look like secrets.
   */
  private redactSecrets(obj: Record<string, unknown>): void {
    const sensitiveKeys = new Set([
      'token', 'apiKey', 'api_key', 'secret', 'password',
      'key', 'credential', 'auth',
    ]);

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && sensitiveKeys.has(key.toLowerCase())) {
        obj[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.startsWith('$vault:')) {
        obj[key] = '[VAULT_REF]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.redactSecrets(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            this.redactSecrets(item as Record<string, unknown>);
          }
        }
      }
    }
  }
}
