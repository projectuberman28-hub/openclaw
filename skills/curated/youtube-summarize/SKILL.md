# YouTube Summarize
## Description
Fetch YouTube video transcripts and generate timestamped summaries. Supports multiple summary styles including brief, detailed, bullet points, and chapter-based.

## Tools
- `youtube_summarize(url: string, style?: string)` — Summarize a YouTube video. Style: 'brief' | 'detailed' | 'bullets' | 'chapters'. Returns `{ title: string, summary: string, duration: string }`.
- `youtube_transcript(url: string)` — Get the raw transcript with timestamps. Returns `{ segments: TranscriptSegment[] }`.
- `youtube_chapters(url: string)` — Extract chapter markers if available. Returns `{ chapters: Chapter[] }`.

## Dependencies
- YouTube Data API or yt-dlp for transcript fetching
- Fetch API for HTTP requests

## Fallbacks
- If YouTube API is unavailable, attempt yt-dlp command-line extraction
- If auto-generated captions unavailable, report and suggest manual transcript
- Rate limiting: queue requests with delay
