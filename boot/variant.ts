import { accessSync, constants } from "node:fs";

/** Where a variant image puts the one program it wants started beside the gateway. */
export const VARIANT_START = "/opt/plow/variant/start";

/** A variant's own program, if this image ships one.
 *
 * A variant is a persona, a prompt and skills — but some are a product with a
 * job of their own: a worker reading sources, a scheduler, a digest. Before
 * this, the only way to run one was to fork `boot/`, and a fork takes the
 * reporter with it: three builders did exactly that, and each copy went silent
 * separately when OpenClaw moved its transcripts.
 *
 * A file that is not executable is not a program: saying so here is the
 * difference between a clear no-op and a spawn that fails at exec on every boot.
 */
export function variantProgram(start = VARIANT_START): string | undefined {
  try {
    accessSync(start, constants.X_OK);
    return start;
  } catch {
    return undefined;   // no variant program, which is the ordinary case
  }
}
