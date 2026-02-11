# Expense Tracker
## Description
Parse and track expenses with category-based organization, stored in SQLite. Generate monthly/weekly reports and export to CSV format.

## Tools
- `expense_add(amount: number, category: string, description: string, date?: string)` — Add an expense entry. Returns `{ id: string, amount: number, category: string }`.
- `expense_list(period?: string, category?: string)` — List expenses with optional filtering. Returns `{ expenses: Expense[], total: number }`.
- `expense_report(period: string)` — Generate a spending report. Period: 'week' | 'month' | 'year'. Returns `{ report: ReportData }`.
- `expense_export(format: string)` — Export expenses to file. Format: 'csv' | 'json'. Returns `{ path: string, count: number }`.

## Dependencies
- SQLite (JSON file fallback) for persistent storage
- Node.js fs for file exports

## Fallbacks
- If SQLite unavailable, use JSON file storage
- If date parsing fails, default to current date
- Export to JSON if CSV generation fails
