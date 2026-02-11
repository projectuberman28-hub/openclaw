/**
 * @alfred/skill-competitor-watch - Fallback strategies
 */

export interface FallbackStrategy {
  name: string;
  description: string;
  trigger: string;
  action: () => Promise<void> | void;
}

export function getFallbacks(): FallbackStrategy[] {
  return [
    {
      name: 'user-agent-rotation',
      description: 'Rotate User-Agent headers when blocked by servers',
      trigger: 'HTTP 403 response from competitor site',
      action: () => {
        // Built into fetchPage — cycles through USER_AGENTS array on retries
      },
    },
    {
      name: 'js-rendering-note',
      description: 'Note when pages require JavaScript rendering and suggest headless browser',
      trigger: 'Extracted content is minimal or contains only JS bootstrap',
      action: () => {
        // Detect minimal content and add note to diff report
      },
    },
    {
      name: 'cached-snapshot-comparison',
      description: 'Use previously cached snapshots for comparison when live fetch fails',
      trigger: 'All fetch retries exhausted',
      action: () => {
        // Snapshots stored in competitor.snapshots persist across checks
      },
    },
    {
      name: 'rate-limit-throttling',
      description: 'Add delays between requests to avoid rate limiting',
      trigger: 'Multiple URLs being checked in sequence',
      action: () => {
        // Built into competitorReport — 300ms delay between URL fetches
      },
    },
  ];
}
