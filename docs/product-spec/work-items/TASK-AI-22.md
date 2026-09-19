# TASK-AI-22 — Promotion gate for proposed memory

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-22` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `155` |
| Dependencies | `TASK-AI-21` (register row 154 `BLOCKED_DEPENDENCY`; its specification, schema and seed are on `origin/main`, the `shipde-brain` repository is not) |
| Assigned author | `CLAUDE` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-22.md`, `tools/ai-brain/lessons/promote.js`, `tools/ai-brain/lessons/lesson-schema.json`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/promote.test.js`, `tools/ai-brain/acceptance/ac-22-*.js`, `tools/ai-brain/acceptance/lib/lesson-promotion.js`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-22` |
| Pull Request | `pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `delivery_order` 155, `work_item_id` `TASK-AI-22`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register has not cleared the dependency block. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 155, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`. The Codex review record below is therefore `NOT_REVIEWED`.
- **This block is true, not stale.** Unlike `TASK-AI-21`'s own block on `TASK-AI-17`, the dependency here is not delivered: `TASK-AI-21`'s register row is not `MERGED`, and the `shipde-brain` repository that the promotion gate writes into does not exist. What is on `origin/main` is `TASK-AI-21`'s specification, the lesson schema and its conformance seed (PR #74). This specification is authored against those so it is ready when the block clears; it does not claim the block has cleared.
- `AC-AI-22-01` compares the `Status` cell above with register row 155 and fails if they diverge.

## Business outcome

`AI-TOOL-06` says agent memory and self-created skills are untrusted until human-reviewed into `shipde-brain`. `TASK-AI-21` gave a lesson a lifecycle (`proposed`, `approved`, `superseded`, `rejected`) and required an approved lesson to name an approver. Nothing yet moves a lesson from `proposed` to `approved`, and nothing stops the wrong party doing it.

The gap was measured, not assumed. `TASK-AI-21`'s schema requires `approved_by` to be a non-empty string on an approved lesson, but JSON Schema cannot compare two fields. Setting the first approved seed lesson's `approved_by` to its own `proposed_by` (`codex-review`) and validating it with `lesson-schema.js`'s `matchesViolations` returns **no violation**. An agent that proposes a lesson and writes its own identity as approver passes the schema today.

This Work Item adds the promotion gate: the only path from `proposed` to `approved`, which refuses self-approval and approval by any agent, and records who approved what, from which commit, and when.

## Source references

- `tools/ai-brain/lessons/lesson-schema.json` — `status` enum, `proposed_by`, `approved_by`, the `allOf` approval branch
- `tools/ai-brain/lessons/lesson-seed.json` — five promoted lessons, each approved by the human owner; one `proposed` lesson with `approved_by: null`
- `tools/ai-brain/acceptance/lib/lesson-schema.js` — `matchesViolations`, `approvedRequirementViolations`
- `docs/product-spec/work-items/TASK-AI-21.md` — `AI-21-R05` "Only a human review approves"
- `AI-TOOL-06` in `AI-TOOLCHAIN-DECISIONS.md`
- `AGENTS.md` § Role separation — "The author never approves its own work"
- Register row 156, `TASK-AI-23` (no specification file yet) — retrieval restricted to approved lessons, downstream of this gate
- `docs/product-spec/work-items/TASK-AI-39.md` — admission scanning of lessons and skills, a separate gate

## Preconditions and dependencies

- `TASK-AI-21` must be delivered: the `shipde-brain` repository exists and is pinned in the manifest, and register row 154 is `MERGED`. Until then this item stays `BLOCKED_DEPENDENCY`.
- The lesson schema declares both `proposed` and `approved` (`AC-AI-22-03`).
- Every promoted lesson the repository ships already satisfies the gate's rule (`AC-AI-22-05`), so the rule can be introduced without rewriting history.

## Author boundary

`CLAUDE` is the assigned author. Scope is the promotion gate and its record.

Prohibited in this Work Item:

- Do NOT let any agent identity — including the author of this Work Item — approve a lesson, in code, fixture or seed.
- Do NOT approve, reject or supersede any real lesson as part of delivering this Work Item. A seed change is a fixture, and it keeps the human owner as approver.
- Do NOT implement retrieval (`TASK-AI-23`) or admission scanning (`TASK-AI-39`).
- Do NOT create the `shipde-brain` repository (`TASK-AI-21`, human action).
- Do NOT touch `.github/`, `scripts/verify-*` or `docs/product-spec/scripts/`.
- Do NOT advance the register status by hand.

## In scope

1. **Propose.** `node tools/ai-brain/cli.js lesson propose` writes a lesson with `status: proposed`, `approved_by: null`, the proposer identity and the 40-character `source_commit`, and validates it against the schema before writing.
2. **Promote.** `node tools/ai-brain/cli.js lesson approve <id>` is the only writer of `status: approved`. It requires a human approver identity, refuses self-approval and agent approval, re-validates the result against the schema, and writes it.
3. **Reject and supersede.** The same gate writes `rejected` (approver stays `null`) and `superseded` (naming the replacing lesson, which must itself be approved).
4. **Approver identity from the environment, not the lesson.** The approver is the authenticated GitHub login of the operator running the command, never a value the proposer wrote into the file.
5. **Promotion record.** Every transition is appended as one JSON line: lesson id, from-state, to-state, approver, proposer, source commit, instant.
6. **Schema tightening where JSON Schema allows it.** `rejected` keeps `approved_by: null`; `proposed` gains `approved_by: null`.
7. **Unit tests** in `tools/ai-brain/test/promote.test.js`, no network.

