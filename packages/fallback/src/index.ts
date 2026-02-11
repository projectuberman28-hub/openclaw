/**
 * @alfred/fallback - Fallback chain execution for all capabilities
 *
 * Provides generic, priority-ordered provider failover with:
 *   - Configurable timeouts and HTTP-status-aware failover logic
 *   - A singleton registry with default chains for every Alfred capability
 *   - Background health checking with degradation detection
 *
 * @packageDocumentation
 */

// Chain - core execution engine
export {
  FallbackChain,
  FallbackChainError,
  HttpError,
  isHttpFailoverEligible,
  type FallbackProvider,
  type FallbackAttempt,
  type FallbackResult,
  type FallbackChainOptions,
} from './chain.js';

// Registry - singleton capability -> chain mapping
export {
  FallbackRegistry,
  type ProviderStatus,
  type ChainStatus,
} from './registry.js';

// Health - background monitoring
export {
  HealthChecker,
  type ProviderHealth,
  type CapabilityHealth,
  type HealthReport,
  type OverallStatus,
} from './health.js';
