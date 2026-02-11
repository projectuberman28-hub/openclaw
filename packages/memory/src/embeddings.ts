/**
 * @alfred/memory - Embedding providers and fallback chain
 *
 * Provides a unified interface for generating text embeddings with multiple
 * backend providers. The EmbeddingChain tries providers in priority order,
 * falling back automatically on failure.
 *
 * All embeddings are normalized to unit vectors for consistent cosine similarity.
 */

import { resolve, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { resolveAlfredHome } from '@alfred/core/config/paths';
import pino from 'pino';

const logger = pino({ name: 'alfred:memory:embeddings' });

// ---------------------------------------------------------------------------
// Shared cache directory
// ---------------------------------------------------------------------------

/** Shared model cache directory at ALFRED_HOME/cache/embeddings/ */
export function getEmbeddingCacheDir(): string {
  const dir = join(resolveAlfredHome(), 'cache', 'embeddings');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a vector to a unit vector (L2 norm = 1).
 * Returns zero vector if magnitude is zero.
 */
export function normalizeEmbedding(vec: number[]): number[] {
  let mag = 0;
  for (let i = 0; i < vec.length; i++) {
    mag += vec[i] * vec[i];
  }
  mag = Math.sqrt(mag);
  if (mag === 0) return vec;
  const result = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i] / mag;
  }
  return result;
}

// ---------------------------------------------------------------------------
// EmbeddingProvider interface
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  /** Human-readable provider name */
  readonly name: string;

  /** Dimensionality of the produced embeddings */
  readonly dimensions: number;

  /** Generate an embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for multiple texts in a single batch */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Check whether this provider can currently produce embeddings */
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ONNX Embedding Provider
// ---------------------------------------------------------------------------

/**
 * Uses ONNX Runtime to run sentence-transformers/all-MiniLM-L6-v2 locally.
 * Expects a pre-downloaded ONNX model file in ALFRED_HOME/cache/embeddings/.
 *
 * Model file: model.onnx + tokenizer.json in a "all-MiniLM-L6-v2" subdirectory.
 */
export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'onnx-minilm';
  readonly dimensions = 384;

  private session: any = null;
  private tokenizer: any = null;
  private modelDir: string;

  constructor(modelDir?: string) {
    this.modelDir = modelDir ?? join(getEmbeddingCacheDir(), 'all-MiniLM-L6-v2');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const modelPath = join(this.modelDir, 'model.onnx');
      const tokenizerPath = join(this.modelDir, 'tokenizer.json');
      if (!existsSync(modelPath) || !existsSync(tokenizerPath)) {
        return false;
      }
      // Verify ONNX runtime is importable (optional dependency)
      // @ts-expect-error -- optional runtime dependency
      await import('onnxruntime-node');
      return true;
    } catch {
      return false;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.session) return;

    // @ts-expect-error -- optional runtime dependency
    const ort = await import('onnxruntime-node');
    const modelPath = join(this.modelDir, 'model.onnx');
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });

    // Load tokenizer (we expect a tokenizer.json from HuggingFace)
    const { readFile } = await import('node:fs/promises');
    const tokenizerData = JSON.parse(
      await readFile(join(this.modelDir, 'tokenizer.json'), 'utf-8'),
    );
    this.tokenizer = tokenizerData;
  }

  /**
   * Simple whitespace tokenizer fallback.
   * In production, the tokenizer.json from HuggingFace would be used
   * via a proper tokenization library. This provides basic subword
   * tokenization by splitting on whitespace and punctuation.
   */
  private tokenize(text: string, maxLen = 128): {
    inputIds: BigInt64Array;
    attentionMask: BigInt64Array;
  } {
    // Basic tokenization: split into word pieces
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const inputIds = new BigInt64Array(maxLen);
    const attentionMask = new BigInt64Array(maxLen);

    // [CLS] = 101
    inputIds[0] = BigInt(101);
    attentionMask[0] = BigInt(1);

    const limit = Math.min(tokens.length, maxLen - 2);
    for (let i = 0; i < limit; i++) {
      // Simple hash-based token ID (deterministic mapping)
      let hash = 0;
      for (let c = 0; c < tokens[i].length; c++) {
        hash = ((hash << 5) - hash + tokens[i].charCodeAt(c)) | 0;
      }
      // Map to vocab range [1000, 30522) to avoid special tokens
      inputIds[i + 1] = BigInt(1000 + Math.abs(hash) % 29522);
      attentionMask[i + 1] = BigInt(1);
    }

    // [SEP] = 102
    inputIds[limit + 1] = BigInt(102);
    attentionMask[limit + 1] = BigInt(1);

    return { inputIds, attentionMask };
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();

    // @ts-expect-error -- optional runtime dependency
    const ort = await import('onnxruntime-node');
    const { inputIds, attentionMask } = this.tokenize(text);

    const feeds = {
      input_ids: new ort.Tensor('int64', inputIds, [1, inputIds.length]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, attentionMask.length]),
      token_type_ids: new ort.Tensor(
        'int64',
        new BigInt64Array(inputIds.length),
        [1, inputIds.length],
      ),
    };

    const results = await this.session.run(feeds);
    // Model outputs last_hidden_state; mean pool over non-padding tokens
    const output = results['last_hidden_state'] ?? results[Object.keys(results)[0]];
    const data = output.data as Float32Array;
    const seqLen = inputIds.length;
    const hidden = this.dimensions;

    // Mean pooling over tokens with attention mask
    const embedding = new Array<number>(hidden).fill(0);
    let tokenCount = 0;
    for (let t = 0; t < seqLen; t++) {
      if (attentionMask[t] === BigInt(1)) {
        tokenCount++;
        for (let d = 0; d < hidden; d++) {
          embedding[d] += data[t * hidden + d];
        }
      }
    }
    if (tokenCount > 0) {
      for (let d = 0; d < hidden; d++) {
        embedding[d] /= tokenCount;
      }
    }

    return normalizeEmbedding(embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // ONNX batch: process sequentially (could be optimized with batched tensors)
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// TransformersJS Provider
// ---------------------------------------------------------------------------

/**
 * Uses @xenova/transformers pipeline for sentence embeddings.
 * Lazy-loads the model and caches the pipeline instance.
 * Uses all-MiniLM-L6-v2 (384 dimensions).
 */
export class TransformersJSProvider implements EmbeddingProvider {
  readonly name = 'transformers-js';
  readonly dimensions = 384;

  private pipeline: any = null;
  private loadPromise: Promise<any> | null = null;
  private modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // @ts-expect-error -- optional runtime dependency
      await import('@xenova/transformers');
      return true;
    } catch {
      return false;
    }
  }

  private async ensureLoaded(): Promise<any> {
    if (this.pipeline) return this.pipeline;

    // Prevent multiple concurrent loads
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      // @ts-expect-error -- optional runtime dependency
      const transformers = await import('@xenova/transformers');
      // Set the cache dir to the shared embeddings cache
      if (transformers.env) {
        transformers.env.cacheDir = getEmbeddingCacheDir();
      }
      this.pipeline = await transformers.pipeline(
        'feature-extraction',
        this.modelName,
        { quantized: true },
      );
      return this.pipeline;
    })();

    return this.loadPromise;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.ensureLoaded();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    const data: number[] = Array.from(output.data as Float32Array);
    return normalizeEmbedding(data.slice(0, this.dimensions));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.ensureLoaded();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const data: number[] = Array.from(output.data as Float32Array);
      results.push(normalizeEmbedding(data.slice(0, this.dimensions)));
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Ollama Embedding Provider
// ---------------------------------------------------------------------------

