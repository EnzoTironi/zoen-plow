import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isDeepStrictEqual } from "node:util";

const { t: SessionManager, i: sessionManagerPrepareCurrentTurnReplay } = await import("/app/dist/session-manager-DjC09C_X.mjs");
const { n: ensureSessionEntry } = await import("/app/dist/session-accessor.sqlite-initial-entry-huf5rr2y.mjs");
const { n: readAnchor } = await import("/app/dist/session-accessor.sqlite-transcript-anchor-B0dOIy5w.mjs");
const { t: createRecorder } = await import("/app/dist/user-turn-transcript-BkLX9Oj1.mjs");
const { a: withReadFence, c: admissionOwner, l: pendingAdmission } = await import("/app/dist/session-transcript-read-fence-Crjo4FKU.mjs");
const { a: validateSessionTranscriptContextVersion, r: validateSessionTranscriptContextAdmission } = await import("/app/dist/session-accessor.sqlite-model-context-Dxi3aFzy.mjs");
const { d: withOwnedWrites, i: captureOwnedTranscriptWriteAssertion, o: getOwnedSessionTranscriptInitialWriter,
  t: SessionTranscriptWriterClaimReboundError, u: withOwnedSessionTranscriptWriterFence } = await import("/app/dist/transcript-write-context-MlBhwaKa.mjs");
const { s: loadSessionEntry, d: patchSessionEntry } = await import("/app/dist/session-accessor.sqlite-entry-UCl9kr-O.mjs");
const { d: loadTranscriptHeaderSync } = await import("/app/dist/session-accessor.sqlite-read-DG0i0-yW.mjs");
const { i: readNestedToolActivity } = await import("/app/dist/nested-tool-activity-Cz_FrJ3z.mjs");
const { i: guardSessionManager } = await import("/app/dist/resource-loader-B1DeXClE.mjs");
const { d: readClosedTranscriptTurn } = await import("/app/dist/session-accessor-DLYTHSBj.mjs");
const { t: sourceTurnId } = await import("/app/dist/source-turn-id-BZGK3amb.mjs");
const { c: closeDatabases } = await import("/app/dist/openclaw-agent-db-lifecycle-D7S9DdJC.mjs");

// Exercise the pinned private function and its actual append wrapper. This
// fixture supplies native dependencies; it does not copy the repair predicate.
const source = await readFile("/app/dist/builtin-openclaw-q1hiFm14.mjs", "utf8");
function region(start: string, end: string) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `the pinned native region must exist: ${start}`);
  return source.slice(first, last);
}
const nativePrepare = new Function("withOwnedSessionTranscriptWriterFence", "captureOwnedTranscriptWriteAssertion",
  "getOwnedSessionTranscriptInitialWriter", "loadSessionEntry", "loadTranscriptHeaderSync", "SessionTranscriptWriterClaimReboundError",
  "sessionManagerPrepareCurrentTurnReplay", "readNestedToolActivity", "isDeepStrictEqual", "validateSessionTranscriptContextVersion",
  "readPendingUserTurnTranscriptAdmission", "validateSessionTranscriptContextAdmission",
  `${region("function isCanonicalPlowHumanTurn(", "function resolveOrphanRepairPlan(")}\n${region("function isInterruptedTurnEntry(", "function sessionMessagesContainIdempotencyKey(")}\nreturn preparePersistedCurrentUserTurn;`
)(withOwnedSessionTranscriptWriterFence, captureOwnedTranscriptWriteAssertion, getOwnedSessionTranscriptInitialWriter,
  loadSessionEntry, loadTranscriptHeaderSync, SessionTranscriptWriterClaimReboundError, sessionManagerPrepareCurrentTurnReplay,
  readNestedToolActivity, isDeepStrictEqual, validateSessionTranscriptContextVersion, pendingAdmission, validateSessionTranscriptContextAdmission);
const guardStart = source.indexOf("\tconst sessionManager = guardSessionManager(unguardedSessionManager, {");
const wrapperStart = source.lastIndexOf("\tif (prepareInitialUserTurnReplay?.restoreAppendTail)", guardStart);
assert.ok(guardStart > 0);
const installAppendWrapper = new Function("unguardedSessionManager", "prepareInitialUserTurnReplay",
  wrapperStart >= 0 ? source.slice(wrapperStart, guardStart) : "");

function assistant(text: string) {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), provider: "fixture", model: "fixture",
    api: "openai-completions", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
