export { attachmentMaxBytes } from "../boot/media.ts";
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const ATTACHMENT_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);

export class AttachmentLimitError extends Error {
  readonly reason: "declared" | "received";
  readonly maxBytes: number;
  constructor(reason: "declared" | "received", maxBytes: number) {
    super(`attachment exceeds ${maxBytes} bytes`);
    this.name = "AttachmentLimitError";
    this.reason = reason;
    this.maxBytes = maxBytes;
  }
}

export async function inboundAttachment(url: URL, contentType: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!ATTACHMENT_TYPES.has(contentType)) throw new Error("unsupported attachment type");
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("unsupported attachment URL");
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error" });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("attachment download failed"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > maxBytes) throw new AttachmentLimitError("declared", maxBytes);
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new AttachmentLimitError("received", maxBytes);
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}
