/**
 * @alfred/skill-habit-tracker - Fallback strategies
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
        // Default storage uses JSON at ~/.alfred/state/habit-tracker/habits.json
      },
    },
    {
      name: 'fuzzy-name-matching',
      description: 'Suggest closest matching habit name when exact match not found',
      trigger: 'Habit name not found in database',
      action: () => {
        // Built into findClosestMatch — used by habitCheck and habitStats
      },
    },
    {
      name: 'timezone-safe-dates',
      description: 'Use ISO date strings (YYYY-MM-DD) to avoid timezone issues in streak calculation',
      trigger: 'Date comparison across timezone boundaries',
      action: () => {
        // All dates stored and compared as YYYY-MM-DD strings
      },
    },
    {
      name: 'grace-period-streak',
      description: 'Allow one-day grace period for daily habits if today is not yet checked',
      trigger: 'Current streak would break because today is not completed yet',
      action: () => {
        // Built into calculateCurrentStreak — checks yesterday as potential streak continuation
      },
    },
  ];
}
