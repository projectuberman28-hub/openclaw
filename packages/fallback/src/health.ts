/**
 * @alfred/fallback - HealthChecker
 *
 * Periodically probes every provider in every registered FallbackChain,
 * tracks consecutive failures, marks providers as degraded, and exposes
 * a structured health report.
 */

import pino from 'pino';
import { FallbackRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Health snapshot for a single provider. */
export interface ProviderHealth {
  name: string;
  available: boolean;
  lastCheck: Date;
  lastLatencyMs: number;
  consecutiveFailures: number;
  /** True when consecutiveFailures >= degradedThreshold. */
  degraded: boolean;
}

/** Overall status level. */
export type OverallStatus = 'healthy' | 'degraded' | 'down';

/** Per-capability summary inside a HealthReport. */
export interface CapabilityHealth {
  capability: string;
  providers: ProviderHealth[];
  /** Best overall status across all providers in this capability. */
  status: OverallStatus;
}

/** Top-level health report returned by getReport(). */
export interface HealthReport {
  overallStatus: OverallStatus;
  capabilities: CapabilityHealth[];
  lastFullCheck: Date | null;
}

// ---------------------------------------------------------------------------
// HealthChecker
// ---------------------------------------------------------------------------

/**
 * Background health checker that polls all registered fallback chains on a
 * configurable interval (default 60 s).
 *
 * ```ts
 * const checker = new HealthChecker(registry, {
 *   intervalMs: 30_000,
 *   degradedThreshold: 3,
 *   onDegraded: (cap, provider) => alert(`${cap}/${provider} is degraded`),
 * });
 * checker.start();
 * // later...
 * checker.stop();
 * const report = checker.getReport();
 * ```
 */
export class HealthChecker {
  private readonly registry: FallbackRegistry;
  private readonly log: pino.Logger;
  private readonly degradedThreshold: number;
  private readonly onDegraded?: (capability: string, providerName: string) => void;

  /** capability -> providerName -> ProviderHealth */
  private readonly healthMap = new Map<string, Map<string, ProviderHealth>>();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastFullCheck: Date | null = null;
  private defaultIntervalMs: number;

  constructor(
    registry?: FallbackRegistry,
    options?: {
      intervalMs?: number;
      degradedThreshold?: number;
      onDegraded?: (capability: string, providerName: string) => void;
      logger?: pino.Logger;
    },
  ) {
    this.registry = registry ?? FallbackRegistry.getInstance();
    this.defaultIntervalMs = options?.intervalMs ?? 60_000;
    this.degradedThreshold = options?.degradedThreshold ?? 3;
    this.onDegraded = options?.onDegraded;
    this.log = options?.logger ?? pino({ name: '@alfred/fallback-health' });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the background polling loop.
   *
   * @param intervalMs - Override the default interval for this run.
   */
  start(intervalMs?: number): void {
    if (this.intervalHandle) {
      this.log.warn('HealthChecker already running -- ignoring start()');
      return;
    }

    const ms = intervalMs ?? this.defaultIntervalMs;
    this.log.info({ intervalMs: ms }, 'Starting health checker');

    // Fire immediately, then repeat
    void this.checkAll();

    this.intervalHandle = setInterval(() => {
      void this.checkAll();
    }, ms);

    // Allow the Node process to exit even if the interval is still active
    if (typeof this.intervalHandle === 'object' && 'unref' in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }

  /**
   * Stop the background polling loop and clean up the interval.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.log.info('Health checker stopped');
    }
  }

  /** Whether the background loop is currently active. */
  get running(): boolean {
    return this.intervalHandle !== null;
  }

  // -----------------------------------------------------------------------
  // Checks
  // -----------------------------------------------------------------------

  /**
   * Run a health check across every registered chain and return the results.
   */
  async checkAll(): Promise<Map<string, ProviderHealth[]>> {
    const capabilities = this.registry.listChains();
    const results = new Map<string, ProviderHealth[]>();

    for (const capability of capabilities) {
      const providerHealths = await this.checkChain(capability);
      results.set(capability, providerHealths);
    }

    this.lastFullCheck = new Date();
    return results;
  }

  /**
   * Run a health check for a single capability chain.
   */
  async checkChain(capability: string): Promise<ProviderHealth[]> {
    const chain = this.registry.getChain(capability);
    if (!chain) {
      throw new Error(`No chain registered for capability "${capability}"`);
    }

    const providerNames = chain.getProviderNames();
    const availabilityResults = await chain.checkAvailability();

    // Ensure we have a sub-map for this capability
    if (!this.healthMap.has(capability)) {
      this.healthMap.set(capability, new Map<string, ProviderHealth>());
    }
    const capMap = this.healthMap.get(capability)!;

    const healthResults: ProviderHealth[] = [];

    for (const { name, available } of availabilityResults) {
      const start = performance.now();
      const latencyMs = Math.round(performance.now() - start);

      // Get or create the health record
      const existing = capMap.get(name);
      const consecutiveFailures = available
        ? 0
        : (existing?.consecutiveFailures ?? 0) + 1;

      const degraded = consecutiveFailures >= this.degradedThreshold;

      const health: ProviderHealth = {
        name,
        available,
        lastCheck: new Date(),
        lastLatencyMs: latencyMs,
        consecutiveFailures,
        degraded,
      };

      capMap.set(name, health);
      healthResults.push(health);

      // Fire the degraded callback when the threshold is crossed
      if (degraded && existing && !existing.degraded) {
        this.log.warn(
          { capability, provider: name, consecutiveFailures },
          'Provider marked degraded',
        );
        this.onDegraded?.(capability, name);
      }

      if (!available) {
        this.log.debug(
          { capability, provider: name, consecutiveFailures },
          'Provider unavailable',
        );
      }
    }

    return healthResults;
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------

  /**
   * Build a structured health report from the most recently cached data.
   */
  getReport(): HealthReport {
    const capabilities: CapabilityHealth[] = [];

    for (const [capability, capMap] of this.healthMap) {
      const providers = Array.from(capMap.values());
      const status = deriveCapabilityStatus(providers);

      capabilities.push({ capability, providers, status });
    }

    const overallStatus = deriveOverallStatus(capabilities);

    return {
      overallStatus,
      capabilities,
      lastFullCheck: this.lastFullCheck,
    };
  }

  /**
   * Reset all tracked health data. Useful in tests.
   */
  reset(): void {
    this.healthMap.clear();
    this.lastFullCheck = null;
  }
}

// ---------------------------------------------------------------------------
// Status derivation helpers
// ---------------------------------------------------------------------------

/**
 * Derive the status for a single capability based on its providers.
 *
 * - healthy : at least one provider is available and none is degraded
 * - degraded: at least one provider is available but some are degraded
 * - down    : no provider is available
 */
function deriveCapabilityStatus(providers: ProviderHealth[]): OverallStatus {
  const anyAvailable = providers.some((p) => p.available);
  const anyDegraded = providers.some((p) => p.degraded);

  if (!anyAvailable) return 'down';
  if (anyDegraded) return 'degraded';
  return 'healthy';
}

/**
 * Derive the overall status across all capabilities.
 *
 * - healthy : every capability is healthy
 * - degraded: at least one capability is degraded (but none is down)
 * - down    : at least one capability is completely down
 */
function deriveOverallStatus(capabilities: CapabilityHealth[]): OverallStatus {
  if (capabilities.length === 0) return 'healthy';

  const hasDown = capabilities.some((c) => c.status === 'down');
  if (hasDown) return 'down';

  const hasDegraded = capabilities.some((c) => c.status === 'degraded');
  if (hasDegraded) return 'degraded';

  return 'healthy';
}
