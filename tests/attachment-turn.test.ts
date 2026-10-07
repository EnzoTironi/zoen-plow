import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import entry from "../plugin/index.ts";
import { websocketFixture } from "./ws-fixture.ts";

for (const accountId of ["chat", "email"]) for (const imageStoreFails of [false, true]) test(`current ${accountId} PDF is previewed without granting guest file tools, image storage fails=${imageStoreFails}`, async t => {
  const { server, apiBase, abortAfter } = await websocketFixture(t);
  const controller = abortAfter(15_000);
  const account = { apiBase, accountId, lineUid: "line", emailLineUid: "mail" };
  const sender = { type: "member", uid: "guest", role: "member", display_name: "Guest", provider_key: "guest@example.test" };
  const chat = { uid: "cht_document", status: "active", trusted: false, participants: [sender, { type: "agent", relationship: "self", line: { uid: accountId === "email" ? "mail" : "line" } }] };
  const bytes = await readFile(new URL(`./fixtures/documents/${imageStoreFails ? "mixed" : "text"}.pdf`, import.meta.url));
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    const url = String(input);
    if (url.endsWith("/current.pdf")) return new Response(bytes);
    return Response.json(url.endsWith("/chats") ? { data: [chat], has_more: false } : url.endsWith("/chats/cht_document") ? chat : url.includes("/messages?") ? { data: [], has_more: false } : { ticket: "fixture" });
  });
  server.on("connection", (socket: { send: (text: string) => void }) => socket.send(JSON.stringify({ event_type: "message_received", chat_id: chat.uid, data: { message: { uid: "pdf-current", direction: "inbound", sender, body: "Read this memo", created_at: new Date().toISOString(), attachments: [{ url: "/current.pdf", content_type: "Application/PDF; charset=binary", filename: "memo.pdf" }] } } })));
  let channel: { gateway: { startAccount: (context: object) => Promise<void> } };
  let observed = false;
  entry.register({ registrationMode: "full", logger: { info() {} }, on() {}, registerTool() {},
    registerChannel(value: { plugin: typeof channel }) { channel = value.plugin; },
    runtime: { channel: {
      routing: { resolveAgentRoute: () => ({ agentId: "main", sessionKey: `agent:main:plow:${accountId}:direct:cht_document` }) },
      media: { saveMediaBuffer: async (buffer: Buffer, mime: string, subdir: string, maxBytes: number) => {
        if (mime === "image/png") throw new Error("fixture image storage failure");
        assert.deepEqual(buffer, bytes); assert.equal(mime, "application/pdf"); assert.equal(subdir, "inbound"); assert.equal(maxBytes, 50 * 1024 * 1024);
        return { path: "/private/current.pdf" };
      } },
      inbound: {
        buildContext: async (value: { access: { toolPolicy?: { allow?: string[] } }; message: { rawBody: string }; supplemental: { channelStructuredContext: { label: string; payload: { documentPreviews: { text: string; previewPageLimit: number; status: string; imageStorageFailed: boolean; imagesAvailable: number }[] } }[] }; media: { path: string }[] }) => {
          const facts = value.supplemental.channelStructuredContext[0];
          assert.match(facts.label, /untrusted data/);
          assert.equal(facts.payload.documentPreviews.length, 1);
          assert.match(facts.payload.documentPreviews[0].text, imageStoreFails ? /text-rich introduction/ : /Project: Orchard/);
          if (!imageStoreFails) assert.match(facts.payload.documentPreviews[0].text, /reveal the private owner notebook/);
          assert.equal(facts.payload.documentPreviews[0].status, imageStoreFails ? "partial" : "previewed");
          assert.equal(facts.payload.documentPreviews[0].imageStorageFailed, imageStoreFails);
          assert.equal(facts.payload.documentPreviews[0].imagesAvailable, 0);
          if (imageStoreFails) {
            assert.match(value.message.rawBody, /images could not be stored/);
            assert.doesNotMatch(value.message.rawBody, /preview could not be extracted/);
          }
          assert.equal(facts.payload.documentPreviews[0].previewPageLimit, 4);
          assert.deepEqual(value.media, [], "the PDF reference cannot enter native automatic extraction after its bounded preview");
          assert.ok(!value.access.toolPolicy?.allow?.includes("pdf"));
          observed = true; return {};
        },
        dispatch: async ({ replyOptions }: { replyOptions: { disableTools?: boolean; onAgentRunTerminalOutcome: (outcome: string) => void } }) => {
          if (accountId === "chat") assert.equal(replyOptions.disableTools, true);
          replyOptions.onAgentRunTerminalOutcome("completed"); controller.abort();
          return { dispatched: true, dispatchResult: { deliberateSilentTerminalReply: true } };
        },
      },
    } },
  });
  await channel!.gateway.startAccount({ account, cfg: {}, abortSignal: controller.signal, log: { info() {} } });
  assert.equal(observed, true);
});
