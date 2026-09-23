---
name: content-cadence
description: Send this week's post ideas from the pillars. The owner picks before any full draft.
---
# Weekly ideas

Read the content-system skill. If the pillars file is missing, follow that skill and stop. Do not schedule, and do not start a marketing worker for this list.

Read the product brief, the pillars, the channel voice, and the latest company-watch mentions if that state file exists. Send five angles for the primary channel, in the conversation's language. One line each: the pillar, the hook, and the source. The source is the brief, this thread, or a real mention. Do not invent a meeting, a customer, or a trend.

If yolo is on, do not ask which angle. Draft the first one in this run and deliver it through the marketing-delivery skill. Otherwise ask which one or two to draft. A full draft in a live conversation goes through the marketing-worker skill after they pick.

After the first list, schedule one Sunday run if it is not already scheduled. From the owner's conversation:

```sh
openclaw cron add "0 18 * * 0" \
  "Follow /opt/plow/skills/content-cadence/SKILL.md. Send this week's post ideas." \
  --name content-cadence \
  --session isolated \
  --announce \
  --channel plow \
  --account chat \
  --to plow-owner \
  --tz TIMEZONE \
  --exact
```

Use the timezone from the pillars or from company-watch. If a job named `content-cadence` already exists, edit it. If the scheduler refuses, the list you already sent still stands. Say that the weekly text is not scheduled.

One channel stays primary until the owner says the cadence is already a habit. Add a second channel only then.
