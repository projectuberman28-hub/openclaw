/**
 * @alfred/skill-youtube-summarize - Test cases
 */

export default [
  {
    name: 'youtube_summarize generates brief summary',
    input: { tool: 'youtube_summarize', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    expected: { videoId: 'dQw4w9WgXcQ', style: 'brief', summary: 'string' },
  },
  {
    name: 'youtube_summarize supports detailed style',
    input: { tool: 'youtube_summarize', args: { url: 'https://youtu.be/dQw4w9WgXcQ', style: 'detailed' } },
    expected: { style: 'detailed', summary: 'string' },
  },
  {
    name: 'youtube_summarize handles short URL format',
    input: { tool: 'youtube_summarize', args: { url: 'https://youtu.be/dQw4w9WgXcQ' } },
    expected: { videoId: 'dQw4w9WgXcQ' },
  },
  {
    name: 'youtube_transcript returns segments array',
    input: { tool: 'youtube_transcript', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    expected: { videoId: 'dQw4w9WgXcQ', segments: 'array' },
  },
  {
    name: 'youtube_chapters returns chapters array',
    input: { tool: 'youtube_chapters', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    expected: { videoId: 'dQw4w9WgXcQ', chapters: 'array' },
  },
  {
    name: 'youtube_summarize rejects invalid URL',
    input: { tool: 'youtube_summarize', args: { url: 'not-a-youtube-url' } },
    expected: { error: 'Could not extract video ID' },
  },
  {
    name: 'youtube_summarize accepts plain video ID',
    input: { tool: 'youtube_summarize', args: { url: 'dQw4w9WgXcQ' } },
    expected: { videoId: 'dQw4w9WgXcQ' },
  },
  {
    name: 'youtube_summarize supports bullets style',
    input: { tool: 'youtube_summarize', args: { url: 'dQw4w9WgXcQ', style: 'bullets' } },
    expected: { style: 'bullets' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
