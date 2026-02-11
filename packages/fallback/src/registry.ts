/**
 * @alfred/fallback - FallbackRegistry
 *
 * Singleton registry that maps capability names (e.g. "embedding", "llm",
 * "search") to their configured FallbackChain instances.
 *
 * Ships with sensible default chain definitions for every Alfred capability.
 * Consumers can override or extend them at runtime.
 */

import pino from 'pino';
import { FallbackChain, type FallbackProvider } from './chain.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of an individual provider within a chain. */
export interface ProviderStatus {
  name: string;
  available: boolean;
}

/** Aggregate status returned by getChainStatus(). */
export interface ChainStatus {
  providers: ProviderStatus[];
}

// ---------------------------------------------------------------------------
// Stub provider factory
// ---------------------------------------------------------------------------

/**
 * Create a stub FallbackProvider for a named backend.
 *
 * The stub's `execute()` always rejects (it must be replaced with real
 * implementations at startup), but `isAvailable()` does a lightweight
 * check -- by default it returns `false`.
 *
 * This keeps the registry purely declarative; real provider adapters are
 * wired in by the host application.
 */
function stub<T>(
  name: string,
  priority: number,
  isAvailableFn?: () => Promise<boolean>,
): FallbackProvider<T> {
  return {
    name,
    priority,
    isAvailable: isAvailableFn ?? (async () => false),
    execute: async (_input: unknown): Promise<T> => {
      throw new Error(
        `Provider "${name}" is a stub. Register a real implementation via FallbackRegistry.registerChain().`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Default chain definitions
// ---------------------------------------------------------------------------

function createDefaultEmbeddingChain(): FallbackChain<Float64Array> {
  return new FallbackChain<Float64Array>({
    providers: [
      stub<Float64Array>('ONNX', 10),
      stub<Float64Array>('TransformersJS', 20),
      stub<Float64Array>('Ollama', 30),
      stub<Float64Array>('Voyage AI', 40),
    ],
    timeoutMs: 30_000,
  });
}

function createDefaultLlmChain(): FallbackChain<string> {
  return new FallbackChain<string>({
    providers: [
      stub<string>('Ollama', 10),
      stub<string>('Anthropic', 20),
      stub<string>('OpenAI', 30),
    ],
    timeoutMs: 60_000,
  });
}

function createDefaultSearchChain(): FallbackChain<unknown> {
  return new FallbackChain<unknown>({
    providers: [
      stub<unknown>('SearXNG', 10),
      stub<unknown>('Grok', 20),
      stub<unknown>('Brave', 30),
      stub<unknown>('DuckDuckGo', 40),
    ],
    timeoutMs: 15_000,
  });
}

function createDefaultTtsChain(): FallbackChain<Buffer> {
  return new FallbackChain<Buffer>({
    providers: [
      stub<Buffer>('local', 10),
      stub<Buffer>('cloud', 20),
    ],
    timeoutMs: 30_000,
  });
}

function createDefaultSttChain(): FallbackChain<string> {
  return new FallbackChain<string>({
    providers: [
      stub<string>('local', 10),
      stub<string>('cloud', 20),
    ],
    timeoutMs: 30_000,
  });
}

// ---------------------------------------------------------------------------
// FallbackRegistry (singleton)
// ---------------------------------------------------------------------------

/**
 * Central registry of fallback chains keyed by capability name.
 *
 * ```ts
 * const registry = FallbackRegistry.getInstance();
 * const chain = registry.getChain('llm');
 * const { result } = await chain!.execute(prompt);
 * ```
 */
export class FallbackRegistry {
  private static instance: FallbackRegistry | undefined;

  private readonly chains = new Map<string, FallbackChain<any>>();
  private readonly log: pino.Logger;

  private constructor(logger?: pino.Logger) {
    this.log = logger ?? pino({ name: '@alfred/fallback-registry' });
    this.registerDefaults();
  }

  /** Get (or create) the singleton instance. */
  static getInstance(logger?: pino.Logger): FallbackRegistry {
    if (!FallbackRegistry.instance) {
      FallbackRegistry.instance = new FallbackRegistry(logger);
    }
    return FallbackRegistry.instance;
  }

  /**
   * Reset the singleton. Primarily useful in tests.
   */
  static resetInstance(): void {
    FallbackRegistry.instance = undefined;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register (or replace) a chain for a given capability.
   */
  registerChain(capability: string, chain: FallbackChain<any>): void {
    this.log.info({ capability, providers: chain.getProviderNames() }, 'Registered fallback chain');
    this.chains.set(capability, chain);
  }

  /**
   * Retrieve the chain for a capability, or `undefined` if none is registered.
   */
  getChain(capability: string): FallbackChain<any> | undefined {
    return this.chains.get(capability);
  }

  /**
   * List all registered capability names.
   */
  listChains(): string[] {
    return Array.from(this.chains.keys());
  }

  /**
   * Check every provider in a given chain for availability.
   */
  async getChainStatus(capability: string): Promise<ChainStatus> {
    const chain = this.chains.get(capability);
    if (!chain) {
      throw new Error(`No fallback chain registered for capability "${capability}"`);
    }
    const providers = await chain.checkAvailability();
    return { providers };
  }

  /**
   * Check availability of all chains in the registry.
   */
  async getAllChainStatuses(): Promise<Map<string, ChainStatus>> {
    const statuses = new Map<string, ChainStatus>();
    for (const capability of this.chains.keys()) {
      statuses.set(capability, await this.getChainStatus(capability));
    }
    return statuses;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private registerDefaults(): void {
    this.chains.set('embedding', createDefaultEmbeddingChain());
    this.chains.set('llm', createDefaultLlmChain());
    this.chains.set('search', createDefaultSearchChain());
    this.chains.set('tts', createDefaultTtsChain());
    this.chains.set('stt', createDefaultSttChain());

    this.log.info(
      { capabilities: Array.from(this.chains.keys()) },
      'Default fallback chains registered',
    );
  }
}
