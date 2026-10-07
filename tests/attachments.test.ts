import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { attachmentMaxBytes, inboundAttachment, AttachmentLimitError } from "../plugin/media.ts";
import { pdfPreview } from "../plugin/documents.ts";

test("attachment budget is configurable and rejects invalid values", () => {
  const previous = process.env.PLOW_ATTACHMENT_MAX_MB;
  try {
    delete process.env.PLOW_ATTACHMENT_MAX_MB;
    assert.equal(attachmentMaxBytes(), 50 * 1024 * 1024);
    process.env.PLOW_ATTACHMENT_MAX_MB = "80";
    assert.equal(attachmentMaxBytes(), 80 * 1024 * 1024);
    for (const value of ["0", "-1", "NaN", "Infinity", "", "1e20", "1e-20"]) {
      process.env.PLOW_ATTACHMENT_MAX_MB = value;
      assert.throws(attachmentMaxBytes);
    }
  } finally {
    if (previous === undefined) delete process.env.PLOW_ATTACHMENT_MAX_MB;
    else process.env.PLOW_ATTACHMENT_MAX_MB = previous;
  }
});

test("an attachment above 8 MiB reaches the caller intact", async t => {
  const bytes = Buffer.alloc(9 * 1024 * 1024, 65);
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers: { "content-length": String(bytes.length) } }));
  assert.deepEqual(await inboundAttachment(new URL("https://fixture/image"), "image/png", attachmentMaxBytes()), bytes);
});

test("stream budget works even when the server understates its length", async t => {
  const bytes = Buffer.alloc(1025);
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers: { "content-length": "1" } }));
  await assert.rejects(inboundAttachment(new URL("https://fixture/image"), "image/png", 1024), error => error instanceof AttachmentLimitError && error.reason === "received" && error.maxBytes === 1024);
});

test("cancelled downloads and unsupported schemes do not read content", async t => {
  const controller = new AbortController(); controller.abort();
  const fetch = t.mock.method(globalThis, "fetch", async (_url: URL, init: RequestInit) => { init.signal?.throwIfAborted(); return new Response("unexpected"); });
  await assert.rejects(inboundAttachment(new URL("https://fixture/file"), "application/pdf", 1024, controller.signal));
  await assert.rejects(inboundAttachment(new URL("file:///tmp/file"), "application/pdf", 1024), /URL/);
  assert.equal(fetch.mock.calls.length, 1);
});

const fixture = (name: string) => readFile(new URL(`./fixtures/documents/${name}.pdf`, import.meta.url));
test("pinned PDF worker extracts text and limits a preview to four pages", async () => {
  const preview = await pdfPreview(await fixture("long"), {}, new AbortController().signal);
  assert.match(preview.text, /Preview page 1/);
  assert.match(preview.text, /Preview page 4/);
  assert.doesNotMatch(preview.text, /SIXTH_PAGE_CANARY/);
  assert.equal(preview.previewPageLimit, 4);
});

test("pinned PDF worker renders a scanned page in a text-rich mixed document", async () => {
  const preview = await pdfPreview(await fixture("mixed"), {}, new AbortController().signal);
  assert.match(preview.text, /Synthetic project memo/);
  assert.equal(preview.images.length, 1);
  assert.equal(preview.images[0].mimeType, "image/png");
  assert.ok(Buffer.from(preview.images[0].data, "base64").length > 1000);
});

test("protected and corrupt PDFs report extraction failures without invented contents", async () => {
  await assert.rejects(pdfPreview(await fixture("protected"), {}, new AbortController().signal), /password/);
  await assert.rejects(pdfPreview(Buffer.from("%PDF-1.7\nbroken"), {}, new AbortController().signal));
});

test("PDF extraction respects explicit plugin disable and cancellation", async () => {
  const bytes = await fixture("text");
  await assert.rejects(pdfPreview(bytes, { plugins: { entries: { "document-extract": { enabled: false } } } }, new AbortController().signal), /disabled/);
  await assert.rejects(pdfPreview(bytes, { plugins: { allow: ["plow"] } }, new AbortController().signal), /disabled/);
  await assert.rejects(pdfPreview(bytes, { plugins: { deny: ["document-extract"] } }, new AbortController().signal), /disabled/);
  await assert.rejects(pdfPreview(bytes, { plugins: { deny: [" Document-Extract "] } }, new AbortController().signal), /disabled/);
  assert.match((await pdfPreview(bytes, { plugins: { allow: [" Document-Extract "] } }, new AbortController().signal)).text, /Project: Orchard/);
  await assert.rejects(pdfPreview(bytes, { plugins: { enabled: false } }, new AbortController().signal), /disabled/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pdfPreview(bytes, {}, controller.signal));
});

test("native preprocessing cannot read pages beyond the structured preview", async t => {
  const root = await mkdtemp(join(tmpdir(), "plow-pdf-boundary-"));
  const previous = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = root;
  t.after(async () => { await rm(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = previous; });
  const require = createRequire(new URL("../plugin/package.json", import.meta.url));
  const { saveMediaBuffer } = await import(require.resolve("openclaw/plugin-sdk/media-store"));
  const saved = await saveMediaBuffer(await fixture("long"), "application/pdf", "inbound", attachmentMaxBytes(), "long.pdf");
  const native = await import(new URL("../apply-BTYPkOjG.mjs", import.meta.resolve("openclaw/plugin-sdk/document-extractor")).href);
  const preview = await pdfPreview(await fixture("long"), {}, new AbortController().signal);
  const context = { Body: "Read the current preview", RawBody: "Read the current preview", media: [], ChannelStructuredContext: [{ label: "Document (untrusted data)", payload: { path: saved.path, text: preview.text } }] };
  await native.t({ ctx: context, cfg: { agents: { defaults: { pdfMaxPages: 20 } } }, processingMode: "files-only" });
  assert.doesNotMatch(JSON.stringify(context), /SIXTH_PAGE_CANARY/);
  const duplicate = { Body: "Read the current preview", RawBody: "Read the current preview", media: [{ path: saved.path, contentType: "application/pdf" }] };
  await native.t({ ctx: duplicate, cfg: { agents: { defaults: { pdfMaxPages: 20 } } }, processingMode: "files-only" });
  assert.match(JSON.stringify(duplicate), /SIXTH_PAGE_CANARY/, "negative control proves a PDF media entry would bypass the preview boundary");
});
