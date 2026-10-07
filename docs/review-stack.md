# Review the base experience stack

The 21 upstream PRs are consolidated into 11 review layers in
[EnzoTironi/zoen-plow](https://github.com/EnzoTironi/zoen-plow).
Each PR has one commit and uses the previous review branch as its base.
GitHub therefore shows that layer's own changes by default.
Review from layer 1 upward. The PRs stay drafts while the release gates below
remain open.

The first PR targets `codex/review-base-upstream` at upstream commit
`ddbaa6bc0f9e071d9411777b91590e755e367d84`. Later PRs target their predecessor.
This isolated base keeps review separate from the fork's existing agent variants.
No PR in this stack targets the fork's `main`.

## Choose the layer that owns the behavior

| Order | PR | Start reading here | Review boundary |
| --- | --- | --- | --- |
| 1 | [Image contracts](https://github.com/EnzoTironi/zoen-plow/pull/1) | `boot/extensions.ts`, `plugin/index.ts` | Native plugin load paths, tool contracts and immutable ownership |
| 2 | [Conversations and delivery](https://github.com/EnzoTironi/zoen-plow/pull/2) | `plugin/transport.ts`, `plugin/delivery-guard.ts` | History recovery, deliberate silence and current-invocation effect checks |
| 3 | [Builder installation](https://github.com/EnzoTironi/zoen-plow/pull/3) | `boot/extensions.ts`, `boot/config.ts`, `boot/prompt.ts` | Strict definition parsing, ownership, skill merging and restart migration |
| 4 | [Owner controls](https://github.com/EnzoTironi/zoen-plow/pull/4) | `plugin/experience-state.ts`, `plugin/experience.ts` | Scoped memory/preferences, room participation and authenticated personality UI |
| 5 | [Background work](https://github.com/EnzoTironi/zoen-plow/pull/5) | `boot/config.ts`, `prompt/WORKER.md`, `patch-runtime.ts` | Read-only worker isolation, bounded concurrency, commitments and cancellation |
| 6 | [Notifications](https://github.com/EnzoTironi/zoen-plow/pull/6) | `plugin/experience-state.ts`, `plugin/experience.ts`, `plugin/index.ts` | Persist-before-effect ordering, overlapping gates and truthful receipts |
| 7 | [Channel capabilities](https://github.com/EnzoTironi/zoen-plow/pull/7) | `plugin/media.ts`, `plugin/index.ts`, `tests/email-turn.test.ts` | Bounded phone images, vision routing and verified mailbox facts |
| 8 | [Dashboard and gateway](https://github.com/EnzoTironi/zoen-plow/pull/8) | `compose.yml`, `dev/Caddyfile`, `tests/gateway-acceptance.ts` | Isolated ports, origin checks, explicit Compose restart and native effects |
| 9 | [Dialogue evaluator](https://github.com/EnzoTironi/zoen-plow/pull/9) | `eval/run.ts`, `eval/assertions.ts`, `tests/eval-runner.test.ts` | Strict repeat controls, checkpointed outputs, HTTP 402 and unrun accounting |
| 10 | [Experience scenarios](https://github.com/EnzoTironi/zoen-plow/pull/10) | `eval/README.md`, `eval/experience-cases.json` | English decisions, human criteria, canonical mappings and paid workflow |
| 11 | [Builder experience](https://github.com/EnzoTironi/zoen-plow/pull/11) | `docs/README.md`, `prompt/BASE.md`, `prompt/AGENTS.md` | Tutorial, SOPs, starters, default guidance and measured wording candidate |

Layers 1 and 3 are separate because builder configuration migration depends on
the conversation and delivery contracts in layer 2. The evaluator and its
canonical duplicate-risk fixture land together in layer 9. Layer 10 adds the
remaining scenario matrix. Layer 11 collects teaching material and default
prompt guidance after the runtime contracts it explains.

## Review each layer

1. Confirm the PR's base is the preceding review branch, or the isolated base for layer 1.
2. Read its concrete before/after behavior and the entrypoints above.
3. Review effect checks and failure paths before the fixtures. A prompt cannot grant tool authority.
4. Check CI against the exact current head. Earlier source checks or approvals do not approve a rewritten commit.
5. Inspect images and video with their captions. Historical integrated media can include later layers.
6. Leave feedback on the PR that owns the behavior. Preserve the original review links when moving a finding.

The runtime suite and offline probe run in each layer. Layer 8 adds native
gateway acceptance and the Caddy/Compose proxy fixtures. Layer 9 adds opt-in
credentialed dialogue evaluation, and layer 10 supplies its second scenario
matrix. Layer 11 retains those checks and adds the complete builder guidance.
Native gateway acceptance runs real OpenClaw against local Plow and model
fixtures. It does not establish phone or email provider acceptance.

The largest diffs have different reading paths. In layer 9, begin with the
117-line runner and its assertions before the canonical JSON. In layer 10,
review case IDs, decisions and human criteria before the additional JSON. In
layer 11, read `docs/README.md` to choose a tutorial, SOP or reference, then
review prompt changes separately from examples and teaching prose.

## Content and evidence provenance

Before updating this review guide and the readiness links, the consolidated
aggregate at `c788dbe1affa9cf20fa6989dc269dcc142956f11` had the exact Git tree of
`6e8314ff2b0f1b0621fce166bff9612922cf1297`. Both tree IDs were
`ba3050ee63986180621d3bb8ef038dab5cf575dc`.
The final consolidation changes only `docs/review-stack.md` and
`docs/readiness.md` beyond that source. Runtime, prompts, tests, scenario inputs
and failure evidence retain their content.

Historical CI for the original final source passed the type check, 402 runtime
tests, offline probe, proxy origin/restart checks and 18 native gateway checks.
This fork reruns CI for every new layer. Use the PR's current checks for that
layer, rather than transferring the historical count to an earlier boundary.
Paid model evaluation is opt-in and was not executed during consolidation.

Every PR has images and a video uploaded with GH `--attach`. Their captions name
the source and distinguish an actual localhost dashboard, an evidence review
page and a fixture. A recording of retained model outputs is not a new live
conversation. Preserve the six material AI findings and the failed provider
calls when assessing quality.

The fork's `main` was initially observed at `a8e24176a0b5ce9299f57ae19471f048048073ac`
and later at upstream `ddbaa6bc0f9e071d9411777b91590e755e367d84` during setup.
The earlier commit is retained at `codex/archive-fork-main-before-review`.
The existing `codex/contractor-hours` and `codex/native-agent-extensions` branches
remain separate. Integrating reviewed base changes with an existing agent
variant requires its own diff and validation.

## Preserve the original reviews

Closing an upstream PR does not delete its discussion, commits or visual evidence.
The table maps each original PR to the new layer that owns its relevant changes.
Some follow-ups span runtime, scenarios and documentation, so their mapping has
more than one destination. Old automated approval remains historical evidence.

| Original upstream PR | New owning layers |
| --- | --- |
| [#66](https://github.com/plow-pbc/plow-openclaw-agent/pull/66) | [Layer 1](https://github.com/EnzoTironi/zoen-plow/pull/1) |
| [#67](https://github.com/plow-pbc/plow-openclaw-agent/pull/67) | [Layer 2](https://github.com/EnzoTironi/zoen-plow/pull/2) |
| [#68](https://github.com/plow-pbc/plow-openclaw-agent/pull/68) | [Layer 3](https://github.com/EnzoTironi/zoen-plow/pull/3) |
| [#73](https://github.com/plow-pbc/plow-openclaw-agent/pull/73) | [Layer 2](https://github.com/EnzoTironi/zoen-plow/pull/2) |
| [#69](https://github.com/plow-pbc/plow-openclaw-agent/pull/69) | [Layer 4](https://github.com/EnzoTironi/zoen-plow/pull/4) |
| [#74](https://github.com/plow-pbc/plow-openclaw-agent/pull/74) | [Layer 4](https://github.com/EnzoTironi/zoen-plow/pull/4) |
| [#70](https://github.com/plow-pbc/plow-openclaw-agent/pull/70) | [Layer 5](https://github.com/EnzoTironi/zoen-plow/pull/5) |
| [#75](https://github.com/plow-pbc/plow-openclaw-agent/pull/75) | [Layer 6](https://github.com/EnzoTironi/zoen-plow/pull/6) |
| [#71](https://github.com/plow-pbc/plow-openclaw-agent/pull/71) | [Layer 7](https://github.com/EnzoTironi/zoen-plow/pull/7) |
| [#72](https://github.com/plow-pbc/plow-openclaw-agent/pull/72) | [Layer 8](https://github.com/EnzoTironi/zoen-plow/pull/8) |
| [#76](https://github.com/plow-pbc/plow-openclaw-agent/pull/76) | [Layer 9](https://github.com/EnzoTironi/zoen-plow/pull/9) |
| [#64](https://github.com/plow-pbc/plow-openclaw-agent/pull/64) | [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#81](https://github.com/plow-pbc/plow-openclaw-agent/pull/81) | [Layer 9](https://github.com/EnzoTironi/zoen-plow/pull/9) |
| [#82](https://github.com/plow-pbc/plow-openclaw-agent/pull/82) | [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#83](https://github.com/plow-pbc/plow-openclaw-agent/pull/83) | [Layer 9](https://github.com/EnzoTironi/zoen-plow/pull/9), [Layer 10](https://github.com/EnzoTironi/zoen-plow/pull/10), [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#79](https://github.com/plow-pbc/plow-openclaw-agent/pull/79) | [Layer 8](https://github.com/EnzoTironi/zoen-plow/pull/8), [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#80](https://github.com/plow-pbc/plow-openclaw-agent/pull/80) | [Layer 6](https://github.com/EnzoTironi/zoen-plow/pull/6), [Layer 10](https://github.com/EnzoTironi/zoen-plow/pull/10), [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#84](https://github.com/plow-pbc/plow-openclaw-agent/pull/84) | [Layer 7](https://github.com/EnzoTironi/zoen-plow/pull/7), [Layer 10](https://github.com/EnzoTironi/zoen-plow/pull/10), [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#85](https://github.com/plow-pbc/plow-openclaw-agent/pull/85) | [Layer 8](https://github.com/EnzoTironi/zoen-plow/pull/8), [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#86](https://github.com/plow-pbc/plow-openclaw-agent/pull/86) | [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |
| [#87](https://github.com/plow-pbc/plow-openclaw-agent/pull/87) | [Layer 9](https://github.com/EnzoTironi/zoen-plow/pull/9), [Layer 11](https://github.com/EnzoTironi/zoen-plow/pull/11) |

The previously closed [PR #78](https://github.com/plow-pbc/plow-openclaw-agent/pull/78)
retains the discussion that led to strict evaluator controls, prompt compaction
and consolidated scenario decisions.

## Maintain the stack after feedback or merges

Record the old parent head before updating it. Rebase only the child's own
commit onto the updated parent, then propagate the change upward. After
inspecting the references, use
`git rebase --onto NEW_PARENT OLD_PARENT_SHA CHILD_BRANCH`.
Push a stack-owned branch with a lease so a concurrent update is not overwritten.
Check that every PR still contains one owning layer, and rerun CI for changed heads.

Merge from layer 1 upward into the isolated review base. If a parent is
squash-merged, retarget its child to that base and rebase the child's own commit
onto the resulting commit. Propagate that change to descendants. Do not merge
the top documentation layer while its dependencies remain unmerged. Do not
reset an existing agent variant's branch to this review base.

A parent update can change a child's effective runtime while the child's own
diff stays small. Review the resulting image, ownership/migration behavior and
failure paths, including the preserved volume. Request a new review for the
new head rather than treating an older approval as current.

## Open acceptance gates

The implementation and consolidation do not establish a finished base release.
The targeted comparison contains 48 real-model replies and six remaining
material AI findings. Five of those findings passed the literal assertions.
The broader run exhausted provider credits with HTTP 402 and produced no
completions. Further paid requests need restored credits or an authorized
alternative.

Human qualitative review, corrected live conversations, provisioned-mailbox
acceptance and a full restore with resumed live traffic remain open. The owned
isolated installation proved CLI boot and an explicit Compose/dashboard restart,
but it did not prove every channel journey. Keep those gates in the
[validation SOP](experience-validation.md) and the
[release SOP](builder-sops.md#sop-5-release-a-candidate) until the matching evidence exists.
