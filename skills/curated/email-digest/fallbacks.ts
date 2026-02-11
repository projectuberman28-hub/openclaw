/**
 * @alfred/skill-email-digest - Fallback strategies
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
      name: 'cached-email-fallback',
      description: 'Use cached email data when IMAP connection fails',
      trigger: 'IMAP connection error or timeout',
      action: () => {
        // Built into emailFetch — returns cached emails on connection failure
      },
    },
    {
      name: 'starttls-negotiation',
      description: 'Attempt STARTTLS when direct TLS connection fails',
      trigger: 'TLS handshake failure',
      action: () => {
        // Connect on port 143, issue STARTTLS command, then upgrade
      },
    },
    {
      name: 'uncategorized-default',
      description: 'Mark email as "uncategorized" when categorization confidence is below threshold',
      trigger: 'All category scores below 0.3',
      action: () => {
        // Built into categorizeEmail — defaults to "informational" with 0.6 confidence
      },
    },
    {
      name: 'config-error-guidance',
      description: 'Provide clear configuration instructions when IMAP is not set up',
      trigger: 'No imap-config.json file found',
      action: () => {
        // Built into emailFetch — throws descriptive error with config path
      },
    },
    {
      name: 'connection-timeout',
      description: 'Enforce 10-second timeout on IMAP connections to prevent hanging',
      trigger: 'IMAP server not responding',
      action: () => {
        // Built into SimpleImapClient.connect — 10s timeout via setTimeout
      },
    },
  ];
}
