---
name: li-daily
description: Weekday LinkedIn angles from the pillars. The owner picks before a full post, unless yolo is on.
---
# LinkedIn ideas

This stays in the turn. Read the pillars, the channel voice, and `/opt/plow/skills/content-library/linkedin.md`. If the pillars file is missing, follow the content-system skill and stop.

Send up to five angles. One line each: the pillar, the format, and the source. The source is the brief, a pasted week, or a real mention. Do not invent a trend.

If yolo is on, draft the first angle in this run and deliver it through the linkedin-post rules and the marketing-delivery skill. Otherwise ask which one to draft. A full draft in a live conversation goes through the marketing-worker skill.

Schedule weekdays only after the owner asks for a daily LinkedIn list:

```sh
openclaw cron add "30 8 * * 1-5" \
  "Follow /opt/plow/skills/li-daily/SKILL.md. Send today's LinkedIn angles." \
  --name li-daily \
  --session isolated \
  --announce \
  --channel plow \
  --account chat \
  --to plow-owner \
  --tz TIMEZONE \
  --exact
```

Use the timezone from the pillars or from company-watch. If a job named `li-daily` already exists, edit it. If the scheduler refuses, the list you sent still stands.
