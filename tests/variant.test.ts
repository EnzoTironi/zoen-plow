import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
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
