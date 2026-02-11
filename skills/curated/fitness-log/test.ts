/**
 * @alfred/skill-fitness-log - Test cases
 */

export default [
  {
    name: 'workout_log records a session',
    input: {
      tool: 'workout_log',
      args: {
        exercises: [
          { name: 'Bench Press', sets: [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }] },
          { name: 'Squat', sets: [{ reps: 5, weight: 315 }] },
        ],
      },
    },
    expected: { id: 'string', totalVolume: 'number', exercises: 'array', prs: 'array' },
  },
  {
    name: 'workout_log resolves exercise aliases',
    input: {
      tool: 'workout_log',
      args: {
        exercises: [{ name: 'OHP', sets: [{ reps: 8, weight: 135 }] }],
      },
    },
    expected: { exercises: [{ name: 'overhead press' }] },
  },
  {
    name: 'workout_log rejects empty exercises',
    input: { tool: 'workout_log', args: { exercises: [] } },
    expected: { error: 'At least one exercise is required' },
  },
  {
    name: 'workout_history returns recent workouts',
    input: { tool: 'workout_history', args: { days: 7 } },
    expected: { workouts: 'array', totalSessions: 'number', totalVolume: 'number' },
  },
  {
    name: 'workout_history defaults to 30 days',
    input: { tool: 'workout_history', args: {} },
    expected: { workouts: 'array' },
  },
  {
    name: 'workout_pr returns records for exercise',
    input: { tool: 'workout_pr', args: { exercise: 'bench press' } },
    expected: { prs: { exercise: 'bench press', maxWeight: 'number', estimated1RM: 'number' } },
  },
  {
    name: 'workout_pr throws for unknown exercise',
    input: { tool: 'workout_pr', args: { exercise: 'nonexistent exercise' } },
    expected: { error: 'No data found' },
  },
  {
    name: 'workout_plan generates strength plan',
    input: { tool: 'workout_plan', args: { type: 'strength' } },
    expected: { plan: { type: 'strength', daysPerWeek: 4 } },
  },
  {
    name: 'workout_plan generates bugenhagen plan',
    input: { tool: 'workout_plan', args: { type: 'bugenhagen' } },
    expected: { plan: { type: 'bugenhagen', daysPerWeek: 6 } },
  },
  {
    name: 'workout_plan rejects unknown type',
    input: { tool: 'workout_plan', args: { type: 'crossfit' } },
    expected: { error: 'Unknown plan type' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
