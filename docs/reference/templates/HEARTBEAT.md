# Heartbeat Configuration

## Overview

The Heartbeat system enables Alfred to send proactive messages to the user on scheduled intervals. Unlike reactive conversation where the user initiates, Heartbeat messages are initiated by Alfred based on time-based triggers, event conditions, or learned patterns from the Playbook.

Heartbeat messages are delivered through the user's configured notification channel and respect quiet hours, channel preferences, and frequency limits.

## Heartbeat Configuration Schema

```json
{
  "heartbeat": {
    "enabled": true,
    "channel": "signal",
    "quietHours": {
      "start": "22:00",
      "end": "07:00",
      "timezone": "America/New_York"
    },
    "maxPerDay": 10,
    "schedules": [
      {
        "id": "morning-briefing",
        "cron": "0 8 * * 1-5",
        "type": "briefing",
        "template": "morning",
        "enabled": true
      },
      {
        "id": "weekly-review",
        "cron": "0 17 * * 5",
        "type": "review",
        "template": "weekly",
        "enabled": true
      }
    ],
    "triggers": [
      {
        "id": "web-monitor-alert",
        "event": "skill:web-monitor:change-detected",
        "priority": "high",
        "template": "alert"
      }
    ]
  }
}
```

## Field Reference

### Global Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Master switch for all heartbeat messages. When false, no proactive messages are sent. |
| `channel` | string | user's primary | Default delivery channel for heartbeat messages. |
| `quietHours` | object | from user profile | Override quiet hours specifically for heartbeat messages. |
| `maxPerDay` | number | `10` | Maximum heartbeat messages per day across all schedules and triggers. Prevents notification fatigue. |

### Schedule Configuration

Each schedule entry defines a recurring heartbeat:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier for this schedule. Used for enable/disable and logging. |
| `cron` | string | yes | Cron expression defining when the heartbeat fires. Standard 5-field cron format. Uses flat param recovery for robustness. |
| `type` | string | yes | Heartbeat type: `briefing`, `review`, `reminder`, `check-in`, `digest`. Determines the template and content generation logic. |
| `template` | string | no | Named template for message formatting. See templates below. |
| `enabled` | boolean | `true` | Whether this specific schedule is active. |
| `channel` | string | global default | Override the delivery channel for this specific schedule. |
| `agent` | string | default agent | Which agent generates the heartbeat content. |

### Trigger Configuration

Triggers fire heartbeats in response to events rather than schedules:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier for this trigger. |
| `event` | string | yes | Event pattern to match. Supports glob-style patterns (e.g., `skill:*:error`). |
| `priority` | string | `"normal"` | `"low"`, `"normal"`, `"high"`, `"urgent"`. Urgent messages bypass quiet hours. |
| `template` | string | no | Named template for message formatting. |
| `cooldown` | string | `"5m"` | Minimum time between trigger firings. Prevents alert storms. Supports `s`, `m`, `h` suffixes. |
| `channel` | string | global default | Override the delivery channel for this trigger. |

## Heartbeat Types

### Briefing

A morning briefing that summarizes upcoming tasks, recent notifications, and relevant information:

```
Good morning, Mike. Here's your briefing for Tuesday:

- 3 meetings today (first at 10:00 AM)
- 2 web monitor alerts overnight (competitor pricing changed)
- Weather: 72F, partly cloudy
- Reminder: quarterly report due Friday
```

The briefing pulls data from the Playbook, active skill results, and the user's schedule.

### Review

A periodic review of activity, progress, and patterns:

```
Weekly Review (Feb 3-7):

- 47 conversations across 3 channels
- Top topics: project architecture, code reviews, meeting prep
- 3 new skills forged (git-changelog, api-tester, log-analyzer)
- Memory: 12 new facts stored, 3 procedures learned
- Suggestion: You frequently ask about Docker — want me to monitor Docker release notes?
```

### Reminder

A targeted reminder about a specific task or event:

```
Reminder: You asked me to remind you about the deployment at 3 PM today.
```

### Check-in

A brief check-in to see if the user needs anything:

```
Hey Mike — haven't heard from you in a while. Need anything?
```

Check-ins respect a configurable inactivity threshold (default: 4 hours during work hours).

### Digest

A summary of accumulated notifications and updates:

```
Digest (3 updates since last check-in):

1. web-monitor: Product page price dropped from $299 to $249
2. email-digest: 2 high-priority emails in your inbox
3. habit-tracker: You've maintained your reading streak for 14 days
```

## Templates

Heartbeat templates control message formatting per channel:

```json
{
  "heartbeat": {
    "templates": {
      "morning": {
        "signal": "{{briefing.summary}}",
        "discord": {
          "embed": true,
          "title": "Morning Briefing — {{date}}",
          "body": "{{briefing.full}}"
        },
        "webchat": "{{briefing.full}}"
      },
      "alert": {
        "signal": "Alert: {{event.summary}}",
        "discord": {
          "embed": true,
          "color": "#ff0000",
          "title": "Alert: {{event.type}}",
          "body": "{{event.details}}"
        }
      }
    }
  }
}
```

## Quiet Hours Behavior

During quiet hours:

- **Normal and low priority**: Queued and delivered when quiet hours end, in chronological order.
- **High priority**: Queued unless the user has configured high-priority pass-through.
- **Urgent**: Delivered immediately regardless of quiet hours. Use sparingly (security alerts, critical monitoring failures).

## CLI Management

```bash
# List all heartbeat schedules and triggers
alfred heartbeat list

# Enable/disable a specific schedule
alfred heartbeat enable morning-briefing
alfred heartbeat disable weekly-review

# Trigger a heartbeat manually (for testing)
alfred heartbeat fire morning-briefing

# View heartbeat history
alfred heartbeat history --last 7d

# Set quiet hours
alfred heartbeat quiet 22:00 07:00

# Pause all heartbeats temporarily
alfred heartbeat pause --duration 4h
```
