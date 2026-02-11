/**
 * @alfred/skill-code-review - Fallback strategies
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
      name: 'gh-cli-fallback',
      description: 'Use gh CLI to fetch PR diff when GitHub REST API is unavailable or rate-limited',
      trigger: 'GitHub API returns 403/429 or network failure',
      action: () => {
        // Built into reviewPr — tries gh CLI after API failure
      },
    },
    {
      name: 'chunk-large-files',
      description: 'Split files larger than 100KB into chunks for analysis',
      trigger: 'File content exceeds 100,000 characters',
      action: () => {
        // Built into reviewFile — processes in 50KB chunks
      },
    },
    {
      name: 'generic-rules',
      description: 'Apply language-agnostic rules when file language cannot be detected',
      trigger: 'File extension not recognized',
      action: () => {
        // Rules with no languages restriction apply to all files
      },
    },
    {
      name: 'finding-cap',
      description: 'Cap findings at 100 to prevent output overload on large codebases',
      trigger: 'Analysis generates more than 100 findings',
      action: () => {
        // Built into reviewFile — slices findings to 100
      },
    },
  ];
}
