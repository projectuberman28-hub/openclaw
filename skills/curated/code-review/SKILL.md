# Code Review
## Description
Analyze code diffs, files, and pull requests for bugs, security vulnerabilities, performance issues, and style violations. Provides severity-rated findings with line references.

## Tools
- `review_diff(diff: string)` — Analyze a unified diff. Returns `{ findings: Finding[], summary: ReviewSummary }`.
- `review_file(path: string)` — Analyze a single file for issues. Returns `{ findings: Finding[], summary: ReviewSummary }`.
- `review_pr(url: string)` — Analyze a GitHub pull request. Returns `{ findings: Finding[], summary: ReviewSummary, filesChanged: number }`.

## Dependencies
- Node.js fs for file reading
- Fetch API for GitHub PR access
- Git CLI for diff operations

## Fallbacks
- If GitHub API is unavailable, attempt git CLI for PR diff
- If file is too large (>100KB), analyze in chunks
- If language detection fails, apply generic rules
