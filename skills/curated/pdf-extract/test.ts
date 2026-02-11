/**
 * @alfred/skill-pdf-extract - Test cases
 */

export default [
  {
    name: 'pdf_extract_text extracts text from valid PDF',
    input: { tool: 'pdf_extract_text', args: { path: '/tmp/test.pdf' } },
    expected: { text: 'string', pages: 'number', info: 'object', method: 'string' },
  },
  {
    name: 'pdf_extract_text throws for non-existent file',
    input: { tool: 'pdf_extract_text', args: { path: '/tmp/nonexistent.pdf' } },
    expected: { error: 'File not found' },
  },
  {
    name: 'pdf_extract_tables returns array of tables',
    input: { tool: 'pdf_extract_tables', args: { path: '/tmp/table-data.pdf' } },
    expected: { tables: 'array' },
  },
  {
    name: 'pdf_extract_tables handles PDF with no tables',
    input: { tool: 'pdf_extract_tables', args: { path: '/tmp/no-tables.pdf' } },
    expected: { tables: [] },
  },
  {
    name: 'pdf_search finds matching text',
    input: { tool: 'pdf_search', args: { path: '/tmp/test.pdf', query: 'hello' } },
    expected: { matches: 'array', total: 'number' },
  },
  {
    name: 'pdf_search returns empty for no matches',
    input: { tool: 'pdf_search', args: { path: '/tmp/test.pdf', query: 'xyznonexistent' } },
    expected: { matches: [], total: 0 },
  },
  {
    name: 'pdf_search is case-insensitive',
    input: { tool: 'pdf_search', args: { path: '/tmp/test.pdf', query: 'HELLO' } },
    expected: { total: 'number' },
  },
  {
    name: 'pdf_extract_text falls back to raw extraction',
    input: { tool: 'pdf_extract_text', args: { path: '/tmp/raw-test.pdf' } },
    expected: { method: 'raw-extraction' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
