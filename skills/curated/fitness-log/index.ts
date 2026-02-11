/**
 * @alfred/skill-fitness-log
 *
 * Log workouts with exercises, sets, reps, and weight.
 * Track personal records (PRs), total volume, and generate training plans.
 * Supports Bugenhagen-compatible programming.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExerciseSet {
  reps: number;
  weight: number; // lbs
  rpe?: number; // Rate of Perceived Exertion 1-10
}

interface ExerciseInput {
  name: string;
  sets: ExerciseSet[];
  notes?: string;
}

interface LoggedExercise {
  name: string;
  normalizedName: string;
  sets: ExerciseSet[];
  volume: number; // total reps * weight
  notes?: string;
}

interface Workout {
  id: string;
  date: string; // ISO YYYY-MM-DD
  exercises: LoggedExercise[];
  totalVolume: number;
  duration?: number; // minutes
  createdAt: number;
}

interface PRRecord {
  exercise: string;
  maxWeight: number;
  maxReps: number;
  maxVolume: number;
  estimated1RM: number;
  achievedAt: string;
}

interface NewPR {
  exercise: string;
  type: 'weight' | 'reps' | 'volume' | '1rm';
  previous: number;
  current: number;
}

interface PlanDay {
  day: string;
  focus: string;
  exercises: Array<{
    name: string;
    sets: number;
    reps: string;
    rest: string;
    notes?: string;
  }>;
  mealSuggestion?: string;
}

interface Plan {
  type: string;
  daysPerWeek: number;
  schedule: PlanDay[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'fitness-log');
const DB_FILE = join(DATA_DIR, 'workouts.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadWorkouts(): Workout[] {
  ensureDataDir();
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveWorkouts(workouts: Workout[]): void {
  ensureDataDir();
  writeFileSync(DB_FILE, JSON.stringify(workouts, null, 2), 'utf-8');
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

function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/dumbbell/gi, 'db')
    .replace(/barbell/gi, 'bb');
}

const EXERCISE_ALIASES: Record<string, string> = {
  'bench': 'bench press',
  'bench press': 'bench press',
  'flat bench': 'bench press',
  'squat': 'back squat',
  'back squat': 'back squat',
  'front squat': 'front squat',
  'deadlift': 'deadlift',
  'dl': 'deadlift',
  'ohp': 'overhead press',
  'overhead press': 'overhead press',
  'military press': 'overhead press',
  'pull up': 'pull up',
  'pullup': 'pull up',
  'chin up': 'chin up',
  'chinup': 'chin up',
  'row': 'barbell row',
  'bb row': 'barbell row',
  'db row': 'dumbbell row',
  'curl': 'bicep curl',
  'bicep curl': 'bicep curl',
  'rdl': 'romanian deadlift',
  'romanian deadlift': 'romanian deadlift',
  'leg press': 'leg press',
  'lat pulldown': 'lat pulldown',
  'dip': 'dip',
  'dips': 'dip',
};

function resolveExercise(name: string): string {
  const normalized = normalizeExerciseName(name);
  return EXERCISE_ALIASES[normalized] ?? name.trim();
}

/**
 * Estimate 1RM using Epley formula: weight * (1 + reps / 30)
 */
function estimate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps === 0 || weight === 0) return 0;
  return Math.round(weight * (1 + reps / 30));
}

function calculateVolume(sets: ExerciseSet[]): number {
  return sets.reduce((total, set) => total + set.reps * set.weight, 0);
}

// ---------------------------------------------------------------------------
// PR detection
// ---------------------------------------------------------------------------

