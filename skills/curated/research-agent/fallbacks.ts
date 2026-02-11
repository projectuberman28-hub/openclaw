/**
 * @alfred/skill-research-agent - Fallback strategies
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
      name: 'alternative-search-engine',
      description: 'Try alternative search engine when DuckDuckGo is unavailable',
      trigger: 'Primary search engine returns error or is blocked',
      action: () => {
        // Could switch to Bing, Google Custom Search, or Brave Search API
      },
    },
    {
      name: 'snippet-only-mode',
      description: 'Use search snippets instead of full page content when pages are inaccessible',
      trigger: 'Page fetch returns 403, 404, or timeout',
      action: () => {
        // Built into synthesis — falls back to snippet when contentMap is empty
      },
    },
    {
      name: 'search-rate-limiting',
      description: 'Add delays between search requests to avoid rate limiting',
      trigger: 'Consecutive search requests',
      action: async () => {
        // Built into research() — 500ms delay between queries
      },
    },
    {
      name: 'cached-results',
      description: 'Return cached research results when network is completely unavailable',
      trigger: 'All search queries fail',
      action: () => {
        // Could store recent research results in ~/.alfred/cache/research/
      },
    },
    {
      name: 'query-refinement',
      description: 'Automatically refine search queries when initial results are poor',
      trigger: 'All results have low relevance scores (< 0.2)',
      action: () => {
        // Generate alternative phrasings and retry
      },
    },
  ];
}
