import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSON5 from "json5";
import { agentDefinitionSchema } from "../boot/extensions.ts";
import { renderConfig, syncConfig } from "../boot/config.ts";

const { C: dreamingPluginConfig, S: dreamingConfig } = await import("/app/dist/dreaming-Rnb_FGdU.mjs");
const { t: workshopConfig } = await import("/app/dist/config-CYRu5kQ6.mjs");
const { t: workshopJobs } = await import("/app/dist/skill-collection-review-monitor-DnbqA4A4.mjs");
const { default: memoryPlugin } = await import("/app/dist/extensions/memory-core/index.js");
const config = renderConfig({ agent: { name: "Cedar" }, line: { uid: "ln_fixture" }, chats: [] }, "http://fixture");

test("the pinned dreaming resolver disables transcript maintenance by default", () => {
  assert.equal(dreamingConfig({ cfg: {}, pluginConfig: dreamingPluginConfig({}) }).enabled, true, "the omitted native setting enables dreaming");
  assert.equal(dreamingConfig({ cfg: config, pluginConfig: dreamingPluginConfig(config) }).enabled, false);
});

test("the pinned Workshop produces only disabled main and worker review declarations", () => {
  assert.equal(workshopConfig({}).autonomous.mode, "auto", "the omitted native setting permits autonomous mutation");
  assert.equal(workshopConfig(config).autonomous.mode, "off");
  const jobs = [...workshopJobs(config, [], { schedulerSeed: "plow-maintenance-fixture" })];
  assert.deepEqual(jobs.map((job: any) => [job.agentId, job.input.enabled]).toSorted(), [["main", false], ["plow-worker", false]]);
});

test("the actual memory plugin returns no automatic compaction flush plan", () => {
  let capability: any;
  // Register the real plugin but do not execute any hook, tool, service or model.
  memoryPlugin.register(new Proxy({
    config,
    runtime: { llm: {}, state: {} },
    logger: { warn() {} },
    registerMemoryCapability(value: any) { capability = value; },
  }, { get: (target: any, key) => key in target ? target[key] : () => {} }));
  assert.ok(capability?.flushPlanResolver({ cfg: {} }), "the omitted native setting requests workspace writes");
  assert.equal(capability.flushPlanResolver({ cfg: config }), null);
});

test("a valid memory-core extension retains its hooks and the native dreaming default through restart", async t => {
  const dir = await mkdtemp(join(tmpdir(), "plow-maintenance-extension-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const definition = agentDefinitionSchema.parse({ version: 1, plugins: [
    { id: "memory-core", path: "/opt/owner-memory", tools: [], conversationAccess: true },
  ] });
  const rendered = renderConfig({ agent: { name: "Cedar" }, line: { uid: "ln_fixture" }, chats: [] }, "http://fixture", definition);
  assert.equal(dreamingConfig({ cfg: rendered, pluginConfig: dreamingPluginConfig(rendered) }).enabled, false);
  const path = join(dir, "openclaw.json"), includes = join(dir, "includes");
  await syncConfig(rendered, path, includes);
  await syncConfig(rendered, path, includes);
  const cfg = JSON5.parse(await readFile(path, "utf8"));
  assert.equal(cfg.plugins.entries["memory-core"].enabled, true);
  assert.equal(cfg.plugins.entries["memory-core"].hooks.allowConversationAccess, true);
  assert.equal(dreamingConfig({ cfg, pluginConfig: dreamingPluginConfig(cfg) }).enabled, false);
});
