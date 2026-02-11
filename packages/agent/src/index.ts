/**
 * @alfred/agent - Core agent loop and session management
 *
 * This package provides the main execution loop for the Alfred AI assistant,
 * including context assembly, streaming, session management, compaction,
 * and conversation intelligence.
 */

// Agent loop
export { AgentLoop } from './loop.js';
export type {
  AgentEvent,
  AgentInput,
  AgentLoopConfig,
  ToolRegistry,
  ModelProvider,
  MemoryStore,
  TokenUsage,
} from './loop.js';

// Context assembly
export { ContextAssembler, estimateTokens } from './context.js';
export type { AssembleParams, AssembledContext } from './context.js';

// System prompt
export { buildSystemPrompt } from './system-prompt.js';
export type { SystemPromptContext } from './system-prompt.js';

// Streaming
export { StreamProcessor } from './streaming.js';
export type { StreamChunk } from './streaming.js';

// Session compaction
export { SessionCompactor } from './compaction.js';
export type { CompactionOptions, CompactionResult } from './compaction.js';

// Session management
export { SessionManager } from './session.js';
export type { Session, SessionManagerOptions } from './session.js';

// Session pruning
export { SessionPruner } from './session-pruning.js';
export type { PruneOptions, PruneResult } from './session-pruning.js';

// Intelligence: conversation analysis
export { ConversationAnalyzer } from './intelligence/conversation-analyzer.js';
export type {
  ConversationAnalysis,
  TaskExtraction,
} from './intelligence/conversation-analyzer.js';

// Intelligence: context enrichment
export { ContextEnricher } from './intelligence/context-enricher.js';
export type { MemoryEntry, EnrichedContext } from './intelligence/context-enricher.js';

// Intelligence: pattern detection
export { PatternDetector } from './intelligence/pattern-detector.js';
export type { DetectedPattern } from './intelligence/pattern-detector.js';
