// Test-only child IPC. Native admission and queue order remain unchanged.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { r as enqueue, a as snapshot } from "/app/dist/command-queue-CaY517ob.mjs";
import { r as sessionLane } from "/app/dist/lanes-CVttd5qX.mjs";

const lane = sessionLane("agent:main:main");
let release, held;
const checkpointPath = join(process.env.OPENCLAW_STATE_DIR, "plow-checkpoints", "cht_home");
const rename = fs.rename;
let checkpoint = { phase: "idle" }, releaseCheckpoint, checkpointDone;
fs.rename = async (source, destination) => {
  if (checkpoint.phase === "armed" && source === `${checkpointPath}.tmp` && destination === checkpointPath) {
    const contents = JSON.parse(await fs.readFile(source, "utf8"));
    if (contents.uid === checkpoint.uid && contents.recent?.includes(checkpoint.uid)) {
      checkpoint = { ...checkpoint, phase: "held", contents };
      let complete; checkpointDone = new Promise(resolve => { complete = resolve; });
      await new Promise(resolve => { releaseCheckpoint = resolve; });
      try { await rename(source, destination); checkpoint = { ...checkpoint, phase: "released" }; }
      finally { releaseCheckpoint = undefined; complete(); }
      return;
    }
  }
  return rename(source, destination);
};
// The plugin uses the named builtin import; update it before gateway loading.
syncBuiltinESMExports();
process.on("message", request => {
  if (!request || typeof request !== "object" || request.kind !== "acceptance-lane" || !Number.isInteger(request.id)) return;
  const respond = error => process.send?.({ kind: "acceptance-lane", id: request.id, snapshot: snapshot(lane), checkpoint, ...(error ? { error: String(error) } : {}) });
  if (request.action === "snapshot") respond();
  else if (request.action === "hold") {
    if (held) { respond("Fixture already holds its session lane"); return; }
    held = enqueue(lane, () => new Promise(resolve => { release = resolve; respond(); }));
    held.catch(error => respond(error)).finally(() => { release = undefined; held = undefined; });
  } else if (request.action === "release") {
    if (!release || !held) { respond("Fixture has no entered session hold"); return; }
    const completed = held; release(); completed.then(() => respond(), error => respond(error));
  } else if (request.action === "checkpoint-hold") {
    if (checkpoint.phase === "armed" || checkpoint.phase === "held" || typeof request.uid !== "string" || !/^msg_in_\d+$/.test(request.uid)) { respond("Invalid checkpoint barrier request"); return; }
    checkpoint = { phase: "armed", uid: request.uid }; respond();
  } else if (request.action === "checkpoint-release") {
    if (releaseCheckpoint) { releaseCheckpoint(); checkpointDone.then(() => respond(), error => respond(error)); }
    else { checkpoint = { phase: "idle" }; respond(); }
  }
});
process.on("disconnect", () => { releaseCheckpoint?.(); release?.(); });
