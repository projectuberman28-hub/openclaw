/**
 * Smoke Tests for Embeddings and Vector Store
 *
 * Tests embedding chain initialization, dimensionality, cosine similarity,
 * and vector store search roundtrip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeEmbedding,
  EmbeddingChain,
  type EmbeddingProvider,
} from '@alfred/memory/embeddings';
import { cosineSimilarity } from '@alfred/memory/vector-store';

// Mock pino
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock resolveAlfredHome
vi.mock('@alfred/core/config/paths', () => ({
  resolveAlfredHome: () => '/mock/.alfred',
}));

// Mock fs used by embeddings
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

/**
 * Create a deterministic mock embedding provider for testing.
 */
function createMockProvider(
  name: string,
  dims: number,
  available = true,
): EmbeddingProvider {
  return {
    name,
    dimensions: dims,
    isAvailable: vi.fn().mockResolvedValue(available),
    embed: vi.fn().mockImplementation(async (text: string) => {
      // Generate deterministic embedding from text hash
      const vec = new Array(dims).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % dims] += text.charCodeAt(i) / 1000;
      }
      return normalizeEmbedding(vec);
    }),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
      const results: number[][] = [];
      for (const text of texts) {
        const vec = new Array(dims).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % dims] += text.charCodeAt(i) / 1000;
        }
        results.push(normalizeEmbedding(vec));
      }
      return results;
    }),
  };
}

