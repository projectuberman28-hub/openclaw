# Research Agent
## Description
Multi-query web search with synthesis and citation. Generates research queries, fetches results, extracts relevant content, and produces cited summaries. Supports quick (3 queries) and deep (10 queries) research depths.

## Tools
- `research(topic: string, depth?: string)` — Research a topic. Depth: 'quick' (3 queries) | 'deep' (10 queries). Returns `{ summary: string, sources: Source[], queryCount: number }`.
- `research_compare(topics: string[])` — Compare multiple topics side-by-side. Returns `{ comparison: ComparisonTable, sources: Source[] }`.
- `research_cite(claim: string)` — Find citations supporting or refuting a claim. Returns `{ citations: Citation[], verdict: string }`.

## Dependencies
- Fetch API for web search and content retrieval
- Search engine API (DuckDuckGo HTML or similar)

## Fallbacks
- If primary search engine fails, try alternative search engines
- If page content is inaccessible, use search snippet instead
- Rate limiting: queue searches with delay between requests
