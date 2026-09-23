---
name: marketing-worker
description: Draft, plan, or research marketing in the background so this conversation can keep talking.
---
# Background draft

You are the only person who texts this thread. A draft, plan, audit, or research pass runs in one hidden worker. A short answer stays in this turn: no worker for a greeting, a yes or no, or one lookup.

## Start

Read `/var/lib/plow/workspace/product-brief.md` once. If it is missing, ask for the product, the audience, and the offer, write nothing, and end the turn.

If the job is a post, a reply, a launch, or outreach, read the content-system skill. If `/var/lib/plow/workspace/content-pillars.md` is missing, follow that skill and end the turn. If the job is outreach and `/var/lib/plow/workspace/icp.md` is missing, follow the outreach skill and end the turn.

Name the matching skill in the task when the job is one of these: launch-kit, outreach, reply-guy, account-brief, warm-intro, proposal, call-prep, x-post, linkedin-post, long-form, draft-reply, comedy.

If a worker for this job is already running, do not start another. Revise or stop it as below.

Otherwise call `sessions_spawn` with `runtime` `subagent`, `context` `isolated`, `mode` `run`, `cleanup` `delete`, and `taskName` `draft`. Omit `visible`, `thread`, and `agentId`. The `task` is the whole assignment, because the worker cannot see this conversation. Begin it with `Task:` and include the person's request, the language to write in, corrections already made in this thread, and these rules: read the product brief; read `/var/lib/plow/workspace/content-pillars.md` and `/var/lib/plow/workspace/channel-voice.md` when they exist; if this is a public draft and the pillars file is missing, return that and do not draft; read `/opt/plow/skills/marketing-playbooks/SKILL.md` and exactly one matching library file; read each of these skills the task names: `/opt/plow/skills/launch-kit/SKILL.md`, `/opt/plow/skills/outreach/SKILL.md`, `/opt/plow/skills/reply-guy/SKILL.md`, `/opt/plow/skills/account-brief/SKILL.md`, `/opt/plow/skills/warm-intro/SKILL.md`, `/opt/plow/skills/proposal/SKILL.md`, `/opt/plow/skills/call-prep/SKILL.md`, `/opt/plow/skills/x-post/SKILL.md`, `/opt/plow/skills/linkedin-post/SKILL.md`, `/opt/plow/skills/long-form/SKILL.md`, `/opt/plow/skills/draft-reply/SKILL.md`, `/opt/plow/skills/comedy/SKILL.md`, `/opt/plow/skills/from-the-week/SKILL.md`, `/opt/plow/skills/content-library/SKILL.md`; for outreach also read the icp file; read `/opt/plow/skills/content-editor/SKILL.md` and apply it before returning a public draft; do not spawn, yield, or send; do not publish, spend, or invent customers, metrics, or claims; return only the deliverable.

When the spawn result is `accepted`, call `sessions_yield`. Put the worker's `childSessionKey` in `message`. Put one short line in `acknowledgment`, in the language of the conversation, saying you are doing the work. That acknowledgment is the only text this turn sends. Do not also answer normally, and do not say the draft is finished. If the spawn is not accepted, say so in a normal reply and do not yield.

## Revise

A new message about the same job steers the running worker. Call `sessions_send` with that child's `sessionKey`, `timeoutSeconds` `0`, and a message that restates the full revised assignment, not only the change. `accepted` with `targetDisposition` `steered` or `queued` means the worker has the new assignment. Reply with one short line that you updated it. Do not wait, and do not yield: a worker started on an earlier turn finishes on its own.

A short question that does not change the job gets a short answer. Leave the worker running.

## Stop

To stop, call `subagents` with `action` `list`, then `action` `cancel` and that `taskId`. Say that you stopped. Cancelling does not undo a send that already happened. Start a replacement only when the person asked for different work.

## Result

When a worker result arrives, rewrite the deliverable in your own voice and send it. Drop session keys, stats, and tool names. If it failed, say what failed in one line. If nothing new is ready for the person, stay silent. Follow the marketing-delivery skill before anything is sent, posted, or spent.
