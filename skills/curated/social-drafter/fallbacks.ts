/**
 * @alfred/skill-social-drafter - Fallback strategies
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
      name: 'auto-truncate',
      description: 'Automatically truncate content with ellipsis when it exceeds platform character limit',
      trigger: 'Adapted content length exceeds platform maxLength',
      action: () => {
        // Built into adaptForPlatform — truncates with ellipsis for casual style
      },
    },
    {
      name: 'generic-platform',
      description: 'Use generic formatting for unknown platforms',
      trigger: 'Platform name not found in PLATFORM_CONFIGS',
      action: () => {
        // Built into socialDraft — creates generic draft with 5000 char limit
      },
    },
    {
      name: 'past-datetime-warning',
      description: 'Warn and suggest next day when scheduled datetime is in the past',
      trigger: 'scheduledDate.getTime() < Date.now()',
      action: () => {
        // Built into socialSchedule — adds warning with suggested date
      },
    },
    {
      name: 'variant-capping',
      description: 'Cap variant count to 10 to prevent excessive generation',
      trigger: 'Requested count exceeds 10',
      action: () => {
        // Built into socialVariants — clamps count to 1-10 range
      },
    },
  ];
}