## Out of scope

- Retrieval of approved lessons into prompts (`TASK-AI-23`).
- Scanning lesson content for injected instructions (`TASK-AI-39`).
- Creating, protecting or pinning the `shipde-brain` repository (`TASK-AI-21`).
- Automatic promotion of any kind.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-22-R01` | **An agent may propose.** Any agent identity may write a lesson in `proposed` with `approved_by: null`. |
| `AI-22-R02` | **No one approves their own lesson.** A transition to `approved` whose approver equals the lesson's `proposed_by` is refused with `SELF_APPROVAL`. |
| `AI-22-R03` | **No agent approves.** A transition to `approved` whose approver is an agent identity (`claude`, `claude-code`, `codex`, `codex-review`, `gemini`, `agy`, `9router`, `dsh`, `cline`, `chatgpt-codex-connector[bot]`, or any `<agent>/<model>` form) is refused with `AGENT_APPROVAL`, even when it differs from the proposer. |
| `AI-22-R04` | **The approver is authenticated, not declared.** The gate reads the approver from the operator's authenticated GitHub login; an `approved_by` already present in the input is ignored and reported. |
| `AI-22-R05` | **Only `proposed` can be approved or rejected.** Approving an `approved`, `rejected` or `superseded` lesson is refused naming its current state. |
| `AI-22-R06` | **A superseding lesson must itself be approved.** A lesson is superseded only by an approved lesson that exists. |
| `AI-22-R07` | **Every transition validates against the schema before it is written.** A result that violates `lesson-schema.json` is not written. |
| `AI-22-R08` | **Every transition is recorded.** The promotion record is append-only; a transition that was not recorded did not happen. |
| `AI-22-R09` | **No PII and no credentials** in a lesson, a record or an error (`AI-21-R09`). |

## UI states

No screen. CLI outcomes: proposed, approved, rejected, superseded, refused (with rule id and reason).

## API, event and data impact

- No database, API or carrier change.
- New append-only promotion record under the brain's lesson directory.
- `lesson-schema.json` may gain `approved_by: null` for `proposed`, a tightening that the committed seed already satisfies.

## Acceptance matrix

**Evidence boundary.** Every row runs against the real files in this repository or a copy of one written to `os.tmpdir()`. No row cites this document as evidence, no row compares two literals written into its own command, no command is stored inline in a table cell, and no row pins a count that drifts with the repository.

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-22-01` | Control table status and delivery register row 155 cannot diverge | `node tools/ai-brain/acceptance/ac-22-01-status-alignment.js` | `0` | `Control status matches register row 155: BLOCKED_DEPENDENCY (declared TASK-AI-22)` | `tools/ai-brain/acceptance/ac-22-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-22-02` | **Negative proof, must fail:** a tampered copy of this specification diverges from the real register and is detected | `node tools/ai-brain/acceptance/ac-22-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-22-02-status-divergence.js`; command stderr |
| `AC-AI-22-03` | The real lesson schema declares both `proposed` and `approved` | `node tools/ai-brain/acceptance/ac-22-03-lifecycle-states.js` | `0` | `LIFECYCLE_STATES_PRESENT: tools/ai-brain/lessons/lesson-schema.json declares proposed and approved` | `tools/ai-brain/lessons/lesson-schema.json`, `tools/ai-brain/acceptance/lib/lesson-promotion.js` |
| `AC-AI-22-04` | **Negative proof, must fail:** a copy of the real schema without `proposed` is rejected by the rule `AC-AI-22-03` runs | `node tools/ai-brain/acceptance/ac-22-04-proposed-state-removed.js` | `1` | `LIFECYCLE_CONTRACT_VIOLATED: LIFECYCLE_STATE_MISSING: proposed` | `tools/ai-brain/acceptance/ac-22-04-proposed-state-removed.js`; command stderr |
| `AC-AI-22-05` | No promoted lesson in the real seed was approved by its proposer or by an agent | `node tools/ai-brain/acceptance/ac-22-05-no-self-approval.js` | `0` | `NO_SELF_APPROVAL: every promoted lesson in tools/ai-brain/lessons/lesson-seed.json names an approver who is neither its proposer nor an agent` | `tools/ai-brain/lessons/lesson-seed.json`, `tools/ai-brain/acceptance/lib/lesson-promotion.js` |
| `AC-AI-22-06` | **Negative proof, must fail:** a copy of the real seed whose first approved lesson is approved by its own proposer is rejected by the rule `AC-AI-22-05` runs | `node tools/ai-brain/acceptance/ac-22-06-self-approval-detected.js` | `1` | `PROMOTION_CONTRACT_VIOLATED: SELF_APPROVAL:` | `tools/ai-brain/acceptance/ac-22-06-self-approval-detected.js`; command stderr |
| `AC-AI-22-07` | The three negative proofs exit 2, not 1, where no repository exists | `node tools/ai-brain/acceptance/ac-22-07-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 3 subjects exited 2 with no repository present` | `tools/ai-brain/acceptance/ac-22-07-outside-repository.js`; command stdout |
| `AC-AI-22-08` | The register does not overstate | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js`; command stdout |
| `AC-AI-22-09` | Documentation validation passes | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py`; command stdout |

