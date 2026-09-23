import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { startGateway } from "../boot/process.ts";
import { variantProgram } from "../boot/variant.ts";

/** An image with no variant program, and one with a file at that path. */
function program(t: import("node:test").TestContext, mode?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plow-variant-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const start = path.join(dir, "start");
  if (mode !== undefined) fs.writeFileSync(start, "#!/bin/sh\nexit 0\n", { mode });
  return start;
}

test("an image without a variant program has none to run", t => {
  assert.equal(variantProgram(program(t)), undefined);
});

test("a file that is not executable is not a program", t => {
  // Refusing it here is the difference between a clear no-op and a spawn that
  // fails at exec time on every boot.
  assert.equal(variantProgram(program(t, 0o644)), undefined);
});

test("an executable at that path is the program to run", t => {
  const start = program(t, 0o755);
  assert.equal(variantProgram(start), start);
});

// Its own file, and so its own process: the supervisor tests leave SIGTERM
// listeners behind, and a stray signal here would fire theirs too.
test("a variant that exits leaves the agent answering", async t => {
  const previousCode = process.exitCode;
  const spawned: { command: string; child: EventEmitter & { signals: string[]; kill(signal: string): void } }[] = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(childProcess, "spawn", (command: string) => {
    const child = Object.assign(new EventEmitter(), {
      signals: [] as string[],
      kill(signal: string) { this.signals.push(signal); queueMicrotask(() => this.emit("close", null, signal)); },
    });
    spawned.push({ command, child });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); process.exitCode = previousCode; });

  await startGateway(true, undefined, "/opt/plow/variant/start");
  const [variant, gateway] = spawned;
  // A worker that dies, cleanly or not, must leave the owner with an agent
  // that still answers: its work is not what this container is for.
  variant.child.emit("close", 1, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(gateway.child.signals, [], "the agent keeps answering");
  assert.equal(process.exitCode, previousCode, "a variant's failure is not the container's");
});

test("shutdown reaches the variant: it is supervised, not merely started", async t => {
  const spawned: { command: string; child: EventEmitter & { signals: string[]; kill(signal: string): void } }[] = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(childProcess, "spawn", (command: string) => {
    const child = Object.assign(new EventEmitter(), {
      signals: [] as string[],
      kill(signal: string) { this.signals.push(signal); queueMicrotask(() => this.emit("close", null, signal)); },
    });
    spawned.push({ command, child });
    return child;
  });
  syncBuiltinESMExports();
  const previousCode = process.exitCode;
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); process.exitCode = previousCode; });

  await startGateway(true, undefined, "/opt/plow/variant/start");
  const [variant, gateway] = spawned;
  assert.deepEqual([variant.command, gateway.command], ["/opt/plow/variant/start", process.execPath],
    "the variant starts before the gateway it runs beside");
  // The gateway going down takes the container with it, and a variant left
  // outside the supervisor would hold PID 1 open, agent already unreachable.
  gateway.child.emit("close", 1, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(variant.child.signals, ["SIGTERM"]);
});
