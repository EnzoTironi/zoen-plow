import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const patches = [
  // Retain Plow's cron intent without claiming provider reconciliation.
  {
    path: "/app/dist/deliver-Bz2WIVCS.mjs",
    checksum: "95fad7fe364eb3d1fd7917e63bbbb7108a381ebcae79224a5bda4132c7ba1d67",
    changes: [{
      before: "...exactReconciliationRequired && params.payloads.length === 1 ? { deliveryQueueId: platformQueueId } : { deliveryQueueId: void 0 },",
      after: "...exactReconciliationRequired && params.payloads.length === 1 ? { deliveryQueueId: platformQueueId } : { deliveryQueueId: params.channel === \"plow\" ? platformQueueId : void 0 },",
    }],
  },
  // The coordinator acknowledges worker cancellation. Native result handoff
  // is separate; suppress only the redundant automatic terminal notice.
  {
    path: "/app/dist/task-notification-policy-7pB-BxLh.mjs",
    checksum: "28d0996e08711568666ccd06d32030afcb93d2304e344a24cfcaa6f0abf46e32",
    changes: [{
      before: "function shouldAutoDeliverTaskTerminalUpdate(task) {",
      after: "function shouldAutoDeliverTaskTerminalUpdate(task) {\n\tif (task.runtime === \"subagent\" && task.childSessionKey?.startsWith(\"agent:plow-worker:subagent:\")) return false;",
    }],
  },
  // Native tools created by a harness retain the host-authenticated turn's
  // channel/account. A delivery destination cannot supply caller authority.
  {
    path: "/app/dist/selection-WkHO-qmO.mjs",
    checksum: "2bd6d7859dfe122427cfc840bcad23a1b4544407e9f72a12490af125763f2442",
    changes: [{
      before: "\t\t\t\t...options,\n\t\t\t\tgithubPublicationAvailable,\n",
      after: "\t\t\t\t...options,\n\t\t\t\tmessageChannel: attempt.messageChannel,\n\t\t\t\tmessageProvider: attempt.messageProvider,\n\t\t\t\tagentAccountId: attempt.agentAccountId,\n\t\t\t\tgithubPublicationAvailable,\n",
    }],
  },
  // Pause/resume changes liveness, not the creator's approved execution scope.
  // Normalize enabled only for origin retention; native CAS, active-source
  // invalidation and cancellation continue to use the full revision.
  {
    path: "/app/dist/jobs-tool-policy-DBCUJ2uk.mjs",
    checksum: "6cd412b9b38218d5a8cbcfc451e3f9297d77eb6f3b54e7df641ed814131a31a5",
    changes: [{
      before: "resolveCronRequesterExecutionRevision(previousJob) === resolveCronRequesterExecutionRevision(job)",
      after: "resolveCronRequesterExecutionRevision({ ...previousJob, enabled: job.enabled }) === resolveCronRequesterExecutionRevision(job)",
    }],
  },
  // Failure announcements use a different native path from scheduled results.
  // Mark only alerts resolving to Plow so the physical pause gate sees them.
  {
    path: "/app/dist/server-cron-Dd6AX5Mc.mjs",
    checksum: "506f6c134534566a4ec50af6c0cc983ee1678eadbbcce5b4fd3b45fba1dd23f9",
    changes: [{
      before: "\t\t\tjobId: params.job.id,\n\t\t\ttarget: {\n",
      after: "\t\t\tjobId: params.job.id,\n\t\t\tdeliveryIntentId: `plow-cron-alert:v1:${params.job.id}:${params.runAtMs}`,\n\t\t\ttarget: {\n",
    }, {
      before: "\t\tpayloads: [params.payload],\n\t\tsession: delivery.session,\n",
      after: "\t\tpayloads: [params.payload],\n\t\tdeliveryIntentId: delivery.resolvedTarget.channel === \"plow\" ? params.deliveryIntentId : void 0,\n\t\tsession: delivery.session,\n",
    }],
  },
  // Suppressed failure alerts and auto-disable notices can reach the owner
  // through native system events. Preserve selected host event/job identity;
  // ordinary and exec heartbeats keep their existing queue semantics.
  {
    path: "/app/dist/heartbeat-runner-run-DDQCfKBB.mjs",
    checksum: "95424ab493a5df4e404f5af255f5a03dbbd665c7be773f8bc74a2e25952b856a",
    changes: [{
      before: "\t\tconst send = await sendDurableMessageBatchCore({\n\t\t\tcfg,\n\t\t\tchannel: delivery.channel,\n",
      after: "\t\tconst cronNotices = delivery.channel === \"plow\" ? policy.prepared.inspectedSystemEventsToConsume.flatMap((event) => {\n\t\t\tconst job = event.contextKey?.match(/^cron:([^:]+):(auto-disabled|failure-alert)$/);\n\t\t\tif (!job) return [];\n\t\t\tif (typeof event.id !== \"string\" || !event.id.trim()) throw new Error(\"Scheduled notice occurrence identity cannot be verified\");\n\t\t\treturn [[job[1], event.id]];\n\t\t}) : [];\n\t\tconst deliveryPayload = cronNotices.length ? copyReplyPayloadMetadata(payload, {\n\t\t\t...payload,\n\t\t\tchannelData: { ...payload.channelData, plowCronNotice: { version: 1, sources: cronNotices } }\n\t\t}) : payload;\n\t\tconst send = await sendDurableMessageBatchCore({\n\t\t\tcfg,\n\t\t\tchannel: delivery.channel,\n",
    }, {
      before: "\t\t\tpayloads: [payload],\n",
      after: "\t\t\tpayloads: [deliveryPayload],\n",
    }],
  },
  // Code Mode runs in a sandbox route, but collectors belong to the admitted
  // native session. Carry that host identity without widening collector access
  // or changing the persisted swarm group/fingerprint used for replay.
  {
    path: "/app/dist/builtin-openclaw-q1hiFm14.mjs",
    checksum: "e4504516aef56cd293e11369e420148c5ad60c80e60128ed64bfb57fb7239e25",
    changes: [{
      before: 'import { a as validateSessionTranscriptContextVersion } from "./session-accessor.sqlite-model-context-Dxi3aFzy.mjs";',
      after: 'import { a as validateSessionTranscriptContextVersion, r as validateSessionTranscriptContextAdmission } from "./session-accessor.sqlite-model-context-Dxi3aFzy.mjs";\nimport { l as readPendingUserTurnTranscriptAdmission } from "./session-transcript-read-fence-Crjo4FKU.mjs";',
    }, {
      before: "function resolveOrphanRepairPlan(params) {",
      after: `function isCanonicalPlowHumanTurn(message) {
\tconst sender = message?.__openclaw?.senderIdentity;
\tconst transport = message?.__openclaw?.transport;
\treturn message?.role === "user" && message.display !== false
\t\t&& (!message.provenance || message.provenance.kind === "external_user")
\t\t&& typeof message.idempotencyKey === "string"
\t\t&& message.idempotencyKey.startsWith("channel-user:v1:")
\t\t&& message.idempotencyKey.slice("channel-user:v1:".length).trim().length > 0
\t\t&& transport?.channel === "plow" && typeof transport.messageId === "string" && transport.messageId.trim().length > 0
\t\t&& sender?.type === "observation" && sender.pluginId === "plow" && sender.senderKind === "human"
\t\t&& typeof sender.id === "string" && sender.id.trim().length > 0 && sender.id === message.__openclaw.senderId;
}
function resolveOrphanRepairPlan(params) {`,
    }, {
      before: "\tconst toolSurfaceRuntime = createAgentHarnessToolSurfaceRuntimeCore({\n\t\tconfig: attempt.config,\n\t\tagentId: params.setup.sessionAgentId,\n\t\tsessionKey: params.setup.sandboxSessionKey,\n",
      after: "\tconst toolSurfaceRuntime = createAgentHarnessToolSurfaceRuntimeCore({\n\t\tconfig: attempt.config,\n\t\tagentId: params.setup.sessionAgentId,\n\t\tsessionKey: params.setup.sandboxSessionKey,\n\t\trunSessionKey: attempt.sessionKey?.trim() || attempt.sessionId,\n",
    }, {
      // A queued, already-admitted human turn owns this canonical leaf. An
      // internal worker settlement must not detach its durable read anchor.
      before: "\treturn {\n\t\tcontextEnginePrompt: merge.prompt,\n\t\tmessageEntry: candidate.messageEntry,\n\t\ttrailingEntries: candidate.trailingEntries,\n\t\tremoveLeaf: merge.removeLeaf || !params.preserveLeaf\n\t};",
      after: "\tconst canonicalPlowHuman = isCanonicalPlowHumanTurn(candidate.messageEntry.message);\n\tconst preserveQueuedHuman = canonicalPlowHuman && !params.preserveLeaf && !merge.removeLeaf;\n\treturn {\n\t\tcontextEnginePrompt: preserveQueuedHuman ? params.prompt : merge.prompt,\n\t\tmessageEntry: candidate.messageEntry,\n\t\ttrailingEntries: candidate.trailingEntries,\n\t\tpreserveQueuedHuman,\n\t\tremoveLeaf: merge.removeLeaf || !(params.preserveLeaf || canonicalPlowHuman)\n\t};",
    }, {
      // Only this factory-owned input may select its existing local branch
      // after another actor settles. Durable history and replay guards remain.
      before: "\tconst readCurrentTurn = async (signal) => {\n\t\tsignal?.throwIfAborted();",
      after: "\tlet replayAppendTail, replayWitness;\n\tconst readCurrentTurn = async (signal) => {\n\t\tsignal?.throwIfAborted();",
    }, {
      before: "\t\tawait sessionManager.reloadPersistedTranscriptAsync(signal);\n\t\tassertOwned();\n\t\treturn await sessionManager[sessionManagerPrepareCurrentTurnReplay]((entry) => isInterruptedTurnEntry(entry, runId), (entry) => entry?.type === \"message\" && entry.message.role === \"user\" && isDeepStrictEqual(entry.message, message), signal);",
      after: `\t\tawait sessionManager.reloadPersistedTranscriptAsync(signal);
\t\tassertOwned();
\t\tconst admission = readPendingUserTurnTranscriptAdmission(recorder);
\t\tconst pendingPlowSource = admission && isCanonicalPlowHumanTurn(message) && isDeepStrictEqual(recorder.getPersistedMessage?.(), message);
\t\tif (pendingPlowSource) {
\t\t\tvalidateSessionTranscriptContextAdmission(scope, admission);
\t\t\tassertOwned();
\t\t\treplayAppendTail = sessionManager.getAppendParentId();
\t\t\tsessionManager.reloadPersistedTranscriptAfterAppend(sessionManager.transcriptMutationAt, admission.entryId, admission.entryId);
\t\t\tassertOwned();
\t\t\tvalidateSessionTranscriptContextAdmission(scope, admission);
\t\t\tconst selected = sessionManager.getEntry(admission.entryId);
\t\t\tif (selected?.type !== "message" || !isDeepStrictEqual(selected.message, message)) throw new Error("Pending Plow user turn changed before replay admission");
\t\t}
\t\tconst witness = await sessionManager[sessionManagerPrepareCurrentTurnReplay]((entry) => isInterruptedTurnEntry(entry, runId), (entry) => entry?.type === "message" && entry.message.role === "user" && isDeepStrictEqual(entry.message, message), signal);
\t\treplayWitness = pendingPlowSource ? witness : void 0;
\t\treturn witness;`,
    }, {
      before: "\tlet pending = true;\n\treturn async (signal = params.signal) => {\n\t\tif (!pending) return;\n\t\tconst replaySignal = signal && params.signal && signal !== params.signal ? AbortSignal.any([signal, params.signal]) : signal;\n\t\tconst current = await readCurrentTurn(replaySignal);\n\t\tif (!current || current.anchor.entryId !== initial.anchor.entryId || current.anchor.generation !== initial.anchor.generation) throw new Error(\"Persisted user turn changed before replay admission\");\n\t\treturn () => {\n\t\t\tif (!pending) return;\n\t\t\tassertPreparedCurrentTurn(current, replaySignal);\n\t\t\tpending = false;\n\t\t};\n\t};",
      after: `\tlet pending = true;
\tconst prepareReplay = async (signal = params.signal) => {
\t\tif (!pending) return;
\t\tconst replaySignal = signal && params.signal && signal !== params.signal ? AbortSignal.any([signal, params.signal]) : signal;
\t\tconst current = await readCurrentTurn(replaySignal);
\t\tif (!current || current.anchor.entryId !== initial.anchor.entryId || current.anchor.generation !== initial.anchor.generation) throw new Error("Persisted user turn changed before replay admission");
\t\treturn () => {
\t\t\tif (!pending) return;
\t\t\tassertPreparedCurrentTurn(current, replaySignal);
\t\t\tpending = false;
\t\t};
\t};
\tprepareReplay.restoreAppendTail = (persistedMessage) => {
\t\tconst admission = readPendingUserTurnTranscriptAdmission(recorder);
\t\tif (!admission || !replayWitness || !isCanonicalPlowHumanTurn(message) || !isDeepStrictEqual(persistedMessage, message)) return;
\t\tif (!replayAppendTail || admission.entryId !== replayWitness.anchor.entryId || admission.generation !== replayWitness.anchor.generation) throw new Error("Pending Plow append custody changed");
\t\tassertPreparedCurrentTurn(replayWitness, params.signal);
\t\tvalidateSessionTranscriptContextAdmission(scope, admission);
\t\tsessionManager.reloadPersistedTranscriptAfterAppend(replayWitness.version.updatedAt, replayAppendTail, admission.entryId);
\t\tassertOwned();
\t\tvalidateSessionTranscriptContextAdmission(scope, admission);
\t};
\treturn prepareReplay;`,
    }, {
      // Restore append custody synchronously. The existing persisted-message
      // callback is async and cannot propagate validation errors to append.
      before: "\tconst sessionManager = guardSessionManager(unguardedSessionManager, {",
      after: `\tif (prepareInitialUserTurnReplay?.restoreAppendTail) {
\t\tconst append = unguardedSessionManager.appendMessageWithTranscriptAnchor.bind(unguardedSessionManager);
\t\tunguardedSessionManager.appendMessageWithTranscriptAnchor = (message, options) => {
\t\t\tconst result = append(message, options);
\t\t\tif (result.appended === false) prepareInitialUserTurnReplay.restoreAppendTail(result.message);
\t\t\treturn result;
\t\t};
\t}
\tconst sessionManager = guardSessionManager(unguardedSessionManager, {`,
    }, {
      // Prompt hooks run after planning; keep the same queued-input boundary
      // when the native runtime assembles model and transcript prompts.
      before: "\tif (leafEntry && input.orphanRepair) {\n\t\tconst orphanPromptMerge = mergeOrphanedTrailingUserPrompt({",
      after: "\tif (leafEntry && input.orphanRepair && !input.orphanRepair.preserveQueuedHuman) {\n\t\tconst orphanPromptMerge = mergeOrphanedTrailingUserPrompt({",
    }],
  },
  {
    path: "/app/dist/tool-surface-bridge-CuOL1qP8.mjs",
    checksum: "1658ee259104fb8dc2005a0bf8a863339cf645a21f9e84a0db4c60543d6655c0",
    changes: [{
      before: "\t\t\t\tsessionKey: params.sessionKey,\n\t\t\t\tsessionId: params.sessionId,\n\t\t\t\trunId: params.runId,\n\t\t\t\tcatalogRef: toolSearchCatalogRef,\n",
      after: "\t\t\t\tsessionKey: params.sessionKey,\n\t\t\t\trunSessionKey: params.runSessionKey,\n\t\t\t\tsessionId: params.sessionId,\n\t\t\t\trunId: params.runId,\n\t\t\t\tcatalogRef: toolSearchCatalogRef,\n",
    }],
  },
  {
    path: "/app/dist/code-mode-swarm.runtime-Cre1Hth5.mjs",
    checksum: "13f57de42c08988228521ef30dac0a8280378f475555a49ba5e1a6e95a2fc216",
    changes: [{
      before: "function resolveCodeModeSwarmGroupId(ctx) {",
      after: "function resolveCodeModeRunSessionKey(ctx) {\n\treturn resolveCodeModeRequesterSessionKey({ ...ctx, sessionKey: ctx.runSessionKey ?? ctx.sessionKey });\n}\nfunction resolveCodeModeSwarmGroupId(ctx) {",
    }, {
      before: "\tconst requesterSessionKey = resolveCodeModeRequesterSessionKey(params.ctx);\n\tlet existing = getSwarmRunByLaunchReplayKey",
      after: "\tconst requesterSessionKey = resolveCodeModeRunSessionKey(params.ctx);\n\tlet existing = getSwarmRunByLaunchReplayKey",
    }, {
      before: "\t\tcurrentSessionKeys: /* @__PURE__ */ new Set([rawSessionKey, requesterSessionKey]),",
      after: "\t\tcurrentSessionKeys: /* @__PURE__ */ new Set([rawSessionKey, requesterSessionKey, resolveCodeModeRunSessionKey(params.ctx)]),",
    }],
  },
];
for (const { path, checksum, changes } of patches) {
  const source = await readFile(path, "utf8");
  if (createHash("sha256").update(source).digest("hex") !== checksum) {
    throw new Error(`Pinned runtime changed at ${path}; review its Plow compatibility patch before building`);
  }
  let updated = source;
  for (const { before, after } of changes) {
    if (updated.split(before).length !== 2) throw new Error(`Pinned runtime patch target is not unique: ${path}`);
    updated = updated.replace(before, after);
  }
  await writeFile(path, updated);
}
