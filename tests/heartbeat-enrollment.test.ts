import assert from "node:assert/strict";
import { test } from "node:test";
import { renderConfig } from "../boot/config.ts";

const { n: enrolledAgents } = await import("/app/dist/heartbeat-config-BvP-hlUW.mjs");
const { O: nativeAgentIds } = await import("/app/dist/agent-scope-config-IQKOEtZ4.mjs");
const config = renderConfig({ agent: { name: "Cedar" }, line: { uid: "ln_fixture" }, chats: [] }, "http://fixture");

test("the actual native heartbeat resolver enrolls only the configured coordinator", () => {
  const { agentId: ignoredSelector, ...route } = config.agents.defaults.heartbeat;
  const legacy = { ...config, agents: { ...config.agents, defaults: { ...config.agents.defaults, heartbeat: route } } };
  assert.deepEqual(enrolledAgents(legacy).toSorted(), ["main", "plow-worker"], "unselected defaults enroll every native agent");
  assert.deepEqual(enrolledAgents(config), ["main"]);
});

test("native enrollment preserves an explicit selector and the worker agent roster", () => {
  const explicit = structuredClone(config);
  explicit.agents.defaults.heartbeat.agentId = "plow-worker";
  assert.deepEqual(enrolledAgents(explicit), ["plow-worker"]);
  assert.deepEqual(nativeAgentIds(config).toSorted(), ["main", "plow-worker"]);
  // Real native spawn/yield/completion remains exercised by gateway-acceptance;
  // heartbeat enrollment does not remove or replace the worker's agent entry.
});
