# Validate a candidate with an isolated Codex login

This optional diagnostic uses GPT-6 Luna through the pinned OpenClaw subscription
provider. It helps investigate model behavior when the Plow models are unavailable.
It does not change the base's GLM/Sonnet defaults or establish acceptance on them.
Use only a login you are authorized to use.

There are two different tests. The dialogue runner sends synthetic conversations
to the real model without tools. An isolated installation runs the full image,
native tools and durable state. A model's statement that it saved, scheduled or
sent something is never enough: inspect the actual receipt and effect.

## 1. Protect and copy the login

Keep the copy outside Git and every Docker build context:

```sh
lab_auth_dir=$(mktemp -d)
chmod 700 "$lab_auth_dir"
cp "$HOME/.codex/auth.json" "$lab_auth_dir/auth.json"
chmod 600 "$lab_auth_dir/auth.json"
```

Never print the file, paste it into a prompt, upload it to a PR, or bake it into
an image. The dialogue runner reads the copied file and does not refresh it.
An expired login stops the run before model calls. A native installation imports
it into its own OAuth profile and may refresh that isolated profile; it has no
write access to the original Codex directory.

## 2. Freeze and run dialogue cases

Commit the candidate and confirm `git status --porcelain` is empty before
labeling a test with `git rev-parse HEAD`. If testing uncommitted work, use an
explicit working-tree label, save its patch and file hashes, and record the built
image ID. A HEAD label alone does not identify uncommitted inputs.

Install dependencies with `npm ci --ignore-scripts` and use the supported Node
runtime. Begin with one case before launching the full matrix:

```sh
node eval/run-codex.ts --codex-home "$lab_auth_dir" \
  --case first-owner-dm --output /TMP/luna-access-check.json
node eval/run-codex.ts --codex-home "$lab_auth_dir" \
  --cases eval/cases.json,eval/experience-cases.json,eval/benchmark-cases.json \
  --repeat 3 --concurrency 2 --reasoning medium \
  --source-revision "$(git rev-parse HEAD)" --output /TMP/luna-medium.json
```

Use actual writable output paths. Existing reports are rejected before paid
requests. Keep each failed report; never overwrite it with a later success.
Reports record source, prompt and case hashes, actual provider/model, reasoning,
latency, usage and errors. No tools, phone messages or emails run in this test.

For a controlled reasoning comparison, run the same frozen files and prompt
with `--reasoning high` and a new output path. Verify equal input hashes before
comparing outputs. Review every response, including literal passes, against the
case's qualitative criteria. The subscription transport has no enforced Plow
`max_tokens` cap and its cost is unknown; neither means the run was free.

Keep development cases separate from a held-out set. Once you inspect and adapt
to a held-out response, that case becomes a regression case. It cannot remain
evidence of unseen generalization. The [benchmark guide](assistant-benchmark.md)
explains how to validate jobs beyond single replies.

## 3. Prepare a fresh native state volume

Use a separate checkout, Compose project, free loopback port and empty volume.
First build the exact candidate from that checkout:

```sh
docker build --build-arg PLOW_REVISION="$(git rev-parse HEAD)" \
  -t plow-openclaw:luna-lab .
docker volume create plow-luna-validation
```

The following one-time import uses the pinned native provider-auth API. Save
the script as `$lab_auth_dir/import.mjs`, alongside the private copied login:

```javascript
import { readFile, writeFile } from 'node:fs/promises';
import { readCodexCliCredentialsCached, upsertAuthProfileWithLock }
  from '/app/dist/plugin-sdk/provider-auth.js';

try {
  await readFile('/var/lib/plow/openclaw.json');
  throw new Error('Use a fresh volume; do not replace an existing installation');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const credential = readCodexCliCredentialsCached({
  codexHome: '/run/codex', allowKeychainPrompt: false,
});
if (!credential?.access || credential.expires <= Date.now()) {
  throw new Error('Copied login is unavailable or expired');
}
const profileId = 'openai:luna-lab';
const stored = await upsertAuthProfileWithLock({
  profileId, credential: { ...credential, provider: 'openai' },
  agentDir: '/var/lib/plow/agents/main/agent', stateDir: '/var/lib/plow',
});
if (!stored) throw new Error('Native OAuth profile was not persisted');
const seed = {
  models: { providers: {} },
  agents: { entries: { main: {} }, defaults: {
    model: { primary: 'openai/gpt-6-luna', fallbacks: [] },
    imageModel: { primary: 'openai/gpt-6-luna' },
    thinkingDefault: 'medium',
    models: { 'openai/gpt-6-luna': {
      agentRuntime: { id: 'openclaw' }, params: { transport: 'sse' },
    } },
    heartbeat: { every: '0m', target: 'none' },
  } },
  plugins: { entries: { openai: { enabled: true } } },
  auth: { profiles: { [profileId]: { provider: 'openai', mode: 'oauth' } },
    order: { openai: [profileId] } },
};
await writeFile('/var/lib/plow/openclaw.json', JSON.stringify(seed), { mode: 0o600 });
console.log('Imported an isolated OAuth profile; no credential output.');
```

