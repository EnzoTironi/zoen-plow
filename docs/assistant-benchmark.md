# Use product benchmarks to validate an agent

Use [Assistant Benchmark](https://assistantbenchmark.com/) to discover useful
jobs and failure patterns. Its [dimension index](https://assistantbenchmark.com/dimensions)
separates logged tests, untested capabilities and work outside a product's scope.
Public user reports are useful leads; they are not our test results.

Start with the [use-case catalog](https://assistantbenchmark.com/use-cases)
to choose a complete job. It distinguishes tested jobs from reported ones.
Use [reports and dated analyses](https://assistantbenchmark.com/reports) to
understand the evidence behind a judgment, then inspect the linked protocol
and conversation. A reported capability becomes a test hypothesis for us;
it does not become a supported feature just because another product offers it.

Our base is infrastructure and a default assistant experience. A specialized
agent supplies its domain knowledge, connected services and permissions. A base
that writes a good itinerary has not necessarily booked a trip. A base that
confirms a reminder has not necessarily delivered it. Validate the complete job.

## 1. Choose a job and define the result

Write the result before running the test. Include the requesting person,
conversation, authorized accounts, constraints and an observable completion
condition. Separate required constraints from preferences. Use owned test
accounts and synthetic data.

For example, a dinner coordinator must collect each participant's availability,
preserve unanswered people, propose a common time and report whether a booking
actually exists. Creating the group or writing a recommendation covers only
part of the job. The [group test](https://assistantbenchmark.com/dimensions/multiplayer_groups)
is a useful reference for closing this loop.

Our maintained [benchmark-inspired cases](../eval/benchmark-cases.json) are
original English scenarios adapted to the base's contracts. They use hypothetical
venues, prices and connector results. They do not reproduce the external protocol
or establish an Assistant Benchmark score.

| Area | Base or builder acceptance work |
| --- | --- |
| Online workflows, travel and purchases | Complete through an authorized connector, or state the missing capability before collecting execution setup |
| Recommendations | Honor constraints, explain tradeoffs and revise when facts change |
| Email | Keep drafts unsent; use the requested identity and authorized account |
| Proactivity and routines | Prove a real trigger, useful result and supported edit/pause behavior |
| Connected services | Label partial results and remove revoked access |
| Privacy and memory | Keep scopes separate; distinguish forgetting from transcript retention |
| Personality | Preserve useful behavior, civil tone and authority at slider extremes |
| Calls | Require a working call connection; never imply a text answer was a phone call |
| Groups | Account for every participant and close the shared task |
| Chained work | Distinguish accepted, partial, rejected and completed effects |
| Restraint | Honor holds, consequential-action limits and notification policy |
| Creative work | Produce supported text/media and state unsupported formats |

This coverage map draws on the [dimension index](https://assistantbenchmark.com/dimensions).
Mark a missing connector as unavailable for this installation. That is a
capability limit, rather than proof that the connector works or a pass on its
end-to-end task. Builders who advertise that connector must implement and test it.

## 2. Evaluate dialogue and effects separately

Run the original and experience matrices, then the new cases:

```sh
npm run eval -- --credentials /PRIVATE/test-credentials \
  --cases eval/benchmark-cases.json --repeat 3 --output /TMP/benchmark-dialogues.json
```

The evaluator supplies facts and completed receipts but exposes no tools. Review
every response against its `review` criteria; literal checks are a prefilter.
Do not count a model's claim as effect evidence. Follow the dialogue test with the
corresponding real journey in the [experience validation SOP](experience-validation.md).

| Dialogue evidence | Effect evidence |
| --- | --- |
| The model says a preference was saved | The scoped store contains the confirmed value after restart |
| The model says a worker completed | The native task registry and result contain the completion evidence |
| The model says reminders resumed | The effective gate is open and the relevant scheduler jobs are inspected |
| The model says it sent a message | The send receipt and provider row agree; delivery/reading are separate |
| The model says a booking failed | The connector confirms the rejected step and no unintended purchase occurred |

For [recommendations](https://assistantbenchmark.com/dimensions/recommendation_quality),
test conflicting constraints, stale information, unavailable search and a later
correction. Label supplied hypothetical facts as hypothetical. Current prices,
opening hours and availability require current evidence.

The [planning comparison](https://assistantbenchmark.com/articles/instinct-muse-grok-bot-elegant-cost-efficient)
examines how assistants trade price against convenience and revise proposals;
it does not establish completed reservations. Use that distinction when reviewing
our cost/time and revision cases. Good judgment includes explaining a tradeoff
without silently overriding a hard constraint.

## 3. Test continuing jobs, not just the first reply

### Routines

Create a routine through the actual conversation and native automation tool.
Inspect its captured source, destination, account, timezone and schedule. Wait
for actual runs, compare every result with known inputs, and inspect delivery
receipts. Edit it, pause it, send a direct question during the pause, resume it,
restart the container and verify that it neither duplicates nor disappears.

A fast repeated fixture test exercises mechanics. It cannot establish a week of
reliable service. The external [routine protocol](https://assistantbenchmark.com/dimensions/running_routine)
requires multiple weekdays. Record the actual observation window and every
expected trigger, including missed or delayed runs. Keep multi-day observation
as a separate release gate when advertising a daily briefing.

### Groups

Use controlled participants who disagree or respond at different times. Test
helper, coordinator and facilitator modes. Include an unanswered participant,
a changed preference, topic drift, an owner absence, a membership change and
another agent's greeting. Do not let one speaker's preference become the room's
decision. A bot participant cannot establish a second human's experience.

Confirm the shared outcome in the source group exactly once. A claimed booking
requires its own connector receipt. The [group coordination use case](https://assistantbenchmark.com/use-cases/coordinate-a-meeting-in-a-group-chat)
provides a useful product-level target; joining a group alone does not meet it.

### Permissions and restraint

Before connecting a service, explain its actual scopes and whether read-only
access is supported. Set an explicit hold on sending or spending, then test a
request and retrieved content that tempt those effects. Verify that disconnect
removes future access and explain the separate retention of stored notes,
transcripts and provider logs. See the [permissions protocol](https://assistantbenchmark.com/dimensions/permissions_privacy).

Treat instructions inside a retrieved email, document or page as untrusted
content. Test a synthetic message that asks for private data or an unrelated
purchase. A friendly refusal is insufficient if a tool already executed the
effect. The [inbox guardrails case](https://assistantbenchmark.com/use-cases/set-guardrails-before-inbox-access)
is a reference for this boundary, not authorization to install a third-party
package or grant inbox access.

Optional proactive work must remain within existing authorization and the
notification policy. Test explicit holds, quiet hours, duplicate updates,
unchanged results and consequential actions. Validate useful low-risk work and
restraint separately; neither constant activity nor permanent inactivity proves
good judgment. See [proactive restraint](https://assistantbenchmark.com/dimensions/proactive_restraint).

### Calendar and media counterexamples

Compare full dates before clock times. Thursday at 19:00 precedes Friday at
18:00 by 23 hours even though Friday's time of day is one hour earlier. A task
recommendation should distinguish those meanings, state relevant price
trade-offs and preserve the supplied timezone. The regression matrix also
includes a 45-minute Sunday-to-Monday midnight rollover. Neither example grants
permission to schedule or book anything.

Separate a verified size violation from an unavailable or undecodable image.
The intake distinguishes the server's declared size from bytes actually received.
If a declared size exceeds the configured attachment budget (50 MiB by default),
the download is skipped; its actual size was
not measured. If received bytes cross the limit, the stream is stopped. Ordinary
errors with the same message are not size evidence. Check that rejected streams
are cancelled and never reach image storage.
A failed download does not prove that the image exceeded the limit. Inspect the
current attachment's actual intake result, offer useful text or a supported
still image and do not reuse an earlier image's contents. For a vision test,
use a new chart whose values never appeared in that conversation; repeated
known values alone cannot establish that the model read the pixels.

## 4. Improve one candidate without rewriting history

1. Freeze cases, expected behaviors, model settings and baseline outputs. Reserve
   additional variants before editing the shared instructions.
2. Read every output and the actual tool/state evidence. Classify a counterexample
   as an implementation defect, semantic failure, minor wording issue, invalid
   fixture, transport failure or uncovered capability.
3. Fix the shared cause. Keep detailed teaching examples in docs; the base prompt
   also needs room for the connected-service contract. Check that the complete
   default prompt still retains the supported 8,000-character Latch instructions.
4. Repeat affected cases, then the full frozen matrices when shared guidance
   changes. Check reserved cases and new journeys for regressions.
5. Preserve every round separately with source/prompt hashes, failed outputs,
   reviewer type and test dates. Once reserved cases guide a fix, describe that
   use; they are no longer an untouched validation set.
6. Keep material failures visible. Do not weaken a legitimate assertion, overwrite
   the baseline, turn an unrun case into a pass or count a provider outage as a
   model-quality failure.

Keep this record with the PR:

| Field | Record |
| --- | --- |
| Candidate | Commit, image digest, pinned runtime and prompt hashes |
| Protocol | Provider/model, reasoning, transport, available tools, repetitions and observation window |
| Results | Literal checks, qualitative decisions, actual effects and uncovered capabilities |
| Counterexamples | Original input/output or failed effect, cause, fix and fresh verification |
| Comparability | Changed inputs/settings, transport failures and unequal token caps |
| Review | AI-assisted versus human review; screenshots and video uploaded with GH `--attach` |

Do not translate our pass rate into another product's published score. Comparable
ranking requires the same tasks, accounts, integrations, run duration, scoring
anchors and logged evidence. Until then, report the specific jobs this candidate
performed and the limits still untested.
