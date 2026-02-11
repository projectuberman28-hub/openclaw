/**
 * @alfred/skill-expense-tracker
 *
 * Parse and track expenses with category-based organization.
 * SQLite-backed storage with reports and CSV/JSON export.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string; // ISO date string YYYY-MM-DD
  createdAt: number; // epoch ms
}

interface ExpenseListResult {
  expenses: Expense[];
  total: number;
  count: number;
  period?: string;
  category?: string;
}

interface CategoryBreakdown {
  category: string;
  total: number;
  count: number;
  percentage: number;
}

interface ReportData {
  period: string;
  startDate: string;
  endDate: string;
  totalSpent: number;
  transactionCount: number;
  averagePerTransaction: number;
  dailyAverage: number;
  categories: CategoryBreakdown[];
  topExpense: Expense | null;
  trend: 'up' | 'down' | 'stable';
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'expense-tracker');
const DB_FILE = join(DATA_DIR, 'expenses.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadExpenses(): Expense[] {
  ensureDataDir();
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveExpenses(expenses: Expense[]): void {
  ensureDataDir();
  writeFileSync(DB_FILE, JSON.stringify(expenses, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

function parseDate(dateStr?: string): string {
  if (!dateStr) {
    return new Date().toISOString().split('T')[0]!;
  }

  // Try parsing various date formats
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0]!;
  }

  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // Try MM/DD/YYYY
  const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1]!.padStart(2, '0')}-${usMatch[2]!.padStart(2, '0')}`;
  }

  // Default to today
  return new Date().toISOString().split('T')[0]!;
}

function getDateRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start: Date;

  switch (period) {
    case 'week': {
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case 'month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'year': {
      start = new Date(now.getFullYear(), 0, 1);
      break;
    }
    case 'last-month': {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end.setDate(0); // Last day of previous month
      break;
    }
    case 'all':
    default: {
      start = new Date(2000, 0, 1);
      break;
    }
  }

  return { start, end };
}

function filterExpenses(
  expenses: Expense[],
  period?: string,
  category?: string,
): Expense[] {
  let filtered = expenses;

  if (period && period !== 'all') {
    const { start, end } = getDateRange(period);
    filtered = filtered.filter((e) => {
      const d = new Date(e.date);
      return d >= start && d <= end;
    });
  }

  if (category) {
    const lowerCat = category.toLowerCase();
    filtered = filtered.filter((e) => e.category.toLowerCase() === lowerCat);
  }

  // Sort by date descending
  filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return filtered;
}

// ---------------------------------------------------------------------------
// Default categories
// ---------------------------------------------------------------------------

const CATEGORY_ALIASES: Record<string, string> = {
  food: 'Food & Dining',
  dining: 'Food & Dining',
  restaurant: 'Food & Dining',
  groceries: 'Food & Dining',
  grocery: 'Food & Dining',
  transport: 'Transportation',
  transportation: 'Transportation',
  gas: 'Transportation',
  uber: 'Transportation',
  lyft: 'Transportation',
  rent: 'Housing',
  housing: 'Housing',
  mortgage: 'Housing',
  utility: 'Utilities',
  utilities: 'Utilities',
  electric: 'Utilities',
  water: 'Utilities',
  internet: 'Utilities',
  phone: 'Utilities',
  health: 'Healthcare',
  healthcare: 'Healthcare',
  medical: 'Healthcare',
  doctor: 'Healthcare',
  pharmacy: 'Healthcare',
  entertainment: 'Entertainment',
  movie: 'Entertainment',
  games: 'Entertainment',
  subscription: 'Subscriptions',
  subscriptions: 'Subscriptions',
  netflix: 'Subscriptions',
  spotify: 'Subscriptions',
  shopping: 'Shopping',
  clothes: 'Shopping',
  clothing: 'Shopping',
  amazon: 'Shopping',
  education: 'Education',
  book: 'Education',
  course: 'Education',
  travel: 'Travel',
  hotel: 'Travel',
  flight: 'Travel',
  insurance: 'Insurance',
  savings: 'Savings',
  investment: 'Investments',
  other: 'Other',
  misc: 'Other',
};

function normalizeCategory(category: string): string {
  const lower = category.toLowerCase().trim();
  return CATEGORY_ALIASES[lower] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function expenseAdd(
  amount: number,
  category: string,
  description: string,
  date?: string,
): Promise<{ id: string; amount: number; category: string; date: string }> {
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }

  const expenses = loadExpenses();
  const normalizedCategory = normalizeCategory(category);
  const parsedDate = parseDate(date);

  const expense: Expense = {
    id: generateId(),
    amount: Math.round(amount * 100) / 100, // Round to 2 decimals
    category: normalizedCategory,
    description: description.trim(),
    date: parsedDate,
    createdAt: Date.now(),
  };

  expenses.push(expense);
  saveExpenses(expenses);

  return {
    id: expense.id,
    amount: expense.amount,
    category: expense.category,
    date: expense.date,
  };
}

async function expenseList(
  period?: string,
  category?: string,
): Promise<ExpenseListResult> {
  const expenses = loadExpenses();
  const filtered = filterExpenses(expenses, period, category);
  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  return {
    expenses: filtered,
    total: Math.round(total * 100) / 100,
    count: filtered.length,
    period,
    category,
  };
}

async function expenseReport(period: string): Promise<{ report: ReportData }> {
  const expenses = loadExpenses();
  const { start, end } = getDateRange(period);
  const filtered = filterExpenses(expenses, period);

  const totalSpent = filtered.reduce((sum, e) => sum + e.amount, 0);
  const daysDiff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));

  // Category breakdown
  const categoryMap = new Map<string, { total: number; count: number }>();
  for (const expense of filtered) {
    const existing = categoryMap.get(expense.category) ?? { total: 0, count: 0 };
    existing.total += expense.amount;
    existing.count++;
    categoryMap.set(expense.category, existing);
  }

  const categories: CategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      total: Math.round(data.total * 100) / 100,
      count: data.count,
      percentage: totalSpent > 0 ? Math.round((data.total / totalSpent) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Find top expense
  const topExpense = filtered.reduce<Expense | null>(
    (max, e) => (!max || e.amount > max.amount ? e : max),
    null,
  );

  // Calculate trend by comparing first half to second half
  const midDate = new Date((start.getTime() + end.getTime()) / 2);
  const firstHalf = filtered.filter((e) => new Date(e.date) < midDate);
  const secondHalf = filtered.filter((e) => new Date(e.date) >= midDate);
  const firstHalfTotal = firstHalf.reduce((sum, e) => sum + e.amount, 0);
  const secondHalfTotal = secondHalf.reduce((sum, e) => sum + e.amount, 0);

  let trend: 'up' | 'down' | 'stable';
  if (secondHalfTotal > firstHalfTotal * 1.1) {
    trend = 'up';
  } else if (secondHalfTotal < firstHalfTotal * 0.9) {
    trend = 'down';
  } else {
    trend = 'stable';
  }

  const report: ReportData = {
    period,
    startDate: start.toISOString().split('T')[0]!,
    endDate: end.toISOString().split('T')[0]!,
    totalSpent: Math.round(totalSpent * 100) / 100,
    transactionCount: filtered.length,
    averagePerTransaction:
      filtered.length > 0 ? Math.round((totalSpent / filtered.length) * 100) / 100 : 0,
    dailyAverage: Math.round((totalSpent / daysDiff) * 100) / 100,
    categories,
    topExpense,
    trend,
  };

  return { report };
}

async function expenseExport(
  format: string = 'csv',
): Promise<{ path: string; count: number }> {
  const expenses = loadExpenses();
  const exportDir = join(DATA_DIR, 'exports');
  if (!existsSync(exportDir)) {
    mkdirSync(exportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'csv') {
    const header = 'ID,Date,Amount,Category,Description';
    const rows = expenses.map(
      (e) =>
        `${e.id},${e.date},${e.amount},"${e.category}","${e.description.replace(/"/g, '""')}"`,
    );
    const csv = [header, ...rows].join('\n');
    const filePath = join(exportDir, `expenses-${timestamp}.csv`);
    writeFileSync(filePath, csv, 'utf-8');
    return { path: filePath, count: expenses.length };
  }

  if (format === 'json') {
    const filePath = join(exportDir, `expenses-${timestamp}.json`);
    writeFileSync(filePath, JSON.stringify(expenses, null, 2), 'utf-8');
    return { path: filePath, count: expenses.length };
  }

  throw new Error(`Unsupported export format: ${format}. Use 'csv' or 'json'.`);
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'expense-tracker';
export const description = 'Track expenses with categories, reports, and CSV export';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'expense_add',
    description: 'Add an expense entry',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Expense amount in dollars' },
        category: { type: 'string', description: 'Expense category (e.g., food, transport, entertainment)' },
        description: { type: 'string', description: 'Description of the expense' },
        date: { type: 'string', description: 'Date of expense (YYYY-MM-DD, default: today)' },
      },
      required: ['amount', 'category', 'description'],
    },
  },
  {
    name: 'expense_list',
    description: 'List expenses with optional filtering by period and category',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['week', 'month', 'year', 'last-month', 'all'],
          description: 'Time period to filter',
        },
        category: { type: 'string', description: 'Category to filter by' },
      },
    },
  },
  {
    name: 'expense_report',
    description: 'Generate a spending report for a given period',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['week', 'month', 'year', 'last-month'],
          description: 'Report period',
        },
      },
      required: ['period'],
    },
  },
  {
    name: 'expense_export',
    description: 'Export all expenses to a file',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['csv', 'json'],
          description: 'Export format (default: csv)',
        },
      },
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'expense_add':
      return expenseAdd(
        args.amount as number,
        args.category as string,
        args.description as string,
        args.date as string | undefined,
      );
    case 'expense_list':
      return expenseList(
        args.period as string | undefined,
        args.category as string | undefined,
      );
    case 'expense_report':
      return expenseReport(args.period as string);
    case 'expense_export':
      return expenseExport((args.format as string) ?? 'csv');
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
