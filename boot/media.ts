import { z } from "zod";

export function attachmentMaxBytes(): number {
  const mb = z.coerce.number().finite().positive().parse(process.env.PLOW_ATTACHMENT_MAX_MB ?? 50);
  const bytes = Math.floor(mb * 1024 * 1024);
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("PLOW_ATTACHMENT_MAX_MB must resolve to a positive safe byte count");
  return bytes;
}
