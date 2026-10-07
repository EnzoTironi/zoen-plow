import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { o: mergeOrphanedTrailingUserPrompt } = await import("/app/dist/context-engine-maintenance-VqmqPz8h.mjs");
const { r: isSessionContextMetadataEntry } = await import("/app/dist/session-manager-codec-DW3_Rlj9.mjs");
const { t: SessionManager } = await import("/app/dist/session-manager-DjC09C_X.mjs");
const { n: ensureSessionEntry } = await import("/app/dist/session-accessor.sqlite-initial-entry-huf5rr2y.mjs");
const { n: readAnchor } = await import("/app/dist/session-accessor.sqlite-transcript-anchor-B0dOIy5w.mjs");
const { t: createRecorder } = await import("/app/dist/user-turn-transcript-BkLX9Oj1.mjs");
const { l: pendingAdmission } = await import("/app/dist/session-transcript-read-fence-Crjo4FKU.mjs");
const { t: sourceTurnId } = await import("/app/dist/source-turn-id-BZGK3amb.mjs");
const { c: closeDatabases } = await import("/app/dist/openclaw-agent-db-lifecycle-D7S9DdJC.mjs");

// The private repair planner is not exported. Execute its unchanged native
// region with native dependencies; do not reimplement the product predicate.
const source = await readFile("/app/dist/builtin-openclaw-q1hiFm14.mjs", "utf8");
const start = source.indexOf("//#region src/agents/embedded-agent-runner/run/attempt-orphan-repair.ts\n");
const end = source.indexOf("\n//#endregion", start);
assert.ok(start >= 0 && end > start, "the pinned native repair region must exist");
const resolvePlan = new Function("isSessionContextMetadataEntry", "mergeOrphanedTrailingUserPrompt",
  `${source.slice(start, end)}\nreturn resolveOrphanRepairPlan;`)(isSessionContextMetadataEntry, mergeOrphanedTrailingUserPrompt);
const mergeStart = source.indexOf("\tconst leafEntry = input.orphanRepair?.messageEntry;");
const mergeEnd = source.indexOf("\n\tlet leasedSteering;", mergeStart);
assert.ok(mergeStart >= 0 && mergeEnd > mergeStart);
const assemblePrompts = new Function("input", "attempt", "mergeOrphanedTrailingUserPrompt", "shouldWarnOnOrphanedUserRepair", "log$6", "effectivePrompt", "effectiveTranscriptPrompt",
  `${source.slice(mergeStart, mergeEnd)}\nreturn { effectivePrompt, effectiveTranscriptPrompt };`);
const reconcileStart = source.indexOf("function reconcilePrePersistedCurrentUserTurn(");
const reconcileEnd = source.indexOf("\n//#endregion", reconcileStart);
assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart);
const reconcile = new Function(`${source.slice(reconcileStart, reconcileEnd)}\nreturn reconcilePrePersistedCurrentUserTurn;`)();

const settlePrompt = "Process this synthetic worker result privately: dinner comparison complete.";
function input() {
  return { text: "What is the status of that dinner comparison?", senderIsOwner: true,
    idempotencyKey: sourceTurnId({ provider: "plow", accountId: "chat", conversationId: "cht_fixture", messageId: "msg_fixture_status" }),
    sender: { id: "fixture-owner", name: "Pat", identity: { type: "observation", id: "fixture-owner", pluginId: "plow", accountId: "chat", senderKind: "human" } },
    transport: { channel: "plow", conversationRef: "conv_fixture", messageId: "msg_fixture_status" },
  };
}
function message() { return createRecorder({ input: input() }).message; }
function guestInput() {
  const seed = input();
  return { ...seed, text: "Could you compare Saturday at 8 as well?", senderIsOwner: false,
    idempotencyKey: sourceTurnId({ provider: "plow", accountId: "chat", conversationId: "cht_group_fixture", messageId: "msg_guest_status" }),
    sender: { id: "fixture-guest", name: "Lee", identity: { ...seed.sender.identity, id: "fixture-guest" } },
    transport: { ...seed.transport, messageId: "msg_guest_status" } };
}
function planFor(value: ReturnType<typeof message>, preserveLeaf = false) {
  const manager = SessionManager.inMemory(); manager.appendMessage(value);
  return resolvePlan({ sessionManager: manager, prompt: settlePrompt, trigger: "user", preserveLeaf });
}

