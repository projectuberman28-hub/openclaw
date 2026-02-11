/**
 * @alfred/skill-expense-tracker - Fallback strategies
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
      name: 'json-file-storage',
      description: 'Use JSON file storage when SQLite is unavailable',
      trigger: 'SQLite module import failure',
      action: () => {
        // Default storage already uses JSON at ~/.alfred/state/expense-tracker/expenses.json
      },
    },
    {
      name: 'date-parsing-fallback',
      description: 'Default to current date when date string cannot be parsed',
      trigger: 'Date parsing returns NaN or invalid date',
      action: () => {
        // Built into parseDate — returns today on any parse failure
      },
    },
    {
      name: 'json-export-fallback',
      description: 'Export as JSON when CSV generation fails',
      trigger: 'CSV formatting error (e.g., unescaped characters)',
      action: () => {
        // Fall back to JSON.stringify for reliable export
      },
    },
    {
      name: 'category-normalization',
      description: 'Map common category aliases to canonical names',
      trigger: 'User provides non-standard category name',
      action: () => {
        // Built into normalizeCategory — maps aliases like "uber" to "Transportation"
      },
    },
  ];
}
