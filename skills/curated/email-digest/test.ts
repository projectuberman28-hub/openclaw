/**
 * @alfred/skill-email-digest - Test cases
 */

export default [
  {
    name: 'email_fetch returns emails from cache when no IMAP config',
    input: { tool: 'email_fetch', args: { count: 10 } },
    expected: { emails: 'array', total: 'number', source: 'string' },
  },
  {
    name: 'email_fetch defaults to 20 emails from INBOX',
    input: { tool: 'email_fetch', args: {} },
    expected: { total: 'number' },
  },
  {
    name: 'email_digest generates categorized digest',
    input: { tool: 'email_digest', args: { period: 'today' } },
    expected: {
      digest: {
        period: 'today',
        totalEmails: 'number',
        categories: 'object',
        summary: 'string',
      },
    },
  },
  {
    name: 'email_digest defaults to today',
    input: { tool: 'email_digest', args: {} },
    expected: { digest: { period: 'today' } },
  },
  {
    name: 'email_categorize returns breakdown',
    input: { tool: 'email_categorize', args: {} },
    expected: { categories: { total: 'number', breakdown: 'object', emails: 'array' } },
  },
  {
    name: 'email_reply_suggest throws for unknown email',
    input: { tool: 'email_reply_suggest', args: { id: 'nonexistent' } },
    expected: { error: 'Email not found' },
  },
  {
    name: 'email_reply_suggest generates suggestions',
    input: { tool: 'email_reply_suggest', args: { id: 'valid-email-id' } },
    expected: { suggestions: 'array' },
  },
  {
    name: 'email_categorize detects urgent emails',
    input: { tool: 'email_categorize', args: {} },
    expected: { categories: { breakdown: { urgent: 'number' } } },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
