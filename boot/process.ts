import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { variantProgram } from "./variant.js";

export async function startGateway(captureOutput = false, mcpUrl?: string, variant = variantProgram()) {
  const children = new Set<ChildProcess>();
  let stopping = false;
  let restartTimer: NodeJS.Timeout | undefined;
  let timer: NodeJS.Timeout | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(restartTimer);
    for (const child of children) child.kill("SIGTERM");
    timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 30_000);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const launch = (label: string, args: string[], options: SpawnOptions, command = process.execPath) => {
    const child = spawn(command, args, options);
    children.add(child);
    child.on("error", error => { console.error(error); if (label === "gateway") { process.exitCode = 1; stop(); } });
    child.on("close", (code, signal) => {
      children.delete(child);
      if (label === "bridge" && !stopping) {
        console.error(`plow-boot: bridge exited code=${code} signal=${signal}; restarting in 1s`);
        restartTimer = setTimeout(startBridge, 1000);
        return;
      }
      // A variant's own work is not what this container is for: it is started
      // here so shutdown reaches it, but its exit -- clean or not -- must not
      // take the gateway, and so the owner's agent, down with it.
      if (label === "variant" && !stopping) {
        if (code || signal) console.error(`plow-boot: variant exited code=${code} signal=${signal}`);
        return;
      }
      if (!stopping && (code || signal)) {
        console.error(`plow-boot: ${label} exited code=${code} signal=${signal}`);
        process.exitCode = code || 1;
      }
      stop();
      if (!children.size) {
        clearTimeout(timer);
        process.off("SIGTERM", stop);
        process.off("SIGINT", stop);
      }
    });
    return child;
  };
  const startBridge = () => launch("bridge", ["/opt/plow/boot/mcp-bridge.js"], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    env: { PLOW_MCP_URL: mcpUrl!, PLOW_AGENT_TOKEN: process.env.PLOW_AGENT_TOKEN, PLOW_MCP_BRIDGE_TOKEN: process.env.PLOW_MCP_BRIDGE_TOKEN },
  });
  if (mcpUrl) {
    const bridge = startBridge();
    await new Promise(resolve => { bridge.once("message", resolve); bridge.once("close", resolve); });
    if (stopping) return bridge;
  }
  // A variant's own work runs under the same supervision as the gateway: its
  // exit is noticed, SIGTERM reaches it, and it cannot hold PID 1 open with
  // the agent already unreachable.
  if (variant) launch("variant", [], { stdio: ["ignore", "inherit", "inherit"], env: process.env }, variant);
  return launch("gateway", ["/app/openclaw.mjs", "gateway"], {
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit", env: process.env,
  });
}
