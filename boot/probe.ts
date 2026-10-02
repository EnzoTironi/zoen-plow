import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { probeIdentity } from "./probe-fixture.js";
import { renderConfig, syncConfig } from "./config.js";
import { startGateway } from "./process.js";

process.env.PLOW_AGENT_TOKEN = "probe-" + randomBytes(16).toString("hex");
delete process.env.OPENCLAW_GATEWAY_TOKEN;
process.env.OPENCLAW_GATEWAY_PASSWORD = randomBytes(32).toString("hex");
const config = renderConfig(probeIdentity, "http://127.0.0.1:1");
await mkdir("/var/lib/plow/workspace", { recursive: true });
const serialized = JSON.stringify(config, null, 2);
if ([process.env.PLOW_AGENT_TOKEN, process.env.OPENCLAW_GATEWAY_PASSWORD].some(token => token && serialized.includes(token))) {
  throw new Error("Credential leaked into rendered config");
}
await syncConfig(config, "/var/lib/plow/openclaw.json", "/etc/plow/openclaw");
const child = await startGateway(true);
let succeeded = false;
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  console.error("plow-probe: gateway readiness timed out");
  process.kill(process.pid, "SIGTERM");
}, 60_000);
let log = "";
let checking = false;
async function validateHoursWeb() {
  if (process.env.PLOW_HOURS !== "1") return;
  const base = "http://127.0.0.1:3000/hours";
  for (const path of ["", "/data", "/app.js", "/style.css", "/plow-logo.svg"]) {
    const anonymous = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    if (anonymous.status !== 401 && anonymous.status !== 403) throw new Error(`Anonymous timesheet request returned ${anonymous.status}`);
  }
  const headers = { "x-plow-user": "mem_probe", "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https", "x-forwarded-host": "probe.example" };
  for (const path of ["", "/data", "/app.js", "/style.css", "/plow-logo.svg"]) {
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) throw new Error(`Authenticated timesheet ${path || "/"} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    if (path === "/data") {
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("contractors" in data) || !Array.isArray(data.contractors)) throw new Error("Timesheet data was not served by the plugin");
    }
  }
  const local = await fetch(base + "/data", { headers: { ...headers, "x-forwarded-for": "192.0.2.1", "x-forwarded-host": "localhost:3001", "x-forwarded-proto": "http" }, signal: AbortSignal.timeout(5000) });
  if (local.status !== 200) throw new Error(`Local owner proxy timesheet returned ${local.status}`);
  const write = await fetch(base + "/data", { method: "POST", headers, signal: AbortSignal.timeout(5000) });
  if (write.status !== 405) throw new Error(`Timesheet write returned ${write.status}`);
  console.log("PLOW_HOURS_WEB_PROBE_OK");
}
function observe(chunk: Buffer) {
  log += chunk.toString();
  if (!checking && !timedOut && log.includes("plow channel registered") && log.includes("[gateway] ready")) {
    checking = true;
    validateHoursWeb().then(() => {
      succeeded = true;
      clearTimeout(timeout);
      console.log("PLOW_PROBE_OK");
      process.kill(process.pid, "SIGTERM");
    }).catch(error => {
      console.error(`plow-probe: ${String(error)}`);
      process.kill(process.pid, "SIGTERM");
    });
  }
}
child.stdout!.on("data", chunk => { process.stdout.write(chunk); observe(chunk); });
child.stderr!.on("data", chunk => { process.stderr.write(chunk); observe(chunk); });
child.on("exit", code => {
  clearTimeout(timeout);
  if (!succeeded || code !== 0) process.exitCode = 1;
});
