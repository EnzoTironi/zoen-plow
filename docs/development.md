# Development

Builders can start with [the tutorial](first-agent.md) and
[the workflow and release SOPs](builder-sops.md). This document contains the
base's executable checks and pinned upstream contracts.

The image pins the runtime and SDK. CI type-checks boot, plugin and build sources,
runs all Node tests against that image, and boots the real offline gateway probe.
Tests use local fixtures and need no Plow credentials. Type checking uses the
published OpenClaw 2026.9.6 declarations because the runtime image omits them;
runtime tests use the SDK shipped in the pinned image. The plugin is an npm
workspace: CI and the image use the root lock, with development, peer and optional
dependencies omitted from the image install.

`tests/native-maintenance.test.ts` calls the pinned dreaming resolver, Workshop
job projection and actual memory plugin's registered flush-plan resolver. It
verifies off/disabled results without executing a model, filesystem maintenance
or plugin lifecycle hook. Config fixtures separately cover fresh and legacy
defaults, explicit choices, opaque includes and idempotent restart. Actual
gateway startup/restart must also confirm that dreaming jobs are absent and
Workshop declarations are disabled. Existing workspace copies require a separate
inventory; a disabled future writer is not evidence of erasure.

```sh
npm ci
docker build -t plow-openclaw:test .
docker run --rm --user root --network none \
  -v "$PWD/node_modules:/opt/plow/node_modules:ro" \
  -v "$PWD/tests:/opt/plow/tests:ro" plow-openclaw:test sh -c \
  '/opt/plow/node_modules/.bin/tsc --noEmit -p /opt/plow/tsconfig.json && mkdir -p /opt/plow/plugin/node_modules && ln -s /app /opt/plow/plugin/node_modules/openclaw && node --test --test-concurrency=2 /opt/plow/tests/*.test.ts'
docker run --rm --network none plow-openclaw:test /opt/plow/probe
```

## Pinned OpenClaw contracts

The Dockerfile pins OpenClaw `2026.9.6` by image digest. These source links target
its release commit `eb377ac59e6c9fd6c7705028034812becf00271b`.

| Contract | Source |
| --- | --- |
| Non-root runtime and foreground launcher | [Dockerfile](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/Dockerfile) |
| Config environment references | [Environment substitution](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/config/env-substitution.ts) |
| Private provider endpoint opt-in | [Provider transport](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/agents/provider-transport-fetch.ts) |
| Channel registration and inbound dispatch | [Plugin entry](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/plugin-sdk/core.ts), [turn contract](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/channels/turn/types.ts) |
| Session isolation and owner binding | [Routing schema](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/config/zod-schema.agents.ts) |
| Tool registration, requester and deny policy | [Tool API](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/plugins/plugin-api.types.ts), [hook context](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/plugins/hook-types.ts), [policy schema](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/config/zod-schema.agent-runtime.ts) |
| MCP configuration | [MCP server type](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/config/types.mcp.ts) |
| Native MCP catalog omits server instructions | [Catalog construction](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/src/agents/agent-bundle-mcp-runtime.ts) |

## Defaults we inherit

GLM 5.2 requests explicitly send `reasoning: { enabled: false }` through
`agents.defaults.models["plow/z-ai/glm-5.2"].params.extraBody`. The pinned runtime
merges this into the OpenAI completions request body; the Plow proxy must preserve
the caller's reasoning field. Sonnet receives no additional reasoning parameter.
An explicit empty `modelPolicy` keeps this parameter map from becoming a legacy
model-selection allowlist. The wire test exercises both models against a local
HTTP server using the pinned runtime's request wrappers and transport.
These settings seed new owner configs. `syncConfig` preserves existing
`agents.defaults` settings, so rebuilding an existing install does not add this
opt-out; add the per-model parameter to its owner config explicitly. If no
owner-authored policy exists, also set `agents.defaults.modelPolicy: {}` so the
parameter map does not restrict model selection. Preserve any existing
owner-authored model-selection policy instead.

