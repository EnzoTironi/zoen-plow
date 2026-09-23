---
name: daily-distribution
description: Text the owner each weekday what to post, who to write, and which reply is waiting.
---
# Morning list

This stays in the turn. Do not invent a pipeline, a deal value, or a meeting that nobody mentioned.

Read the pillars, the icp file, and the positioning file when they exist. If company-watch is set up, run `node /opt/plow/skills/company-watch/fetch.mjs` and use only mentions that command prints. Then send, in the conversation's language:

- One line on public mentions since the last run, or that it was quiet.
- Replies or follow-ups the owner already said were waiting. If none were named, skip this line.
- One post to draft today, from the pillars. If yolo is on, draft it in this run and deliver it. Otherwise ask if they want it drafted.
- One person or company to write, only if they have named one that fits the icp. If yolo is on and that person is already named, deliver the note. Otherwise ask who, once.

Three to five lines. No worker for this list. A draft they accept goes through the marketing-worker skill.

After the first list, schedule weekday mornings if that job does not exist. From the owner's conversation:

```sh
openclaw cron add "0 8 * * 1-5" \
  "Follow /opt/plow/skills/daily-distribution/SKILL.md. Send this morning's list." \
  --name daily-distribution \
  --session isolated \
  --announce \
  --channel plow \
  --account chat \
  --to plow-owner \
  --tz TIMEZONE \
  --exact
```

Use the timezone from company-watch or the pillars. If a job named `daily-distribution` already exists, edit it. If the scheduler refuses, the list you sent still stands. Say that the morning text is not scheduled.
