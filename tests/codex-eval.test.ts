import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Codex evaluation protects credentials, reserves evidence and stops on authentication failure", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "plow-codex-eval-"));
  const authPath = join(dir, "auth.json"), cases = join(dir, "cases.json"), calls = join(dir, "calls.jsonl");
  const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url");
  const access = `eyJhbGciOiJub25lIn0.${claims}.fixture`, refresh = "fixture-refresh-token";
  const auth = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: access, refresh_token: refresh, id_token: access, account_id: "fixture-account" } });
  await writeFile(authPath, auth, { mode: 0o600 });
  await writeFile(cases, JSON.stringify([{ id: "fixture", facts: {}, messages: [{ role: "user", content: "14 + 8?" }], contains: ["22"] }]));
  // Replace only the paid provider boundary; credential reading, CLI selection,
  // report checkpointing and validation are the maintained production code.
  const provider = join(dir, "provider.mjs"), preload = join(dir, "preload.mjs");
  await writeFile(provider, `
    import assert from 'node:assert/strict';
    import { appendFile, readFile } from 'node:fs/promises';
    let count = 0;
    export function streamSimple(model, context, options) {
      return { result: async () => {
        count++;
        assert.equal(model.id, 'gpt-6-luna'); assert.equal(options.transport, 'sse');
        assert.equal(options.reasoning, process.env.FIXTURE_REASONING); assert.equal(options.maxTokens, undefined);
        assert.deepEqual(context.tools, []); assert.ok(options.apiKey);
        if (count > 1) assert.equal(JSON.parse(await readFile(process.env.FIXTURE_OUTPUT, 'utf8')).results.length, count - 1);
        await appendFile(process.env.FIXTURE_CALLS, JSON.stringify({ model: model.id, count }) + '\\n');
        const failed = process.env.FIXTURE_MODE === 'auth-stop' && count === 2;
        return { content: failed ? [] : [{ type: 'text', text: '22' }], model: model.id,
          stopReason: failed ? 'error' : 'stop',
          ...(failed ? { errorMessage: '401 access token ' + options.apiKey + ' ' + process.env.FIXTURE_REFRESH } : {}),
          usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 0 } } };
      } };
    }
  `);
  await writeFile(preload, `
    import { registerHooks } from 'node:module';
    globalThis.fetch = async () => { throw new Error('Unexpected network access in the evaluator fixture'); };
    registerHooks({ resolve(specifier, context, nextResolve) {
      return specifier === 'openclaw/plugin-sdk/llm'
        ? { url: ${JSON.stringify(new URL(`file://${provider}`).href)}, shortCircuit: true }
        : nextResolve(specifier, context);
    } });
  `);
  let sequence = 0;
  async function run(args: string[] = [], mode = "success", existingOutput?: string) {
    const output = existingOutput ?? join(dir, `report-${sequence++}.json`);
    const child = spawn(process.execPath, ["--import", preload, fileURLToPath(new URL("../eval/run-codex.ts", import.meta.url)), "--codex-home", dir, "--cases", cases, "--output", output, ...args], {
      env: { ...process.env, FIXTURE_OUTPUT: output, FIXTURE_CALLS: calls, FIXTURE_MODE: mode, FIXTURE_REFRESH: refresh, FIXTURE_REASONING: args.includes("--reasoning") ? args[args.indexOf("--reasoning") + 1] : "medium" }, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, killSignal: "SIGKILL",
    });
    let logs = "";
    child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    return { code, logs, output };
  }
  const callCount = async () => { try { return (await readFile(calls, "utf8")).trim().split("\n").length; } catch { return 0; } };
  try {
    for (const args of [["--model", "other"], ["--reasoning", "invalid"], ["--repeat", "6"], ["--repeat"], ["--repeat", "2", "--repeat", "3"], ["--case", "missing"]]) {
      const invalid = await run(args); assert.notEqual(invalid.code, 0, invalid.logs);
    }
    assert.equal(await callCount(), 0);
    await chmod(authPath, 0o644);
    const publicAuth = await run(); assert.notEqual(publicAuth.code, 0); assert.match(publicAuth.logs, /must be private/);
    await chmod(authPath, 0o600);
    const success = await run(["--repeat", "2"]); assert.equal(success.code, 0, success.logs);
    const report = JSON.parse(await readFile(success.output, "utf8"));
    assert.equal(report.expectedResults, 2); assert.equal(report.failures, 0);
    assert.equal(report.results[0].usage.cost, undefined); assert.equal(report.settings.effectiveMaxTokens, null);
    assert.equal(report.results[0].estimatedCostUsd, null);
    const original = await readFile(success.output, "utf8");
    const duplicate = await run([], "success", success.output); assert.notEqual(duplicate.code, 0);
    assert.equal(await readFile(success.output, "utf8"), original); assert.equal(await callCount(), 2);
    const stopped = await run(["--repeat", "3"], "auth-stop"); assert.equal(stopped.code, 1, stopped.logs);
    const raw = await readFile(stopped.output, "utf8"), partial = JSON.parse(raw);
    assert.equal(partial.results.length, 2); assert.equal(partial.results[0].output, "22");
    assert.equal(partial.results[1].passed, false); assert.equal(partial.stopped.unrunResults, 1);
    assert.equal(partial.expectedResults, 3); assert.equal(await callCount(), 4);
    assert.ok(partial.completedAt); assert.match(partial.results[1].error, /redacted-token/);
    for (const text of [raw, original, stopped.logs, success.logs]) { assert.ok(!text.includes(access)); assert.ok(!text.includes(refresh)); }
    const high = await run(["--reasoning", "high"]); assert.equal(high.code, 0, high.logs);
    assert.equal(JSON.parse(await readFile(high.output, "utf8")).settings.reasoning, "high");
    assert.equal(await readFile(authPath, "utf8"), auth, "evaluation must not refresh or overwrite a login");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
