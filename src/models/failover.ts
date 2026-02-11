/**
 * @alfred/models - Model Failover
 *
 * Uses the FallbackChain from @alfred/fallback to provide automatic
 * failover between model providers. HTTP 400 is failover-eligible.
 * Providers are tried in config order.
 */

import {
  FallbackChain,
  HttpError,
  type FallbackProvider,
} from '@alfred/fallback';
import type { PrivacyGate } from '@alfred/privacy';
import type { StreamChunk } from '@alfred/agent/streaming.js';
import { createProvider, parseModelId, type ModelProvider, type ChatMessage, type ChatOptions } from './provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FailoverConfig {
  /** Ordered list of model IDs to try (e.g., ["ollama/llama3.1", "anthropic/claude-sonnet-4-20250514"]). */
  models: string[];
  /** Per-provider timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** Callback when failover occurs. */
  onFallback?: (from: string, to: string, error: string) => void;
}

/**
 * A streaming result that wraps the provider name and an async generator.
 */
export interface StreamingResult {
  provider: string;
  stream: AsyncGenerator<StreamChunk>;
}

// ---------------------------------------------------------------------------
// ModelFailover
// ---------------------------------------------------------------------------

export class ModelFailover {
  private providerInstances: ModelProvider[] = [];
  private fallbackChain: FallbackChain<StreamingResult> | null = null;
  private config: FailoverConfig;
  private privacyGate: PrivacyGate | undefined;
  private initialized = false;

  constructor(config: FailoverConfig, privacyGate?: PrivacyGate) {
    this.config = config;
    this.privacyGate = privacyGate;
  }

  /**
   * Initialize all model providers and build the fallback chain.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create provider instances for each model
    this.providerInstances = [];
    for (const modelId of this.config.models) {
      try {
        const provider = await createProvider(modelId, this.privacyGate);
        this.providerInstances.push(provider);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[ModelFailover] Failed to create provider for ${modelId}: ${message}`);
      }
    }

    if (this.providerInstances.length === 0) {
      throw new Error('[ModelFailover] No providers could be initialized');
    }

    // Build fallback chain
    // We wrap the streaming chat method into a FallbackProvider
    const fallbackProviders: FallbackProvider<StreamingResult>[] =
      this.providerInstances.map((provider, index) => ({
        name: `${provider.name}/${provider.model}`,
        priority: index * 10, // Config order determines priority
        isAvailable: () => provider.isAvailable(),
        execute: async (input: unknown): Promise<StreamingResult> => {
          const { messages, options } = input as {
            messages: ChatMessage[];
            options?: ChatOptions;
          };

          // Return a streaming result -- the consumer iterates the generator
          const stream = provider.chat(messages, options);
          return { provider: `${provider.name}/${provider.model}`, stream };
        },
      }));

    this.fallbackChain = new FallbackChain<StreamingResult>({
      providers: fallbackProviders,
      timeoutMs: this.config.timeoutMs ?? 60_000,
      onFallback: this.config.onFallback,
    });

    this.initialized = true;
    console.log(
      `[ModelFailover] Initialized with ${this.providerInstances.length} providers: ` +
      this.providerInstances.map((p) => `${p.name}/${p.model}`).join(', '),
    );
  }

  /**
   * Execute a chat with automatic failover.
   *
   * Tries each provider in config order. If a provider fails with
   * a failover-eligible error (including HTTP 400), the next provider is tried.
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<StreamingResult> {
    if (!this.fallbackChain) {
      await this.initialize();
    }

    const result = await this.fallbackChain!.execute({ messages, options });
    return result.result;
  }

  /**
   * Check availability of all configured providers.
   */
  async checkAvailability(): Promise<Array<{ name: string; available: boolean }>> {
    if (!this.fallbackChain) {
      await this.initialize();
    }

    return this.fallbackChain!.checkAvailability();
  }

  /**
   * Get the list of provider names in failover order.
   */
  getProviderNames(): string[] {
    return this.providerInstances.map((p) => `${p.name}/${p.model}`);
  }
}
