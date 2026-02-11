/**
 * @alfred/skill-competitor-watch - Test cases
 */

export default [
  {
    name: 'competitor_add creates new competitor',
    input: {
      tool: 'competitor_add',
      args: { name: 'Acme Corp', urls: ['https://acme.example.com', 'https://acme.example.com/pricing'] },
    },
    expected: { id: 'string', name: 'Acme Corp', urlCount: 2 },
  },
  {
    name: 'competitor_add merges URLs for existing competitor',
    input: {
      tool: 'competitor_add',
      args: { name: 'Acme Corp', urls: ['https://acme.example.com/blog'] },
    },
    expected: { urlCount: 3 },
  },
  {
    name: 'competitor_add requires name',
    input: { tool: 'competitor_add', args: { name: '', urls: ['https://example.com'] } },
    expected: { error: 'Competitor name is required' },
  },
  {
    name: 'competitor_add requires URLs',
    input: { tool: 'competitor_add', args: { name: 'Test', urls: [] } },
    expected: { error: 'At least one URL' },
  },
  {
    name: 'competitor_remove removes existing competitor',
    input: { tool: 'competitor_remove', args: { name: 'Acme Corp' } },
    expected: { removed: true },
  },
  {
    name: 'competitor_remove returns false for non-existent',
    input: { tool: 'competitor_remove', args: { name: 'NonExistent' } },
    expected: { removed: false },
  },
  {
    name: 'competitor_report generates report',
    input: { tool: 'competitor_report', args: {} },
    expected: { report: { totalCompetitors: 'number', competitors: 'array' } },
  },
  {
    name: 'competitor_diff throws for unknown competitor',
    input: { tool: 'competitor_diff', args: { name: 'Unknown Corp' } },
    expected: { error: 'Competitor not found' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
