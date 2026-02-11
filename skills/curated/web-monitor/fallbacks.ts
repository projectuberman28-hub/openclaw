/**
 * @alfred/skill-web-monitor - Fallback strategies
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
      name: 'retry-with-backoff',
      description: 'Retry failed HTTP requests with exponential backoff (1s, 2s, 4s)',
      trigger: 'fetch failure or timeout',
      action: async () => {
        // Built into fetchWithRetry in index.ts — 3 attempts with 2^n second delays
      },
    },
    {
      name: 'json-file-storage',
      description: 'Use JSON file persistence when SQLite is unavailable',
      trigger: 'SQLite import failure or database corruption',
      action: () => {
        // Default storage layer already uses JSON file at ~/.alfred/state/web-monitor/monitors.json
      },
    },
    {
      name: 'full-page-fallback',
      description: 'Monitor entire page content when CSS selector matching fails',
      trigger: 'CSS selector returns no matches',
      action: () => {
        // Built into fetchContent — returns full HTML when selector match fails
      },
    },
    {
      name: 'cached-content-comparison',
      description: 'Use last known content hash when network is unavailable',
      trigger: 'all fetch retry attempts exhausted',
      action: () => {
        // Return last known state from storage without updating
      },
    },
    {
      name: 'alternative-user-agent',
      description: 'Switch User-Agent header if blocked by server',
      trigger: 'HTTP 403 response',
      action: () => {
        // Rotate to common browser User-Agent strings
      },
    },
  ];
}
