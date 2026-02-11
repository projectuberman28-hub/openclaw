/**
 * @alfred/skill-social-drafter - Test cases
 */

export default [
  {
    name: 'social_draft creates platform-specific posts',
    input: {
      tool: 'social_draft',
      args: { content: 'We just launched our new AI product that helps developers write better code.', platforms: ['x', 'linkedin'] },
    },
    expected: { drafts: 'array_length_2' },
  },
  {
    name: 'social_draft respects X character limit',
    input: {
      tool: 'social_draft',
      args: { content: 'Short post about AI', platforms: ['x'] },
    },
    expected: { drafts: [{ platform: 'X (Twitter)', withinLimit: true, charLimit: 280 }] },
  },
  {
    name: 'social_draft adds hashtags for Instagram',
    input: {
      tool: 'social_draft',
      args: { content: 'Check out our new product launch event. Amazing technology and innovation on display.', platforms: ['instagram'] },
    },
    expected: { drafts: [{ platform: 'Instagram', hashtags: 'array' }] },
  },
  {
    name: 'social_draft handles unknown platform gracefully',
    input: {
      tool: 'social_draft',
      args: { content: 'Hello world', platforms: ['myspace'] },
    },
    expected: { drafts: [{ platform: 'myspace' }] },
  },
  {
    name: 'social_draft requires content',
    input: { tool: 'social_draft', args: { content: '', platforms: ['x'] } },
    expected: { error: 'Content is required' },
  },
  {
    name: 'social_variants generates multiple versions',
    input: {
      tool: 'social_variants',
      args: { draft: 'AI is transforming software development. Teams can now ship faster.', count: 3 },
    },
    expected: { variants: 'array_length_3' },
  },
  {
    name: 'social_variants requires draft',
    input: { tool: 'social_variants', args: { draft: '', count: 3 } },
    expected: { error: 'Draft content is required' },
  },
  {
    name: 'social_schedule stores scheduled post',
    input: {
      tool: 'social_schedule',
      args: { draft: 'Launching tomorrow!', datetime: '2026-03-15T10:00:00Z' },
    },
    expected: { id: 'string', scheduledFor: 'string' },
  },
  {
    name: 'social_schedule warns on past datetime',
    input: {
      tool: 'social_schedule',
      args: { draft: 'Old post', datetime: '2020-01-01T10:00:00Z' },
    },
    expected: { warning: 'string' },
  },
  {
    name: 'social_schedule rejects invalid datetime',
    input: {
      tool: 'social_schedule',
      args: { draft: 'Post', datetime: 'not-a-date' },
    },
    expected: { error: 'Invalid datetime' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
