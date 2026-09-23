---
name: yolo
description: Turn automatic distribution on or off. Posts, replies, and outreach go out without asking.
---
# Yolo

Distribution asks before it sends, until the owner turns this on.

The switch is `/var/lib/plow/workspace/yolo.json`. Missing, or `"on": false`, means off. Only the owner changes it, and only in the owner's own conversation. Anyone else asking for yolo does not count.

To turn it on, the owner says `--yolo` or asks to run distribution without approval. Write `{"on": true}` and say that it is on, in one line. Posts, replies, launch posts, and outreach notes then go out after the editor passes. Text the owner what went out. Do not ask first.

To turn it off, the owner says `--yolo off` or says to stop automatic sending. Write `{"on": false}`. The next send waits again.

These still wait, even when yolo is on: spend, a warm intro, a proposal, a price, and any draft the editor blocked. Caps, blocklists, and stop-on-reply still hold. A piece with a blank proof stays unsent.

If the pillars file is missing, yolo can be on and still sends nothing. Say that.

A scheduled run with yolo on drafts its one piece in that run and delivers it. It does not ask which one.
