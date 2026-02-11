/**
 * @alfred/models - Model Provider Interface & Factory
 *
 * Defines the ModelProvider contract and provides a factory function
 * to create the appropriate provider for a given model identifier.
 */

import type { StreamChunk } from '@alfred/agent/streaming.js';
import type { PrivacyGate } from '@alfred/privacy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  [key: string]: unknown;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  stream?: boolean;
  sessionId?: string;
  channel?: string;
}

/**
 * The ModelProvider interface that all LLM providers must implement.
 */
export interface ModelProvider {
  /** Provider name (e.g., 'anthropic', 'openai', 'ollama'). */
  name: string;

  /** The specific model being used. */
  model: string;

  /**
   * Send a chat completion request with streaming response.
   * Yields StreamChunk objects as data arrives.
   */
  chat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk>;

  /**
   * Check if this provider is currently available.
   */
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Model ID parsing
// ---------------------------------------------------------------------------

/**
 * Parse a model identifier string into provider and model parts.
 *
 * Format: "provider/model-name"
 * Examples:
 *   "anthropic/claude-sonnet-4-20250514" -> { provider: "anthropic", model: "claude-sonnet-4-20250514" }
 *   "ollama/llama3.1" -> { provider: "ollama", model: "llama3.1" }
 *   "openai/gpt-4o" -> { provider: "openai", model: "gpt-4o" }
 */
export function parseModelId(id: string): { provider: string; model: string } {
  const slashIndex = id.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model ID "${id}": must be in provider/model format (e.g., anthropic/claude-sonnet-4-20250514)`,
    );
  }

  const provider = id.slice(0, slashIndex).toLowerCase().trim();
  const model = id.slice(slashIndex + 1).trim();

  if (!provider || !model) {
    throw new Error(
      `Invalid model ID "${id}": provider and model must both be non-empty`,
    );
  }

  return { provider, model };
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/** Known local providers that do not need a privacy gate. */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'local']);

/**
 * Create a ModelProvider instance for the given model ID.
 *
 * @param modelId - Full model identifier (e.g., "anthropic/claude-sonnet-4-20250514")
 * @param privacyGate - Optional privacy gate for cloud providers
 */
export async function createProvider(
  modelId: string,
  privacyGate?: PrivacyGate,
): Promise<ModelProvider> {
  const { provider, model } = parseModelId(modelId);

  switch (provider) {
    case 'anthropic': {
      const { AnthropicProvider } = await import('./anthropic.js');
      return new AnthropicProvider(model, privacyGate);
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(model, privacyGate);
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./ollama.js');
      return new OllamaProvider(model);
    }
    case 'lmstudio': {
      const { LMStudioProvider } = await import('./lmstudio.js');
      return new LMStudioProvider(model);
    }
    default:
      throw new Error(
        `Unknown provider "${provider}". Supported: anthropic, openai, ollama, lmstudio`,
      );
  }
}

/**
 * Check if a model ID references a local provider.
 */
export function isLocal(modelId: string): boolean {
  try {
    const { provider } = parseModelId(modelId);
    return LOCAL_PROVIDERS.has(provider);
  } catch {
    return false;
  }
}