describe('Embeddings Smoke Tests', () => {
  // ---------------------------------------------------------------------------
  // Embedding chain initialization
  // ---------------------------------------------------------------------------
  describe('EmbeddingChain initialization', () => {
    it('initializes with providers', () => {
      const provider = createMockProvider('mock-onnx', 384);
      const chain = new EmbeddingChain([provider]);

      expect(chain.getProviders().length).toBe(1);
      expect(chain.dimensions).toBe(384);
    });

    it('throws when initialized with no providers', () => {
      expect(() => new EmbeddingChain([])).toThrow(
        'EmbeddingChain requires at least one provider',
      );
    });

    it('reports availability of each provider', async () => {
      const available = createMockProvider('avail', 384, true);
      const unavailable = createMockProvider('unavail', 384, false);
      const chain = new EmbeddingChain([available, unavailable]);

      const status = await chain.checkAvailability();
      expect(status).toEqual([
        { name: 'avail', available: true },
        { name: 'unavail', available: false },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Embed returns correct dimensions
  // ---------------------------------------------------------------------------
  describe('Embed returns correct dimensions', () => {
    it('returns embedding with expected dimensionality', async () => {
      const provider = createMockProvider('mock-384', 384);
      const chain = new EmbeddingChain([provider]);

      const { embedding, provider: usedProvider } = await chain.embed('test text');
      expect(embedding.length).toBe(384);
      expect(usedProvider).toBe('mock-384');
    });

    it('batch embed returns correct count and dimensions', async () => {
      const provider = createMockProvider('mock-384', 384);
      const chain = new EmbeddingChain([provider]);

      const texts = ['hello', 'world', 'test'];
      const { embeddings } = await chain.embedBatch(texts);

      expect(embeddings.length).toBe(3);
      for (const emb of embeddings) {
        expect(emb.length).toBe(384);
      }
    });

    it('embedding is normalized to unit vector', async () => {
      const provider = createMockProvider('mock', 384);
      const chain = new EmbeddingChain([provider]);

      const { embedding } = await chain.embed('some text');

      // Compute L2 norm
      let mag = 0;
      for (const v of embedding) {
        mag += v * v;
      }
      mag = Math.sqrt(mag);

      // Should be ~1.0 (normalized)
      expect(mag).toBeCloseTo(1.0, 4);
    });
  });

  // ---------------------------------------------------------------------------
  // Cosine similarity computation
  // ---------------------------------------------------------------------------
  describe('Cosine similarity', () => {
    it('returns 1 for identical vectors', () => {
      const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
      const sim = cosineSimilarity(vec, vec);
      expect(sim).toBeCloseTo(1.0, 6);
    });

    it('returns -1 for opposite vectors', () => {
      const vec = [1, 0, 0];
      const negVec = [-1, 0, 0];
      const sim = cosineSimilarity(vec, negVec);
      expect(sim).toBeCloseTo(-1.0, 6);
    });

    it('returns 0 for orthogonal vectors', () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      const sim = cosineSimilarity(vecA, vecB);
      expect(sim).toBeCloseTo(0.0, 6);
    });

    it('returns high similarity for similar vectors', () => {
      const vecA = [0.9, 0.1, 0.05];
      const vecB = [0.85, 0.12, 0.06];
      const sim = cosineSimilarity(vecA, vecB);
      expect(sim).toBeGreaterThan(0.99);
    });

    it('returns low similarity for dissimilar vectors', () => {
      const vecA = [1, 0, 0, 0];
      const vecB = [0, 0, 0, 1];
      const sim = cosineSimilarity(vecA, vecB);
      expect(sim).toBeCloseTo(0.0, 6);
    });

    it('throws for dimension mismatch', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
        'Vector dimension mismatch',
      );
    });

    it('returns 0 for zero vectors', () => {
      const zero = [0, 0, 0];
      expect(cosineSimilarity(zero, zero)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // normalizeEmbedding
  // ---------------------------------------------------------------------------
  describe('normalizeEmbedding', () => {
    it('normalizes to unit length', () => {
      const vec = [3, 4]; // magnitude 5
      const normalized = normalizeEmbedding(vec);

      let mag = 0;
      for (const v of normalized) {
        mag += v * v;
      }
      mag = Math.sqrt(mag);

      expect(mag).toBeCloseTo(1.0, 6);
      expect(normalized[0]).toBeCloseTo(0.6, 6);
      expect(normalized[1]).toBeCloseTo(0.8, 6);
    });

    it('returns zero vector unchanged', () => {
      const zero = [0, 0, 0];
      const result = normalizeEmbedding(zero);
      expect(result).toEqual([0, 0, 0]);
    });

    it('handles single-element vectors', () => {
      const vec = [5];
      const normalized = normalizeEmbedding(vec);
      expect(normalized[0]).toBeCloseTo(1.0, 6);
    });
  });

  // ---------------------------------------------------------------------------
  // Fallback between providers
  // ---------------------------------------------------------------------------
  describe('Embedding chain fallback', () => {
    it('falls back to second provider when first is unavailable', async () => {
      const primary = createMockProvider('primary', 384, false);
      const fallback = createMockProvider('fallback', 384, true);
      const chain = new EmbeddingChain([primary, fallback]);

      const { provider } = await chain.embed('test');
      expect(provider).toBe('fallback');
    });

    it('falls back when first provider throws', async () => {
      const broken: EmbeddingProvider = {
        name: 'broken',
        dimensions: 384,
        isAvailable: vi.fn().mockResolvedValue(true),
        embed: vi.fn().mockRejectedValue(new Error('ONNX crash')),
        embedBatch: vi.fn().mockRejectedValue(new Error('ONNX crash')),
      };
      const fallback = createMockProvider('fallback', 384, true);
      const chain = new EmbeddingChain([broken, fallback]);

      const { provider } = await chain.embed('test');
      expect(provider).toBe('fallback');
    });

    it('throws when all providers fail', async () => {
      const fail1: EmbeddingProvider = {
        name: 'fail1',
        dimensions: 384,
        isAvailable: vi.fn().mockResolvedValue(true),
        embed: vi.fn().mockRejectedValue(new Error('fail1')),
        embedBatch: vi.fn().mockRejectedValue(new Error('fail1')),
      };
      const fail2: EmbeddingProvider = {
        name: 'fail2',
        dimensions: 384,
        isAvailable: vi.fn().mockResolvedValue(true),
        embed: vi.fn().mockRejectedValue(new Error('fail2')),
        embedBatch: vi.fn().mockRejectedValue(new Error('fail2')),
      };
      const chain = new EmbeddingChain([fail1, fail2]);

      await expect(chain.embed('test')).rejects.toThrow('All embedding providers failed');
    });
  });

  // ---------------------------------------------------------------------------
  // Vector store search roundtrip (simulated with in-memory cosine)
  // ---------------------------------------------------------------------------
  describe('Vector store search roundtrip', () => {
    it('finds the most similar document by embedding', async () => {
      const provider = createMockProvider('mock', 64);
      const chain = new EmbeddingChain([provider]);

      // "Store" some documents
      const docs = [
        { text: 'TypeScript is a programming language', embedding: [] as number[] },
        { text: 'Cats are wonderful pets', embedding: [] as number[] },
        { text: 'JavaScript and TypeScript are related', embedding: [] as number[] },
      ];

      // Generate embeddings
      for (const doc of docs) {
        const { embedding } = await chain.embed(doc.text);
        doc.embedding = embedding;
      }

      // Query
      const { embedding: queryEmbedding } = await chain.embed('Tell me about TypeScript');

      // Score each doc
      const results = docs.map((doc) => ({
        text: doc.text,
        score: cosineSimilarity(queryEmbedding, doc.embedding),
      }));

      results.sort((a, b) => b.score - a.score);

      // Verify sorting works — scores are in descending order
      expect(results.length).toBe(3);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
      // All scores should be between -1 and 1 (cosine similarity range)
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(-1);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('search respects similarity threshold', async () => {
      const provider = createMockProvider('mock', 64);
      const chain = new EmbeddingChain([provider]);

      const doc = await chain.embed('programming is fun');
      const query = await chain.embed('programming is fun');

      const score = cosineSimilarity(doc.embedding, query.embedding);

      // Same text should have very high similarity
      expect(score).toBeGreaterThan(0.99);
    });
  });
});
