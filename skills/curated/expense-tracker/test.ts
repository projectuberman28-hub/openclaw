/**
 * @alfred/skill-expense-tracker - Test cases
 */

export default [
  {
    name: 'expense_add creates an entry',
    input: {
      tool: 'expense_add',
      args: { amount: 42.50, category: 'food', description: 'Lunch at deli' },
    },
    expected: { id: 'string', amount: 42.5, category: 'Food & Dining' },
  },
  {
    name: 'expense_add normalizes category',
    input: {
      tool: 'expense_add',
      args: { amount: 15, category: 'uber', description: 'Ride to office' },
    },
    expected: { category: 'Transportation' },
  },
  {
    name: 'expense_add rejects zero amount',
    input: {
      tool: 'expense_add',
      args: { amount: 0, category: 'food', description: 'Free lunch' },
    },
    expected: { error: 'Amount must be positive' },
  },
  {
    name: 'expense_add rejects negative amount',
    input: {
      tool: 'expense_add',
      args: { amount: -10, category: 'food', description: 'Refund' },
    },
    expected: { error: 'Amount must be positive' },
  },
  {
    name: 'expense_add accepts custom date',
    input: {
      tool: 'expense_add',
      args: { amount: 100, category: 'shopping', description: 'Shoes', date: '2025-01-15' },
    },
    expected: { date: '2025-01-15' },
  },
  {
    name: 'expense_list returns all expenses',
    input: { tool: 'expense_list', args: {} },
    expected: { expenses: 'array', total: 'number', count: 'number' },
  },
  {
    name: 'expense_list filters by period',
    input: { tool: 'expense_list', args: { period: 'month' } },
    expected: { period: 'month', expenses: 'array' },
  },
  {
    name: 'expense_report generates monthly report',
    input: { tool: 'expense_report', args: { period: 'month' } },
    expected: { report: { period: 'month', categories: 'array' } },
  },
  {
    name: 'expense_export creates CSV file',
    input: { tool: 'expense_export', args: { format: 'csv' } },
    expected: { path: 'string', count: 'number' },
  },
  {
    name: 'expense_export rejects unsupported format',
    input: { tool: 'expense_export', args: { format: 'xml' } },
    expected: { error: 'Unsupported export format' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
