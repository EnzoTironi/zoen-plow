// Run separately: this uses the real pinned gateway on port 3000 and local
// Plow/model fixtures. No real phone, email, Mac or Agent Index is contacted.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { describeImageFile } from "openclaw/plugin-sdk/media-understanding-runtime";
import { renderConfig, syncConfig } from "../boot/config.ts";
import { composePrompt } from "../boot/prompt.ts";
import { agentDefinitionSchema } from "../boot/extensions.ts";
import { personalitySchema } from "../boot/personality.ts";
import { healthy } from "../boot/health.ts";
import { notificationControl } from "../plugin/experience.ts";
import { readExperience, updateExperience } from "../plugin/experience-state.ts";
import { scheduler, type Scheduler } from "../plugin/scheduler.ts";
import type { Account, Message } from "../plugin/transport.ts";

const { WebSocketServer } = createRequire(new URL("../plugin/package.json", import.meta.url))("ws");
const root = await mkdtemp(join(tmpdir(), "plow-gateway-acceptance-"));
process.env.OPENCLAW_STATE_DIR = root;
process.env.OPENCLAW_CONFIG_PATH = join(root, "openclaw.json");
process.env.OPENCLAW_INCLUDE_ROOTS = root;
process.env.PLOW_AGENT_TOKEN = "offline-acceptance";
process.env.OPENCLAW_GATEWAY_PASSWORD = randomBytes(32).toString("hex");
delete process.env.OPENCLAW_GATEWAY_TOKEN;
const owner = { type: "member" as const, uid: "mem_owner", role: "owner", display_name: "Pat", provider_key: "+15550000001" };
const guest = { ...owner, uid: "mem_guest", role: "member", display_name: "Lee", provider_key: "+15550000002" };
const self = { type: "agent" as const, relationship: "self", line: { uid: "ln_acceptance", display_name: "Cedar" } };
const home = { uid: "cht_home", status: "active", trusted: false, participants: [owner, self] };
const group = { ...home, uid: "cht_group", display_name: "Dinner planning", participants: [owner, guest, self] };
const alertDestination = { ...group, uid: "cht_alert_destination", display_name: "Alert destination" };
const chats = [home, group, alertDestination];
const inbound: Message[] = [], outbound: { chat: string; body: string; uid: string }[] = [];
const typing: { chat: string; action: string }[] = [];
const modelRequests: Record<string, any>[] = [];
const callsIssued = new Set<string>();
const cancelledTasks: string[] = [];
const safetyOutcomes: object[] = [];
const evidence: { check: string; result: string }[] = [];
let child: ChildProcess | undefined, log = "";
let completed = false, safetyHeartbeatAt = 0, autoDisableInterruptStarted = false;
let releaseReminder: (() => void) | undefined;
let cancelReminderClosed = false, cancelReminderStarted = false;
let releaseWorker: (() => void) | undefined, cancelWorkerClosed = false, workerFinished = false;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const record = (check: string, result: string) => { evidence.push({ check, result }); console.log(`PASS ${check}: ${result}`); };
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Gateway exited during ${label}\n${log.slice(-6000)}`); await delay(250); }
  throw new Error(`Timed out: ${label}\nFixture state: ${JSON.stringify({ cancelReminderClosed, cancelWorkerClosed, outbound, callsIssued: [...callsIssued] })}\n${log.slice(-6000)}`);
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture");
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const json = (value: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
  if (url.pathname === "/v1/chat/completions") {
    modelRequests.push(body);
    const text = JSON.stringify(body.messages);
    // The pinned runtime also appends user-role internal context. It can quote
    // older requests; choose the actual turn instead of treating that as a command.
    const latestUser = JSON.stringify(body.messages.findLast((message: any) => message.role === "user" && !JSON.stringify(message.content).includes("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>"))?.content ?? "");
    const scheduled = latestUser.includes("[cron:");
    if (scheduled && latestUser.includes("AUTO_DISABLED_INTERRUPT")) {
      autoDisableInterruptStarted = true;
      await new Promise<void>(resolve => res.once("close", () => resolve())); return;
    }
    if (scheduled && latestUser.includes("AUTO_DISABLED_RUN")) { res.statusCode = 400; json({ error: { message: "Fixture permanent model rejection" } }); return; }
    if (!scheduled && latestUser.includes("AUTO_DISABLED_SAFETY")) safetyHeartbeatAt = Date.now();
    if (!scheduled && latestUser.includes("SAFETY_FALLBACK_ACCEPTANCE")) safetyHeartbeatAt = Date.now();
    const worker = body.messages.some((message: any) => message.role === "system" && JSON.stringify(message.content).includes("PLOW_EXECUTION_WORKER"));
    if (scheduled && latestUser.includes("CANCEL_CRON_ACCEPTANCE")) {
      cancelReminderStarted = true;
      await new Promise<void>(resolve => { res.once("close", () => { cancelReminderClosed = true; resolve(); }); });
    }
    if (worker && text.includes("WORKER_HELD")) await new Promise<void>(resolve => { releaseWorker = resolve; });
    if (worker && text.includes("WORKER_CANCEL_HELD")) await new Promise<void>(resolve => { res.once("close", () => { cancelWorkerClosed = true; resolve(); }); });
    if (res.destroyed) return;
    if (text.includes("IN_FLIGHT_ACCEPTANCE")) await new Promise<void>(resolve => { releaseReminder = resolve; });
    let call: { name: string; arguments: string; id: string } | undefined;
    const toolResults = body.messages.filter((message: any) => message.role === "tool").flatMap((message: any) => {
      try { return [JSON.parse(typeof message.content === "string" ? message.content : message.content.map((part: any) => part.text ?? "").join("\n"))]; } catch { return []; }
    });
    for (const result of toolResults) if (result.status === "cancelled" && result.cancelled === true && typeof result.taskId === "string") cancelledTasks.push(result.taskId);
    const taskList = toolResults.flatMap((result: any) => result.action === "list" ? result.tasks ?? [] : []);
    const activeTask = taskList.findLast((task: any) => task.runtime === "subagent" && ["queued", "running"].includes(task.status));
    const hasResult = (id: string) => callsIssued.has(id);
    if (!worker && !scheduled && latestUser.includes("CREATE_REMINDER_ACCEPTANCE") && !hasResult("fixture-create-reminder")) call = { id: "fixture-create-reminder", name: "automations", arguments: JSON.stringify({ action: "add", job: { name: "Created through native tool", sessionTarget: "current", deleteAfterRun: false, schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, payload: { kind: "agentTurn", message: "REMINDER_ACCEPTANCE: remind Pat to check the dinner plan" } } }) };
    else if (scheduled && latestUser.includes("SCHEDULED_TOOL_GUARD") && !hasResult("fixture-scheduled-notifications")) call = { id: "fixture-scheduled-notifications", name: "plow_notifications", arguments: JSON.stringify({ action: "get", scope: "conversation", diagnostics: false }) };
    else if (scheduled && latestUser.includes("SCHEDULED_TOOL_GUARD") && !hasResult("fixture-scheduled-send")) call = { id: "fixture-scheduled-send", name: "plow_reply_to", arguments: JSON.stringify({ chat_uid: home.uid, text: "Duplicate scheduled tool send must be blocked." }) };
    else if (!worker && !scheduled && latestUser.includes("PAUSE_ACTIVE_CRON_ACCEPTANCE") && !hasResult("fixture-pause-active-cron")) call = { id: "fixture-pause-active-cron", name: "plow_notifications", arguments: JSON.stringify({ action: "pause", scope: "all", diagnostics: false }) };
    else if (!worker && text.includes("WORKER_CANCEL_START") && !hasResult("fixture-worker-cancel")) call = { id: "fixture-worker-cancel", name: "sessions_spawn", arguments: JSON.stringify({ agentId: "plow-worker", task: "WORKER_CANCEL_HELD: Analyze a hypothetical dinner plan; no secrets, messages or mutations.", mode: "run" }) };
    else if (!worker && text.includes("WORKER_STOP") && !hasResult("fixture-worker-list")) call = { id: "fixture-worker-list", name: "subagents", arguments: JSON.stringify({ action: "list" }) };
    else if (!worker && text.includes("WORKER_STOP") && activeTask && !hasResult("fixture-worker-stop")) call = { id: "fixture-worker-stop", name: "subagents", arguments: JSON.stringify({ action: "cancel", taskId: activeTask.taskId }) };
    else if (!worker && text.includes("WORKER_START") && !hasResult("fixture-worker-start")) call = { id: "fixture-worker-start", name: "sessions_spawn", arguments: JSON.stringify({ agentId: "plow-worker", task: "WORKER_HELD: Compare two hypothetical dinner times, Thursday 7 or Friday 6. Return the analysis with those facts as evidence. No secrets, messages or mutations.", mode: "run" }) };
    // Native tool follow-ups can retain a prior user envelope. Match the later
    // worker phase before that envelope's earlier paused-reply marker.
    const content = scheduled && latestUser.includes("SCHEDULED_TOOL_GUARD") ? (body.messages.some((message: any) => message.role === "tool" && JSON.stringify(message.content).includes("Return the requested reminder or result as your final text")) ? "Reminder: check the train timetable." : "Scheduled send guard did not return its delivery instruction.")
      : !scheduled && latestUser.includes("AUTO_DISABLED_SAFETY") ? (latestUser.includes("AUTO_DISABLED_SAFETY_PAUSED") ? "Auto-disabled notice from the paused source room." : "Auto-disabled notice from the unpaused source room.")
      : !scheduled && latestUser.includes("SAFETY_FALLBACK_ACCEPTANCE") ? (latestUser.includes("SAFETY_FALLBACK_ACCEPTANCE_DESTINATION") ? "Safety notice for the paused destination." : latestUser.includes("SAFETY_FALLBACK_ACCEPTANCE_PAUSED") ? "Safety notice from the paused source room." : "Safety notice from the unpaused source room.")
      : worker ? JSON.stringify({ status: "completed", summary: "Thursday at 7 is one option; Pat still needs to confirm.", evidence: ["The assignment supplies Thursday 7 and Friday 6 as options."] })
      : text.includes("WORKER_STOP") ? "Cancelled the background analysis."
      : text.includes("WORKER_CANCEL_START") ? "Started the next background analysis."
      : text.includes("WORKER_PING") && !workerFinished ? "I'm here. The background analysis is still running."
      : workerFinished && text.includes("WORKER_START") ? "The analysis is ready: Thursday at 7 is one option; Pat still needs to confirm."
      : text.includes("WORKER_START") ? "Started the background analysis."
      : !scheduled && latestUser.includes("PAUSE_ACTIVE_CRON_ACCEPTANCE") ? (toolResults.some(result => result.status === "complete" && result.scheduledDeliveryHere === "paused") ? "Scheduled notifications are paused; direct replies still work." : "Notification pause did not complete.")
      : !scheduled && latestUser.includes("CREATE_REMINDER_ACCEPTANCE") ? "Created the reminder in this conversation."
      : latestUser.includes("PAUSED_REPLY_ACCEPTANCE") ? "Direct replies still work while reminders are paused."
      : text.includes("REMINDER_ACCEPTANCE") ? "Reminder: check the dinner plan."
      : text.includes("coordinate dinner") ? "Thursday at 7 works. I still need Pat's confirmation."
      : text.includes("ambient-silence-check") ? "NO_REPLY" : "An image is attached.";
    if (!body.stream) { json({ id: "offline-model", choices: [{ message: { role: "assistant", content }, finish_reason: "stop", index: 0 }], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } }); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (call) {
      callsIssued.add(call.id);
      res.write(`data: ${JSON.stringify({ id: "offline-model", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "offline-model", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } })}\n\n`);
      res.end("data: [DONE]\n\n"); return;
    }
    for (const delta of [{ role: "assistant", content }, {}]) res.write(`data: ${JSON.stringify({ id: "offline-model", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: Object.keys(delta).length ? null : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } })}\n\n`);
    res.end("data: [DONE]\n\n"); return;
  }
  if (url.pathname === "/v1/chats") { json({ data: chats, has_more: false }); return; }
  if (url.pathname === "/v1/ws/ticket") { json({ ticket: "offline-ticket" }); return; }
  const chat = chats.find(value => url.pathname.startsWith(`/v1/chats/${value.uid}`));
  if (chat && url.pathname.endsWith("/messages")) {
    if (req.method === "POST") { const message = { chat: chat.uid, body: body.body, uid: `msg_out_${outbound.length}` }; outbound.push(message); console.log(`FIXTURE_DELIVERY ${JSON.stringify(message)}`); json(message); }
    else json({ data: inbound.filter(message => (message as Message & { chat?: string }).chat === chat.uid).toReversed(), has_more: false });
    return;
  }
  if (chat && url.pathname.endsWith("/typing")) { typing.push({ chat: chat.uid, action: body.action }); json({}); return; }
  if (chat) { json(chat); return; }
  if (["/v1/agent", "/v1/agents/me"].includes(url.pathname)) { json({ agent: { name: "Cedar" }, line: self.line, chats }); return; }
  res.statusCode = 404; json({ error: "Unknown fixture path" });
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert.ok(address && typeof address !== "string");
const apiBase = `http://127.0.0.1:${address.port}`;
const ws = new WebSocketServer({ server });
const account: Account = { accountId: "chat", apiBase, lineUid: self.line.uid };
const definition = agentDefinitionSchema.parse({ version: 1, persona: { role: "Dinner coordinator", purpose: "Find a shared dinner time", voice: "Warm and direct", sliders: { "playful-serious": 80 } } });
const uiOrigin = process.env.PLOW_ACCEPTANCE_ORIGIN ?? "http://localhost:3001";
const cfg = renderConfig({ agent: { name: "Cedar", web_url: uiOrigin }, line: self.line, chats }, apiBase, definition);
// A separate send policy cancels only the primary alert destination. This
// produces a proven not-sent fallback without pausing its scopes or introducing
// provider uncertainty, which correctly prohibits a blind fallback/replay.
const noticePolicy = join(root, "notice-policy");
await mkdir(noticePolicy);
await writeFile(join(noticePolicy, "openclaw.plugin.json"), JSON.stringify({ id: "acceptance-notice-policy", configSchema: { type: "object", additionalProperties: false } }));
await writeFile(join(noticePolicy, "index.mjs"), `export default { id: "acceptance-notice-policy", register(api) { api.on("message_sending", event => event.to === "${alertDestination.uid}" ? { cancel: true } : undefined); } };\n`);
cfg.plugins.load.paths.push(noticePolicy);
cfg.plugins.entries["acceptance-notice-policy"] = { enabled: true, hooks: { allowConversationAccess: true } };
cfg.agents.defaults.workspace = join(root, "workspace");
cfg.agents.entries["plow-worker"].workspace = join(root, "workspace-worker");
await mkdir(cfg.agents.defaults.workspace);
await mkdir(cfg.agents.entries["plow-worker"].workspace);
await writeFile(join(cfg.agents.entries["plow-worker"].workspace, "AGENTS.md"), await readFile(new URL("../prompt/WORKER.md", import.meta.url), "utf8"));
await writeFile(join(cfg.agents.defaults.workspace, "AGENTS.md"), composePrompt(await readFile(new URL("../prompt/BASE.md", import.meta.url), "utf8"), "", definition));
await syncConfig(cfg, process.env.OPENCLAW_CONFIG_PATH, root);
const auth = { Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_PASSWORD}` };
const url = "http://127.0.0.1:3000/plugins/plow/personality/api";
const rpc = (method: string, params: Record<string, unknown>) => callGatewayFromCli(method, { url: "ws://127.0.0.1:3000", password: process.env.OPENCLAW_GATEWAY_PASSWORD, timeout: "10000", json: true }, params, { scopes: ["operator.admin"] });
async function start(afterIntentionalCrash = false) {
  log = "";
  child = spawn(process.execPath, ["/app/openclaw.mjs", "gateway"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", value => { log = (log + value.toString()).slice(-128_000); });
  child.stderr?.on("data", value => { log = (log + value.toString()).slice(-128_000); });
  await until(() => healthy(), "gateway readiness");
  if (afterIntentionalCrash && log.includes("restart-loop breaker tripped")) await rpc("channels.start", { channel: "plow" });
  await until(() => ws.clients.size > 0, "Plow fixture connection");
  await until(async () => { try { await readFile(join(root, "plow-checkpoints", group.uid)); return true; } catch { return false; } }, "Plow history initialization");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  const timer = setTimeout(() => child?.kill("SIGKILL"), 35_000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function settings(value?: object) {
  return await fetch(url, { headers: { ...auth, ...(value ? { "Content-Type": "application/json", "X-Agent-Personality": "1", Origin: "http://localhost:3001" } : {}) }, ...(value ? { method: "POST", body: JSON.stringify(value) } : {}) });
}
async function message(chat: string, body: string, sender = guest) {
  const value = { chat, uid: `msg_in_${inbound.length}`, direction: "inbound", sender, body, created_at: new Date().toISOString(), attachments: [] };
  inbound.push(value);
  for (const socket of ws.clients) socket.send(JSON.stringify({ event_type: "message_received", chat_id: chat, data: { message: value } }));
  return value.uid;
}
try {
  assert.equal(await healthy(), false); await start();
  record("readiness", "parked/unstarted gateway is unhealthy; ready gateway is healthy");
  assert.equal((await fetch(url)).status, 401);
  const profile = await (await settings()).json();
  assert.equal(profile.sliders["playful-serious"], 80);
  const sliders = personalitySchema.parse({ "execute-collaborate": 0, "polite-unfiltered": 100 });
  assert.equal((await settings({ action: "preview", sliders })).status, 200);
  assert.equal((await (await settings()).json()).saved, false);
  assert.equal((await settings({ action: "save", sliders, revision: profile.revision })).status, 200);
  assert.equal((await settings({ action: "save", sliders: { ...sliders, "playful-serious": 0 }, revision: profile.revision })).status, 409);
  assert.equal((await fetch(url, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "X-Agent-Personality": "1", Origin: "https://foreign.invalid" }, body: JSON.stringify({ action: "reset" }) })).status, 403);
  record("personality access and persistence", "unauthenticated and foreign-origin writes rejected; preview does not save; stale edit rejected");

  const ambient = await message(group.uid, "Pat: Lee, how was your day? ambient-silence-check");
  await until(() => log.includes(`completed chat=${group.uid} message=${ambient}`), "quiet group turn");
  assert.equal(outbound.length, 0);
  assert.equal(typing.filter(value => value.chat === group.uid).length, 0);
  record("quiet group delivery", "real dispatcher consumes NO_REPLY without sending text, fallback or typing indicators");
  await message(group.uid, "Cedar, coordinate dinner. Lee is free Thursday after 7.");
  await until(() => outbound.length === 1, "useful group response");
  assert.equal(outbound[0].chat, group.uid); assert.match(outbound[0].body, /Pat's confirmation/);
  record("group reply route", "one final delivered to its source group with participant context");

  const png = join(root, "pixel.png");
  await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWf8AAAAASUVORK5CYII=", "base64"));
  const vision = await describeImageFile({ filePath: png, cfg, agentId: "main", activeModel: { provider: "plow", model: "z-ai/glm-5.2" }, mime: "image/png", prompt: "Describe this image", timeoutMs: 20_000 });
  assert.equal(vision.model, "anthropic/claude-sonnet-5");
  assert.ok(modelRequests.some(value => value.model === vision.model && JSON.stringify(value.messages).includes("image_url")));
  record("vision routing", "native image understanding sends image bytes to Sonnet while GLM remains the text model");

  const context = { sessionKey: "agent:main:main", agentId: "main", assertInvocationCurrent() {} };
  const scope = { account, conversation: home.uid };
  await message(home.uid, "CREATE_REMINDER_ACCEPTANCE: remind me to check the dinner plan in an hour", owner);
  let created: any;
  await until(async () => {
    const result: any = await rpc("cron.list", { includeDisabled: true });
    created = result.jobs.find((value: any) => value.name === "Created through native tool");
    return !!created;
  }, "automation created by the native tool from an authenticated owner turn");
  const createdView: any = await rpc("cron.get", { id: created.id });
  assert.equal(createdView.owner.accountId, "chat");
  const beforeCreatedRun = outbound.filter(value => value.body.startsWith("Reminder:")).length;
  await rpc("cron.run", { id: created.id, mode: "force" });
  await until(() => outbound.filter(value => value.chat === home.uid && value.body.startsWith("Reminder:")).length === beforeCreatedRun + 1, "captured chat account executes and delivers the tool-created reminder");
  await until(async () => ((await rpc("cron.runs", { id: created.id, limit: 10 })) as any).entries?.some((entry: any) => entry.action === "finished" && entry.status === "ok"), "tool-created reminder run completion");
  await notificationControl(scheduler, scope, context, "pause", false);
  assert.equal((await rpc("cron.get", { id: created.id }) as any).enabled, false);
  await notificationControl(scheduler, scope, context, "resume", false);
  assert.equal((await rpc("cron.get", { id: created.id }) as any).enabled, true);
  await rpc("cron.run", { id: created.id, mode: "force" });
  await until(() => outbound.filter(value => value.chat === home.uid && value.body.startsWith("Reminder:")).length === beforeCreatedRun + 2, "pause/resume preserves the creator's authenticated account for the next run");
  await until(async () => ((await rpc("cron.runs", { id: created.id, limit: 10 })) as any).entries?.filter((entry: any) => entry.action === "finished" && entry.status === "ok").length === 2, "resumed tool-created reminder run completion");
  await rpc("cron.remove", { id: created.id });
  record("native automation creation and execution", "authenticated inbound creation preserves Plow origin and chat account; each forced run delivers once, including after pause/resume");
  const guarded: any = await rpc("cron.add", { name: "Scheduled send guard", agentId: "main", sessionKey: "agent:main:main", enabled: true,
    schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, sessionTarget: "isolated", deleteAfterRun: false,
    payload: { kind: "agentTurn", message: "SCHEDULED_TOOL_GUARD: check the train timetable." },
    delivery: { mode: "announce", channel: "plow", to: home.uid, accountId: "chat" } });
  const guardBefore = outbound.length;
  await rpc("cron.run", { id: guarded.id, mode: "force" });
  await until(() => outbound.slice(guardBefore).some(value => value.body === "Reminder: check the train timetable."), "native scheduled send denial redirects the final text through scheduler delivery");
  for (const id of ["fixture-scheduled-notifications", "fixture-scheduled-send"]) {
    // The pinned provider normalizes these call IDs to alphanumeric strings.
    const result = modelRequests.flatMap(value => value.messages).find((value: any) => value.role === "tool" && value.tool_call_id === id.replaceAll("-", ""));
    assert.ok(result, `native denial receipt exists for ${id}`);
    assert.match(JSON.stringify(result.content), /Return the requested reminder or result as your final text/);
    assert.match(JSON.stringify(result.content), /scheduled|scheduler/i);
  }
  assert.ok(!outbound.some(value => value.body.includes("Duplicate scheduled tool send")));
  assert.equal(outbound.slice(guardBefore).filter(value => value.body === "Reminder: check the train timetable.").length, 1);
  await rpc("cron.remove", { id: guarded.id });
  record("scheduled tool send guard", "detached notification lookup and direct send both return native denials with final-text/scheduler guidance; the scheduler delivers one useful reminder");

  const job: any = await rpc("cron.add", { name: "Acceptance reminder", agentId: "main", sessionKey: context.sessionKey, enabled: true, deleteAfterRun: false, schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "REMINDER_ACCEPTANCE: remind Pat to check the dinner plan", toolsAllow: [] }, delivery: { mode: "announce", channel: "plow", to: home.uid, accountId: "chat" } });
  for (const fault of ["lost disable response", "revoked invocation"] as const) {
    let revoked = false;
    const faultContext = { ...context, assertInvocationCurrent() { if (revoked) throw new Error(fault); } };
    const faultGateway: Scheduler = { async request(method, params) {
      const result = await scheduler.request(method, params);
      if (method === "cron.update" && (params.patch as { enabled?: boolean })?.enabled === false) {
        if (fault === "lost disable response") throw new Error(fault);
        revoked = true;
      }
      return result;
    } };
    await assert.rejects(notificationControl(faultGateway, scope, faultContext, "pause", false), new RegExp(fault));
    assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, false);
    assert.ok((await readExperience(scope)).suspendedJobs[0].pendingDefinition);
    await notificationControl(scheduler, scope, context, "resume", false);
    assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, true);
    assert.deepEqual((await readExperience(scope)).suspendedJobs, []);
    record(fault, "native disabled definition reconciles with the persisted intent; a fresh invocation resumes it once");
  }
  await notificationControl(scheduler, scope, context, "pause", false);
  let enableRequests = 0;
  const lostResume: Scheduler = { async request(method, params) {
    const result = await scheduler.request(method, params);
    if (method === "cron.update" && (params.patch as { enabled?: boolean })?.enabled === true) {
      enableRequests++;
      if (enableRequests === 1) throw new Error("lost enable response");
    }
    return result;
  } };
  await assert.rejects(notificationControl(lostResume, scope, context, "resume", false), /lost enable response/);
  assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, true);
  assert.equal((await readExperience(scope)).paused, false, "an accepted enable must not leave its one-shot delivery gate closed");
  assert.equal((await readExperience(scope)).suspendedJobs[0].id, job.id);
  await notificationControl(lostResume, scope, context, "resume", false);
  assert.equal(enableRequests, 1);
  assert.deepEqual((await readExperience(scope)).suspendedJobs, []);
  record("lost resume response", "an accepted native enable leaves delivery open and its journal recoverable; retry reconciles without another enable");
  const allScope = { account, conversation: "owner" };
  for (const first of [scope, allScope]) {
    const second = first === scope ? allScope : scope;
    await notificationControl(scheduler, first, context, "pause", first === allScope);
    await notificationControl(scheduler, second, context, "pause", second === allScope);
    await notificationControl(scheduler, first, context, "resume", first === allScope);
    assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, false);
    assert.equal((await readExperience(second)).suspendedJobs[0].id, job.id);
    await notificationControl(scheduler, second, context, "resume", second === allScope);
    assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, true);
  }
  record("overlapping native pauses", "both room/global pause orders transfer the journal and keep the job disabled until the last scope resumes");
  await notificationControl(scheduler, scope, context, "pause", false);
  assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, false);
  await stop();
  const backup = `${root}-backup`;
  await cp(root, backup, { recursive: true });
  await rm(root, { recursive: true });
  await cp(backup, root, { recursive: true });
  await rm(backup, { recursive: true });
  await start();
  assert.equal((await readExperience(scope)).paused, true);
  assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, false);
  assert.equal((await (await settings()).json()).sliders["polite-unfiltered"], 100);
  record("restart and backup restoration", "personality, pause state, delivery checkpoints and disabled scheduler job survive a full-state backup/restore and gateway restart");
  await notificationControl(scheduler, scope, context, "resume", false);
  assert.equal((await rpc("cron.get", { id: job.id }) as any).enabled, true);
  const remindersBefore = outbound.filter(value => value.chat === home.uid && value.body.startsWith("Reminder:")).length;
  await rpc("cron.run", { id: job.id, mode: "force" });
  await until(() => outbound.filter(value => value.chat === home.uid && value.body.startsWith("Reminder:")).length === remindersBefore + 1, "scheduled model execution and phone delivery");
  await until(async () => ((await rpc("cron.runs", { id: job.id, limit: 10 })) as any).entries?.some((entry: any) => entry.action === "finished" && entry.status === "ok"), "resumed reminder run completion");
  await rpc("cron.remove", { id: job.id });
  await assert.rejects(rpc("cron.get", { id: job.id }));
  record("reminder execution and cancellation", "resumed job invokes model and delivers once to the owner; removal confirmed by scheduler");
  const pauseGateCases = [
    { name: "In-flight pause check", sessionKey: context.sessionKey, scope, check: "in-flight pause gate", result: "persisted pause blocks physical delivery from an already generating reminder even without scheduler disable/cancellation" },
    { name: "Source-room pause check", sessionKey: `agent:main:plow:chat:group:${group.uid}`, scope: { account, conversation: group.uid }, check: "source-room in-flight pause", result: "a persisted source-room pause blocks scheduled delivery to another room even after generation has begun" },
  ];
  for (const gate of pauseGateCases) {
    releaseReminder = undefined;
    const queued: any = await rpc("cron.add", { name: gate.name, agentId: "main", sessionKey: gate.sessionKey, enabled: true, deleteAfterRun: false, schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "IN_FLIGHT_ACCEPTANCE: remind Pat about dinner", toolsAllow: [] }, delivery: { mode: "announce", channel: "plow", to: home.uid, accountId: "chat" } });
    const sourceView: any = await rpc("cron.get", { id: queued.id });
    assert.equal(sourceView.owner?.sessionKey ?? sourceView.sessionKey, gate.sessionKey);
    await rpc("cron.run", { id: queued.id, mode: "force" });
    await until(() => !!releaseReminder, `${gate.name}: model request`);
    const sentBeforePause = outbound.length;
    // Isolate the physical delivery gate without disabling or aborting the job,
    // as on a partial scheduler-control failure.
    await updateExperience(gate.scope, context.assertInvocationCurrent, state => { state.paused = true; });
    releaseReminder!();
    await until(async () => ((await rpc("cron.runs", { id: queued.id, limit: 10 })) as any).entries?.some((entry: any) => entry.action === "finished"), `${gate.name}: paused run completion`);
    assert.equal(outbound.length, sentBeforePause, `${gate.name}: the paused scope gates destination delivery`);
    if (gate.scope.conversation === home.uid) {
      await message(home.uid, "PAUSED_REPLY_ACCEPTANCE: can you still answer me?", owner);
      await until(() => outbound.some(value => value.body.includes("Direct replies still work")), "direct reply while notifications paused");
      record("paused direct replies", "ordinary inbound replies still deliver while scheduled notifications are paused");
    }
    await rpc("cron.remove", { id: queued.id });
    if (gate.scope.conversation === home.uid) await notificationControl(scheduler, scope, context, "resume", false);
    else await updateExperience(gate.scope, context.assertInvocationCurrent, state => { state.paused = false; });
    record(gate.check, gate.result);
  }
  const alertControl: any = await rpc("cron.add", { name: "Unpaused failure alert", agentId: "main", sessionKey: context.sessionKey, enabled: true, deleteAfterRun: false, schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "CANCEL_CRON_ACCEPTANCE", toolsAllow: [] }, delivery: { mode: "announce", channel: "plow", to: home.uid, accountId: "chat" }, failureAlert: { after: 1, cooldownMs: 0, channel: "last", to: home.uid, accountId: "chat" } });
  await rpc("cron.run", { id: alertControl.id, mode: "force" });
  await until(() => cancelReminderStarted, "unpaused failure-alert positive-control request");
  const beforeAlert = outbound.length;
  await rpc("cron.update", { id: alertControl.id, patch: { enabled: false } });
  await until(() => cancelReminderClosed && outbound.slice(beforeAlert).some(value => value.chat === home.uid && value.body.includes("Unpaused failure alert")), "unpaused cancelled run announces its failure through channel:last resolving to Plow");
  assert.equal(outbound.length, beforeAlert + 1);
  await rpc("cron.remove", { id: alertControl.id });
  record("unpaused failure alert", "a native abort produces one alert through the resolved Plow route when delivery is allowed");
  cancelReminderStarted = false; cancelReminderClosed = false;
  const cancellable: any = await rpc("cron.add", { name: "Active run pause and failure alert", agentId: "main", sessionKey: context.sessionKey, enabled: true, deleteAfterRun: false, schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "CANCEL_CRON_ACCEPTANCE", toolsAllow: [] }, delivery: { mode: "announce", channel: "plow", to: home.uid, accountId: "chat" }, failureAlert: { after: 1, cooldownMs: 0, channel: "plow", to: home.uid, accountId: "chat" } });
  await rpc("cron.run", { id: cancellable.id, mode: "force" });
  await until(() => cancelReminderStarted, "active scheduled model request");
  const beforeCancel = outbound.length;
  await message(home.uid, "PAUSE_ACTIVE_CRON_ACCEPTANCE: pause scheduled notifications everywhere", owner);
  await until(() => cancelReminderClosed && outbound.some(value => value.body === "Scheduled notifications are paused; direct replies still work."), "owner pause disables cron and aborts its active provider request");
  await until(async () => {
    const view: any = await rpc("cron.get", { id: cancellable.id });
    return (view.state ?? view).lastFailureNotificationDeliveryStatus === "not-delivered";
  }, "cancelled run's failure announcement settles behind the pause gate");
  assert.equal((await readExperience(allScope)).paused, true);
  assert.equal((await rpc("cron.get", { id: cancellable.id }) as any).enabled, false);
  assert.deepEqual(outbound.slice(beforeCancel).map(value => value.body), ["Scheduled notifications are paused; direct replies still work."]);
  await rpc("cron.remove", { id: cancellable.id });
  await notificationControl(scheduler, allScope, context, "resume", true);
  record("native active reminder cancellation", "verified owner tool pause uses native disable to abort the provider request; its failure alert is suppressed while the direct acknowledgement still delivers");
  // Previous cancellation cases leave deliberately undelivered in-memory
  // system events for jobs the fixture has removed. Isolate the new paired
  // control with a normal gateway restart; missing-job notices fail closed.
  await stop(); await start();
  // Remove optional heartbeat throttling as a confounder: compare native
  // fallback custody with an allowed control and a paused creator room.
  await updateExperience(allScope, context.assertInvocationCurrent, state => { state.preferences.notificationMinIntervalMinutes = 0; });
  const safetySource = { account, conversation: group.uid };
  const safetyDestination = { account, conversation: alertDestination.uid };
  for (const { sourcePaused, destinationPaused } of [{ sourcePaused: false, destinationPaused: false }, { sourcePaused: true, destinationPaused: false }, { sourcePaused: false, destinationPaused: true }]) {
    if (destinationPaused) { await stop(); await start(); }
    cancelReminderStarted = false; cancelReminderClosed = false; safetyHeartbeatAt = 0;
    await updateExperience(safetySource, context.assertInvocationCurrent, state => { state.paused = sourcePaused; });
    await updateExperience(safetyDestination, context.assertInvocationCurrent, state => { state.paused = destinationPaused; });
    const safetyName = destinationPaused ? "SAFETY_FALLBACK_ACCEPTANCE_DESTINATION" : sourcePaused ? "SAFETY_FALLBACK_ACCEPTANCE_PAUSED" : "SAFETY_FALLBACK_ACCEPTANCE_UNPAUSED";
    const safety: any = await rpc("cron.add", { name: safetyName, agentId: "main", sessionKey: `agent:main:plow:chat:group:${group.uid}`, enabled: true, deleteAfterRun: false, schedule: { kind: "at", at: new Date(Date.now() + 3600_000).toISOString() }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "CANCEL_CRON_ACCEPTANCE", toolsAllow: [] }, delivery: { mode: "announce", channel: "plow", to: alertDestination.uid, accountId: "chat" }, failureAlert: { after: 1, cooldownMs: 0, channel: "plow", to: alertDestination.uid, accountId: "chat" } });
    await rpc("cron.run", { id: safety.id, mode: "force" });
    await until(() => cancelReminderStarted, "source-room safety run starts");
    const beforeSafety = outbound.length;
    await rpc("cron.update", { id: safety.id, patch: { enabled: false } });
    await until(async () => (await rpc("cron.get", { id: safety.id }) as any).state?.lastFailureNotificationDeliveryStatus === "not-delivered", "primary failure alert cannot reach its destination");
    await until(() => safetyHeartbeatAt > 0, "native fallback event reaches heartbeat model");
    await until(async () => {
      const event: any = await rpc("last-heartbeat", {});
      return event?.ts >= safetyHeartbeatAt && ["sent", "failed", "skipped", "ok-empty", "ok-token"].includes(event.status);
    }, "native fallback heartbeat reaches its terminal delivery outcome");
    const body = destinationPaused ? "Safety notice for the paused destination." : sourcePaused ? "Safety notice from the paused source room." : "Safety notice from the unpaused source room.";
    // Other already-queued owner events may settle after resume; track this
    // uniquely named native notice rather than counting unrelated traffic.
    const related = outbound.slice(beforeSafety).filter(value => value.body === body || value.body.includes(safetyName));
    safetyOutcomes.push({ sourcePaused, destinationPaused, event: await rpc("last-heartbeat", {}), outbound: outbound.slice(beforeSafety), related });
    if (sourcePaused || destinationPaused) assert.deepEqual(related, [], "a fallback safety heartbeat cannot bypass its source or original destination pause");
    else assert.deepEqual(related.map(value => ({ chat: value.chat, body: value.body })), [{ chat: home.uid, body }], "unpaused fallback must actually deliver once to establish the control");
    await rpc("cron.remove", { id: safety.id });
    record(destinationPaused ? "destination safety fallback" : sourcePaused ? "source-room safety fallback" : "unpaused safety fallback", sourcePaused || destinationPaused ? "native suppressed alert reaches system-event/heartbeat custody without bypassing its paused scope" : "a primary alert cancelled by an independent fixture send policy becomes one native fallback delivery while its scopes are unpaused");
  }
  await updateExperience(safetySource, context.assertInvocationCurrent, state => { state.paused = false; });
  await updateExperience(safetyDestination, context.assertInvocationCurrent, state => { state.paused = false; });
  // Exercise the actual native circuit breaker, with distinct responses and a
  // normal restart separating it from the earlier deliberately unsent notices.
  await stop(); await start();
  for (const sourcePaused of [false, true]) {
    safetyHeartbeatAt = 0;
    await updateExperience(safetySource, context.assertInvocationCurrent, state => { state.paused = sourcePaused; });
    const name = sourcePaused ? "AUTO_DISABLED_SAFETY_PAUSED" : "AUTO_DISABLED_SAFETY_UNPAUSED";
    const job: any = await rpc("cron.add", { name, agentId: "main", sessionKey: `agent:main:plow:chat:group:${group.uid}`, enabled: true,
      schedule: { kind: "every", everyMs: 3600_000 }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "AUTO_DISABLED_RUN", toolsAllow: [] },
      delivery: { mode: "none" }, failureAlert: false });
    const before = outbound.length;
    for (let attempt = 1; attempt <= 9; attempt++) {
      await rpc("cron.run", { id: job.id, mode: "force" });
      await until(async () => ((await rpc("cron.get", { id: job.id })) as any).state?.consecutiveErrors >= attempt, "permanent native run failure is recorded");
    }
    // Forced runs preserve the schedule and its backoff. The native startup
    // repair also counts a genuinely interrupted run, without a fake clock.
    autoDisableInterruptStarted = false;
    await rpc("cron.update", { id: job.id, patch: { payload: { kind: "agentTurn", message: "AUTO_DISABLED_INTERRUPT", toolsAllow: [] } } });
    await rpc("cron.run", { id: job.id, mode: "force" });
    await until(() => autoDisableInterruptStarted, "native run remains in flight before crash");
    assert.ok(child); const crashed = once(child, "exit"); child.kill("SIGKILL"); await crashed;
    await start(true);
    await until(async () => {
      const repaired: any = await rpc("cron.get", { id: job.id });
      return repaired.enabled === false && repaired.state?.runningAtMs === undefined
        && repaired.state?.consecutiveErrors === 10 && repaired.state?.autoDisabled?.reason === "consecutive-failures";
    }, "asynchronous native startup repair disables the interrupted job");
    const view: any = await rpc("cron.get", { id: job.id });
    assert.equal(view.enabled, false); assert.equal(view.state.autoDisabled.consecutiveErrors, 10);
    await until(() => safetyHeartbeatAt > 0, "native auto-disabled event reaches heartbeat model");
    await until(async () => { const event: any = await rpc("last-heartbeat", {}); return event?.ts >= safetyHeartbeatAt && ["sent", "failed", "skipped", "ok-empty", "ok-token"].includes(event.status); }, "auto-disabled heartbeat settles");
    const body = sourcePaused ? "Auto-disabled notice from the paused source room." : "Auto-disabled notice from the unpaused source room.";
    const related = outbound.slice(before).filter(value => value.body === body || value.body.includes(name));
    safetyOutcomes.push({ kind: "auto-disabled", sourcePaused, event: await rpc("last-heartbeat", {}), outbound: outbound.slice(before), related });
    assert.deepEqual(related.map(value => ({ chat: value.chat, body: value.body })), sourcePaused ? [] : [{ chat: home.uid, body }]);
    await rpc("cron.remove", { id: job.id });
    record(sourcePaused ? "paused auto-disabled notice" : "unpaused auto-disabled notice", "nine failed native runs and one actual crash-interrupted run trigger startup circuit-breaker repair; its system-event/heartbeat delivery obeys the creator room's pause");
  }
  await updateExperience(safetySource, context.assertInvocationCurrent, state => { state.paused = false; });
  await updateExperience(allScope, context.assertInvocationCurrent, state => { delete state.preferences.notificationMinIntervalMinutes; });
  await message(home.uid, "WORKER_START: do a bounded background analysis of dinner options", owner);
  await until(() => !!releaseWorker, "native background worker start");
  await message(home.uid, "WORKER_PING: are you available while the analysis runs?", owner);
  await until(() => outbound.some(value => value.body.includes("I'm here.")), "coordinator remains responsive");
  assert.ok(!outbound.some(value => value.body.includes('"status":"completed"')));
  workerFinished = true; releaseWorker!();
  await until(() => outbound.some(value => value.body.includes("The analysis is ready")), "worker completion through coordinator");
  assert.equal(outbound.filter(value => value.body.includes("The analysis is ready")).length, 1);
  record("conversation and worker separation", "native background analysis runs while the coordinator answers a new message; one completion returns through the source conversation");
  await message(home.uid, "WORKER_CANCEL_START: start another bounded analysis", owner);
  await until(() => modelRequests.some(value => JSON.stringify(value.messages).includes("PLOW_EXECUTION_WORKER") && JSON.stringify(value.messages).includes("WORKER_CANCEL_HELD")), "cancellable worker start");
  await message(home.uid, "WORKER_STOP: cancel the active analysis", owner);
  await until(() => cancelWorkerClosed && cancelledTasks.length > 0 && log.includes("OPENCLAW_DIRECT_ABORT") && outbound.some(value => value.body.includes("Cancelled the background")), "owned worker cancellation");
  await delay(1000);
  assert.ok(!outbound.some(value => value.body.includes('"status":"completed"')));
  assert.ok(!outbound.some(value => value.body.startsWith("Background task cancellation requested:")));
  assert.equal(outbound.filter(value => value.body.includes("Cancelled the background")).length, 1);
  record("worker cancellation", "coordinator cancellation aborts the owned worker's in-flight model request with one acknowledgement and no raw worker or duplicate automatic notice");
  const usage = JSON.parse(execFileSync("python3", ["-c", "import importlib.util,json; s=importlib.util.spec_from_file_location('client','/opt/plow/agent-index-client.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); usage=m.from_openclaw(1); print(json.dumps({'usage':usage,'failures':m.FAILURES}))"], { encoding: "utf8", env: process.env }));
  assert.deepEqual(usage.failures, []);
  assert.ok(JSON.stringify(usage.usage).includes("z-ai/glm-5.2"));
  const totals = Object.values(usage.usage).flatMap(day => Object.values(day as Record<string, { input: number }>));
  assert.ok(totals.some(row => row.input > 0));
  record("native usage reporting", "pinned Agent Index reader counts actual gateway transcript usage from SQLite without contacting the Index");

  const saved = await (await settings()).json();
  assert.equal((await settings({ action: "reset", revision: saved.revision })).status, 200);
  assert.equal((await (await settings()).json()).sliders["playful-serious"], 80);
  record("builder defaults", "reset removes owner override and restores the image's slider defaults");
  completed = true;
  if (process.env.PLOW_ACCEPTANCE_SERVE === "1") {
    // tests/compose.acceptance.yml uses the existing local-dev Caddy boundary.
    console.log("ACCEPTANCE_GATEWAY_READY");
    await once(process, "SIGTERM");
  }
} finally {
  const output = process.env.PLOW_ACCEPTANCE_OUTPUT;
  if (output) await writeFile(output, JSON.stringify({ kind: "real pinned gateway with local Plow/model fixtures; no external messages", completed, evidence, outbound, safetyOutcomes, modelRequests: modelRequests.map(value => ({ model: value.model, image: JSON.stringify(value.messages).includes("image_url"), messages: value.messages })), logTail: log.slice(-12_000) }, null, 2) + "\n");
  releaseReminder?.();
  releaseWorker?.();
  await stop();
  for (const socket of ws.clients) socket.terminate();
  await new Promise<void>(resolve => ws.close(() => resolve()));
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
}
