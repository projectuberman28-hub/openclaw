# Meeting Notes
## Description
Process meeting transcripts into structured notes with summary, action items, decisions, and attendee extraction. Stores meetings in persistent storage for later querying.

## Tools
- `meeting_process(transcript: string)` — Process a raw transcript into structured notes. Returns `{ id: string, summary: string, actionItems: ActionItem[], decisions: string[], attendees: string[] }`.
- `meeting_summary(id: string)` — Get the summary of a previously processed meeting. Returns `{ summary: MeetingSummary }`.
- `meeting_actions(id: string)` — Get action items from a meeting. Returns `{ actions: ActionItem[] }`.
- `meeting_search(query: string)` — Search across all meeting notes. Returns `{ results: SearchResult[] }`.

## Dependencies
- JSON file storage for meeting data

## Fallbacks
- If transcript is too large, process in chunks
- If attendee detection fails, default to "Unknown"
- If no action items detected, return empty with note
