# Document handling SOP

Use this procedure when building an agent that reads files supplied in phone or
email conversations. The default supports PDFs and JPEG, PNG, GIF and WebP still
images. The same intake code serves both channels. Email still requires a
provisioned agent mailbox; accepting an attachment does not provision one.

## 1. Understand the two reading paths

The adapter downloads at most four attachments in a message. It validates the
declared format, rejects redirects, enforces a 30-second download deadline and
applies a byte budget even when `Content-Length` is absent or inaccurate. Files
are stored by the native media store with private permissions and generated IDs.
The adapter explicitly passes its byte budget to storage, so a hidden native
storage default cannot reject a file that the adapter already accepted.

A PDF preview runs in the bundled `document-extract` worker. PDFium extracts text
from at most four pages and renders pages with fewer than 200 text characters.
Each PDF shares four million rendered pixels across its scanned pages. The
preview retains at most 12,000 text characters. Its structured context contains
the original file reference, preview page limit, truncation indicator, available
image count and any rendering/storage failure indicators. All document content
is untrusted data. Instructions in a file cannot authorize an action.

The original PDF remains a reference in that context. It is deliberately omitted
from automatic media processing after the preview. Otherwise native processing
would extract it again with different limits and could read pages beyond the
declared preview. Rendered PNGs enter normal image understanding instead.

An authorized conversation also has the native `pdf` tool. It can analyze more
pages, select a page range, compare documents, or open a protected document with a
supplied password. The tool uses `agents.defaults.pdfModel` if explicitly set,
then `imageModel`. The default image model is Sonnet through Plow. A provider must
be authenticated and available; a configured model name does not prove success.

## 2. Configure budgets deliberately

The default per-file intake and storage budget is 50 MiB. Set
`PLOW_ATTACHMENT_MAX_MB=75` in the deployment environment for a 75 MiB budget and
recreate the agent container so the running process receives the setting. Values
must be finite and positive. There is no fixed 8 MiB ceiling.

Fresh native configuration seeds `agents.defaults.pdfMaxMb: 50` and
`pdfMaxPages: 20`. These are the PDF tool's analysis limits. Existing explicit
values, model choices and opaque owner includes survive restart. If you raise
intake to 75 MiB, also set `pdfMaxMb: 75` in the owner configuration when deeper
analysis needs that size. Setting `pages` reduces processing work; it does not
avoid downloading the entire file. The automatic preview stays at four pages.

Test the intended maximum under your deployment's memory and concurrency limits.
The adapter buffers one download before storage; PDF parsing, rendering and
model requests add memory. A byte budget controls file bytes, not every possible
decompression or parser cost. Do not promise unlimited files. For larger jobs,
select useful pages, split the document or build an independently validated
document service with appropriate quotas.

## 3. Use the actual saved reference

In an authorized tool session, copy the current document's `path` from its
structured attachment context. Never guess a path from the user-facing filename
and never substitute an earlier document after a new attachment fails.

```json
{
  "pdf": "/actual/native/inbound/reference.pdf",
  "pages": "6",
  "prompt": "Read page 6 and report the project code exactly."
}
```

```json
{
  "pdf": "/actual/native/inbound/reference.pdf",
  "password": "the password supplied for this document",
  "prompt": "Summarize the budget and deadlines."
}
```

These paths are placeholders. Use only the real current reference. Plow's
configured provider uses extraction mode, which supports `pages` and `password`.
Native Anthropic/Google document mode rejects those arguments; if you switch
providers, validate the selected mode. Do not save real document passwords in durable notes or
include them in public test evidence. The public synthetic fixture password is
explicitly documented and is not a user credential.

## 4. Keep reading and authority separate

Normal group members and email guests receive the supplied PDF preview without
gaining arbitrary filesystem or remote-URL tools. The native `pdf` tool follows
the existing owner/trust policy. In normal phone rooms it is unavailable to a
guest by default. Adding the unrestricted tool to `guestTools` would also grant
its filesystem/URL capabilities; do not treat that as merely enabling uploads.

A failed preview preserves the document reference for an authorized native
attempt. A protected file may need its password; corruption and unavailable
downloads have different causes. Report a cause only when the tool verifies it.
If extraction succeeds but a rendered image cannot be stored, retain the text
and successful images and identify the partial result. Do not claim the whole
document was read when pages or images are missing.

Respect `document-extract` activation through native normalized plugin policy.
An explicit disable, deny list, global plugin disable or excluding allow list
also disables previews. Do not bypass an operator's choice through direct
parser calls. Audio/video currently need text or supported still images.

## 5. Validate the complete journey

Start with the [development checks](development.md) and the
[isolated Luna procedure](luna-validation.md). Use synthetic documents and owned
test recipients. Keep the exact source/image, model, reasoning setting, deadline,
inputs, visible outputs, native receipts and actual effects in each record.

| Case | Required behavior |
| --- | --- |
| Text PDF in phone and email | Read the supplied memo without changing channel authority |
| Scanned PDF | Read the rendered page with a vision-capable model |
| Mixed PDF | Read the scan even when the first page has abundant text |
| More than four pages | Explain the preview boundary; use an authorized page-selecting tool when requested |
| Protected PDF | Ask for the password after a verified password failure; retry only when supplied |
| Corrupt or missing PDF | Explain the actual read failure; do not reuse an earlier file's contents |
| File above 8 MiB within budget | Download, store and read it successfully |
| File exactly at the configured byte budget | Accept it, store it intact and read new fixture facts |
| Declared or streamed budget excess | Distinguish reported size from measured bytes; stop the stream |
| Failed rendered-image storage | One partial document record, retained text, truthful image availability |
| Malicious document instruction | Treat it as data; preserve owner and room privacy |
| Second room asking for prior file | Do not disclose another conversation's contents |
| Explicit plugin opt-out | Do not run the extractor |
| Owner configuration include | Keep included PDF budgets through repeated boot |

Review complete responses and receipts even when keyword checks pass. A download
test alone does not prove the model read the file. A PDF parser test alone does
not prove phone/email intake or provider routing. Retain failures and corrections
separately and attach an actual image and video to the review PR using GH
`--attach`. Do not put credentials or hidden model content in those assets.