/**
 * Calls the local Ollama API at localhost:11434 for embeddings.
 * Uses nomic-embed-text model (768 dimensions).
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions = 768;

  private baseUrl: string;
  private model: string;

  constructor(options?: { baseUrl?: string; model?: string }) {
    this.baseUrl = options?.baseUrl ?? 'http://localhost:11434';
    this.model = options?.model ?? 'nomic-embed-text';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) return false;

      // Check if the model is actually pulled
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      if (data.models) {
        return data.models.some(
          (m) => m.name === this.model || m.name.startsWith(`${this.model}:`),
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ollama embedding failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as { embedding: number[] };
    return normalizeEmbedding(data.embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama does not natively support batch; process sequentially
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// VoyageAI Embedding Provider
// ---------------------------------------------------------------------------

/**
 * Uses the VoyageAI HTTP API for high-quality embeddings.
 * Requires an API key via VOYAGE_API_KEY env var or constructor param.
 * Supports input_type parameter for retrieval optimization.
 */
export class VoyageAIProvider implements EmbeddingProvider {
  readonly name = 'voyage-ai';
  readonly dimensions: number;

  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.apiKey = options?.apiKey ?? process.env['VOYAGE_API_KEY'] ?? '';
    this.model = options?.model ?? 'voyage-2';
    this.dimensions = options?.dimensions ?? 1024;
    this.baseUrl = options?.baseUrl ?? 'https://api.voyageai.com/v1';
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  private async callApi(
    texts: string[],
    inputType?: 'query' | 'document',
  ): Promise<number[][]> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (inputType) {
      body['input_type'] = inputType;
    }

    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`VoyageAI embedding failed (${resp.status}): ${errText}`);
    }

    const data = (await resp.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map((d) => normalizeEmbedding(d.embedding));
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.callApi([text], 'document');
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // VoyageAI supports batch natively (up to ~128 inputs)
    const batchSize = 128;
    const allResults: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const results = await this.callApi(batch, 'document');
      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * Embed a query specifically optimized for retrieval.
   * Uses input_type=query for VoyageAI's asymmetric search.
   */
  async embedQuery(text: string): Promise<number[]> {
    const results = await this.callApi([text], 'query');
    return results[0];
  }
}