for (const sender of ["owner", "guest"]) test(`native repair preserves an adopted ${sender}'s immutable SQLite anchor and queued receipt`, { timeout: 20_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "plow-orphan-admission-"));
  const previousState = process.env.OPENCLAW_STATE_DIR, previousConfig = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENCLAW_STATE_DIR = root; process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
  t.after(async () => {
    await closeDatabases(root);
    if (previousState === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = previousState;
    if (previousConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH; else process.env.OPENCLAW_CONFIG_PATH = previousConfig;
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await writeFile(process.env.OPENCLAW_CONFIG_PATH, "{}");
  const sessionId = randomUUID(), target = { agentId: "main", sessionKey: "agent:main:main", sessionId,
    storePath: join(root, "agents/main/sessions/sessions.json") };
  ensureSessionEntry(target, { sessionId, updatedAt: Date.now() });
  const recorder = createRecorder({ input: sender === "owner" ? input() : guestInput(), target, updateMode: "none" });
  assert.ok(await recorder.persistApproved(), "adoption must finish before the settlement boundary");
  const receipt = structuredClone(recorder.getAdmissionReceipt()), original = structuredClone(recorder.getPersistedMessage());
  assert.ok(receipt.entryId); assert.deepEqual(pendingAdmission(recorder), receipt);
  const before = readAnchor({ ...target, entryId: receipt.entryId }); assert.ok(before);
  const manager = SessionManager.open(target, root);
  const repair = resolvePlan({ sessionManager: manager, prompt: settlePrompt, trigger: "user", preserveLeaf: false });
  assert.equal(repair.messageEntry.id, receipt.entryId);
  // Apply the actual planner's decision through native transcript operations.
  if (repair.removeLeaf) {
    if (repair.messageEntry.parentId) manager.branch(repair.messageEntry.parentId); else manager.resetLeaf();
    manager.appendLeafControl({ targetId: manager.getLeafId(), appendParentId: manager.getAppendParentId() });
  }
  assert.deepEqual(readAnchor({ ...target, entryId: receipt.entryId }), before,
    "a worker settlement must not retire the already-adopted human's active anchor");
  assert.equal(repair.removeLeaf, false, "a worker settlement does not own this already-adopted human input");
  manager.appendMessage({ role: "user", content: repair.contextEnginePrompt, display: false, timestamp: Date.now(),
    idempotencyKey: "fixture-settle:user", provenance: { kind: "inter_session", sourceTool: "subagent_settle", sourceChannel: "internal" } });
  assert.deepEqual(readAnchor({ ...target, entryId: receipt.entryId }), before);
  assert.deepEqual(pendingAdmission(recorder), receipt, "settlement cannot replace the queued foreground receipt");
  const reopened = SessionManager.open(target, root);
  assert.deepEqual(reopened.getEntry(receipt.entryId).message, original);
  assert.throws(() => reopened.appendMessageWithTranscriptAnchor(original), /outside the current turn/,
    "an unfenced stale input cannot borrow this foreground admission");
  const foreground = SessionManager.openModelContext(target, { admission: receipt });
  assert.equal(foreground.getEntry(receipt.entryId), undefined,
    "native model context excludes its admitted current input, which is supplied as the foreground prompt");
  assert.ok(!foreground.buildSessionContext().messages.some(value => value.idempotencyKey === "fixture-settle:user"));
  foreground.appendMessage(original);
  assert.equal(foreground.buildSessionContext().messages.filter(value => value.idempotencyKey === original.idempotencyKey).length, 1);
  assert.deepEqual(readAnchor({ ...target, entryId: receipt.entryId }), before);
  assert.deepEqual(SessionManager.open(target, root).getEntry(receipt.entryId).message, original);
  assert.deepEqual(pendingAdmission(recorder), receipt);
});

test("queued human text belongs only to its own foreground prompt, not worker settlement", () => {
  const value = message(), repair = planFor(value);
  assert.equal(repair.removeLeaf, false);
  assert.equal(repair.contextEnginePrompt, settlePrompt);
  const prompts = assemblePrompts({ orphanRepair: repair }, { trigger: "user", runId: "fixture-settle", sessionId: "fixture-session" },
    mergeOrphanedTrailingUserPrompt, () => false, { debug() {}, warn() {} }, settlePrompt, settlePrompt);
  assert.deepEqual(prompts, { effectivePrompt: settlePrompt, effectiveTranscriptPrompt: settlePrompt });
  const activeSession = { agent: { state: { messages: [value] } } };
  assert.equal(reconcile({ activeSession, currentUserTurnMessage: value, durableUserTurnMessage: value, userTurnAlreadyPersisted: true }), true);
  assert.deepEqual(activeSession.agent.state.messages, [], "own-current reconciliation still excludes duplicate persisted input");
  const otherSession = { agent: { state: { messages: [value] } } };
  assert.equal(reconcile({ activeSession: otherSession, currentUserTurnMessage: { ...value, idempotencyKey: "fixture-settle:user" }, durableUserTurnMessage: value, userTurnAlreadyPersisted: true }), false);
  assert.deepEqual(otherSession.agent.state.messages, [value], "a settlement cannot reconcile another admitted human as its own");
});

test("explicit external provenance retains the canonical source without a preserveLeaf override", () => {
  const value = message(); value.provenance = { kind: "external_user" };
  assert.equal(planFor(value).removeLeaf, false);
});

test("another verified human's queued question stays separate without owner authority", () => {
  const value = createRecorder({ input: guestInput() }).message, repair = planFor(value);
  assert.equal(value.__openclaw.senderIsOwner, false);
  assert.equal(value.__openclaw.senderIdentity.id, "fixture-guest");
  assert.equal(repair.removeLeaf, false); assert.equal(repair.contextEnginePrompt, settlePrompt);
  assert.deepEqual(assemblePrompts({ orphanRepair: repair }, { trigger: "user", runId: "fixture-owner-settle", sessionId: "fixture-session" },
    mergeOrphanedTrailingUserPrompt, () => false, { debug() {}, warn() {} }, settlePrompt, settlePrompt),
  { effectivePrompt: settlePrompt, effectiveTranscriptPrompt: settlePrompt });
  assert.equal(repair.messageEntry.message.__openclaw.senderIsOwner, false, "preservation does not turn a guest into an owner");
});

test("explicit preserveLeaf retains native restart/recovery prompt merging", () => {
  const value = message(), repair = planFor(value, true);
  assert.equal(repair.removeLeaf, false);
  assert.ok(repair.contextEnginePrompt.includes(input().text));
  const prompts = assemblePrompts({ orphanRepair: repair }, { trigger: "user", runId: "fixture-recovery", sessionId: "fixture-session" },
    mergeOrphanedTrailingUserPrompt, () => false, { debug() {}, warn() {} }, settlePrompt, settlePrompt);
  assert.ok(prompts.effectivePrompt.includes(input().text));
  assert.ok(prompts.effectiveTranscriptPrompt.includes(input().text));
});

const malformed: { name: string; edit: (value: ReturnType<typeof message>) => void }[] = [
  { name: "missing source key", edit: value => { delete value.idempotencyKey; } },
  { name: "run-owned source key", edit: value => { value.idempotencyKey = "fixture-run:user"; } },
  { name: "empty channel source suffix", edit: value => { value.idempotencyKey = "channel-user:v1:   "; } },
  { name: "hidden source", edit: value => { value.display = false; } },
  { name: "missing sender metadata", edit: value => { delete value.__openclaw.senderIdentity; } },
  { name: "wrong sender type", edit: value => { value.__openclaw.senderIdentity.type = "profile"; } },
  { name: "wrong sender plugin", edit: value => { value.__openclaw.senderIdentity.pluginId = "other"; } },
  { name: "bot sender", edit: value => { value.__openclaw.senderIdentity.senderKind = "bot"; } },
  { name: "empty sender identity", edit: value => { value.__openclaw.senderIdentity.id = " "; value.__openclaw.senderId = " "; } },
  { name: "missing sender ID", edit: value => { delete value.__openclaw.senderId; } },
  { name: "mismatched sender ID", edit: value => { value.__openclaw.senderId = "different-human"; } },
  { name: "missing transport", edit: value => { delete value.__openclaw.transport; } },
  { name: "wrong transport channel", edit: value => { value.__openclaw.transport.channel = "other"; } },
  { name: "missing provider message ID", edit: value => { delete value.__openclaw.transport.messageId; } },
  { name: "empty provider message ID", edit: value => { value.__openclaw.transport.messageId = "  "; } },
];
for (const { name, edit } of malformed) test(`native orphan cleanup remains for ${name}`, () => {
  const value = message(); edit(value); assert.equal(planFor(value).removeLeaf, true);
});

test("empty and stale internal leaves remain removable even with preserveLeaf", () => {
  const empty = message(); empty.content = "";
  const internal = message(); internal.provenance = { kind: "inter_session", sourceTool: "subagent_settle", sourceChannel: "internal" };
  for (const value of [empty, internal]) for (const preserveLeaf of [false, true]) assert.equal(planFor(value, preserveLeaf).removeLeaf, true);
});

test("untagged synthetic leaves retain the native preserveLeaf behavior", () => {
  const synthetic = { role: "user", content: "An untagged synthetic orphan.", timestamp: Date.now() };
  assert.equal(planFor(synthetic).removeLeaf, true);
  assert.equal(planFor(synthetic, true).removeLeaf, false);
});
