# Competitor Watch
## Description
Monitor competitor websites, pricing pages, and social presence. Track changes over time and generate weekly diff reports comparing competitor activities.

## Tools
- `competitor_add(name: string, urls: string[])` — Add a competitor to watch. Returns `{ id: string, name: string, urlCount: number }`.
- `competitor_remove(name: string)` — Remove a competitor. Returns `{ removed: boolean }`.
- `competitor_report()` — Generate a report across all competitors. Returns `{ report: CompetitorReport }`.
- `competitor_diff(name: string)` — Get recent changes for a specific competitor. Returns `{ diffs: DiffEntry[] }`.

## Dependencies
- Fetch API for web scraping
- JSON file storage for competitor data and snapshots

## Fallbacks
- If URL fetch fails, retry with different User-Agent
- If page content is JavaScript-rendered, note limitation
- Cache previous snapshots for offline comparison
