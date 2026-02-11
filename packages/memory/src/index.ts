/**
 * @alfred/memory - Embeddings, vector storage, hybrid search, compaction & daily logs
 *
 * Privacy-first memory subsystem for Alfred v3.
 * All data stored locally; no external calls unless explicitly configured.
 */

// Embeddings
export {
  type EmbeddingProvider,
  type EmbeddingChainResult,
  type EmbeddingChainBatchResult,
  type EmbeddingChainConfig,
  EmbeddingChain,
  OnnxEmbeddingProvider,
  TransformersJSProvider,
  OllamaEmbeddingProvider,
  VoyageAIProvider,
  createDefaultChain,
  normalizeEmbedding,
  getEmbeddingCacheDir,
} from './embeddings.js';

// Vector store
export {
  type MemoryRecord,
  type SearchResult,
  type SearchFilter,
  type VectorStoreOptions,
  VectorStore,
  cosineSimilarity,
} from './vector-store.js';

// Hybrid search
export {
  type HybridSearchResult,
  type HybridSearchOptions,
  type HybridSearchConfig,
  HybridSearch,
  BM25,
  reciprocalRankFusion,
  tokenize,
  tokenizeWithStopwords,
} from './hybrid-search.js';

// Compaction
export {
  type MemoryEntry,
  type CompactionResult,
  type CompactionOptions,
  type PruneResult,
  MemoryCompactor,
  estimateTokens,
  extractKeyFacts,
  deduplicateFacts,
} from './compaction.js';

// Daily log
export {
  type DailyLogEntryType,
  type DailyLogEntry,
  type DailyLogOptions,
  DailyLog,
} from './daily-log.js';
