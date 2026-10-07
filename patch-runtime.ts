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
