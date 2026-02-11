/**
 * @alfred/skill-web-monitor - Test cases
 */

export default [
  {
    name: 'monitor_add creates a new entry',
    input: { tool: 'monitor_add', args: { url: 'https://example.com', interval: 60000 } },
    expected: { id: 'string', url: 'https://example.com', interval: 60000 },
  },
  {
    name: 'monitor_add with selector',
    input: {
      tool: 'monitor_add',
      args: { url: 'https://example.com/page', interval: 3600000, selector: '#content' },
    },
    expected: { id: 'string', url: 'https://example.com/page', interval: 3600000 },
  },
  {
    name: 'monitor_add updates existing entry interval',
    input: { tool: 'monitor_add', args: { url: 'https://example.com', interval: 120000 } },
    expected: { id: 'string', url: 'https://example.com', interval: 120000 },
  },
  {
    name: 'monitor_list returns all entries',
    input: { tool: 'monitor_list', args: {} },
    expected: { type: 'array', minLength: 0 },
  },
  {
    name: 'monitor_remove removes existing entry',
    input: { tool: 'monitor_remove', args: { url: 'https://example.com' } },
    expected: { removed: true },
  },
  {
    name: 'monitor_remove returns false for non-existent URL',
    input: { tool: 'monitor_remove', args: { url: 'https://nonexistent.example.com' } },
    expected: { removed: false },
  },
  {
    name: 'monitor_check throws for unmonitored URL',
    input: { tool: 'monitor_check', args: { url: 'https://not-monitored.example.com' } },
    expected: { error: 'URL not monitored' },
  },
  {
    name: 'monitor_check detects initial content capture',
    input: { tool: 'monitor_check', args: { url: 'https://example.com' } },
    expected: { changed: false, checkedAt: 'number' },
  },
  {
    name: 'monitor_add uses default 1-hour interval',
    input: { tool: 'monitor_add', args: { url: 'https://default-interval.example.com' } },
    expected: { interval: 3600000 },
  },
  {
    name: 'monitor_check returns diff on change',
    input: { tool: 'monitor_check', args: { url: 'https://example.com' } },
    expected: { changed: 'boolean', checkedAt: 'number' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
