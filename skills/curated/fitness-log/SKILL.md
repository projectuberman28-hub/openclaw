# Fitness Log
## Description
Log workouts with exercises, sets, reps, and weight. Track personal records (PRs), total volume, and generate training plans. Supports Bugenhagen-compatible programming and gluten-free meal suggestions.

## Tools
- `workout_log(exercises: Exercise[])` — Log a workout session. Returns `{ id: string, totalVolume: number, prs: PR[] }`.
- `workout_history(days?: number)` — Get workout history. Returns `{ workouts: Workout[], totalSessions: number }`.
- `workout_pr(exercise: string)` — Get personal records for an exercise. Returns `{ prs: PRRecord }`.
- `workout_plan(type: string)` — Generate a workout plan. Type: 'strength' | 'hypertrophy' | 'bugenhagen' | 'endurance'. Returns `{ plan: Plan }`.

## Dependencies
- JSON file storage for workout data

## Fallbacks
- If exercise name is ambiguous, suggest closest match
- If weight unit not specified, default to lbs
- Generate basic plan if requested type is unknown
