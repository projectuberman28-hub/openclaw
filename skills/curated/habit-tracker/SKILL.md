# Habit Tracker
## Description
Track daily and weekly habits with streak counting, completion rates, and historical statistics. Supports daily, weekly, and custom frequency habits.

## Tools
- `habit_create(name: string, frequency: string)` — Create a habit to track. Frequency: 'daily' | 'weekly' | 'weekdays' | 'custom'. Returns `{ id: string, name: string, frequency: string }`.
- `habit_check(name: string)` — Mark a habit as completed for today. Returns `{ checked: boolean, streak: number }`.
- `habit_list()` — List all habits with current streak info. Returns `{ habits: HabitInfo[] }`.
- `habit_stats(name?: string)` — Get habit statistics. Returns `{ stats: HabitStats | HabitStats[] }`.

## Dependencies
- SQLite (JSON file fallback) for persistent storage

## Fallbacks
- If SQLite unavailable, use JSON file storage
- If habit name not found, suggest closest match
- Streak calculation handles timezone changes gracefully
