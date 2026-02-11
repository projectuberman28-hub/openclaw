# Email Digest
## Description
Fetch emails via IMAP, categorize them by urgency and type, generate digests, and suggest quick replies. Categories: urgent, action-needed, informational, spam.

## Tools
- `email_fetch(count?: number, folder?: string)` — Fetch recent emails. Returns `{ emails: Email[], total: number }`.
- `email_digest(period?: string)` — Generate a categorized email digest. Returns `{ digest: EmailDigest }`.
- `email_categorize()` — Categorize all unread emails. Returns `{ categories: CategoryResult }`.
- `email_reply_suggest(id: string)` — Suggest quick replies for an email. Returns `{ suggestions: ReplySuggestion[] }`.

## Dependencies
- Node.js net and tls modules for IMAP socket connection
- JSON file storage for email cache and configuration

## Fallbacks
- If IMAP connection fails, use cached email data
- If TLS negotiation fails, attempt STARTTLS
- If categorization confidence is low, mark as "uncategorized"
