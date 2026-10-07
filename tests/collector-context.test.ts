import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Use the image's native handlers and registry; only child execution is synthetic.
const { codeModeSwarmHandlers: handlers } = await import("/app/dist/code-mode-swarm.runtime-Cre1Hth5.mjs");
const { j: persistRuns } = await import("/app/dist/subagent-registry-read-C2SIiLpb.mjs");
const { r: loadRuns } = await import("/app/dist/subagent-registry.store.sqlite-DcyWJbiA.mjs");
const { t: bindCollector, n: bindJoinedInvocation, r: captureCollectorGuard } = await import("/app/dist/swarm-collector-capability-BUvTLaKn.mjs");
const { t: bindSourceGuard } = await import("/app/dist/agent-tool-source-execution-guard-CEFulHpI.mjs");
const { t: replayKey, n: fingerprint } = await import("/app/dist/swarm-code-mode-DXtHU4JN.mjs");

const rawSession = "agent:main:plow:chat:direct:plow-owner";
const canonicalSession = "agent:main:main";
const prompt = "Compare only synthetic options.";
const options = { agentId: "plow-worker", label: "Fixture comparison" };
const cfg = { agents: { list: [{ id: "main" }, { id: "plow-worker" }] }, tools: { swarm: { enabled: true } } };

function fixture(name: string, owner = canonicalSession, pending = false) {
  const controller = new AbortController();
  const runId = `swarm_fixture_${name}`;
  const childSession = `agent:plow-worker:subagent:fixture-${name}`;
  let active = true, calls = 0;
  let captured: Record<PropertyKey, unknown> | undefined;
  let afterSpawn: (() => void) | undefined;
  const assertSource = () => { if (!active) throw new Error("fixture source revoked"); };
  const tool = bindCollector({ name: "sessions_spawn", description: "Synthetic child execution", parameters: {
    type: "object", properties: { task: { type: "string" } },
  } }, { collect: { type: "boolean" }, groupId: { type: "string" }, outputSchema: { type: "object" } }, controller.signal);
  const spawnTool = bindSourceGuard(tool, assertSource);
  const entry = { id: "fixture-sessions-spawn", name: "sessions_spawn", tool: spawnTool };
  const ctx = { agentId: "main", sessionKey: rawSession, runSessionKey: canonicalSession as string | undefined,
    runId: `fixture-turn-${name}`, runtimeConfig: cfg, catalogRef: { current: { entries: [entry] } }, abortSignal: controller.signal };
  const runtime = { async callExactId(id: string, input: Record<PropertyKey, unknown>, call: { signal: AbortSignal }) {
    assert.equal(id, entry.id);
    assert.equal(call.signal, controller.signal);
    bindJoinedInvocation(spawnTool, "fixture-child-call");
    captureCollectorGuard(spawnTool, "fixture-child-call", assertSource)();
    calls++;
    captured = input;
    const now = Date.now();
    persistRuns(new Map([[runId, {
      runId, taskRunId: runId, childSessionKey: childSession, requesterSessionKey: owner, requesterAgentId: "main",
      task: input.task, label: options.label, cleanup: "keep", spawnMode: "run", createdAt: now,
      collect: true, expectsCompletionMessage: false, swarmRequesterSessionKey: owner, swarmWaitOwnerSessionKeys: [owner],
      swarmRunId: runId, groupId: input.groupId, swarmLaunchReplayKey: input[replayKey],
      swarmLaunchRequestFingerprint: input[fingerprint], swarmLaunchPending: false,
      execution: pending ? { status: "running", startedAt: now } : {
        status: "terminal", startedAt: now, endedAt: now, outcome: { status: "ok" },
      },
      completion: { required: false, ...(pending ? {} : { resultText: "Synthetic comparison complete.", capturedAt: now }) },
      delivery: { status: "not_required" }, ...(pending ? {} : { collectorCompletion: { status: "done" } }),
    }]]));
    afterSpawn?.();
    return { result: { details: { status: "accepted", runId, sessionKey: childSession, label: options.label } } };
  } };
  return { ctx, controller, runId, childSession,
    get calls() { return calls; }, get captured() { return captured; },
    revoke() { active = false; }, afterSpawn(fn: () => void) { afterSpawn = fn; },
    spawn(task = prompt, context = ctx) {
      return handlers.agentSpawn({ ctx: context, runtime, codeModeRunId: `fixture-code-${name}`, parentToolCallId: "fixture-parent",
        request: { id: "spawn-one", args: [task, options] }, signal: controller.signal });
    },
    wait(context = ctx) { return handlers.agentWait({ ctx: context, request: { args: [runId] }, signal: controller.signal }); },
  };
}

