/**
 * @alfred/skill-invoice-generator
 *
 * Create professional invoices from structured details.
 * Generates HTML invoices and tracks invoice history.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceDetails {
  from: {
    name: string;
    address?: string;
    email?: string;
    phone?: string;
  };
  to: {
    name: string;
    address?: string;
    email?: string;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  currency?: string;
  taxRate?: number; // percentage, e.g. 10 for 10%
  notes?: string;
  dueDate?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  from: InvoiceDetails['from'];
  to: InvoiceDetails['to'];
  items: LineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  notes: string;
  status: 'draft' | 'sent' | 'paid';
  createdAt: number;
  htmlPath: string;
}

interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  date: string;
  to: string;
  total: number;
  currency: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_DIR = join(homedir(), '.alfred', 'state', 'invoice-generator');
const DB_FILE = join(DATA_DIR, 'invoices.json');
const INVOICES_DIR = join(DATA_DIR, 'files');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(INVOICES_DIR)) mkdirSync(INVOICES_DIR, { recursive: true });
}

function loadInvoices(): Invoice[] {
  ensureDataDir();
  if (!existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveInvoices(invoices: Invoice[]): void {
  ensureDataDir();
  writeFileSync(DB_FILE, JSON.stringify(invoices, null, 2), 'utf-8');
}

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
}

function generateInvoiceNumber(invoices: Invoice[]): string {
  const year = new Date().getFullYear();
  const existingNumbers = invoices
    .map((inv) => {
      const match = inv.invoiceNumber.match(/INV-(\d{4})-(\d+)/);
      if (match && parseInt(match[1]!) === year) {
        return parseInt(match[2]!);
      }
      return 0;
    })
    .filter((n) => n > 0);

  const nextNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `INV-${year}-${String(nextNum).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

function generateInvoiceHtml(invoice: Invoice): string {
  const itemRows = invoice.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px 15px; border-bottom: 1px solid #eee;">${escapeHtml(item.description)}</td>
        <td style="padding: 10px 15px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px 15px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.unitPrice, invoice.currency)}</td>
        <td style="padding: 10px 15px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.amount, invoice.currency)}</td>
      </tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; line-height: 1.6; }
    .invoice { max-width: 800px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .invoice-title { font-size: 28px; font-weight: 700; color: #2563eb; }
    .invoice-meta { text-align: right; }
    .invoice-meta p { margin: 2px 0; color: #666; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .party { flex: 1; }
    .party-label { font-size: 12px; text-transform: uppercase; color: #999; letter-spacing: 1px; margin-bottom: 5px; }
    .party-name { font-weight: 600; font-size: 16px; }
    .party-detail { color: #666; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    thead th { background: #f8f9fa; padding: 12px 15px; text-align: left; font-weight: 600; font-size: 13px; text-transform: uppercase; color: #666; letter-spacing: 0.5px; }
    thead th:nth-child(2) { text-align: center; }
    thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
    .totals { display: flex; justify-content: flex-end; }
    .totals-table { width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .totals-row.total { border-top: 2px solid #333; border-bottom: none; font-weight: 700; font-size: 18px; padding-top: 12px; }
    .notes { margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
    .notes-label { font-weight: 600; margin-bottom: 5px; }
    .footer { margin-top: 60px; text-align: center; color: #999; font-size: 12px; }
    @media print { .invoice { padding: 20px; } body { -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div>
        <div class="invoice-title">INVOICE</div>
      </div>
      <div class="invoice-meta">
        <p><strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
        <p>Date: ${escapeHtml(invoice.date)}</p>
        <p>Due: ${escapeHtml(invoice.dueDate)}</p>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-label">From</div>
        <div class="party-name">${escapeHtml(invoice.from.name)}</div>
        ${invoice.from.address ? `<div class="party-detail">${escapeHtml(invoice.from.address)}</div>` : ''}
        ${invoice.from.email ? `<div class="party-detail">${escapeHtml(invoice.from.email)}</div>` : ''}
        ${invoice.from.phone ? `<div class="party-detail">${escapeHtml(invoice.from.phone)}</div>` : ''}
      </div>
      <div class="party" style="text-align: right;">
        <div class="party-label">Bill To</div>
        <div class="party-name">${escapeHtml(invoice.to.name)}</div>
        ${invoice.to.address ? `<div class="party-detail">${escapeHtml(invoice.to.address)}</div>` : ''}
        ${invoice.to.email ? `<div class="party-detail">${escapeHtml(invoice.to.email)}</div>` : ''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-table">
        <div class="totals-row">
          <span>Subtotal</span>
          <span>${formatCurrency(invoice.subtotal, invoice.currency)}</span>
        </div>
        ${invoice.taxRate > 0 ? `
        <div class="totals-row">
          <span>Tax (${invoice.taxRate}%)</span>
          <span>${formatCurrency(invoice.taxAmount, invoice.currency)}</span>
        </div>` : ''}
        <div class="totals-row total">
          <span>Total</span>
          <span>${formatCurrency(invoice.total, invoice.currency)}</span>
        </div>
      </div>
    </div>

    ${invoice.notes ? `
    <div class="notes">
      <div class="notes-label">Notes</div>
      <div>${escapeHtml(invoice.notes)}</div>
    </div>` : ''}

    <div class="footer">
      <p>Generated by Alfred v3 Invoice Generator</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$',
  };
  const symbol = symbols[currency] ?? currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function invoiceCreate(
  details: InvoiceDetails,
): Promise<{ id: string; invoiceNumber: string; path: string; total: number }> {
  if (!details.from?.name) throw new Error('Sender name (from.name) is required');
  if (!details.to?.name) throw new Error('Recipient name (to.name) is required');
  if (!details.items || details.items.length === 0) throw new Error('At least one line item is required');

  const invoices = loadInvoices();
  const invoiceNumber = generateInvoiceNumber(invoices);
  const currency = details.currency ?? 'USD';
  const taxRate = details.taxRate ?? 0;

  const items: LineItem[] = details.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const today = new Date().toISOString().split('T')[0]!;
  const dueDate = details.dueDate ?? addDays(today, 30);

  const id = generateId();
  const htmlFilename = `${invoiceNumber}.html`;
  const htmlPath = join(INVOICES_DIR, htmlFilename);

  const invoice: Invoice = {
    id,
    invoiceNumber,
    date: today,
    dueDate,
    from: details.from,
    to: details.to,
    items,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency,
    notes: details.notes ?? '',
    status: 'draft',
    createdAt: Date.now(),
    htmlPath,
  };

  // Generate HTML
  ensureDataDir();
  const html = generateInvoiceHtml(invoice);
  writeFileSync(htmlPath, html, 'utf-8');

  // Save to database
  invoices.push(invoice);
  saveInvoices(invoices);

  return { id, invoiceNumber, path: htmlPath, total };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
}

async function invoiceList(): Promise<{ invoices: InvoiceSummary[] }> {
  const invoices = loadInvoices();
  const summaries: InvoiceSummary[] = invoices
    .map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      to: inv.to.name,
      total: inv.total,
      currency: inv.currency,
      status: inv.status,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return { invoices: summaries };
}

async function invoiceGet(id: string): Promise<{ invoice: Invoice }> {
  const invoices = loadInvoices();
  const invoice = invoices.find((inv) => inv.id === id || inv.invoiceNumber === id);
  if (!invoice) {
    throw new Error(`Invoice not found: ${id}`);
  }
  return { invoice };
}

async function invoiceExport(id: string): Promise<{ path: string; format: string }> {
  const invoices = loadInvoices();
  const invoice = invoices.find((inv) => inv.id === id || inv.invoiceNumber === id);
  if (!invoice) {
    throw new Error(`Invoice not found: ${id}`);
  }

  // Regenerate HTML in case of changes
  ensureDataDir();
  const html = generateInvoiceHtml(invoice);
  writeFileSync(invoice.htmlPath, html, 'utf-8');

  return { path: invoice.htmlPath, format: 'html' };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'invoice-generator';
export const description = 'Create professional invoices from structured details with HTML output';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'invoice_create',
    description: 'Create a new invoice',
    parameters: {
      type: 'object',
      properties: {
        details: {
          type: 'object',
          description: 'Invoice details',
          properties: {
            from: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                address: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
              },
              required: ['name'],
            },
            to: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                address: { type: 'string' },
                email: { type: 'string' },
              },
              required: ['name'],
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                },
                required: ['description', 'quantity', 'unitPrice'],
              },
            },
            currency: { type: 'string', description: 'Currency code (default: USD)' },
            taxRate: { type: 'number', description: 'Tax rate percentage (e.g., 10 for 10%)' },
            notes: { type: 'string' },
            dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD, default: 30 days from now)' },
          },
          required: ['from', 'to', 'items'],
        },
      },
      required: ['details'],
    },
  },
  {
    name: 'invoice_list',
    description: 'List all invoices',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'invoice_get',
    description: 'Get full details of a specific invoice',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Invoice ID or number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'invoice_export',
    description: 'Export an invoice as HTML file',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Invoice ID or number' },
      },
      required: ['id'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'invoice_create':
      return invoiceCreate(args.details as InvoiceDetails);
    case 'invoice_list':
      return invoiceList();
    case 'invoice_get':
      return invoiceGet(args.id as string);
    case 'invoice_export':
      return invoiceExport(args.id as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
