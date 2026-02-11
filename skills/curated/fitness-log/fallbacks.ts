/**
 * @alfred/skill-fitness-log - Fallback strategies
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
      name: 'exercise-alias-resolution',
      description: 'Resolve common exercise abbreviations and aliases to canonical names',
      trigger: 'User provides abbreviation like "OHP", "DL", "BB row"',
      action: () => {
        // Built into resolveExercise — maps aliases to full names
      },
    },
    {
      name: 'default-weight-unit',
      description: 'Default to lbs when weight unit is not specified',
      trigger: 'Weight provided without unit specification',
      action: () => {
        // All weights stored in lbs by default
      },
    },
    {
      name: 'generic-plan-fallback',
      description: 'Generate a basic full-body plan when requested type is unknown',
      trigger: 'Plan type not in available templates',
      action: () => {
        // Error message lists available plan types for user guidance
      },
    },
    {
      name: 'json-file-storage',
      description: 'Use JSON file storage for workout persistence',
      trigger: 'Default storage mechanism',
      action: () => {
        // Workouts stored at ~/.alfred/state/fitness-log/workouts.json
      },
    },
  ];
}