Plow prepares messages in arrival order within each chat, releasing the chat lane
at the dispatch call rather than model completion, and sets the global queue mode
to `collect`. OpenClaw's [Telegram middleware](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/extensions/telegram/src/bot-core.ts#L257)
also orders ordinary messages using [conversation keys](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/extensions/telegram/src/sequential-key.ts#L250).
Before dispatch, Plow waits 2 seconds for same-sender text bubbles in a chat
(`messages.inbound.byChannel.plow`). A speaker change, command or media message
flushes the pending burst immediately; chat trust is refreshed before dispatch.
Host concurrency and active-run queue tuning inherit the pinned defaults:
500 ms debounce, cap 20 pending messages, and summarize overflow. Retained prompts
are joined without a Plow text cap; overflow keeps bounded 160-character previews,
so text beyond 20 pending messages can be summarized or omitted. At 1.5-second
spacing, a busy run lasting roughly 32 seconds can reach that limit.

Every Plow tool uses the SDK's per-run requester, account and owner fields, resolving
the conversation from its native ID or retained delivery route on collected follow-ups,
then fetches current Plow chat facts. No shared receipt registry or
async execution context is needed for authorization. Thread creation keys use the
stable inbound source and normalized payload; typed tool hooks bind the source to
the host tool-call ID. Delivery uncertainty blocks later Plow mutations in the
same run, and run completion clears that guard.
Native message sends use OpenClaw's cross-context policy with both within-provider
and across-provider permissions false; the Plow send adapter checks served lines
and active destinations. Tool Search remains disabled.

External plugins cannot use OpenClaw's trusted durable ingress. Plow retains UID
deduplication and atomic per-chat checkpoints with a 512-UID recent set. Catch-up
pages through history until the checkpoint (or the answered boundary for a new
owner DM); four chats can recover concurrently. Automatic phone
finals use the SDK inbound dispatcher’s durable outbound queue. Adoption callbacks acknowledge sources, not successful replies;
deferred sources remain pending until the host adopts them. Terminal commands
without model runs acknowledge at completion. Uncertain delivery is not blindly
replayed, and later explicit mutations in the same run are blocked after an
ambiguous delivery. The next run remains independent.

A state database already opened by 2026.9.6 cannot be opened by 2026.9.4.
Restore a pre-upgrade backup, or use a fresh state volume (which resets local
profiles, sessions and memory); do not attempt an in-place database downgrade.
Before replacing a volume, stop the agent and preserve `/var/lib/plow/plow-checkpoints`,
`/var/lib/plow/plow-listening-since` and `/var/lib/plow/plow-email` (where email threads report).
Restore those directories into the replacement volume before booting the agent.
Without checkpoints, boot dispatches unanswered group messages newer than
`plow-listening-since` and trailing unanswered owner DMs, in history order;
history older than `plow-listening-since` stays unanswered.


## Experience acceptance

The build applies `patch-runtime.ts` to six checksum-verified 2026.9.6 modules.
The outbound patch retains the durable intent ID in Plow adapter context even when exact
provider reconciliation is not required. This lets the adapter distinguish cron
delivery from inbound replies for pause enforcement. It does not enable provider
reconciliation or change other channels. Runtime upgrades must review this patch;
a changed source checksum fails the build. Gateway acceptance tests the partial
pause case without scheduler cancellation and confirms direct replies still work.

The task notification patch suppresses the redundant automatic terminal notice
for native subagents in the reserved `plow-worker` session namespace. The
coordinator acknowledges cancellation; native result handoff still runs. Other
workers and task runtimes retain their notification policy. Runtime and gateway
tests verify the boundary and reject duplicate cancellation notices.

The tool-surface patch carries the prepared host turn's channel, provider and
account into native tool construction. A reminder created with
`sessionTarget="current"` must retain its authenticated source as well as its
delivery destination. Inferring caller authority from `delivery.channel` would
cross that boundary; the scheduled-account guard remains unchanged. Acceptance
creates the reminder through an actual inbound tool invocation and executes that
job, rather than relying only on an administrator-created scheduler fixture.

The origin-retention patch preserves that creator when only `enabled` changes.
Without it, a pause/resume through the gateway can reset a valid Plow origin to
unknown, and a previously accepted reminder later fails the account guard.
Only the authority-retention comparison normalizes `enabled`; full configuration
revisions, active-source invalidation and native cancellation are unchanged.
Changes to the work, tool cap, owner, destination, schedule or trigger still
require fresh authorization. Native boundary tests check these negative controls,
and gateway acceptance executes a conversation-created job before and after pause.

The failure-alert patch uses `deliveryIntentId`, not `deliveryQueueId`, to persist
a versioned job/run identity in a newly created queue entry. A supplied queue ID
can be replaced by a fresh UUID; it does not select a new durable intent. The native
target resolves to Plow. This includes `channel="last"` resolving to Plow. The
adapter gates that alert at physical dispatch using global, destination and
source-job pause state. Ordinary replies retain their own delivery intent and
continue during pause. Disabling a job already cancels its active native run;
the plugin does not enumerate session-owned tasks to discover system-owned cron
runs. The gateway test holds a provider request, pauses through the owner's
registered tool, and checks both the abort and suppressed failure announcement.

The safety-notice patch carries selected native `auto-disabled` and
`failure-alert` system-event job IDs and occurrence IDs into Plow-only persisted
`channelData`. It copies native reply metadata and leaves the pending-final queue
ID, completion ID and writer authority unchanged. Replacing that queue ID would
break restart recovery's lookup of its original delivery owner. A narrow
`sendPayload` adapter validates the independent notice metadata and passes it to
the existing physical send gate. This prevents the fallback heartbeat from bypassing the same source-room
pause. Ordinary and exec heartbeats keep their existing queue behavior. Every
job in a combined notice is checked; missing jobs or occurrence identity fail
closed. The native fallback test has an allowed control, distinct notice text
and no optional frequency throttle, so neither deduplication nor rate limiting
can disguise a missing pause guard. Queued adapter tests cover multiple sources,
late pauses, malformed provenance, original completion settlement and replaced
writer authority. Stable queue custody preserves pending
recovery; it does not establish indefinite duplicate suppression after acknowledgement.

Scheduled turns also reject direct Plow message sends at the tool boundary.
Their final text goes through the scheduler's configured delivery route, where
the pause gate and durable queue apply. The denial explains this path so a
mistaken tool selection can recover into a useful reminder instead of a false
authorization failure. Mailbox listing remains a read; ordinary inbound replies
retain their existing tool access. A job message should repeat the final-text
instruction because a detached execution does not inherit every detail of its
creation turn.
Conversation notification controls also remain outside the detached run: its
own session is not a verified foreground Plow conversation. The same denial
explains that the delivery gate is checked by the scheduler/adapter rather than
asking the job to inspect or change those controls. Ordinary phone requests can
still inspect, pause and resume them.

Default heartbeat enrollment names `main` explicitly. In this pinned runtime,
an unspecified agent selector enrolls every agent, including `plow-worker`;
the worker could then send an unsolicited analysis through the owner's route.
Boot migration adds `agentId: "main"` only when no selector is present, retaining
the owner's cadence and route, including `none`, and preserving an explicit
custom selector. Native resolver tests and the gateway's no-raw-worker assertion
cover the default enrollment. This is separate from requested worker completion
and does not disable the main agent's heartbeat.

For every runtime upgrade, review these six source modules against the new
upstream implementation. Checksums and unique replacement targets fail the
build on drift; updating only a filename or hash is insufficient. Run the suite,
offline probe and native gateway acceptance before changing the pin. A fixture
model proves the tool and transport contract; live model wording has its own
qualitative review gate.

After the suite and probe, run the real gateway acceptance harness. It uses local
Plow and model fixtures under `--network none`, tests authenticated personality
writes, real silence and group delivery, native Sonnet image routing, scheduler
pause/resume through a full-state backup/restore, reminder execution/delivery and
cancellation, a pause during in-flight generation, responsive background workers
and their cancellation, and the pinned client's native SQLite usage reader.
It also checks lost native disable and resume responses, invocation revocation
after a successful mutation, both room/global pause orders, and an in-flight
source-room pause when delivery targets another room. The stress suite covers
all 40 two-scope and three-scope pause/resume orderings and 205 jobs across
pagination boundaries. The email fixture allows 20 seconds for native SQLite
initialization under concurrent load; temporary-state teardown retries transient
directory races while native storage finishes its background work.

```sh
docker run --rm --user root --network none \
  -v "$PWD/node_modules:/opt/plow/node_modules:ro" \
  -v "$PWD/tests:/opt/plow/tests:ro" plow-openclaw:test sh -c \
  'mkdir -p /opt/plow/plugin/node_modules && ln -s /app /opt/plow/plugin/node_modules/openclaw && node /opt/plow/tests/gateway-acceptance.ts'
```

For an interactive personality preview, follow
[the gateway fixture instructions](../tests/gateway-acceptance.md#inspect-the-personality-page).
The preview uses the existing Caddy boundary with a loopback-only host port and
synthetic identity; it never loads a live credentials file.

Live dialogue evaluations require a dedicated agent credential. They call both
configured models with synthetic context and never send phone or email messages:

```sh
npm run eval -- --credentials /PRIVATE/test-credentials --output /TMP/eval-results.json
```

The report contains assertions, outputs, token usage, latency and estimated cost.
Review outputs using the rubric in [base-experience.md](base-experience.md#operations-and-release-evidence).
Provider failures fail the run and remain visible; deterministic CI needs no
credential. The manual workflow uses repository secrets for a live evaluation.

Experience controls use SDK context version 2 and check current authority at the
mutation boundary. Native task flows hold commitments; native cron holds schedules;
scoped experience JSON holds voice/preferences/notes/notification gates. Back up
all of `/var/lib/plow` while stopped. The real gateway harness restores the complete
state tree at its original path, then verifies scheduler and personality continuity.