test("native collector execution identity", { timeout: 20_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "plow-collector-context-"));
  const previousState = process.env.OPENCLAW_STATE_DIR, previousConfig = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
  t.after(async () => {
    if (previousState === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = previousState;
    if (previousConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH; else process.env.OPENCLAW_CONFIG_PATH = previousConfig;
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await writeFile(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg));

  await t.test("canonical owner collects and replays without changing the raw group or fingerprint", async () => {
    const f = fixture("canonical");
    const accepted = await f.spawn();
    assert.deepEqual(await f.wait(), { runId: f.runId, status: "done", result: "Synthetic comparison complete.",
      sessionKey: f.childSession, label: options.label });
    assert.deepEqual(await f.spawn(), accepted);
    assert.equal(f.calls, 1, "replay must reuse the existing native collector");
    assert.equal(f.captured?.groupId, `swarm:${rawSession}:fixture-turn-canonical`);
    // Frozen compatibility value for the original raw-session spawn input.
    assert.equal(f.captured?.[fingerprint], "sha256:0e0936b7828d3584ff934e421a4c50bbe24f07ade8a3ead956926ac0b1cf0382");
    const stored = loadRuns().get(f.runId);
    assert.equal(stored.swarmRequesterSessionKey, canonicalSession);
    assert.equal(stored.swarmLaunchReplayKey, "fixture-code-canonical:spawn-one");
    await assert.rejects(f.spawn("A different task."), /replay request does not match/);
    assert.equal(f.calls, 1);
  });

  await t.test("a foreign canonical session or agent cannot collect the owner's child", async () => {
    const f = fixture("foreign"); await f.spawn();
    await assert.rejects(f.wait({ ...f.ctx, runSessionKey: "agent:main:plow:chat:group:cht_other" }), /not_owner/);
    await assert.rejects(f.wait({ ...f.ctx, agentId: "plow-worker" }), /not_owner/);
    assert.equal(f.calls, 1);
  });

  await t.test("missing host identity falls back to the raw owner and never guesses a binding", async () => {
    const canonical = fixture("no-host"); await canonical.spawn();
    await assert.rejects(canonical.wait({ ...canonical.ctx, runSessionKey: undefined }), /not_owner/);
    const legacy = fixture("legacy", rawSession);
    const context = { ...legacy.ctx, runSessionKey: undefined };
    const accepted = await legacy.spawn(prompt, context);
    assert.equal((await legacy.wait(context)).status, "done");
    assert.deepEqual(await legacy.spawn(prompt, context), accepted);
    assert.equal(legacy.calls, 1);
  });

  await t.test("aborted calls cannot spawn or expose completed or pending results", async () => {
    const before = fixture("abort-before"); before.controller.abort();
    await assert.rejects(before.spawn(), { name: "AbortError" }); assert.equal(before.calls, 0);
    const during = fixture("abort-during"); during.afterSpawn(() => during.controller.abort());
    await assert.rejects(during.spawn(), { name: "AbortError" }); assert.equal(during.calls, 1);
    await assert.rejects(during.wait(), /wait aborted/);
    const pending = fixture("abort-pending", canonicalSession, true); await pending.spawn();
    const waiting = pending.wait(); pending.controller.abort();
    await assert.rejects(waiting, /wait aborted/);
  });

  await t.test("native source guards fence both new launches and persisted replays", async () => {
    const before = fixture("source-before"); before.revoke();
    await assert.rejects(before.spawn(), /fixture source revoked/); assert.equal(before.calls, 0);
    const during = fixture("source-during"); during.afterSpawn(() => during.revoke());
    await assert.rejects(during.spawn(), /fixture source revoked/); assert.equal(during.calls, 1);
    const replay = fixture("source-replay"); await replay.spawn(); replay.revoke();
    await assert.rejects(replay.spawn(), /fixture source revoked/); assert.equal(replay.calls, 1);
  });
});
