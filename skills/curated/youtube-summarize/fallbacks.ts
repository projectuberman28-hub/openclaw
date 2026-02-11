/**
 * @alfred/skill-youtube-summarize - Fallback strategies
 */

export interface FallbackStrategy {
  name: string;
  description: string;
  trigger: string;
  action: () => Promise<void> | void;
}

export function getFallbacks(): FallbackStrategy[] {
  return [
    {
      name: 'yt-dlp-fallback',
      description: 'Use yt-dlp command-line tool when YouTube innertube API fails',
      trigger: 'YouTube API request failure or parsing error',
      action: () => {
        // Built into index.ts — fetchTranscriptViaDlp called on API failure
      },
    },
    {
      name: 'xml-caption-format',
      description: 'Fall back to XML caption format when JSON3 format is unavailable',
      trigger: 'json3 caption endpoint returns non-OK status',
      action: () => {
        // Built into fetchTranscriptFromYouTube — calls fetchTranscriptXml
      },
    },
    {
      name: 'auto-segmentation',
      description: 'Auto-segment transcript when no chapter markers are detected in the video',
      trigger: 'chapters style requested but no chapters found',
      action: () => {
        // Built into generateChapterSummary — falls back to generateDetailedSummary
      },
    },
    {
      name: 'rate-limit-queue',
      description: 'Queue requests with delays when rate-limited by YouTube',
      trigger: 'HTTP 429 response from YouTube',
      action: async () => {
        // Wait 5 seconds before retrying
        await new Promise((resolve) => setTimeout(resolve, 5000));
      },
    },
    {
      name: 'no-captions-report',
      description: 'Return informative error when video has no captions available',
      trigger: 'No caption tracks found in player response',
      action: () => {
        // Throw descriptive error suggesting manual transcript or different video
      },
    },
  ];
}
