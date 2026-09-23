# Zoen for distribution

One OpenClaw agent on the Plow base image. It is the startup's distribution hire: one voice, a product brief, content pillars, 36 playbooks, and a daily digest of public mentions. A long draft runs in a hidden worker, so the conversation can answer the next message while that draft is still going. The worker's result comes back to this chat and is rewritten in the hire's voice.

Public drafts read the pillars and the channel voice, then pass an editor check. The owner gets a weekly list of ideas and a weekday morning list, and picks before a full draft. A launch returns the thread, the LinkedIn post, the short video script, and three emails. Replies to other people's posts stay in a queue until the owner sends them. Outreach is one observation and a new angle on each follow-up, and it stops when they reply. `--yolo` sends posts, replies, and outreach without asking, then texts what went out. Spend, intros, and proposals still wait. A company gets a one-page brief before anyone writes them. Intros, proposals, call prep, objections, and the note after a meeting use the same proof rule: if it is not in the brief, it stays blank.

The image does not replace Plow boot or usage reporting. It only replaces `AGENTS.md` and adds skills. `google-workspace` and `owners-mac` stay on the base image.

Playbooks are adapted from the marketing division of [agency-agents](https://github.com/msitarzewski/agency-agents) (`053ddbbf`). See `NOTICE`.

The content loop and the outreach loop are adapted from the Agentic Content Creation and Agentic Sales packs. Those packs are not vendored. The procedures in this image are original. The content pack's remaining jobs are here as sheets and skills: X, LinkedIn, long-form, comedy, replies on our posts, daily angles, launch beats, and material from the week.

## Build

From this directory:

```sh
node check.mjs
docker compose up --build -d
```

`docker compose` reads `../plow-credentials`, the same file the base image uses. Mint it from the repository root with `plow-agents mint LINE_UID` before the first boot.

To publish, from this directory:

```sh
plow-agents image build REGISTRY/marketing-hire:TAG
plow-agents image push REGISTRY/marketing-hire:TAG
plow-agents deploy REGISTRY/marketing-hire@sha256:DIGEST --line LINE_UID
```

`AGENT_ID` is `zoen-distribution`. A later change of id on an existing state volume registers a second listing.

The base tag is `base-7ce757a1745de286dd180c5c5182aca31eba8a75`, pinned by digest in the Dockerfile. That digest is the linux/amd64 manifest. Rebuild on a newer base digest to pick up boot fixes. On an Apple Silicon Mac, build with `--platform linux/amd64`.
