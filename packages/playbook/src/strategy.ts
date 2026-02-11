/**
 * @alfred/playbook - Strategy engine
 *
 * Analyses accumulated playbook data to generate actionable strategies.
 * Detects patterns in tool usage, failure rates, fallback frequency,
 * and forge events, then produces scored recommendations.
 *
 * Also provides weekly-report generation for periodic retrospectives.
 */

import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { PlaybookDatabase } from './database.js';
import type { PlaybookQuery } from './query.js';
import type { Strategy, WeeklyReport, PlaybookEntry, EntryRow } from './types.js';

const log = pino({ name: 'alfred:playbook:strategy' });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeJsonParse(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function rowToEntry(row: EntryRow): PlaybookEntry {
  return {
    id: row.id,
    type: row.type as PlaybookEntry['type'],
    timestamp: row.timestamp,
    tool: row.tool,
    args: safeJsonParse(row.args),
    result: safeJsonParse(row.result),
    error: row.error,
    durationMs: row.duration_ms,
    agentId: row.agent_id,
    sessionId: row.session_id,
    channel: row.channel,
    success: row.success === 1,
    tags: safeJsonParse(row.tags) as string[],
  };
}

/**
 * Classify a confidence score based on the strength of evidence.
 * More data points and a clearer signal yield higher confidence.
 */
function computeConfidence(sampleSize: number, signalStrength: number): number {
  // signalStrength: 0..1 (how clear the pattern is)
  // sampleSize: raw count of supporting entries
  // We want at least ~20 samples for high confidence.
  const sizeFactor = Math.min(sampleSize / 20, 1);
  const raw = signalStrength * 0.6 + sizeFactor * 0.4;
  return Number(Math.min(Math.max(raw, 0), 1).toFixed(3));
}

// ---------------------------------------------------------------------------
// StrategyEngine
// ---------------------------------------------------------------------------

export class StrategyEngine {
  private db: PlaybookDatabase;
  private query: PlaybookQuery;

  constructor(db: PlaybookDatabase, query: PlaybookQuery) {
    this.db = db;
    this.query = query;
  }

  // -----------------------------------------------------------------------
  // Strategy generation
  // -----------------------------------------------------------------------

  /**
   * Analyse current playbook data and generate a list of strategies.
   * Each strategy describes a pattern and offers recommendations.
   */
  async generateStrategies(): Promise<Strategy[]> {
    const strategies: Strategy[] = [];

    // Run all analysis passes and collect strategies
    strategies.push(...this.analyseFrequentlyFailingTools());
    strategies.push(...this.analyseCommonErrorPatterns());
    strategies.push(...this.analyseSlowTools());
    strategies.push(...this.analyseFallbackPatterns());
    strategies.push(...this.analyseForgeOutcomes());
    strategies.push(...this.analyseUnderusedCapabilities());
    strategies.push(...this.analyseSuccessfulWorkflows());

    log.info({ count: strategies.length }, 'Strategies generated');
    return strategies;
  }

  // -----------------------------------------------------------------------
  // Analysis passes
  // -----------------------------------------------------------------------

  /**
   * Detect tools with a high failure rate and recommend investigation.
   */
  private analyseFrequentlyFailingTools(): Strategy[] {
    const strategies: Strategy[] = [];

    const toolStats = this.db.raw
      .prepare(`
        SELECT
          tool,
          COUNT(*) as total,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
        FROM entries
        WHERE tool != '' AND type = 'tool_execution'
        GROUP BY tool
        HAVING total >= 5
        ORDER BY (CAST(failures AS REAL) / total) DESC
      `)
      .all() as Array<{ tool: string; total: number; failures: number }>;

    for (const stat of toolStats) {
      const failRate = stat.failures / stat.total;
      if (failRate < 0.2) continue; // Only flag tools that fail >= 20%

      const confidence = computeConfidence(stat.total, failRate);
      const recentErrors = this.db.raw
        .prepare(`
          SELECT DISTINCT error FROM entries
          WHERE tool = ? AND error IS NOT NULL AND error != ''
          ORDER BY timestamp DESC LIMIT 5
        `)
        .all(stat.tool) as Array<{ error: string }>;

      const errorSummary = recentErrors.map((r) => r.error);

      strategies.push({
        id: randomUUID(),
        title: `High failure rate for tool "${stat.tool}"`,
        description:
          `Tool "${stat.tool}" has a ${(failRate * 100).toFixed(1)}% failure rate ` +
          `across ${stat.total} invocations (${stat.failures} failures).`,
        recommendations: [
          `Investigate root cause of failures in "${stat.tool}".`,
          ...(errorSummary.length > 0
            ? [`Recent errors: ${errorSummary.join('; ')}`]
            : []),
          failRate > 0.5
            ? `Consider adding a fallback provider for "${stat.tool}".`
            : `Monitor "${stat.tool}" for regressions.`,
        ],
        confidence,
        basedOn: [`tool:${stat.tool}`, `failures:${stat.failures}`, `total:${stat.total}`],
      });
    }

    return strategies;
  }

  /**
   * Group errors by message and flag recurring ones.
   */
  private analyseCommonErrorPatterns(): Strategy[] {
    const strategies: Strategy[] = [];

    const errorGroups = this.db.raw
      .prepare(`
        SELECT
          error,
          COUNT(*) as count,
          GROUP_CONCAT(DISTINCT tool) as tools,
          MIN(timestamp) as first_seen,
          MAX(timestamp) as last_seen
        FROM entries
        WHERE error IS NOT NULL AND error != ''
        GROUP BY error
        HAVING count >= 3
        ORDER BY count DESC
        LIMIT 10
      `)
      .all() as Array<{
      error: string;
      count: number;
      tools: string;
      first_seen: string;
      last_seen: string;
    }>;

    for (const group of errorGroups) {
      const affectedTools = group.tools.split(',');
      const confidence = computeConfidence(group.count, 0.7);

      strategies.push({
        id: randomUUID(),
        title: `Recurring error pattern (${group.count} occurrences)`,
        description:
          `Error "${group.error.substring(0, 120)}" has occurred ${group.count} times ` +
          `across tools: ${affectedTools.join(', ')}. ` +
          `First seen: ${group.first_seen}, last seen: ${group.last_seen}.`,
        recommendations: [
          `Add targeted error handling for this pattern.`,
          affectedTools.length > 1
            ? `This error spans ${affectedTools.length} tools -- look for a shared dependency.`
            : `Isolated to tool "${affectedTools[0]}".`,
          `Consider creating an automated recovery strategy.`,
        ],
        confidence,
        basedOn: [
          `error_count:${group.count}`,
          ...affectedTools.map((t) => `tool:${t}`),
        ],
      });
    }

    return strategies;
  }

  /**
   * Identify tools with unusually long execution times.
   */
  private analyseSlowTools(): Strategy[] {
    const strategies: Strategy[] = [];

    const slowTools = this.db.raw
      .prepare(`
        SELECT
          tool,
          COUNT(*) as total,
          AVG(duration_ms) as avg_ms,
          MAX(duration_ms) as max_ms,
          MIN(duration_ms) as min_ms
        FROM entries
        WHERE tool != '' AND duration_ms > 0 AND type = 'tool_execution'
        GROUP BY tool
        HAVING total >= 5 AND avg_ms > 5000
        ORDER BY avg_ms DESC
        LIMIT 10
      `)
      .all() as Array<{
      tool: string;
      total: number;
      avg_ms: number;
      max_ms: number;
      min_ms: number;
    }>;

    for (const toolStat of slowTools) {
      const avgSec = (toolStat.avg_ms / 1000).toFixed(1);
      const maxSec = (toolStat.max_ms / 1000).toFixed(1);
      const confidence = computeConfidence(
        toolStat.total,
        Math.min(toolStat.avg_ms / 30000, 1), // 30s = max signal
      );

      strategies.push({
        id: randomUUID(),
        title: `Slow tool: "${toolStat.tool}" (avg ${avgSec}s)`,
        description:
          `Tool "${toolStat.tool}" averages ${avgSec}s per call ` +
          `(max ${maxSec}s) across ${toolStat.total} invocations.`,
        recommendations: [
          `Profile "${toolStat.tool}" to identify bottlenecks.`,
          `Consider caching results if the tool is called with repeated arguments.`,
          toolStat.max_ms > toolStat.avg_ms * 3
            ? `Max latency is ${maxSec}s (${((toolStat.max_ms / toolStat.avg_ms)).toFixed(1)}x average) -- investigate outliers.`
            : `Execution time is relatively stable.`,
        ],
        confidence,
        basedOn: [`tool:${toolStat.tool}`, `avg_ms:${Math.round(toolStat.avg_ms)}`],
      });
    }

    return strategies;
  }

  /**
   * Analyse fallback events to detect providers that fail frequently.
   */
  private analyseFallbackPatterns(): Strategy[] {
    const strategies: Strategy[] = [];

    const fallbacks = this.db.raw
      .prepare(`
        SELECT
          tool as capability,
          args,
          COUNT(*) as count
        FROM entries
        WHERE type = 'fallback'
        GROUP BY tool
        HAVING count >= 2
        ORDER BY count DESC
      `)
      .all() as Array<{ capability: string; args: string; count: number }>;

    for (const fb of fallbacks) {
      // Gather unique failed providers
      const detailRows = this.db.raw
        .prepare(`
          SELECT DISTINCT
            JSON_EXTRACT(args, '$.failedProvider') as failed_provider,
            JSON_EXTRACT(args, '$.succeededProvider') as succeeded_provider
          FROM entries
          WHERE type = 'fallback' AND tool = ?
        `)
        .all(fb.capability) as Array<{
        failed_provider: string | null;
        succeeded_provider: string | null;
      }>;

      const failedProviders = [
        ...new Set(detailRows.map((d) => d.failed_provider).filter(Boolean)),
      ] as string[];
      const succeededProviders = [
        ...new Set(detailRows.map((d) => d.succeeded_provider).filter(Boolean)),
      ] as string[];

      const confidence = computeConfidence(fb.count, 0.6);

      strategies.push({
        id: randomUUID(),
        title: `Frequent fallbacks for "${fb.capability}" (${fb.count} times)`,
        description:
          `Capability "${fb.capability}" has triggered ${fb.count} fallback events. ` +
          `Failed providers: ${failedProviders.join(', ') || 'unknown'}. ` +
          `Succeeded providers: ${succeededProviders.join(', ') || 'unknown'}.`,
        recommendations: [
          failedProviders.length > 0
            ? `Investigate reliability of provider(s): ${failedProviders.join(', ')}.`
            : `Identify the failing provider(s).`,
          `Consider promoting the reliable fallback as the primary provider.`,
          `Set up monitoring alerts for fallback events on "${fb.capability}".`,
        ],
        confidence,
        basedOn: [
          `capability:${fb.capability}`,
          `fallback_count:${fb.count}`,
          ...failedProviders.map((p) => `failed:${p}`),
        ],
      });
    }

    return strategies;
  }

  /**
   * Analyse forge event outcomes: build success/failure trends, quarantined skills.
   */
  private analyseForgeOutcomes(): Strategy[] {
    const strategies: Strategy[] = [];

    // Aggregate forge events by skill
    const forgeStats = this.db.raw
      .prepare(`
        SELECT
          tool as skill_name,
          COUNT(*) as total_events,
          SUM(CASE WHEN JSON_EXTRACT(args, '$.forgeEventType') = 'test_passed' THEN 1 ELSE 0 END) as test_passes,
          SUM(CASE WHEN JSON_EXTRACT(args, '$.forgeEventType') = 'test_failed' THEN 1 ELSE 0 END) as test_failures,
          SUM(CASE WHEN JSON_EXTRACT(args, '$.forgeEventType') = 'promoted' THEN 1 ELSE 0 END) as promotions,
          SUM(CASE WHEN JSON_EXTRACT(args, '$.forgeEventType') = 'quarantined' THEN 1 ELSE 0 END) as quarantines,
          SUM(CASE WHEN JSON_EXTRACT(args, '$.forgeEventType') = 'build_completed' THEN 1 ELSE 0 END) as builds
        FROM entries
        WHERE type = 'forge_event'
        GROUP BY tool
        ORDER BY total_events DESC
      `)
      .all() as Array<{
      skill_name: string;
      total_events: number;
      test_passes: number;
      test_failures: number;
      promotions: number;
      quarantines: number;
      builds: number;
    }>;

    for (const stat of forgeStats) {
      // Flag skills with high test failure rates
      const totalTests = stat.test_passes + stat.test_failures;
      if (totalTests > 0 && stat.test_failures > 0) {
        const failRate = stat.test_failures / totalTests;
        if (failRate >= 0.3) {
          const confidence = computeConfidence(totalTests, failRate);

          strategies.push({
            id: randomUUID(),
            title: `Forge skill "${stat.skill_name}" has unstable tests`,
            description:
              `Skill "${stat.skill_name}" has a ${(failRate * 100).toFixed(0)}% test failure rate ` +
              `(${stat.test_failures} failures out of ${totalTests} test runs). ` +
              `Promotions: ${stat.promotions}, Quarantines: ${stat.quarantines}.`,
            recommendations: [
              `Review test suite for skill "${stat.skill_name}".`,
              stat.quarantines > 0
                ? `This skill has been quarantined ${stat.quarantines} time(s) -- consider deprioritising.`
                : `Add more test coverage to stabilise the skill.`,
              `Investigate whether the skill's gap definition is too broad.`,
            ],
            confidence,
            basedOn: [
              `skill:${stat.skill_name}`,
              `test_failures:${stat.test_failures}`,
              `test_passes:${stat.test_passes}`,
            ],
          });
        }
      }

      // Flag skills that have been quarantined
      if (stat.quarantines > 0 && stat.promotions === 0) {
        strategies.push({
          id: randomUUID(),
          title: `Forge skill "${stat.skill_name}" quarantined without promotion`,
          description:
            `Skill "${stat.skill_name}" has been quarantined ${stat.quarantines} time(s) ` +
            `and has never been promoted. It may need manual review or removal.`,
          recommendations: [
            `Manually review the generated code for "${stat.skill_name}".`,
            `Consider re-evaluating the gap that triggered this skill.`,
            `If the capability is no longer needed, remove the skill from the queue.`,
          ],
          confidence: computeConfidence(stat.total_events, 0.8),
          basedOn: [`skill:${stat.skill_name}`, `quarantines:${stat.quarantines}`],
        });
      }
    }

    return strategies;
  }

  /**
   * Detect tools that are defined but rarely used.
   */
  private analyseUnderusedCapabilities(): Strategy[] {
    const strategies: Strategy[] = [];

    // Get all tools with very low usage (< 3 calls) but that have been seen at least once
    const rareTool = this.db.raw
      .prepare(`
        SELECT tool, COUNT(*) as count, MAX(timestamp) as last_used
        FROM entries
        WHERE tool != '' AND type = 'tool_execution'
        GROUP BY tool
        HAVING count <= 2
        ORDER BY count ASC
      `)
      .all() as Array<{ tool: string; count: number; last_used: string }>;

    if (rareTool.length === 0) return strategies;

    // Get the total number of distinct tools for context
    const totalToolsRow = this.db.raw
      .prepare(`
        SELECT COUNT(DISTINCT tool) as cnt
        FROM entries
        WHERE tool != '' AND type = 'tool_execution'
      `)
      .get() as { cnt: number };

    // Only flag if there's a meaningful number of tools overall
    if (totalToolsRow.cnt < 5) return strategies;

    const underused = rareTool.map((r) => r.tool);
    const confidence = computeConfidence(totalToolsRow.cnt, 0.4);

    strategies.push({
      id: randomUUID(),
      title: `${underused.length} tool(s) appear underutilised`,
      description:
        `The following tools have been invoked 2 or fewer times: ` +
        `${underused.join(', ')}. ` +
        `Out of ${totalToolsRow.cnt} total distinct tools, these may be ` +
        `candidates for removal or better integration.`,
      recommendations: [
        `Review whether these tools are still needed: ${underused.join(', ')}.`,
        `If they serve niche purposes, consider documenting when to use them.`,
        `If obsolete, remove them to reduce the tool surface.`,
      ],
      confidence,
      basedOn: underused.map((t) => `tool:${t}`),
    });

    return strategies;
  }

  /**
   * Identify tools and sessions with consistently high success rates.
   */
  private analyseSuccessfulWorkflows(): Strategy[] {
    const strategies: Strategy[] = [];

    const reliableTools = this.db.raw
      .prepare(`
        SELECT
          tool,
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
          AVG(duration_ms) as avg_ms
        FROM entries
        WHERE tool != '' AND type = 'tool_execution'
        GROUP BY tool
        HAVING total >= 10 AND (CAST(successes AS REAL) / total) >= 0.95
        ORDER BY total DESC
        LIMIT 5
      `)
      .all() as Array<{
      tool: string;
      total: number;
      successes: number;
      avg_ms: number;
    }>;

    if (reliableTools.length === 0) return strategies;

    const toolNames = reliableTools.map((t) => t.tool);
    const confidence = computeConfidence(
      reliableTools.reduce((sum, t) => sum + t.total, 0),
      0.9,
    );

    strategies.push({
      id: randomUUID(),
      title: `${reliableTools.length} highly reliable tool(s) identified`,
      description:
        `The following tools have a 95%+ success rate with significant usage: ` +
        reliableTools
          .map(
            (t) =>
              `"${t.tool}" (${t.total} calls, ` +
              `${((t.successes / t.total) * 100).toFixed(1)}% success, ` +
              `avg ${(t.avg_ms / 1000).toFixed(1)}s)`,
          )
          .join('; ') +
        `.`,
      recommendations: [
        `These tools are stable and can be relied upon for critical workflows.`,
        `Consider using them as primary options in fallback chains.`,
        `Document their success patterns for future reference.`,
      ],
      confidence,
      basedOn: toolNames.map((t) => `reliable_tool:${t}`),
    });

    return strategies;
  }

  // -----------------------------------------------------------------------
  // Strategy persistence
  // -----------------------------------------------------------------------

  /**
   * Retrieve stored strategies, optionally filtered by minimum confidence.
   */
  getStrategies(options?: { minConfidence?: number }): Strategy[] {
    return this.db.getStrategies({
      minConfidence: options?.minConfidence,
    });
  }

  /**
   * Save a strategy to the database. Returns the strategy ID.
   */
  saveStrategy(strategy: Strategy): string {
    return this.db.saveStrategy(strategy);
  }

  // -----------------------------------------------------------------------
  // Weekly report
  // -----------------------------------------------------------------------

  /**
   * Generate a weekly analysis report starting from the given date.
   * The report covers 7 calendar days from weekStart.
   */
  analyzeWeek(weekStart: Date): WeeklyReport {
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startIso = weekStart.toISOString();
    const endIso = weekEnd.toISOString();
    const period = `${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`;

    // Total operations in the period
    const totalRow = this.db.raw
      .prepare(`
        SELECT COUNT(*) as cnt FROM entries
        WHERE timestamp >= ? AND timestamp < ?
      `)
      .get(startIso, endIso) as { cnt: number };

    const totalOperations = totalRow.cnt;

    // Success rate
    const successRow = this.db.raw
      .prepare(`
        SELECT COUNT(*) as cnt FROM entries
        WHERE timestamp >= ? AND timestamp < ? AND success = 1
      `)
      .get(startIso, endIso) as { cnt: number };

    const successRate = totalOperations > 0
      ? Number(((successRow.cnt / totalOperations) * 100).toFixed(2))
      : 0;

    // Top successes: tools with highest success counts this week
    const topSuccessRows = this.db.raw
      .prepare(`
        SELECT tool, COUNT(*) as cnt
        FROM entries
        WHERE timestamp >= ? AND timestamp < ? AND success = 1 AND tool != ''
        GROUP BY tool
        ORDER BY cnt DESC
        LIMIT 5
      `)
      .all(startIso, endIso) as Array<{ tool: string; cnt: number }>;

    const topSuccesses = topSuccessRows.map(
      (r) => `${r.tool} (${r.cnt} successful calls)`,
    );

    // Top failures: tools with highest failure counts this week
    const topFailureRows = this.db.raw
      .prepare(`
        SELECT tool, COUNT(*) as cnt, GROUP_CONCAT(DISTINCT error) as errors
        FROM entries
        WHERE timestamp >= ? AND timestamp < ? AND success = 0 AND tool != ''
        GROUP BY tool
        ORDER BY cnt DESC
        LIMIT 5
      `)
      .all(startIso, endIso) as Array<{ tool: string; cnt: number; errors: string | null }>;

    const topFailures = topFailureRows.map((r) => {
      const errorSnippet = r.errors
        ? ` -- ${r.errors.substring(0, 80)}`
        : '';
      return `${r.tool} (${r.cnt} failures${errorSnippet})`;
    });

    // New patterns: detect tools or error messages seen for the first time this week
    const newToolRows = this.db.raw
      .prepare(`
        SELECT tool, MIN(timestamp) as first_seen
        FROM entries
        WHERE tool != ''
        GROUP BY tool
        HAVING first_seen >= ? AND first_seen < ?
      `)
      .all(startIso, endIso) as Array<{ tool: string; first_seen: string }>;

    const newErrorRows = this.db.raw
      .prepare(`
        SELECT error, MIN(timestamp) as first_seen
        FROM entries
        WHERE error IS NOT NULL AND error != ''
        GROUP BY error
        HAVING first_seen >= ? AND first_seen < ?
      `)
      .all(startIso, endIso) as Array<{ error: string; first_seen: string }>;

    const newPatterns: string[] = [
      ...newToolRows.map((r) => `New tool: "${r.tool}"`),
      ...newErrorRows.map(
        (r) => `New error: "${r.error.substring(0, 80)}"`,
      ),
    ];

    // Recommendations based on the week's data
    const recommendations: string[] = [];

    if (successRate < 80) {
      recommendations.push(
        `Overall success rate is ${successRate}% -- below 80%. Investigate systemic issues.`,
      );
    } else if (successRate >= 95) {
      recommendations.push(
        `Excellent success rate of ${successRate}%. System is operating reliably.`,
      );
    }

    if (topFailures.length > 0) {
      recommendations.push(
        `Focus remediation on the top failing tool: ${topFailureRows[0]?.tool ?? 'unknown'}.`,
      );
    }

    if (newPatterns.length > 3) {
      recommendations.push(
        `${newPatterns.length} new patterns detected this week -- schedule a review.`,
      );
    }

    // Check for fallback frequency
    const fallbackRow = this.db.raw
      .prepare(`
        SELECT COUNT(*) as cnt FROM entries
        WHERE type = 'fallback' AND timestamp >= ? AND timestamp < ?
      `)
      .get(startIso, endIso) as { cnt: number };

    if (fallbackRow.cnt > 0) {
      recommendations.push(
        `${fallbackRow.cnt} fallback event(s) occurred this week. Review provider reliability.`,
      );
    }

    // Check for forge activity
    const forgeRow = this.db.raw
      .prepare(`
        SELECT COUNT(*) as cnt FROM entries
        WHERE type = 'forge_event' AND timestamp >= ? AND timestamp < ?
      `)
      .get(startIso, endIso) as { cnt: number };

    if (forgeRow.cnt > 0) {
      recommendations.push(
        `${forgeRow.cnt} forge event(s) this week. Review generated skill quality.`,
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('No specific issues detected. Continue monitoring.');
    }

    log.info(
      { period, totalOperations, successRate },
      'Weekly report generated',
    );

    return {
      period,
      totalOperations,
      successRate,
      topSuccesses,
      topFailures,
      newPatterns,
      recommendations,
    };
  }
}
