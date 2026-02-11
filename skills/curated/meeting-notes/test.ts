/**
 * @alfred/skill-meeting-notes - Test cases
 */

export default [
  {
    name: 'meeting_process extracts structured data from transcript',
    input: {
      tool: 'meeting_process',
      args: {
        transcript: `John: Welcome everyone. Let's discuss the Q1 roadmap.
Sarah: I think we should focus on the mobile app first.
John: Agreed. Sarah will lead the mobile initiative by next Friday.
Decision: We will prioritize mobile app development for Q1.
Action Item: Sarah to create the project timeline by January 15th.
TODO: John to review the budget allocation.`,
      },
    },
    expected: {
      id: 'string',
      summary: 'string',
      actionItems: 'array',
      decisions: 'array',
      attendees: 'array',
    },
  },
  {
    name: 'meeting_process detects attendees from speaker labels',
    input: {
      tool: 'meeting_process',
      args: {
        transcript: `Alice: Good morning everyone.
Bob: Morning Alice. Ready to begin?
Alice: Yes, let's start with updates.`,
      },
    },
    expected: { attendees: ['Alice', 'Bob'] },
  },
  {
    name: 'meeting_process throws on empty transcript',
    input: { tool: 'meeting_process', args: { transcript: '' } },
    expected: { error: 'Transcript is empty' },
  },
  {
    name: 'meeting_summary throws for unknown ID',
    input: { tool: 'meeting_summary', args: { id: 'nonexistent' } },
    expected: { error: 'Meeting not found' },
  },
  {
    name: 'meeting_actions throws for unknown ID',
    input: { tool: 'meeting_actions', args: { id: 'nonexistent' } },
    expected: { error: 'Meeting not found' },
  },
  {
    name: 'meeting_search returns results for matching query',
    input: { tool: 'meeting_search', args: { query: 'mobile app' } },
    expected: { results: 'array' },
  },
  {
    name: 'meeting_search returns empty for no matches',
    input: { tool: 'meeting_search', args: { query: 'xyznonexistent' } },
    expected: { results: [] },
  },
  {
    name: 'meeting_process extracts action items with assignees',
    input: {
      tool: 'meeting_process',
      args: {
        transcript: `Mike will prepare the presentation by tomorrow.
Action Item: Lisa to update the documentation (assigned to Lisa).
TODO: Review PR #123 @Dave`,
      },
    },
    expected: { actionItems: 'array_length_3' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
