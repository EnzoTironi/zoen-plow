import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import entry from "../plugin/index.ts";
import { updateExperience } from "../plugin/experience-state.ts";
import { scheduler } from "../plugin/scheduler.ts";

// Load the image runtime explicitly: the mounted declaration package is pristine.
const { sendDurableMessageBatch } = await import("/app/dist/plugin-sdk/channel-outbound.js");
const { t: createEmptyPluginRegistry } = await import("/app/dist/registry-empty--vb91VWS.mjs");
const { w: setActivePluginRegistry, r: clearActivePluginRegistry } = await import("/app/dist/runtime-B0mfNCRA.mjs");
const { T: setReplyPayloadMetadata } = await import("/app/dist/reply-payload-B2ZQhznY.mjs");
const { d: patchSessionEntryCore, s: loadSessionEntry } = await import("/app/dist/session-accessor.sqlite-entry-UCl9kr-O.mjs");
// Fixture seeds need no background maintenance worker after their temp root ends.
const replaceSessionEntry = (scope: object, value: object) => patchSessionEntryCore(scope, () => value, { fallbackEntry: value, replaceEntry: true, skipMaintenance: true });
const { f: loadPendingDelivery, o: failDeliveryBeforePlatformSend } = await import("/app/dist/delivery-queue-storage-j8JnhuyK.mjs");
const { t: drainPendingDeliveriesCore } = await import("/app/dist/delivery-queue-recovery-Dud1kzH1.mjs");
const { n: deliverOutboundPayloadsInternal } = await import("/app/dist/deliver-Bz2WIVCS.mjs");
const notice = (sources: unknown) => ({ version: 1, sources });
const paired = notice([["job-one", "occurrence-one"], ["job-two", "occurrence-two"]]);
const cases = [
  { name: "allowed paired notice", notice: paired, expected: "sent" },
  { name: "first source paused", notice: paired, pause: "cht_one", expected: "suppressed" },
  { name: "second source paused", notice: paired, pause: "cht_two", expected: "suppressed" },
  { name: "second source paused during preparation", notice: paired, latePause: true, expected: "suppressed" },
  { name: "missing second job", notice: notice([["job-one", "occurrence-one"], ["missing", "occurrence-two"]]), expected: "failed" },
  { name: "missing occurrence identity", notice: notice([["job-one", ""]]), expected: "failed" },
  { name: "empty notice batch", notice: notice([]), expected: "failed" },
  { name: "malformed notice shape", notice: "invalid", expected: "failed" },
  { name: "ordinary heartbeat with another source paused", pause: "cht_two", expected: "sent" },
  { name: "queued failure alert during global pause", intent: "plow-cron-alert:v1:job-one:1791370000000", pause: "owner", expected: "suppressed" },
  { name: "ordinary direct reply during global pause", pause: "owner", direct: true, expected: "sent" },
  { name: "unmarked channel data during another source pause", channelData: { unrelated: "fixture" }, pause: "cht_two", expected: "sent" },
  { name: "notice writer replaced during preparation", notice: paired, replacedWriter: true, expected: "failed" },
  { name: "stored notice recovers after a pre-send fault", notice: paired, recover: true, expected: "sent" },
  { name: "stored notice respects a source paused before recovery", notice: paired, recover: true, pauseBeforeRecovery: "cht_two", expected: "suppressed" },
  { name: "stored notice respects a writer replaced before recovery", notice: paired, recover: true, replaceBeforeRecovery: true, expected: "failed" },
  { name: "notice media retains the original delivery owner", notice: paired, media: true, expected: "sent" },
  { name: "notice source paused during media upload", notice: paired, media: true, pauseOnUpload: true, expected: "suppressed" },
  { name: "notice aborted during media upload", notice: paired, media: true, abortOnUpload: true, expected: "failed" },
  { name: "notice aborted by the dispatch callback", notice: paired, abortOnDispatch: true, expected: "failed" },
] as const;