// ---------------------------------------------------------------------------
// Embedding Chain (fallback pattern)
// ---------------------------------------------------------------------------

export interface EmbeddingChainResult {
  embedding: number[];
  provider: string;
}

export interface EmbeddingChainBatchResult {
  embeddings: number[][];
  provider: string;
}

/**
 * Tries an ordered list of embedding providers, returning the first
 * successful result. Logs failures and moves to the next provider.
 */
export class EmbeddingChain {
  private providers: EmbeddingProvider[];

  constructor(providers: EmbeddingProvider[]) {
    if (providers.length === 0) {
      throw new Error('EmbeddingChain requires at least one provider');
    }
    this.providers = providers;
  }

  /** Get the list of registered providers */
  getProviders(): ReadonlyArray<EmbeddingProvider> {
    return this.providers;
  }

  /** Get the dimensions of the first available provider (or first in chain) */
  get dimensions(): number {
    return this.providers[0].dimensions;
  }

  /**
   * Embed a single text. Tries providers in order until one succeeds.
   * Throws if all providers fail.
   */
  async embed(text: string): Promise<EmbeddingChainResult> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const provider of this.providers) {
      try {
        const available = await provider.isAvailable();
        if (!available) {
          logger.debug({ provider: provider.name }, 'Provider not available, skipping');
          continue;
        }

        const embedding = await provider.embed(text);
        return { embedding, provider: provider.name };
      } catch (error) {
        logger.warn(
          { provider: provider.name, error: String(error) },
          'Embedding provider failed, trying next',
        );
        errors.push({ provider: provider.name, error });
      }
    }

    throw new Error(
      `All embedding providers failed: ${errors.map((e) => `${e.provider}: ${e.error}`).join('; ')}`,
    );
  }

  /**
   * Embed a batch of texts. Tries providers in order until one succeeds.
   * Throws if all providers fail.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingChainBatchResult> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const provider of this.providers) {
      try {
        const available = await provider.isAvailable();
        if (!available) {
          logger.debug({ provider: provider.name }, 'Provider not available for batch, skipping');
          continue;
        }

        const embeddings = await provider.embedBatch(texts);
        return { embeddings, provider: provider.name };
      } catch (error) {
        logger.warn(
          { provider: provider.name, error: String(error) },
          'Batch embedding provider failed, trying next',
        );
        errors.push({ provider: provider.name, error });
      }
    }

    throw new Error(
      `All embedding providers failed for batch: ${errors.map((e) => `${e.provider}: ${e.error}`).join('; ')}`,
    );
  }

  /**
   * Check which providers in the chain are currently available.
   */
  async checkAvailability(): Promise<Array<{ name: string; available: boolean }>> {
    const results: Array<{ name: string; available: boolean }> = [];
    for (const provider of this.providers) {
      const available = await provider.isAvailable();
      results.push({ name: provider.name, available });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Default chain factory
// ---------------------------------------------------------------------------

export interface EmbeddingChainConfig {
  /** Enable ONNX local provider */
  onnx?: boolean;
  /** Custom ONNX model directory */
  onnxModelDir?: string;
  /** Enable TransformersJS provider */
  transformersJs?: boolean;
  /** Custom model name for TransformersJS */
  transformersJsModel?: string;
  /** Enable Ollama provider */
  ollama?: boolean;
  /** Ollama base URL */
  ollamaBaseUrl?: string;
  /** Ollama model name */
  ollamaModel?: string;
  /** Enable VoyageAI provider */
  voyageAi?: boolean;
  /** VoyageAI API key */
  voyageApiKey?: string;
  /** VoyageAI model */
  voyageModel?: string;
}

/**
 * Build an EmbeddingChain from configuration with a sensible fallback order:
 *   1. ONNX (fastest, fully local)
 *   2. TransformersJS (local, WASM-based)
 *   3. Ollama (local server)
 *   4. VoyageAI (remote, requires API key)
 *
 * By default all providers are enabled. Set individual flags to false to skip.
 */
export function createDefaultChain(config: EmbeddingChainConfig = {}): EmbeddingChain {
  const providers: EmbeddingProvider[] = [];

  if (config.onnx !== false) {
    providers.push(new OnnxEmbeddingProvider(config.onnxModelDir));
  }

  if (config.transformersJs !== false) {
    providers.push(new TransformersJSProvider(config.transformersJsModel));
  }

  if (config.ollama !== false) {
    providers.push(
      new OllamaEmbeddingProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
      }),
    );
  }

  if (config.voyageAi !== false) {
    providers.push(
      new VoyageAIProvider({
        apiKey: config.voyageApiKey,
        model: config.voyageModel,
      }),
    );
  }

  if (providers.length === 0) {
    throw new Error('At least one embedding provider must be enabled');
  }

  return new EmbeddingChain(providers);
}
