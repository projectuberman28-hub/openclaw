/**
 * @alfred/playbook - Structured operational memory
 *
 * Logs every tool invocation, failure, fallback, and forge event.
 * Generates strategies and weekly reports from accumulated data.
 *
 * Public API surface:
 *   - PlaybookDatabase  (database.ts)  -- SQLite persistence layer
 *   - PlaybookLogger    (logger.ts)    -- structured event logging
 *   - PlaybookQuery     (query.ts)     -- pre-built query engine
 *   - StrategyEngine    (strategy.ts)  -- pattern analysis & recommendations
 *   - All types         (types.ts)     -- shared interfaces
 */

// Types
export type {
  PlaybookEntry,
  PlaybookEntryType,
  ForgeEventType,
  Strategy,
  PlaybookPattern,
  PlaybookStats,
  WeeklyReport,
  SearchOptions,
  EntryRow,
  StrategyRow,
  PatternRow,
} from './types.js';

// Database
export { PlaybookDatabase } from './database.js';

// Logger
export { PlaybookLogger } from './logger.js';
export type {
  ToolExecutionParams,
  FallbackParams,
  ForgeEventParams,
  ErrorParams,
} from './logger.js';

// Query
export { PlaybookQuery } from './query.js';

// Strategy
export { StrategyEngine } from './strategy.js';
