/**
 * @alfred/gateway - Health Monitor
 *
 * Checks the health of all Alfred services:
 * - Gateway itself
 * - Ollama (localhost:11434)
 * - SearXNG (localhost:8888)
 * - Memory database
 * - Channel connections
 */

import { existsSync } from 'node:fs';
import { buildPaths } from '@alfred/core/config/paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: Date;
  latencyMs: number;
  details?: string;
}

export interface HealthReport {
  gateway: ServiceStatus;
  ollama: ServiceStatus;
  searxng: ServiceStatus;
  memory: ServiceStatus;
  channels: Record<string, ServiceStatus>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ping an HTTP endpoint and return a ServiceStatus.
 */
async function pingHttp(
  url: string,
  timeoutMs: number = 5000,
): Promise<ServiceStatus> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return {
        status: 'healthy',
        lastCheck: new Date(),
        latencyMs,
      };
    }

    return {
      status: 'degraded',
      lastCheck: new Date(),
      latencyMs,
      details: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    return {
      status: 'down',
      lastCheck: new Date(),
      latencyMs,
      details: message,
    };
  }
}

// ---------------------------------------------------------------------------
// HealthMonitor
// ---------------------------------------------------------------------------

export class HealthMonitor {
  private startTime: number;
  private ollamaUrl: string;
  private searxngUrl: string;
  private channelStatusFn: (() => Record<string, boolean>) | null = null;

  constructor(options?: {
    ollamaUrl?: string;
    searxngUrl?: string;
  }) {
    this.startTime = Date.now();
    this.ollamaUrl = options?.ollamaUrl ?? 'http://localhost:11434';
    this.searxngUrl = options?.searxngUrl ?? 'http://localhost:8888';
  }

  /**
   * Register a function that returns channel connection statuses.
   */
  setChannelStatusProvider(fn: () => Record<string, boolean>): void {
    this.channelStatusFn = fn;
  }

  /**
   * Run a full health check across all services.
   */
  async check(): Promise<HealthReport> {
    const [ollama, searxng, memory] = await Promise.all([
      this.checkOllama(),
      this.checkSearXNG(),
      this.checkMemory(),
    ]);

    const channels = this.checkChannels();

    return {
      gateway: {
        status: 'healthy',
        lastCheck: new Date(),
        latencyMs: 0,
        details: `Uptime: ${Math.floor((Date.now() - this.startTime) / 1000)}s`,
      },
      ollama,
      searxng,
      memory,
      channels,
    };
  }

  /**
   * Quick liveness check - just returns gateway status.
   */
  getLiveness(): { status: string; uptime: number } {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Ping Ollama at localhost:11434.
   */
  private async checkOllama(): Promise<ServiceStatus> {
    return pingHttp(`${this.ollamaUrl}/api/tags`);
  }

  /**
   * Ping SearXNG at localhost:8888.
   */
  private async checkSearXNG(): Promise<ServiceStatus> {
    return pingHttp(`${this.searxngUrl}/healthz`);
  }

  /**
   * Check memory database exists on disk.
   */
  private async checkMemory(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      const paths = buildPaths();
      const memDir = paths.memory;
      const exists = existsSync(memDir);
      const latencyMs = Date.now() - start;

      return {
        status: exists ? 'healthy' : 'degraded',
        lastCheck: new Date(),
        latencyMs,
        details: exists ? `Memory dir: ${memDir}` : `Memory dir not found: ${memDir}`,
      };
    } catch (err) {
      return {
        status: 'down',
        lastCheck: new Date(),
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check channel connection statuses.
   */
  private checkChannels(): Record<string, ServiceStatus> {
    const result: Record<string, ServiceStatus> = {};

    if (!this.channelStatusFn) {
      return result;
    }

    const statuses = this.channelStatusFn();
    const now = new Date();

    for (const [name, connected] of Object.entries(statuses)) {
      result[name] = {
        status: connected ? 'healthy' : 'down',
        lastCheck: now,
        latencyMs: 0,
        details: connected ? 'Connected' : 'Disconnected',
      };
    }

    return result;
  }
}
