# Social Drafter
## Description
Draft platform-specific social media posts. Adapts content for X (280 chars), LinkedIn (professional tone), Instagram (hashtag-rich), and other platforms. Generate multiple variants from a single content brief.

## Tools
- `social_draft(content: string, platforms: string[])` — Draft posts for specified platforms. Returns `{ drafts: PlatformDraft[] }`.
- `social_variants(draft: string, count: number)` — Generate alternative versions of a draft. Returns `{ variants: string[] }`.
- `social_schedule(draft: string, datetime: string)` — Schedule a post (stores locally). Returns `{ id: string, scheduledFor: string }`.

## Dependencies
- JSON file storage for scheduled posts

## Fallbacks
- If content exceeds platform limits, auto-truncate with ellipsis
- If platform is unknown, use generic formatting
- If scheduling datetime is in past, warn and suggest next day
