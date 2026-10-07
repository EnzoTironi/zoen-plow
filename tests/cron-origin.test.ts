import assert from "node:assert/strict";
import { test } from "node:test";

// Exercise the image's patched native authority boundary, rather than emulate it.
const { i: reconcile, n: sameMessageAuthority } = await import("/app/dist/jobs-tool-policy-DBCUJ2uk.mjs");
const { t: configRevision } = await import("/app/dist/config-revision-DtL_Z8FS.mjs");

function fixture() {
  return {
    id: "origin-fixture", name: "Synthetic reminder", enabled: true, agentId: "main", sessionKey: "agent:main:main",
    owner: { agentId: "main", sessionKey: "agent:main:main", accountId: "chat" },
    createdAtMs: 1_791_370_000_000, updatedAtMs: 1_791_370_000_000,
    schedule: { kind: "at", at: "2026-10-08T15:00:00.000Z" }, sessionTarget: "current", wakeMode: "now",
    payload: { kind: "agentTurn", message: "Check dinner", toolsAllow: ["message"], toolsAllowIsDefault: true as boolean | undefined },
    scheduledToolPolicy: { version: 1, mode: "account", ownerSessionKey: "agent:main:main", ownerAccountId: "chat" },
    toolsAllowProvenance: { version: 1, source: "final-executable-surface", callerOrigin: { kind: "external", channel: "plow" },
      channelRequester: { version: 1, channel: "plow", accountId: "chat", senderId: "plow-owner" } },
    delivery: { mode: "announce", channel: "plow", to: "cht_fixture", accountId: "chat" }, state: {},
  };
}

test("native pause/resume retains the creator while invalidating active message authority", () => {
  const previous = fixture(), disabled = structuredClone(previous);
  disabled.enabled = false;
  reconcile({ job: disabled, previousJob: previous });
  assert.deepEqual(disabled.toolsAllowProvenance, previous.toolsAllowProvenance);
  assert.notEqual(configRevision(disabled), configRevision(previous), "scheduler compare-and-swap must still see disable");
  assert.equal(sameMessageAuthority(previous, disabled), false, "an active source must still be invalidated by disable");
  const resumed = structuredClone(disabled); resumed.enabled = true;
  reconcile({ job: resumed, previousJob: disabled });
  assert.deepEqual(resumed.toolsAllowProvenance, previous.toolsAllowProvenance);
});

const edits: { name: string; change: (job: ReturnType<typeof fixture>) => void }[] = [
  { name: "payload", change: job => { job.payload.message = "Different work"; } },
  { name: "tool cap", change: job => { job.payload.toolsAllow = []; } },
  { name: "default-cap marker", change: job => { job.payload.toolsAllowIsDefault = undefined; } },
  { name: "owner account", change: job => { job.owner.accountId = "other"; job.scheduledToolPolicy.ownerAccountId = "other"; } },
  { name: "owner session", change: job => { job.owner.sessionKey = "agent:main:plow:chat:group:cht_other"; job.scheduledToolPolicy.ownerSessionKey = job.owner.sessionKey; } },
  { name: "destination", change: job => { job.delivery.to = "cht_other"; } },
  { name: "schedule", change: job => { job.schedule.at = "2026-10-09T15:00:00.000Z"; } },
  { name: "trigger", change: job => { job.state = { triggerState: { revision: 1 } }; } },
];
for (const { name, change } of edits) test(`native ${name} edit cannot inherit the previous creator without fresh authorization`, () => {
  const previous = fixture(), edited = structuredClone(previous);
  change(edited);
  reconcile({ job: edited, previousJob: previous });
  assert.deepEqual(edited.toolsAllowProvenance.callerOrigin, { kind: "unknown" });
  assert.equal(edited.toolsAllowProvenance.channelRequester, undefined);
});

test("native runtime-only progress retains origin; toggling never grants an unknown origin", () => {
  const previous = fixture(), progress = structuredClone(previous);
  progress.state = { lastRunAtMs: 1_791_370_001_000 };
  reconcile({ job: progress, previousJob: previous });
  assert.deepEqual(progress.toolsAllowProvenance, previous.toolsAllowProvenance);
  const unknown = { ...fixture(), toolsAllowProvenance: { version: 1, source: "final-executable-surface", callerOrigin: { kind: "unknown" } } };
  const disabled = structuredClone(unknown); disabled.enabled = false;
  reconcile({ job: disabled, previousJob: unknown });
  assert.deepEqual(disabled.toolsAllowProvenance.callerOrigin, { kind: "unknown" });
});