for (const item of cases) test(`native queued notification: ${item.name}`, async t => {
  const root = await mkdtemp(join(tmpdir(), "plow-scheduled-notice-"));
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
  process.env.PLOW_AGENT_TOKEN = "fixture";
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  t.after(() => clearActivePluginRegistry());
  const account = { accountId: "chat", apiBase: "http://fixture", lineUid: "ln_fixture" };
  const cfg = { channels: { plow: { apiBase: account.apiBase, lineUid: account.lineUid, threadTrust: "untrusted" } }, agents: { entries: { main: { identity: { name: "Cedar" } } }, defaults: {} },
    plugins: { load: { paths: [new URL("../plugin/", import.meta.url).pathname] }, entries: { plow: { enabled: true } } } };
  await writeFile(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg));
  const sessionKey = "agent:main:main", sessionId = "native-notice-session", deliveryId = "native-pending-final";
  const storePath = join(root, "agents/main/sessions/sessions.json");
  const scope = { storePath, sessionKey };
  const session = { sessionId, updatedAt: Date.now(), status: "running", abortedLastRun: true, lifecycleRevision: 1, activeWriterRunId: "writer-one", permissionMode: "guarded",
    pendingFinalDelivery: { kind: "replayable", text: "Synthetic notification", createdAt: Date.now(), intentId: "native-final", context: { channel: "plow", to: "plow-heartbeat", accountId: "chat" }, deliveries: [{ id: deliveryId, state: "prepared" }] } };
  if ("notice" in item) { await mkdir(join(root, "agents/main/sessions"), { recursive: true }); await replaceSessionEntry(scope, session); }
  const chat = { uid: "cht_home", status: "active", trusted: false, participants: [
    { type: "member", uid: "mem_owner", role: "owner", provider_key: "+15550000001" },
    { type: "agent", relationship: "self", line: { uid: account.lineUid } },
  ] };
  const posts: string[] = [];
  const recoveryLog: string[] = [];
  const controller = new AbortController();
  const mediaUrl = join(root, "media/pixel.png");
  if ("media" in item) {
    await mkdir(join(root, "media"), { recursive: true });
    await writeFile(mediaUrl, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWf8AAAAASUVORK5CYII=", "base64"));
  }
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit = {}) => {
    if (options.method === "PUT") {
      if ("pauseOnUpload" in item) await updateExperience({ account, conversation: "cht_two" }, () => {}, state => { state.paused = true; });
      if ("abortOnUpload" in item) controller.abort(new Error("Fixture revoked during upload"));
      return new Response();
    }
    if (options.method === "POST" && url.endsWith("/attachments")) return Response.json({ uid: "att_fixture", upload_url: "http://fixture/upload", upload_headers: {} });
    if (options.method === "POST") { posts.push(url); return Response.json({ uid: "msg_sent" }); }
    if ("latePause" in item && item.latePause && url.endsWith("/chats/cht_home")) {
      await updateExperience({ account, conversation: "cht_two" }, () => {}, state => { state.paused = true; });
    }
    if ("replacedWriter" in item && url.endsWith("/chats/cht_home")) await replaceSessionEntry(scope, { ...session, activeWriterRunId: "writer-two" });
    return Response.json(url.endsWith("/chats") ? { data: [chat], has_more: false } : chat);
  });
  t.mock.method(scheduler, "request", async (method: string, params: any) => {
    assert.equal(method, "cron.get");
    if (!["job-one", "job-two"].includes(params.id)) throw new Error("unknown scheduled job");
    return { id: params.id, enabled: false, owner: { agentId: "main", accountId: "chat", sessionKey: `agent:main:plow:chat:group:${params.id === "job-one" ? "cht_one" : "cht_two"}` },
      delivery: { channel: "plow", accountId: "chat", to: chat.uid } };
  });
  const registry = createEmptyPluginRegistry();
  entry.register({ registrationMode: "full", runtime: { channel: {} }, logger: { info() {} }, on() {}, registerTool() {},
    registerChannel({ plugin }: { plugin: object }) {
      registry.channels.push({ pluginId: "plow", plugin, source: "fixture" }); setActivePluginRegistry(registry);
    },
  } as any);
  if ("pause" in item) await updateExperience({ account, conversation: item.pause }, () => {}, state => { state.paused = true; });
  const intents: string[] = [];
  const payload = { text: "Synthetic notification", ...("media" in item ? { mediaUrl } : {}), ...("notice" in item ? { channelData: { sibling: "preserved", plowCronNotice: item.notice } } : "channelData" in item ? { channelData: item.channelData } : {}) };
  if ("notice" in item) setReplyPayloadMetadata(payload, {
    pendingFinalDeliveryCompletion: { storePath, sessionKey, sessionId, intentId: "native-final", deliveryId },
    sessionWriterDeliveryAuthority: { storePath, sessionKey, expectedSessionId: sessionId, expectedLifecycleRevision: 1, expectedWriterRunId: "writer-one" },
  });
  const result = await sendDurableMessageBatch({ cfg, channel: "plow", accountId: "chat", to: "direct" in item ? chat.uid : "plow-heartbeat",
    payloads: [payload], ...("intent" in item ? { deliveryIntentId: item.intent } : {}),
    signal: controller.signal,
    ...("abortOnDispatch" in item ? { onPlatformSendDispatch: async () => { controller.abort(new Error("Fixture revoked at dispatch")); } } : {}),
    onDeliveryIntent(value) { intents.push(value.id); if ("recover" in item) throw new Error("Fixture failure after queue publication, before adapter dispatch"); },
  });
  if ("recover" in item) {
    assert.equal(result.status, "failed", "the initial send fails before the provider POST");
    assert.equal(posts.length, 0);
    const stored = await loadPendingDelivery(deliveryId, root);
    assert.equal(stored.id, deliveryId);
    assert.equal(stored.deliveryCompletion.deliveryId, deliveryId);
    assert.deepEqual(stored.preparedBatch.entries[0].payload.channelData, payload.channelData, "SQLite preparation retains independent notice provenance and sibling data");
    if ("pauseBeforeRecovery" in item) await updateExperience({ account, conversation: item.pauseBeforeRecovery }, () => {}, state => { state.paused = true; });
    if ("replaceBeforeRecovery" in item) await replaceSessionEntry(scope, { ...loadSessionEntry(scope), activeWriterRunId: "writer-two" });
    // The fixture knows the adapter never started. Close that producer through
    // the native pre-send failure API before a new recovery owner takes custody.
    await failDeliveryBeforePlatformSend(deliveryId, "Fixture stopped before adapter dispatch", root, stored.producerClaimId);
    // Rehydrate from SQLite through the native recovery API. Bypassing backoff
    // changes timing only; admission, ownership and physical dispatch stay real.
    await drainPendingDeliveriesCore({ cfg, stateDir: root, drainKey: root, logLabel: "fixture recovery", log: { info(value: string) { recoveryLog.push(value); }, warn(value: string) { recoveryLog.push(value); }, error(value: string) { recoveryLog.push(value); } },
      selectEntry: () => ({ match: true, bypassBackoff: true }) }, deliverOutboundPayloadsInternal);
  } else assert.equal(result.status, item.expected, item.name);
  assert.equal(posts.length, item.expected === "sent" ? 1 : 0, `physical provider sends establish the gate: ${recoveryLog.join("; ")}`);
  if ("intent" in item) assert.deepEqual(intents, [item.intent], "native queue identity retains host provenance");
  if ("notice" in item) {
    assert.deepEqual(intents, [deliveryId], "pending-final ownership keeps the native queue identity");
    if (item.expected !== "failed") assert.equal(loadSessionEntry(scope).pendingFinalDelivery.deliveries[0].state,
      item.expected === "sent" ? "delivered" : "suppressed", "original native completion is settled");
  }
});
