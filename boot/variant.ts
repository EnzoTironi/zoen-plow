import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";

/** Where a variant image puts the one program it wants started beside the gateway. */
const START = "/opt/plow/variant/start";

/** Start a variant's own background work, if it ships any.
 *
 * A variant is a persona, a prompt and skills — but some are a product with a
 * job of their own: a worker reading sources, a scheduler, a digest. Before
 * this, the only way to run one was to fork `boot/`, and a fork takes the
 * reporter with it: three builders did exactly that, and each one's copy went
 * silent separately when OpenClaw moved its transcripts.
 *
 * So the base keeps boot, the gateway and the reporter, and runs this one
 * executable if the image has it. It is started, not supervised: it owns its
 * own restarts, and its failure is logged rather than fatal, because the agent
 * answering its owner does not depend on it.
 */
export function startVariant(start = START) {
  try {
    accessSync(start, constants.X_OK);
  } catch {
    return undefined;   // no variant program, which is the ordinary case
  }
  const child = spawn(start, [], { stdio: ["ignore", "inherit", "inherit"], env: process.env });
  child.on("error", error => console.error(`plow-boot: variant start failed: ${error.message}`));
  child.on("close", (code, signal) => {
    if (code || signal) console.error(`plow-boot: variant exited code=${code} signal=${signal}`);
  });
  return child;
}