function detectPRs(
  exercise: LoggedExercise,
  workouts: Workout[],
): NewPR[] {
  const prs: NewPR[] = [];
  const exerciseName = exercise.normalizedName;

  // Get historical data for this exercise
  const historicalSets: ExerciseSet[] = [];
  for (const workout of workouts) {
    for (const ex of workout.exercises) {
      if (ex.normalizedName === exerciseName) {
        historicalSets.push(...ex.sets);
      }
    }
  }

  if (historicalSets.length === 0) return prs; // First time — no PRs to compare

  // Check max weight
  const prevMaxWeight = Math.max(0, ...historicalSets.map((s) => s.weight));
  const currentMaxWeight = Math.max(0, ...exercise.sets.map((s) => s.weight));
  if (currentMaxWeight > prevMaxWeight) {
    prs.push({
      exercise: exercise.name,
      type: 'weight',
      previous: prevMaxWeight,
      current: currentMaxWeight,
    });
  }

  // Check max reps at max weight
  const prevMaxReps = Math.max(0, ...historicalSets.filter((s) => s.weight === prevMaxWeight).map((s) => s.reps));
  const currentMaxReps = Math.max(0, ...exercise.sets.filter((s) => s.weight >= prevMaxWeight).map((s) => s.reps));
  if (currentMaxReps > prevMaxReps && prevMaxReps > 0) {
    prs.push({
      exercise: exercise.name,
      type: 'reps',
      previous: prevMaxReps,
      current: currentMaxReps,
    });
  }

  // Check estimated 1RM
  const prevMax1RM = Math.max(0, ...historicalSets.map((s) => estimate1RM(s.weight, s.reps)));
  const currentMax1RM = Math.max(0, ...exercise.sets.map((s) => estimate1RM(s.weight, s.reps)));
  if (currentMax1RM > prevMax1RM) {
    prs.push({
      exercise: exercise.name,
      type: '1rm',
      previous: prevMax1RM,
      current: currentMax1RM,
    });
  }

  return prs;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function workoutLog(
  exercises: ExerciseInput[],
): Promise<{ id: string; totalVolume: number; exercises: LoggedExercise[]; prs: NewPR[] }> {
  if (!exercises || exercises.length === 0) {
    throw new Error('At least one exercise is required');
  }

  const workouts = loadWorkouts();
  const allPRs: NewPR[] = [];

  const loggedExercises: LoggedExercise[] = exercises.map((ex) => {
    const resolved = resolveExercise(ex.name);
    const volume = calculateVolume(ex.sets);
    const logged: LoggedExercise = {
      name: resolved,
      normalizedName: normalizeExerciseName(resolved),
      sets: ex.sets,
      volume,
      notes: ex.notes,
    };

    // Detect PRs against historical data
    const prs = detectPRs(logged, workouts);
    allPRs.push(...prs);

    return logged;
  });

  const totalVolume = loggedExercises.reduce((sum, e) => sum + e.volume, 0);

  const workout: Workout = {
    id: generateId(),
    date: todayStr(),
    exercises: loggedExercises,
    totalVolume,
    createdAt: Date.now(),
  };

  workouts.push(workout);
  saveWorkouts(workouts);

  return {
    id: workout.id,
    totalVolume,
    exercises: loggedExercises,
    prs: allPRs,
  };
}

async function workoutHistory(
  days: number = 30,
): Promise<{ workouts: Workout[]; totalSessions: number; totalVolume: number }> {
  const workouts = loadWorkouts();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0]!;

  const filtered = workouts
    .filter((w) => w.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalVolume = filtered.reduce((sum, w) => sum + w.totalVolume, 0);

  return {
    workouts: filtered,
    totalSessions: filtered.length,
    totalVolume,
  };
}

async function workoutPR(exercise: string): Promise<{ prs: PRRecord }> {
  const workouts = loadWorkouts();
  const exerciseName = normalizeExerciseName(resolveExercise(exercise));

  const allSets: Array<ExerciseSet & { date: string }> = [];
  for (const workout of workouts) {
    for (const ex of workout.exercises) {
      if (ex.normalizedName === exerciseName) {
        for (const set of ex.sets) {
          allSets.push({ ...set, date: workout.date });
        }
      }
    }
  }

  if (allSets.length === 0) {
    throw new Error(`No data found for exercise: ${exercise}`);
  }

  const maxWeightSet = allSets.reduce((max, s) => (s.weight > max.weight ? s : max));
  const maxRepsSet = allSets.reduce((max, s) => (s.reps > max.reps ? s : max));
  const maxVolumeSet = allSets.reduce((max, s) =>
    s.reps * s.weight > max.reps * max.weight ? s : max,
  );
  const max1RMSet = allSets.reduce((max, s) =>
    estimate1RM(s.weight, s.reps) > estimate1RM(max.weight, max.reps) ? s : max,
  );

  return {
    prs: {
      exercise: resolveExercise(exercise),
      maxWeight: maxWeightSet.weight,
      maxReps: maxRepsSet.reps,
      maxVolume: maxVolumeSet.reps * maxVolumeSet.weight,
      estimated1RM: estimate1RM(max1RMSet.weight, max1RMSet.reps),
      achievedAt: max1RMSet.date,
    },
  };
}

async function workoutPlan(
  type: string = 'strength',
): Promise<{ plan: Plan }> {
  const plans: Record<string, Plan> = {
    strength: {
      type: 'strength',
      daysPerWeek: 4,
      schedule: [
        {
          day: 'Monday',
          focus: 'Upper Push',
          exercises: [
            { name: 'Bench Press', sets: 5, reps: '5', rest: '3-5 min', notes: 'Work up to heavy 5' },
            { name: 'Overhead Press', sets: 4, reps: '6', rest: '3 min' },
            { name: 'Dip', sets: 3, reps: '8-10', rest: '2 min' },
            { name: 'Tricep Pushdown', sets: 3, reps: '12', rest: '90 sec' },
          ],
          mealSuggestion: 'Grilled chicken breast with rice and steamed broccoli (gluten-free)',
        },
        {
          day: 'Tuesday',
          focus: 'Lower',
          exercises: [
            { name: 'Back Squat', sets: 5, reps: '5', rest: '3-5 min', notes: 'Work up to heavy 5' },
            { name: 'Romanian Deadlift', sets: 4, reps: '8', rest: '3 min' },
            { name: 'Leg Press', sets: 3, reps: '10', rest: '2 min' },
            { name: 'Calf Raises', sets: 4, reps: '15', rest: '60 sec' },
          ],
          mealSuggestion: 'Salmon with sweet potato and asparagus (gluten-free)',
        },
        {
          day: 'Thursday',
          focus: 'Upper Pull',
          exercises: [
            { name: 'Barbell Row', sets: 5, reps: '5', rest: '3-5 min' },
            { name: 'Pull Up', sets: 4, reps: '6-8', rest: '3 min' },
            { name: 'Face Pull', sets: 3, reps: '15', rest: '90 sec' },
            { name: 'Bicep Curl', sets: 3, reps: '12', rest: '90 sec' },
          ],
          mealSuggestion: 'Turkey stir-fry with vegetables and rice (gluten-free)',
        },
        {
          day: 'Friday',
          focus: 'Lower + Deadlift',
          exercises: [
            { name: 'Deadlift', sets: 5, reps: '3', rest: '4-5 min', notes: 'Work up to heavy triple' },
            { name: 'Front Squat', sets: 3, reps: '6', rest: '3 min' },
            { name: 'Hip Thrust', sets: 3, reps: '10', rest: '2 min' },
            { name: 'Ab Wheel', sets: 3, reps: '10', rest: '90 sec' },
          ],
          mealSuggestion: 'Grilled steak with mashed potatoes and green beans (gluten-free)',
        },
      ],
      notes: [
        'Progressive overload: add 5 lbs to upper lifts and 10 lbs to lower lifts each week',
        'Deload every 4th week at 60% intensity',
        'All meal suggestions are gluten-free',
      ],
    },
    hypertrophy: {
      type: 'hypertrophy',
      daysPerWeek: 5,
      schedule: [
        {
          day: 'Monday',
          focus: 'Chest & Triceps',
          exercises: [
            { name: 'Bench Press', sets: 4, reps: '8-10', rest: '2 min' },
            { name: 'Incline DB Press', sets: 4, reps: '10-12', rest: '90 sec' },
            { name: 'Cable Fly', sets: 3, reps: '12-15', rest: '60 sec' },
            { name: 'Tricep Pushdown', sets: 3, reps: '12-15', rest: '60 sec' },
            { name: 'Overhead Tricep Extension', sets: 3, reps: '12', rest: '60 sec' },
          ],
          mealSuggestion: 'Chicken breast with quinoa and roasted vegetables (gluten-free)',
        },
        {
          day: 'Tuesday',
          focus: 'Back & Biceps',
          exercises: [
            { name: 'Barbell Row', sets: 4, reps: '8-10', rest: '2 min' },
            { name: 'Lat Pulldown', sets: 4, reps: '10-12', rest: '90 sec' },
            { name: 'Cable Row', sets: 3, reps: '12', rest: '90 sec' },
            { name: 'Bicep Curl', sets: 3, reps: '12', rest: '60 sec' },
            { name: 'Hammer Curl', sets: 3, reps: '12', rest: '60 sec' },
          ],
          mealSuggestion: 'Tuna salad with avocado and mixed greens (gluten-free)',
        },
        {
          day: 'Wednesday',
          focus: 'Legs',
          exercises: [
            { name: 'Back Squat', sets: 4, reps: '8-10', rest: '2-3 min' },
            { name: 'Leg Press', sets: 4, reps: '10-12', rest: '2 min' },
            { name: 'Romanian Deadlift', sets: 3, reps: '10', rest: '2 min' },
            { name: 'Leg Curl', sets: 3, reps: '12', rest: '60 sec' },
            { name: 'Calf Raises', sets: 4, reps: '15-20', rest: '60 sec' },
          ],
          mealSuggestion: 'Lean beef with brown rice and steamed broccoli (gluten-free)',
        },
        {
          day: 'Thursday',
          focus: 'Shoulders & Arms',
          exercises: [
            { name: 'Overhead Press', sets: 4, reps: '8-10', rest: '2 min' },
            { name: 'Lateral Raise', sets: 4, reps: '12-15', rest: '60 sec' },
            { name: 'Face Pull', sets: 3, reps: '15', rest: '60 sec' },
            { name: 'EZ Bar Curl', sets: 3, reps: '10', rest: '60 sec' },
            { name: 'Skull Crusher', sets: 3, reps: '10', rest: '60 sec' },
          ],
          mealSuggestion: 'Grilled shrimp with corn salad and rice (gluten-free)',
        },
        {
          day: 'Friday',
          focus: 'Full Body',
          exercises: [
            { name: 'Deadlift', sets: 4, reps: '6-8', rest: '3 min' },
            { name: 'Bench Press', sets: 3, reps: '10', rest: '2 min' },
            { name: 'Pull Up', sets: 3, reps: 'AMRAP', rest: '2 min' },
            { name: 'Leg Extension', sets: 3, reps: '15', rest: '60 sec' },
          ],
          mealSuggestion: 'Pork tenderloin with roasted sweet potatoes (gluten-free)',
        },
      ],
      notes: [
        'Focus on time under tension: 2-second eccentric, 1-second concentric',
        'Track RPE — stay at 7-8 for most sets',
        'All meal suggestions are gluten-free',
      ],
    },
    bugenhagen: {
      type: 'bugenhagen',
      daysPerWeek: 6,
      schedule: [
        {
          day: 'Monday',
          focus: 'Heavy Compound — Work Up',
          exercises: [
            { name: 'Bench Press', sets: 1, reps: 'Work up to daily max', rest: 'As needed', notes: 'Bugenhagen style: singles to daily max' },
            { name: 'Back Squat', sets: 1, reps: 'Work up to daily max', rest: 'As needed' },
            { name: 'Grip Work', sets: 3, reps: 'Max hold', rest: '2 min', notes: 'Plate pinches or farmer walks' },
          ],
          mealSuggestion: 'Eggs, bacon, and hash browns with fruit (gluten-free)',
        },
        {
          day: 'Tuesday',
          focus: 'Volume — Repetition Method',
          exercises: [
            { name: 'Overhead Press', sets: 5, reps: '10', rest: '90 sec' },
            { name: 'Pull Up', sets: 5, reps: 'Max', rest: '2 min' },
            { name: 'Dip', sets: 5, reps: 'Max', rest: '2 min' },
            { name: 'Strongman Carry', sets: 3, reps: '60 sec', rest: '2 min' },
          ],
          mealSuggestion: 'Ground beef chili with rice and beans (gluten-free)',
        },
        {
          day: 'Wednesday',
          focus: 'Deadlift & Odd Objects',
          exercises: [
            { name: 'Deadlift', sets: 1, reps: 'Work up to daily max', rest: 'As needed' },
            { name: 'Sandbag Carry', sets: 3, reps: '100 ft', rest: '3 min' },
            { name: 'Neck Harness', sets: 3, reps: '20', rest: '90 sec', notes: 'Bugenhagen staple' },
            { name: 'Reverse Hyper', sets: 3, reps: '15', rest: '90 sec' },
          ],
          mealSuggestion: 'Whole roasted chicken with potatoes and salad (gluten-free)',
        },
        {
          day: 'Thursday',
          focus: 'Bodyweight & Conditioning',
          exercises: [
            { name: 'Muscle Up', sets: 5, reps: '3-5', rest: '3 min' },
            { name: 'Handstand Push Up', sets: 3, reps: 'Max', rest: '3 min' },
            { name: 'Sled Push', sets: 6, reps: '40 yards', rest: '90 sec' },
            { name: 'Ab Wheel', sets: 3, reps: '10', rest: '90 sec' },
          ],
          mealSuggestion: 'Salmon with sweet potato and roasted vegetables (gluten-free)',
        },
        {
          day: 'Friday',
          focus: 'Max Effort Variations',
          exercises: [
            { name: 'Floor Press', sets: 1, reps: 'Work up to daily max', rest: 'As needed' },
            { name: 'Box Squat', sets: 1, reps: 'Work up to daily max', rest: 'As needed' },
            { name: 'Grip Work', sets: 3, reps: 'Varied', rest: '2 min' },
            { name: 'Band Pull-Aparts', sets: 5, reps: '20', rest: '30 sec' },
          ],
          mealSuggestion: 'Steak and eggs with avocado and fruit (gluten-free)',
        },
        {
          day: 'Saturday',
          focus: 'Active Recovery / Odd Lifts',
          exercises: [
            { name: 'Stone Loading', sets: 5, reps: '3', rest: '3 min', notes: 'Atlas stones or natural stones' },
            { name: 'Tire Flip', sets: 5, reps: '5', rest: '3 min' },
            { name: 'Log Clean & Press', sets: 3, reps: '5', rest: '3 min' },
            { name: 'Light Cardio', sets: 1, reps: '20-30 min', rest: 'N/A' },
          ],
          mealSuggestion: 'BBQ ribs with corn on the cob and coleslaw (gluten-free)',
        },
      ],
      notes: [
        'Bugenhagen approach: train daily, work up to a daily max, listen to your body',
        'Grip strength is a priority — incorporate daily',
        'Odd object work builds real-world functional strength',
        'No rigid percentages — go by feel and daily readiness',
        'All meal suggestions are gluten-free',
      ],
    },
    endurance: {
      type: 'endurance',
      daysPerWeek: 5,
      schedule: [
        {
          day: 'Monday',
          focus: 'Circuit Training',
          exercises: [
            { name: 'Kettlebell Swing', sets: 5, reps: '20', rest: '30 sec' },
            { name: 'Burpee', sets: 5, reps: '10', rest: '30 sec' },
            { name: 'Box Jump', sets: 5, reps: '10', rest: '30 sec' },
            { name: 'Mountain Climber', sets: 5, reps: '30 sec', rest: '30 sec' },
          ],
          mealSuggestion: 'Oatmeal alternative: chia pudding with berries (gluten-free)',
        },
        {
          day: 'Tuesday',
          focus: 'Steady State Cardio',
          exercises: [
            { name: 'Running', sets: 1, reps: '30-45 min', rest: 'N/A', notes: 'Zone 2 heart rate' },
            { name: 'Core Circuit', sets: 3, reps: '10 each', rest: '60 sec' },
          ],
          mealSuggestion: 'Grilled fish tacos with corn tortillas (gluten-free)',
        },
        {
          day: 'Wednesday',
          focus: 'Strength-Endurance',
          exercises: [
            { name: 'Back Squat', sets: 4, reps: '15', rest: '90 sec' },
            { name: 'Push Up', sets: 4, reps: 'Max', rest: '60 sec' },
            { name: 'Pull Up', sets: 4, reps: 'Max', rest: '90 sec' },
            { name: 'Plank', sets: 3, reps: '60 sec', rest: '30 sec' },
          ],
          mealSuggestion: 'Chicken stir-fry with rice noodles (gluten-free)',
        },
        {
          day: 'Thursday',
          focus: 'Interval Training',
          exercises: [
            { name: 'Sprint Intervals', sets: 10, reps: '30 sec on / 30 sec off', rest: '30 sec' },
            { name: 'Rowing', sets: 5, reps: '500m', rest: '2 min' },
          ],
          mealSuggestion: 'Protein smoothie with banana, peanut butter, and almond milk (gluten-free)',
        },
        {
          day: 'Friday',
          focus: 'Long Duration',
          exercises: [
            { name: 'Cycling or Swimming', sets: 1, reps: '45-60 min', rest: 'N/A' },
            { name: 'Stretching', sets: 1, reps: '15 min', rest: 'N/A' },
          ],
          mealSuggestion: 'Grilled salmon with quinoa salad (gluten-free)',
        },
      ],
      notes: [
        'Heart rate zones matter: Z2 for endurance base, Z4-5 for intervals',
        'Hydrate well — aim for body weight (lbs) / 2 in ounces of water daily',
        'All meal suggestions are gluten-free',
      ],
    },
  };

  const plan = plans[type.toLowerCase()];
  if (!plan) {
    const available = Object.keys(plans).join(', ');
    throw new Error(`Unknown plan type: ${type}. Available: ${available}`);
  }

  return { plan };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'fitness-log';
export const description =
  'Log workouts, track PRs, volume, and generate training plans with gluten-free meal suggestions';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'workout_log',
    description: 'Log a workout session with exercises, sets, reps, and weight',
    parameters: {
      type: 'object',
      properties: {
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Exercise name' },
              sets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    reps: { type: 'number' },
                    weight: { type: 'number', description: 'Weight in lbs' },
                    rpe: { type: 'number', description: 'RPE 1-10 (optional)' },
                  },
                  required: ['reps', 'weight'],
                },
              },
              notes: { type: 'string' },
            },
            required: ['name', 'sets'],
          },
          description: 'List of exercises with sets',
        },
      },
      required: ['exercises'],
    },
  },
  {
    name: 'workout_history',
    description: 'Get workout history for the past N days',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look back (default: 30)' },
      },
    },
  },
  {
    name: 'workout_pr',
    description: 'Get personal records for a specific exercise',
    parameters: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exercise name' },
      },
      required: ['exercise'],
    },
  },
  {
    name: 'workout_plan',
    description: 'Generate a workout plan',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['strength', 'hypertrophy', 'bugenhagen', 'endurance'],
          description: 'Plan type',
        },
      },
      required: ['type'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'workout_log':
      return workoutLog(args.exercises as ExerciseInput[]);
    case 'workout_history':
      return workoutHistory((args.days as number) ?? 30);
    case 'workout_pr':
      return workoutPR(args.exercise as string);
    case 'workout_plan':
      return workoutPlan((args.type as string) ?? 'strength');
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
