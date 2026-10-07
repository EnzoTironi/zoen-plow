import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import entry, { sendText } from "../plugin/index.ts";

// Use the pinned outbound queue and registered channel, including successful sends.
const { t: createEmptyPluginRegistry } = await import("/app/dist/registry-empty--vb91VWS.mjs");
const { w: setActivePluginRegistry, r: clearActivePluginRegistry } = await import("/app/dist/runtime-B0mfNCRA.mjs");

async function fixture(t: TestContext, revokeDuring?: "destination" | "route" | "adapter") {
  const root = await mkdtemp(join(tmpdir(), "plow-extension-send-"));
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
  process.env.PLOW_AGENT_TOKEN = "fixture";
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  let current = true;
  const posts: string[] = [];
  const cfg = { channels: { plow: { apiBase: "http://fixture", lineUid: "ln_fixture" } },
    plugins: { load: { paths: [new URL("../plugin/", import.meta.url).pathname] }, entries: { plow: { enabled: true } } } };
  const chat = { uid: "cht_target", status: "active", trusted: false, participants: [
    { type: "member", uid: "mem_owner", role: "owner", provider_key: "+15550000001" },
    { type: "agent", relationship: "self", line: { uid: "ln_fixture" } },
  ] };
  let destinationReads = 0;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit = {}) => {
    await Promise.resolve();
    if (options.method === "POST") { posts.push(url); return Response.json({ uid: "msg_sent" }); }
    destinationReads++;
    if (revokeDuring === "destination" || (revokeDuring === "adapter" && destinationReads > 1)) current = false;
    return Response.json(chat);
  });
  const runtime = { channel: {
    routing: { resolveAgentRoute: () => ({ agentId: "main", sessionKey: "agent:main:main" }) },
    session: { resolveStorePath: () => join(root, "sessions.json"), async updateLastRoute() {
      await Promise.resolve();
      if (revokeDuring === "route") current = false;
    } },
  } };
  const registry = createEmptyPluginRegistry();
  t.after(() => clearActivePluginRegistry());
  entry.register({ registrationMode: "full", runtime, logger: { info() {} }, on() {}, registerTool() {},
    registerChannel({ plugin }: { plugin: object }) {
      registry.channels.push({ pluginId: "plow", plugin, source: "fixture" });
      setActivePluginRegistry(registry);
    },
  } as any);
  const assertCurrent = () => { if (!current) throw new Error("invocation revoked"); };
  return { cfg, chat, runtime, assertCurrent, posts };
}

for (const phase of ["destination", "route", "adapter"] as const) test(`extension send checks invocation after awaited ${phase} preparation`, async t => {
  const { cfg, chat, runtime, assertCurrent, posts } = await fixture(t, phase);
  await assert.rejects(sendText(cfg, chat.uid, "Ready", runtime as any, assertCurrent), /invocation revoked/);
  assert.deepEqual(posts, [], "a revoked extension invocation must not reach the provider");
});

for (const guarded of [false, true]) test(`extension send preserves a confirmed ${guarded ? "tool invocation" : "journal-owned background"} send`, async t => {
  const { cfg, chat, runtime, assertCurrent, posts } = await fixture(t);
  assert.deepEqual(await sendText(cfg, chat.uid, "Ready", runtime as any, guarded ? assertCurrent : undefined), { messageId: "msg_sent" });
  assert.deepEqual(posts, ["http://fixture/v1/chats/cht_target/messages"]);
});
