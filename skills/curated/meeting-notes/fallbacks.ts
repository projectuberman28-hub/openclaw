/**
 * @alfred/skill-meeting-notes - Fallback strategies
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
      name: 'chunk-large-transcripts',
      description: 'Process transcripts larger than 50KB in segments',
      trigger: 'Transcript exceeds 50,000 characters',
      action: () => {
        // Split transcript by time markers or speaker changes and process each segment
      },
    },
    {
      name: 'unknown-attendee-default',
      description: 'Default to "Unknown" when no attendee names can be detected',
      trigger: 'extractAttendees returns empty array',
      action: () => {
        // Built into meetingProcess — sets attendees to ["Unknown"]
      },
    },
    {
      name: 'empty-actions-note',
      description: 'Return informative message when no action items detected',
      trigger: 'extractActionItems returns empty array',
      action: () => {
        // Empty array returned with the result; user can review manually
      },
    },
    {
      name: 'json-file-storage',
      description: 'Use JSON file persistence for meeting data',
      trigger: 'Default storage mechanism',
      action: () => {
        // Meetings stored at ~/.alfred/state/meeting-notes/meetings.json
      },
    },
  ];
}