async function fixture(t: TestContext, guest = false) {
  const root = await mkdtemp(join(tmpdir(), "plow-foreground-custody-"));
  const oldState = process.env.OPENCLAW_STATE_DIR, oldConfig = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENCLAW_STATE_DIR = root; process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
  t.after(async () => {
    await closeDatabases(root);
    if (oldState === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = oldState;
    if (oldConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH; else process.env.OPENCLAW_CONFIG_PATH = oldConfig;
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await writeFile(process.env.OPENCLAW_CONFIG_PATH, "{}");
  const runId = randomUUID(), target = { agentId: "main", sessionKey: "agent:main:main", sessionId: randomUUID(),
    storePath: join(root, "agents/main/sessions/sessions.json") };
  ensureSessionEntry(target, { sessionId: target.sessionId, updatedAt: Date.now(), lifecycleRevision: 1, activeWriterRunId: runId });
  const sender = guest ? "fixture-guest" : "fixture-owner";
  const recorder = createRecorder({ target, updateMode: "none", input: {
    text: "WORKER_RACE_STATUS: What is the dinner comparison status?", senderIsOwner: !guest,
    idempotencyKey: sourceTurnId({ provider: "plow", accountId: "chat", conversationId: "cht_fixture", messageId: "msg_status" }),
    sender: { id: sender, identity: { type: "observation", id: sender, pluginId: "plow", accountId: "chat", senderKind: "human" } },
    transport: { channel: "plow", conversationRef: "conv_fixture", messageId: "msg_status" },
  } });
  assert.ok(await recorder.persistApproved());
  const receipt = structuredClone(pendingAdmission(recorder)), original = structuredClone(recorder.getPersistedMessage());
  assert.ok(receipt?.entryId);
  const manager = SessionManager.open(target, root);
  const settleId = manager.appendMessage({ role: "user", content: "[Subagent Context] Dinner comparison complete.", timestamp: Date.now(),
    provenance: { kind: "inter_session", sourceSessionKey: "agent:plow-worker:subagent:fixture", sourceTool: "subagent_settle" } });
  const actualTail = manager.appendMessage(assistant("The worker recommends Thursday: $5 cheaper."));
  const attached = await SessionManager.openAsync(target, root, { maxBytes: 1_000_000, maxEvents: 100 });
  let owned = true;
  const scope = { ...target, expectedWriterRunId: runId, expectedLifecycleRevision: 1 };
  const ownedRun = <T>(run: () => T) => withOwnedWrites({ sessionTarget: scope, withTranscriptWrite: (write: () => T) => write(),
    assertCommitAllowed() { if (!owned) throw new Error("fixture writer revoked"); } }, run);
  const prepare = (message = original, currentRecorder = recorder, currentManager = attached, signal?: AbortSignal) => ownedRun(() =>
    nativePrepare({ sessionManager: currentManager, message, recorder: currentRecorder, runId, signal }));
  const guard = (replay: any) => {
    installAppendWrapper(attached, replay);
    return guardSessionManager(attached, { agentId: target.agentId, sessionKey: target.sessionKey, runId, trigger: "user", config: {},
      preparedUserTurnMessage: original, preparedUserTurnTranscriptRecorder: recorder });
  };
  return { root, target, scope, recorder, receipt, original, attached, settleId, actualTail, prepare, guard, ownedRun,
    revoke() { owned = false; }, anchor: readAnchor({ ...target, entryId: receipt.entryId }),
    runtimeUser: { role: "user", content: original.content, timestamp: Date.now(), idempotencyKey: original.idempotencyKey } };
}

for (const guest of [false, true]) test(`native foreground replay restores append custody for the adopted ${guest ? "guest" : "owner"}`, { timeout: 20_000 }, async t => {
  const f = await fixture(t, guest), replay = await f.prepare();
  assert.equal(typeof replay, "function", "the actual pending factory input must regain its local replay witness");
  const guarded = f.guard(replay);
  const entryId = await f.ownedRun(() => withReadFence(f.receipt, () => guarded.appendMessage(f.runtimeUser)));
  assert.equal(entryId, f.receipt.entryId);
  assert.equal(f.attached.getAppendParentId(), f.actualTail, "synchronous append restoration keeps the actual settlement tail");
  // Model-bound preparation reselects its source, and its subsequent fast append
  // must restore custody again without writing or replacing the immutable event.
  const admit = await replay();
  assert.equal(await f.ownedRun(() => withReadFence(f.receipt, () => guarded.appendMessage(f.runtimeUser))), f.receipt.entryId);
  admit();
  assert.equal(f.attached.getAppendParentId(), f.actualTail);
  assert.deepEqual(readAnchor({ ...f.target, entryId }), f.anchor);
  assert.deepEqual(SessionManager.open(f.target, f.root).getEntry(entryId).message, f.original);
  assert.throws(() => SessionManager.open(f.target, f.root).appendMessageWithTranscriptAnchor(f.original), /outside the current turn/);
  const foregroundId = await f.ownedRun(() => withReadFence(f.receipt, () => guarded.appendMessage(assistant("Race status: Thursday is $5 cheaper."))));
  const durable = SessionManager.open(f.target, f.root);
  assert.equal(durable.getEntry(foregroundId).parentId, f.actualTail);
  assert.ok(durable.getEntry(f.settleId));
  assert.deepEqual(durable.getEntry(entryId).message, f.original);
  assert.deepEqual(readAnchor({ ...f.target, entryId }), f.anchor);
  const model = SessionManager.openModelContext(f.target, { admission: f.receipt });
  assert.equal(model.getEntry(entryId), undefined); assert.equal(model.getEntry(f.settleId), undefined);
  const terminal = readAnchor({ ...f.target, entryId: foregroundId }); assert.ok(terminal);
  const range = readClosedTranscriptTurn({ boundary: { admission: f.receipt, terminal }, maxBytes: 1_000_000, maxEvents: 100 });
  assert.equal(range.kind, "ok"); assert.deepEqual(range.messages[0], f.original);
  assert.ok(range.messages.some((value: any) => value.provenance?.sourceTool === "subagent_settle"));
  assert.equal(range.messages.at(-1).content[0].text, "Race status: Thursday is $5 cheaper.");
  assert.equal(readClosedTranscriptTurn({ boundary: { admission: f.receipt, terminal: { ...terminal, sessionKey: "agent:other:main" } }, maxBytes: 1_000_000, maxEvents: 100 }).kind, "session-rebound");
  assert.equal(f.original.__openclaw.senderIsOwner, !guest, "local replay does not upgrade a guest's authority");
});

for (const mode of ["forged recorder", "blocked input", "sent input", "changed message", "noncanonical message"] as const)
  test(`native pending replay rejects ${mode}`, { timeout: 20_000 }, async t => {
    const f = await fixture(t);
    let recorder = f.recorder, message = f.original;
    if (mode === "forged recorder") recorder = { ...recorder };
    if (mode === "blocked input") recorder.markBlocked();
    if (mode === "sent input") recorder.markSentToProvider();
    if (mode === "changed message") message = { ...message, content: "Changed foreground request." };
    if (mode === "noncanonical message") message = { ...message, display: false };
    assert.equal(await f.prepare(message, recorder), undefined);
    assert.throws(() => f.attached.appendMessageWithTranscriptAnchor(f.original), /outside the current turn/);
    assert.deepEqual(readAnchor({ ...f.target, entryId: f.receipt.entryId }), f.anchor);
  });

for (const field of ["generation", "rawSeq", "effectiveParentId", "activeMessagePosition", "entryId", "agentId", "sessionId", "sessionKey", "storePath"] as const)
  test(`native admission rejects a changed ${field}`, { timeout: 20_000 }, async t => {
    const f = await fixture(t), changed = { ...f.receipt };
    changed[field] = typeof changed[field] === "number" ? changed[field] + 1 : `${changed[field]}-foreign`;
    admissionOwner(f.recorder).refresh(changed, f.original);
    await assert.rejects(f.prepare(), /admission|transcript|session key|store/i);
    assert.deepEqual(readAnchor({ ...f.target, entryId: f.receipt.entryId }), f.anchor);
  });

for (const mode of ["writer revoked", "writer row changed", "lifecycle row changed", "transcript version changed", "receipt generation changed", "anchor detached", "abort"] as const)
  test(`native append restoration fails synchronously when ${mode}`, { timeout: 20_000 }, async t => {
    const f = await fixture(t), controller = new AbortController(), replay = await f.prepare(f.original, f.recorder, f.attached, controller.signal);
    assert.equal(typeof replay, "function"); const guarded = f.guard(replay);
    if (mode === "writer revoked") f.revoke();
    if (mode === "writer row changed") await patchSessionEntry(f.target, () => ({ activeWriterRunId: "foreign-run" }));
    if (mode === "lifecycle row changed") await patchSessionEntry(f.target, () => ({ lifecycleRevision: 2 }));
    if (mode === "transcript version changed") SessionManager.open(f.target, f.root).appendMessage(assistant("A later native settlement."));
    if (mode === "receipt generation changed") admissionOwner(f.recorder).refresh({ ...f.receipt, generation: f.receipt.generation + 1 }, f.original);
    if (mode === "anchor detached") {
      const manager = SessionManager.open(f.target, f.root), parent = manager.getEntry(f.receipt.entryId).parentId;
      if (parent) manager.branch(parent); else manager.resetLeaf();
      manager.appendLeafControl({ targetId: manager.getLeafId(), appendParentId: manager.getAppendParentId() });
    }
    if (mode === "abort") controller.abort(new Error("fixture abort"));
    assert.throws(() => withReadFence(f.receipt, () => guarded.appendMessage(f.runtimeUser)),
      /writer|transcript|custody|admission|abort|context read/i);
    assert.ok(!SessionManager.open(f.target, f.root).getBranch().some((entry: any) => entry.message?.content?.[0]?.text === "Race status: Thursday is $5 cheaper."));
  });
