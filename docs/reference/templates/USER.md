# User Profile Template

## Overview

The User Profile stores information about the user that Alfred uses to personalize interactions. It is populated during the bootstrap process and continuously refined through conversation. The profile is injected into the system prompt alongside the Soul and Identity templates to give Alfred context about who it is speaking with.

All user profile data is stored locally in `~/.alfred/user-profile.json` and is never sent to cloud services without explicit consent and PII redaction.

## Profile Schema

```json
{
  "name": "Michael",
  "preferredName": "Mike",
  "timezone": "America/New_York",
  "locale": "en-US",
  "occupation": "Software Engineer",
  "expertise": ["TypeScript", "systems architecture", "devops"],
  "interests": ["AI", "privacy", "open source"],
  "communicationPreferences": {
    "formality": "casual",
    "verbosity": "concise",
    "codeExamples": true,
    "explanationDepth": "expert"
  },
  "schedule": {
    "workHours": { "start": "09:00", "end": "18:00" },
    "quietHours": { "start": "22:00", "end": "07:00" },
    "timezone": "America/New_York"
  },
  "channels": {
    "primary": "signal",
    "work": "slack",
    "notifications": "signal"
  },
  "devices": {
    "desktop": { "os": "macOS", "paired": true },
    "mobile": { "os": "iOS", "paired": true }
  },
  "dataRetention": {
    "sessionHistory": "90d",
    "memoryRetention": "forever",
    "auditLogs": "1y"
  }
}
```

## Field Reference

### Personal Information

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | User's full name. Used in greetings and references. |
| `preferredName` | string | no | Nickname or shortened name Alfred should use. If unset, defaults to `name`. |
| `timezone` | string | no | IANA timezone string (e.g., `America/New_York`). Used for scheduling and time-aware responses. |
| `locale` | string | no | BCP 47 locale tag (e.g., `en-US`). Affects date formats, number formats, and language preferences. |
| `occupation` | string | no | User's profession. Helps Alfred calibrate technical depth and domain-specific knowledge. |
| `expertise` | string[] | no | Areas of expertise. Alfred adjusts explanations based on these: expert topics get less preamble, unfamiliar topics get more context. |
| `interests` | string[] | no | Personal and professional interests. Used for proactive suggestions and research topics. |

### Communication Preferences

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `formality` | string | `"casual"` | `"formal"`, `"casual"`, or `"adaptive"`. Adaptive matches the user's tone per message. |
| `verbosity` | string | `"concise"` | `"terse"`, `"concise"`, or `"detailed"`. Controls default response length. |
| `codeExamples` | boolean | `true` | Whether to include code examples in technical explanations. |
| `explanationDepth` | string | `"intermediate"` | `"beginner"`, `"intermediate"`, or `"expert"`. Controls how much background Alfred provides. |

### Schedule

| Field | Type | Description |
|-------|------|-------------|
| `workHours` | object | `{ start, end }` in HH:MM format. Alfred prioritizes work-related tasks during these hours. |
| `quietHours` | object | `{ start, end }` in HH:MM format. Alfred suppresses proactive messages and non-urgent notifications during quiet hours. |
| `timezone` | string | Schedule timezone. May differ from the global timezone if the user travels. |

### Channel Preferences

| Field | Type | Description |
|-------|------|-------------|
| `primary` | string | Default channel for general communication. |
| `work` | string | Preferred channel for work-related interactions. |
| `notifications` | string | Channel for proactive notifications and heartbeat messages. |

### Data Retention

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sessionHistory` | string | `"90d"` | How long to keep raw session transcripts. Supports `d`, `w`, `m`, `y` suffixes. |
| `memoryRetention` | string | `"forever"` | How long to keep synthesized memories. `"forever"` means memories are never automatically deleted. |
| `auditLogs` | string | `"1y"` | How long to keep privacy audit logs. |

## Profile Population

### Bootstrap Process

On first run, Alfred asks a series of questions to populate the initial profile:

1. What should Alfred call you?
2. What timezone are you in?
3. What do you do for work?
4. How technical are your conversations (beginner/intermediate/expert)?
5. Do you prefer short or detailed responses?

These questions are presented conversationally, not as a form. The user can skip any question and fill in the information later.

### Continuous Learning

After bootstrap, the profile is refined through normal conversation:

- If the user consistently asks for more detail, Alfred nudges `verbosity` toward `"detailed"`.
- If the user mentions a new area of expertise, Alfred adds it to the `expertise` array.
- If the user corrects Alfred's formality level, Alfred adjusts `formality`.
- All profile updates are logged in the Playbook with the source conversation reference.

### Manual Editing

Users can directly edit `~/.alfred/user-profile.json` or use the desktop app's profile settings panel. Changes take effect on the next conversation turn.

### CLI Profile Commands

```bash
# View current profile
alfred profile show

# Set a field
alfred profile set name "Michael Williams"
alfred profile set timezone "America/New_York"

# Add to an array field
alfred profile add expertise "Rust"

# Remove from an array field
alfred profile remove interests "blockchain"

# Reset profile (triggers bootstrap on next conversation)
alfred profile reset
```

## Privacy Considerations

- The full user profile is only available to the local Agent. Cloud model calls receive a redacted version that excludes: full name (replaced with preferred name or initials), specific timezone (generalized to region), occupation details, and device information.
- The profile is stored unencrypted on disk since it resides in the user's home directory. Users who require at-rest encryption should use filesystem-level encryption (FileVault, LUKS, BitLocker).
- Profile data is included in device sync but is encrypted in transit using the device pairing key.
