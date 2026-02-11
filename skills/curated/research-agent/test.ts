/**
 * @alfred/skill-research-agent - Test cases
 */

export default [
  {
    name: 'research with quick depth performs 3 queries',
    input: { tool: 'research', args: { topic: 'TypeScript generics', depth: 'quick' } },
    expected: { topic: 'TypeScript generics', depth: 'quick', queryCount: 3, sources: 'array' },
  },
  {
    name: 'research with deep depth performs 10 queries',
    input: { tool: 'research', args: { topic: 'machine learning', depth: 'deep' } },
    expected: { depth: 'deep', queryCount: 10 },
  },
  {
    name: 'research defaults to quick depth',
    input: { tool: 'research', args: { topic: 'Node.js performance' } },
    expected: { depth: 'quick', queryCount: 3 },
  },
  {
    name: 'research_compare requires at least 2 topics',
    input: { tool: 'research_compare', args: { topics: ['React'] } },
    expected: { error: 'At least 2 topics' },
  },
  {
    name: 'research_compare rejects more than 5 topics',
    input: {
      tool: 'research_compare',
      args: { topics: ['a', 'b', 'c', 'd', 'e', 'f'] },
    },
    expected: { error: 'Maximum 5 topics' },
  },
  {
    name: 'research_compare returns comparison table',
    input: { tool: 'research_compare', args: { topics: ['React', 'Vue'] } },
    expected: { topics: ['React', 'Vue'], comparison: 'array', sources: 'array' },
  },
  {
    name: 'research_cite returns verdict',
    input: { tool: 'research_cite', args: { claim: 'TypeScript improves code quality' } },
    expected: { claim: 'TypeScript improves code quality', citations: 'array', verdict: 'string' },
  },
  {
    name: 'research returns summary with citations',
    input: { tool: 'research', args: { topic: 'WebAssembly performance' } },
    expected: { summary: 'string', sources: 'array' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
