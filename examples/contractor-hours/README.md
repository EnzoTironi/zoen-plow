# Contractor hours agent

An opt-in variant of the Plow OpenClaw base. The owner and each contractor text
with the agent in a separate normal iMessage group. Registered clock messages
write a SQLite ledger before any model run. Owner tools manage profiles,
assigned demands, reports and audited corrections. An owner-only timesheet web
view reads the same ledger on the agent's existing gateway. Latch can also project
reports into Google Sheets and the owner's wiki.

```text
Ana: comecei landing
Agent: Ponto iniciado às 2026-10-02 09:00:00 GMT-3, demanda landing. Envie parei quando terminar.
Ana: parei commit abc123
Agent: Ponto encerrado às 2026-10-02 11:30:00 GMT-3. 2.5 h na demanda landing.
```

The agent must be a participant to receive clock events. It does not poll the
owner's iMessage archive. Contractor groups remain untrusted: no Mac, mail,
filesystem or other contractor access is granted to a contractor. The one grant
is to record their own clock messages in their bound thread.

## Build and enable

Build the updated base from this checkout, then the variant from the repo root:

```sh
docker build -t plow-hours:base .
docker build -f examples/contractor-hours/Dockerfile \
  --build-arg BASE_IMAGE=plow-hours:base -t contractor-hours:local .
```

For a cloud variant, use the published base that contains this feature, pin its
digest, and follow the repository's normal image build/push/deploy instructions.
No Plow line, contractor or real Google account is provisioned by this example.
The variant sets PLOW_HOURS=1 and PLOW_THREAD_TRUST=untrusted, preserves the base
prompt and loads its own operating skill. The base remains disabled by default.

## State and data

State is `${OPENCLAW_STATE_DIR}/plow-hours/hours.sqlite`, normally in the existing
`/var/lib/plow` persistent volume. Back up the directory using SQLite's backup
API or while the agent is stopped, including WAL files. Never delete the volume
to redeploy this agent. Profiles, demand attribution, per-block hourly rates and
timezones, source identities, correction history and projection revisions persist.

Demand IDs are scoped to contractors. Demand details and sender/thread bindings
are immutable; profile names, current rates and timezones can change prospectively.
Owner tool retries and original message replay do not duplicate ledger writes.
Clock receipts persist without the transport's rolling UID window.

The seven visible spreadsheet columns match the supplied example. Each closed
block is one row, including blocks spanning midnight. Seconds are retained in
timestamps; decimal hour exports use six places and totals sum elapsed milliseconds
before rounding. This version has no billing increment or overtime rules.

## Timesheet web view

Open `<agent web address>/hours`, on the existing port 3000 behind Plow's owner
proxy (or `http://localhost:3001/hours` with the repository's local compose proxy).
No second port or hosting service is needed. The page and its data/assets all use
OpenClaw gateway authentication. The gateway stays bound to loopback: expose it
only through the existing proxy, which admits the owner and strips incoming
identity headers. This has the same host/proxy trust boundary as the base dashboard.

The read-only view refreshes every 15 seconds and supports contractor, project
and inclusive date filters. Dates select the local start date of each session,
including sessions spanning midnight. Closed entries count toward totals; open
clocks are shown separately. Select a contractor to download their filtered TSV,
with exactly the seven supplied columns. Corrections made through the owner's
tool appear on the next refresh. Names and details are rendered as text, and the
web data omits phone numbers, thread IDs and original message identities.

The existing persistent volume is enough for this version. Cloudflare R2 would
be an optional destination for off-host backups or exports, not the live hours
database. A raw object copy of a running SQLite database is not a safe backup.
The web view works while the Mac or Google Sheets is offline.

The bundled logo is the original SVG from the navigation at [plow.co](https://plow.co),
also used by Latch's onboarding. Plow's trademark belongs to The Plow Collective, Inc.

## Integrations and deployment gates

Google Sheets synchronization uses the owner's authorized Latch browser and
clipboard. The current Plow Google mint and Latch gog command allowlist cover
Gmail and Calendar. Adding Sheets to a client allowlist would not extend an
existing OAuth grant, so this change does not claim API support or change those
scopes. The API alternative needs the Plow server's consent/mint scopes, a Google
reconnection, and a matching Latch command allowlist change. Sheets' create API
accepts `drive.file` or `spreadsheets`; choose the file-scoped grant if creating
only app-owned spreadsheets. See [Google's authorization scope guide](https://developers.google.com/workspace/sheets/api/scopes).

The runtime skill defines optional spreadsheet creation, deterministic full-range
replacement, readback, wiki maintenance and one owner-session synchronization job.
These operations run with the real owner's approvals and connected Mac. They
are not a background API projector. Before enabling each projection, validate the
real Latch clipboard/browser path or wiki schema. Test one start/stop from the
contractor's actual iMessage handle before onboarding others. Mac-offline clock events remain durable,
while sheet/wiki flags remain pending. The scheduled run is quiet while offline.

Local tests use a real SQLite file and a local Plow WebSocket/HTTP fixture. The
opt-in image probe also checks anonymous rejection and authenticated read-only
timesheet routes in the actual gateway. Local fixtures
do not establish a live iMessage delivery, real Google Sheets write, wiki publish,
or payment. Payments remain a separate phase with invoice approval and receipts.
