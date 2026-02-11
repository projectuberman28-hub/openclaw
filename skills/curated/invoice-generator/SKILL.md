# Invoice Generator
## Description
Create professional invoices from structured or natural language descriptions. Generate HTML-based invoices that can be rendered to PDF via browser print. Tracks invoice history with unique numbering.

## Tools
- `invoice_create(details: InvoiceDetails)` — Create a new invoice. Returns `{ id: string, invoiceNumber: string, path: string, total: number }`.
- `invoice_list()` — List all invoices. Returns `{ invoices: InvoiceSummary[] }`.
- `invoice_get(id: string)` — Get full invoice details. Returns `{ invoice: Invoice }`.
- `invoice_export(id: string)` — Export invoice as HTML file. Returns `{ path: string }`.

## Dependencies
- Node.js fs for file generation
- JSON file storage for invoice tracking

## Fallbacks
- If natural language parsing fails, prompt for structured input
- If HTML generation fails, export as plain text
- Auto-increment invoice numbers with collision detection
