/**
 * @alfred/skill-habit-tracker - Test cases
 */

export default [
  {
    name: 'habit_create creates a daily habit',
    input: { tool: 'habit_create', args: { name: 'Meditation', frequency: 'daily' } },
    expected: { id: 'string', name: 'Meditation', frequency: 'daily' },
  },
  {
    name: 'habit_create defaults to daily frequency',
    input: { tool: 'habit_create', args: { name: 'Reading' } },
    expected: { frequency: 'daily' },
  },
  {
    name: 'habit_create rejects duplicate name',
    input: { tool: 'habit_create', args: { name: 'Meditation' } },
    expected: { error: 'already exists' },
  },
  {
    name: 'habit_create rejects invalid frequency',
    input: { tool: 'habit_create', args: { name: 'Test', frequency: 'hourly' } },
    expected: { error: 'Invalid frequency' },
  },
  {
    name: 'habit_check marks habit as completed',
    input: { tool: 'habit_check', args: { name: 'Meditation' } },
    expected: { checked: true, streak: 'number', alreadyCompleted: false },
  },
  {
    name: 'habit_check returns alreadyCompleted on duplicate check',
    input: { tool: 'habit_check', args: { name: 'Meditation' } },
    expected: { checked: true, alreadyCompleted: true },
  },
  {
    name: 'habit_check throws for unknown habit',
    input: { tool: 'habit_check', args: { name: 'NonExistent' } },
    expected: { error: 'not found' },
  },
  {
    name: 'habit_list returns all habits',
    input: { tool: 'habit_list', args: {} },
    expected: { habits: 'array' },
  },
  {
    name: 'habit_stats returns stats for specific habit',
    input: { tool: 'habit_stats', args: { name: 'Meditation' } },
    expected: { stats: { name: 'Meditation', last7Days: 'array' } },
  },
  {
    name: 'habit_stats returns all habits when no name specified',
    input: { tool: 'habit_stats', args: {} },
    expected: { stats: 'array' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