The Expected Output String is matched as a substring of the stated stream, never by equality: `AC-AI-22-05` appends an `(inspected: N)` count and `AC-AI-22-07` prints a `CONTROL:` line first, both evidence rather than assertions. `AC-AI-22-05` also refuses a promoted lesson that names no approver (`MISSING_APPROVER`), so "names an approver" is enforced, not assumed. `AC-AI-22-06` pins only the violation kind; the lesson it tampers is whichever approved lesson comes first in the seed.

### Why each negative proof is not vacuous

| Row | Negative proof of | CONTROL (real input accepted) | Tamper (copy in `os.tmpdir()`) | Rejection |
|---|---|---|---|---|
| `AC-AI-22-02` | `AC-AI-22-01` | the real specification agrees with row 155 | `Status` cell set to `READY_FOR_AUTHOR` | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-22-04` | `AC-AI-22-03` | the real schema declares both states | `proposed` removed from the `status` enum | `LIFECYCLE_CONTRACT_VIOLATED`, exit `1` |
| `AC-AI-22-06` | `AC-AI-22-05` | the real seed has no self-approved lesson | first approved lesson's `approved_by` set to its `proposed_by` | `PROMOTION_CONTRACT_VIOLATED: SELF_APPROVAL`, exit `1` |

Each negative proof exits `2` when its source is missing (measured by `AC-AI-22-07`) and also exits `2` when a regression stops the rule detecting its tamper, so a broken proof never reports success with `0`.

### One rule, one module

The lifecycle and approval rules live once in `tools/ai-brain/acceptance/lib/lesson-promotion.js`; `AC-AI-22-03` to `-06` all require it, and the gate delivered by this Work Item must use the same identity list. The status pair reuses `lib/spec-status-alignment.js`.

### Observed baseline (evidence only, not asserted)

Every command in the matrix was run on this branch and produced the exit code and string stated. `AC-AI-22-05` inspected 5 promoted lessons; the count is printed as evidence and not asserted. The measurement that `TASK-AI-21`'s schema accepts a self-approved lesson was made with `matchesViolations(schema, lesson)` returning `[]` for the same tampered lesson `AC-AI-22-06` builds.

## Verification commands

```bash
node tools/ai-brain/acceptance/ac-22-01-status-alignment.js
node tools/ai-brain/acceptance/ac-22-02-status-divergence.js
node tools/ai-brain/acceptance/ac-22-03-lifecycle-states.js
node tools/ai-brain/acceptance/ac-22-04-proposed-state-removed.js
node tools/ai-brain/acceptance/ac-22-05-no-self-approval.js
node tools/ai-brain/acceptance/ac-22-06-self-approval-detected.js
node tools/ai-brain/acceptance/ac-22-07-outside-repository.js
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-22. The register records `BLOCKED_DEPENDENCY`, so no verdict is claimed. |

## Residual limitations

- **No dependency-merged row.** The neighbouring specifications prove a stale block from Git. This block is true, so a row asserting `TASK-AI-21` merged would be false, and a row matching `TASK-AI-21` by commit message would pass on the specification commit alone and overstate delivery.
- **The agent identity list is a list.** A new harness or reviewer name that is not added to `AGENT_IDENTITIES` would be treated as human by `AI-22-R03`. `AI-22-R04` (the approver comes from an authenticated GitHub login) is what closes this in the gate; the acceptance rows cannot.
- **The gate itself has no positive row.** `promote.js` does not exist at HEAD. `AC-AI-22-03` to `-06` assert what the gate must preserve and what it must refuse.
- **The seed's approvals are not re-verified.** The rows prove no seed lesson names its proposer or an agent as approver; they cannot prove the named human actually reviewed it.

## Contradictions found in neighbouring specifications

1. **`TASK-AI-21` `AI-21-R05` says "No agent approves its own lesson", and its schema cannot enforce it.** `approved_by` is only required to be non-empty on an approved lesson. A lesson approved by its own proposer passes `matchesViolations` with no violation. `TASK-AI-21` is not edited here; this Work Item owns the enforcement.
2. **`TASK-AI-21`'s register row reads `BLOCKED_DEPENDENCY` on `TASK-AI-17`, and `TASK-AI-21.md` documents that block as stale**, while this row's block on `TASK-AI-21` is true. Clearing `TASK-AI-21`'s own block would move it to `BACKLOG`, not `MERGED`, so it would not by itself clear this row.
