/**
 * @alfred/skill-habit-tracker
 *
 * Track daily and weekly habits with streak counting, completion rates,
 * and historical statistics. JSON-backed persistent storage.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Frequency = 'daily' | 'weekly' | 'weekdays' | 'custom';

interface Habit {
  id: string;
  name: string;
  frequency: Frequency;
  createdAt: number; // epoch ms
  completions: string[]; // ISO date strings (YYYY-MM-DD)
}

interface HabitInfo {
  id: string;
  name: string;
  frequency: Frequency;
  currentStreak: number;
  bestStreak: number;
  completedToday: boolean;
  totalCompletions: number;
  createdAt: number;
}

interface HabitStats {
  name: string;
  frequency: Frequency;
  currentStreak: number;
  bestStreak: number;
  totalCompletions: number;
  completionRate: number; // 0-100%
  last7Days: boolean[];
  last30Days: number; // count of completions
  daysSinceCreation: number;
  weeklyAverage: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'habit-tracker');
const DB_FILE = join(DATA_DIR, 'habits.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadHabits(): Habit[] {
  ensureDataDir();
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHabits(habits: Habit[]): void {
  ensureDataDir();
  writeFileSync(DB_FILE, JSON.stringify(habits, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]!;
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round(Math.abs(da - db) / 86_400_000);
}

function addDays(dateString: string, days: number): string {
  const d = new Date(dateString);
  d.setDate(d.getDate() + days);
  return dateStr(d);
}

function findHabit(habits: Habit[], name: string): Habit | undefined {
  const lowerName = name.toLowerCase().trim();
  return habits.find((h) => h.name.toLowerCase() === lowerName);
}

function findClosestMatch(habits: Habit[], name: string): string | null {
  const lowerName = name.toLowerCase().trim();
  let best: string | null = null;
  let bestScore = 0;

  for (const habit of habits) {
    const habitLower = habit.name.toLowerCase();
    // Simple similarity: count matching characters
    let score = 0;
    for (let i = 0; i < Math.min(lowerName.length, habitLower.length); i++) {
      if (lowerName[i] === habitLower[i]) score++;
    }
    // Also check if one contains the other
    if (habitLower.includes(lowerName) || lowerName.includes(habitLower)) {
      score += 10;
    }
    if (score > bestScore) {
      bestScore = score;
      best = habit.name;
    }
  }

  return bestScore >= 3 ? best : null;
}

// ---------------------------------------------------------------------------
// Streak calculation
// ---------------------------------------------------------------------------

function calculateCurrentStreak(completions: string[], frequency: Frequency): number {
  if (completions.length === 0) return 0;

  const sorted = [...completions].sort().reverse(); // Most recent first
  const today = todayStr();
  let streak = 0;
  let expectedDate = today;

  for (const date of sorted) {
    if (frequency === 'daily') {
      if (date === expectedDate) {
        streak++;
        expectedDate = addDays(expectedDate, -1);
      } else if (date === addDays(today, -1) && streak === 0) {
        // Allow one day grace if not completed today yet
        streak++;
        expectedDate = addDays(date, -1);
      } else {
        break;
      }
    } else if (frequency === 'weekdays') {
      const d = new Date(date);
      const day = d.getDay();
      if (day === 0 || day === 6) continue; // Skip weekends

      if (date === expectedDate || daysBetween(date, expectedDate) <= 3) {
        streak++;
        // Find the previous weekday
        const prev = new Date(date);
        do {
          prev.setDate(prev.getDate() - 1);
        } while (prev.getDay() === 0 || prev.getDay() === 6);
        expectedDate = dateStr(prev);
      } else {
        break;
      }
    } else if (frequency === 'weekly') {
      if (daysBetween(date, expectedDate) <= 7) {
        streak++;
        expectedDate = addDays(date, -7);
      } else {
        break;
      }
    } else {
      // Custom: any completion counts
      streak++;
    }
  }

  return streak;
}

function calculateBestStreak(completions: string[], frequency: Frequency): number {
  if (completions.length === 0) return 0;

  const sorted = [...completions].sort();
  let bestStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1]!, sorted[i]!);
    const maxGap = frequency === 'weekly' ? 8 : frequency === 'weekdays' ? 3 : 1;

    if (gap <= maxGap) {
      currentStreak++;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  return bestStreak;
}

function calculateCompletionRate(habit: Habit): number {
  const daysSinceCreation = Math.max(
    1,
    daysBetween(new Date(habit.createdAt).toISOString().split('T')[0]!, todayStr()),
  );

  let expectedCompletions: number;
  switch (habit.frequency) {
    case 'daily':
      expectedCompletions = daysSinceCreation;
      break;
    case 'weekdays':
      expectedCompletions = Math.floor(daysSinceCreation * 5 / 7);
      break;
    case 'weekly':
      expectedCompletions = Math.floor(daysSinceCreation / 7);
      break;
    default:
      expectedCompletions = daysSinceCreation;
  }

  return expectedCompletions > 0
    ? Math.min(100, Math.round((habit.completions.length / expectedCompletions) * 100))
    : 0;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function habitCreate(
  name: string,
  frequency: Frequency = 'daily',
): Promise<{ id: string; name: string; frequency: Frequency }> {
  const habits = loadHabits();

  // Check for duplicates
  if (findHabit(habits, name)) {
    throw new Error(`Habit "${name}" already exists`);
  }

  const validFrequencies: Frequency[] = ['daily', 'weekly', 'weekdays', 'custom'];
  if (!validFrequencies.includes(frequency)) {
    throw new Error(`Invalid frequency: ${frequency}. Use: ${validFrequencies.join(', ')}`);
  }

  const habit: Habit = {
    id: generateId(),
    name: name.trim(),
    frequency,
    createdAt: Date.now(),
    completions: [],
  };

  habits.push(habit);
  saveHabits(habits);

  return { id: habit.id, name: habit.name, frequency: habit.frequency };
}

async function habitCheck(
  name: string,
): Promise<{ checked: boolean; streak: number; alreadyCompleted: boolean }> {
  const habits = loadHabits();
  const habit = findHabit(habits, name);

  if (!habit) {
    const suggestion = findClosestMatch(habits, name);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    throw new Error(`Habit "${name}" not found.${hint}`);
  }

  const today = todayStr();

  if (habit.completions.includes(today)) {
    return {
      checked: true,
      streak: calculateCurrentStreak(habit.completions, habit.frequency),
      alreadyCompleted: true,
    };
  }

  habit.completions.push(today);
  saveHabits(habits);

  const streak = calculateCurrentStreak(habit.completions, habit.frequency);

  return { checked: true, streak, alreadyCompleted: false };
}

async function habitList(): Promise<{ habits: HabitInfo[] }> {
  const habits = loadHabits();
  const today = todayStr();

  const habitInfos: HabitInfo[] = habits.map((h) => ({
    id: h.id,
    name: h.name,
    frequency: h.frequency,
    currentStreak: calculateCurrentStreak(h.completions, h.frequency),
    bestStreak: calculateBestStreak(h.completions, h.frequency),
    completedToday: h.completions.includes(today),
    totalCompletions: h.completions.length,
    createdAt: h.createdAt,
  }));

  return { habits: habitInfos };
}

async function habitStats(
  name?: string,
): Promise<{ stats: HabitStats | HabitStats[] }> {
  const habits = loadHabits();

  function computeStats(habit: Habit): HabitStats {
    const today = todayStr();
    const createdDate = new Date(habit.createdAt).toISOString().split('T')[0]!;
    const daysSinceCreation = Math.max(1, daysBetween(createdDate, today));

    // Last 7 days
    const last7Days: boolean[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      last7Days.push(habit.completions.includes(d));
    }

    // Last 30 days completions
    const thirtyDaysAgo = addDays(today, -30);
    const last30Days = habit.completions.filter((c) => c >= thirtyDaysAgo && c <= today).length;

    // Weekly average
    const weeksTracked = Math.max(1, daysSinceCreation / 7);
    const weeklyAverage = Math.round((habit.completions.length / weeksTracked) * 10) / 10;

    return {
      name: habit.name,
      frequency: habit.frequency,
      currentStreak: calculateCurrentStreak(habit.completions, habit.frequency),
      bestStreak: calculateBestStreak(habit.completions, habit.frequency),
      totalCompletions: habit.completions.length,
      completionRate: calculateCompletionRate(habit),
      last7Days,
      last30Days,
      daysSinceCreation,
      weeklyAverage,
    };
  }

  if (name) {
    const habit = findHabit(habits, name);
    if (!habit) {
      const suggestion = findClosestMatch(habits, name);
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
      throw new Error(`Habit "${name}" not found.${hint}`);
    }
    return { stats: computeStats(habit) };
  }

  return { stats: habits.map(computeStats) };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'habit-tracker';
export const description = 'Track habits with streaks, completion rates, and statistics';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'habit_create',
    description: 'Create a new habit to track',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the habit' },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekly', 'weekdays', 'custom'],
          description: 'How often the habit should be performed (default: daily)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'habit_check',
    description: 'Mark a habit as completed for today',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the habit to check off' },
      },
      required: ['name'],
    },
  },
  {
    name: 'habit_list',
    description: 'List all tracked habits with current streak info',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'habit_stats',
    description: 'Get detailed statistics for habits',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Habit name (omit for all habits)',
        },
      },
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'habit_create':
      return habitCreate(
        args.name as string,
        (args.frequency as Frequency) ?? 'daily',
      );
    case 'habit_check':
      return habitCheck(args.name as string);
    case 'habit_list':
      return habitList();
    case 'habit_stats':
      return habitStats(args.name as string | undefined);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
