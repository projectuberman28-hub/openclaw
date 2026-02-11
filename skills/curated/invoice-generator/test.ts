/**
 * @alfred/skill-invoice-generator - Test cases
 */

export default [
  {
    name: 'invoice_create generates invoice with correct total',
    input: {
      tool: 'invoice_create',
      args: {
        details: {
          from: { name: 'John Doe', email: 'john@example.com' },
          to: { name: 'Acme Corp', email: 'billing@acme.com' },
          items: [
            { description: 'Web Development', quantity: 40, unitPrice: 150 },
            { description: 'Design Review', quantity: 5, unitPrice: 100 },
          ],
          taxRate: 10,
        },
      },
    },
    expected: { id: 'string', invoiceNumber: 'string', path: 'string', total: 6950 },
  },
  {
    name: 'invoice_create requires from.name',
    input: {
      tool: 'invoice_create',
      args: { details: { from: {}, to: { name: 'Client' }, items: [{ description: 'Work', quantity: 1, unitPrice: 100 }] } },
    },
    expected: { error: 'Sender name' },
  },
  {
    name: 'invoice_create requires at least one item',
    input: {
      tool: 'invoice_create',
      args: { details: { from: { name: 'Me' }, to: { name: 'Client' }, items: [] } },
    },
    expected: { error: 'At least one line item' },
  },
  {
    name: 'invoice_list returns all invoices',
    input: { tool: 'invoice_list', args: {} },
    expected: { invoices: 'array' },
  },
  {
    name: 'invoice_get returns invoice by ID',
    input: { tool: 'invoice_get', args: { id: 'test-id' } },
    expected: { invoice: 'object' },
  },
  {
    name: 'invoice_get throws for unknown ID',
    input: { tool: 'invoice_get', args: { id: 'nonexistent' } },
    expected: { error: 'Invoice not found' },
  },
  {
    name: 'invoice_export generates HTML file',
    input: { tool: 'invoice_export', args: { id: 'test-id' } },
    expected: { path: 'string', format: 'html' },
  },
  {
    name: 'invoice_create defaults currency to USD',
    input: {
      tool: 'invoice_create',
      args: {
        details: {
          from: { name: 'Freelancer' },
          to: { name: 'Client' },
          items: [{ description: 'Consulting', quantity: 10, unitPrice: 200 }],
        },
      },
    },
    expected: { total: 2000 },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
