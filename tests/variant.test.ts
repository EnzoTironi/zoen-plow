import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startVariant } from "../boot/variant.ts";

/** An image with no variant program, and one with an executable program. */
function program(t: import("node:test").TestContext, mode?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plow-variant-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const start = path.join(dir, "start");
  if (mode !== undefined) fs.writeFileSync(start, "#!/bin/sh\nexit 0\n", { mode });
  return start;
}

function spawned(t: import("node:test").TestContext) {
  const calls: string[] = [];
  t.mock.method(childProcess, "spawn", (command: string) => {
    calls.push(command);
    return Object.assign(new EventEmitter(), { kill() {} });
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

test("an image without a variant program starts nothing", t => {
  const calls = spawned(t);
  assert.equal(startVariant(program(t)), undefined);
  assert.deepEqual(calls, []);
});

test("a file that is not executable is not a program to run", t => {
  const calls = spawned(t);
  // Refusing it here is the difference between a clear no-op and a spawn that
  // fails at exec time on every boot.
  assert.equal(startVariant(program(t, 0o644)), undefined);
  assert.deepEqual(calls, []);
});

test("an executable variant program is started beside the gateway", t => {
  const calls = spawned(t);
  const start = program(t, 0o755);
  assert.ok(startVariant(start));
  assert.deepEqual(calls, [start]);
});