Import into the fresh volume, then return its ownership to the image's user:

```sh
docker run --rm --user root \
  -v plow-luna-validation:/var/lib/plow \
  -v "$lab_auth_dir:/run/codex:ro" plow-openclaw:luna-lab sh -c \
  'node /run/codex/import.mjs && chown -R node:node /var/lib/plow'
```

Wait for this import command to exit successfully before starting Compose.
Starting the boot process while the importer writes the seed can race with
configuration migration; a volume from that attempt is no longer an untouched
fresh-install control. Preserve its log and use a new owned empty volume.

Choose the native `thinkingDefault` from the setting being tested and record it
in the installation receipt. The example uses `medium`; a `high` comparison must
set `high` before the first boot and keep the same model, inputs and transport.
A later change cannot relabel earlier native results. Reasoning selection in a
lab is not a change to the shipped provider defaults.

No auth directory is mounted during normal operation. The seed disables model
fallback and optional heartbeats so model attribution and unsolicited traffic
are controlled. It leaves native automations available. This is a lab seed,
not a proposed production configuration or an acceptance test of heartbeats.

## 4. Run through the real installation path

Choose an **unused owned test line**, following the [first-agent tutorial](first-agent.md).
`plow-agents mint LINE_UID` writes `plow-credentials` in the checkout. An occupied
line is refused; revoking it retires chats. Do not revoke an active install to
make a test convenient. Reusing your own existing test credential is a separate
test condition; record it instead of claiming a newly minted installation.

Create a local `work/luna.compose.yml`:

```yaml
services:
  agent:
    image: plow-openclaw:luna-lab
    environment:
      AGENT_ID: ""
volumes:
  state:
    external: true
    name: plow-luna-validation
```

The empty `AGENT_ID` prevents registration of a diagnostic listing. Use a free
port and keep both variables for all later Compose commands:

```sh
export COMPOSE_PROJECT_NAME=plow-luna-validation PLOW_DEV_PORT=3017
docker compose -f compose.yml -f work/luna.compose.yml up -d --no-build
docker compose -f compose.yml -f work/luna.compose.yml ps
docker compose -f compose.yml -f work/luna.compose.yml logs agent
```

Wait for healthy readiness and the actual Plow WebSocket connection. Open
`http://localhost:3017/plugins/plow/personality`. A running container or a
working dashboard alone does not prove phone delivery. Send test messages only
through owned conversations and authorized recipients. Never print the credential
file or a complete config/auth RPC response while collecting evidence.

## 5. Inspect effects and recovery

Apply the [experience acceptance journeys](experience-validation.md#3-exercise-real-user-journeys).
In particular, inspect a reminder created through the actual conversation, pause
and resume it, then verify a successful native run and exactly one destination
message. Creating a job is insufficient. Check the captured account and source;
administrative pause/resume must not erase the original approved execution scope.

Preview personality after a stored setting and verify that it remains unsaved.
Save and forget private memory, restart, and inspect the scoped store. Check
groups, speaker attribution, worker completion and cancellation separately.
Compare physical sends against receipts under lost responses, revocation and
pauses. Set a 300-second own-input terminal deadline before the first native
input. Keep that deadline, model and transport unchanged across every segment,
provider retry and continuation. Check the recorded driver settings before each
segment; a missing option must not silently select a shorter default. Preserve
timeouts and late outputs separately. Mark an incomplete attempt as incomplete;
do not extend its deadline retrospectively. Adoption acknowledgements and
unrelated callbacks do not count as the input's own terminal.
Preserve each provider error and every incomplete input even when a separate
rerun succeeds.
A driver exit code or `completedAt` field is insufficient: verify the expected
input count and each direct or run-bound terminal against its actual effects.
Retain the original failed native scenarios and run the same inputs after a
shared correction. Add a separately labeled set with different wording and facts,
including positive authorized work. For scope and resume, inspect both notebooks,
actual job creation and actual delivery. A changed default or a zero-created
control receipt alone cannot prove the model interpreted consent correctly.
Freeze the completed original round before starting supplementary variants.
Use a new empty volume for those variants so prior turns cannot supply missing
facts or authorization. Report each round's own terminals and results separately.

Run heavy native fixtures sequentially; record resource saturation and
readiness timeouts rather than quietly extending deadlines.

Label evidence precisely: real model with loopback transport, deterministic
model with real native gateway, or real Plow service. None establishes a real
email send if this identity has no mailbox. Accelerated routine tests do not
establish a week of reliability, and these diagnostics do not establish parity
with another product. Material failures block release.

## 6. Shut down and preserve reviewable evidence

Stop only this project with the same variables and override. Keep its volume
while reviewing recovery; remove it only when you no longer need the test state.
Delete the temporary login copy after the run. Retained native state contains
its own credential profile and must remain private.

Upload only sanitized screenshots/videos and synthetic reports. Record the
exact source and image, failed attempts, limits and reviewer type. For PRs, use
`gh --attach` to host the image and video on GitHub; inspect the resulting assets
before claiming that visual evidence is available.
