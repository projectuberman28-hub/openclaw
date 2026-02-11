/**
 * @alfred/tools - GatewayTool
 *
 * Manage the Alfred Gateway (HTTP API server):
 *   - status()    – check gateway health
 *   - restart()   – restart the gateway process
 *   - getConfig() – retrieve current gateway configuration
 */

import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:gateway' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayStatus {
  running: boolean;
  host: string;
  port: number;
  uptime: number;
  requestCount: number;
  activeConnections: number;
  version: string;
}

export interface GatewayConfig {
  host: string;
  port: number;
  cors?: { origins: string[] };
  rateLimit?: { windowMs: number; maxRequests: number };
  auth?: { type: string };
}

/**
 * Backend interface for gateway management.
 */
export interface GatewayBackend {
  getStatus(): Promise<GatewayStatus>;
  restart(): Promise<void>;
  getConfig(): Promise<GatewayConfig>;
}

// ---------------------------------------------------------------------------
// GatewayTool
// ---------------------------------------------------------------------------

export class GatewayTool {
  private executor: SafeExecutor;
  private backend: GatewayBackend | null;
  private defaultHost: string;
  private defaultPort: number;

  constructor(
    executor: SafeExecutor,
    backend?: GatewayBackend,
    config?: { host?: string; port?: number },
  ) {
    this.executor = executor;
    this.backend = backend ?? null;
    this.defaultHost = config?.host ?? '127.0.0.1';
    this.defaultPort = config?.port ?? 18789;
  }

  static definition = {
    name: 'gateway',
    description:
      'Manage the Alfred Gateway. Check status, restart, or get configuration.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'restart', 'getConfig'],
          description: 'Gateway action',
        },
      },
      required: ['action'],
    },
  };

  /**
   * Set the gateway backend.
   */
  setBackend(backend: GatewayBackend): void {
    this.backend = backend;
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  async status(execOpts?: ExecuteOptions): Promise<GatewayStatus> {
    if (this.backend) {
      const result = await this.executor.execute(
        'gateway.status',
        async () => this.backend!.getStatus(),
        { timeout: 10_000, ...execOpts },
      );

      if (result.error) {
        return this.defaultStatus(false);
      }

      return result.result as GatewayStatus;
    }

    // Fallback: probe the gateway HTTP endpoint directly
    const result = await this.executor.execute(
      'gateway.status',
      async () => {
        try {
          const url = `http://${this.defaultHost}:${this.defaultPort}/health`;
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(5_000),
          });

          if (resp.ok) {
            const data = (await resp.json()) as Partial<GatewayStatus>;
            return {
              running: true,
              host: this.defaultHost,
              port: this.defaultPort,
              uptime: data.uptime ?? 0,
              requestCount: data.requestCount ?? 0,
              activeConnections: data.activeConnections ?? 0,
              version: data.version ?? 'unknown',
            };
          }

          return this.defaultStatus(false);
        } catch {
          return this.defaultStatus(false);
        }
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      return this.defaultStatus(false);
    }

    return result.result as GatewayStatus;
  }

  // -----------------------------------------------------------------------
  // Restart
  // -----------------------------------------------------------------------

  async restart(execOpts?: ExecuteOptions): Promise<void> {
    if (!this.backend) {
      logger.warn('No gateway backend configured – cannot restart');
      throw new Error('GatewayTool: no backend configured for restart');
    }

    const result = await this.executor.execute(
      'gateway.restart',
      async () => {
        await this.backend!.restart();
        logger.info('Gateway restarted');
      },
      { timeout: 30_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  // -----------------------------------------------------------------------
  // Get config
  // -----------------------------------------------------------------------

  async getConfig(execOpts?: ExecuteOptions): Promise<GatewayConfig> {
    if (this.backend) {
      const result = await this.executor.execute(
        'gateway.getConfig',
        async () => this.backend!.getConfig(),
        { timeout: 10_000, ...execOpts },
      );

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result as GatewayConfig;
    }

    // Return defaults when no backend
    return {
      host: this.defaultHost,
      port: this.defaultPort,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private defaultStatus(running: boolean): GatewayStatus {
    return {
      running,
      host: this.defaultHost,
      port: this.defaultPort,
      uptime: 0,
      requestCount: 0,
      activeConnections: 0,
      version: 'unknown',
    };
  }
}
