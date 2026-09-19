# TASK-AI-31 — Promptfoo qualification gate before an account is used

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-31` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `164` |
| Dependencies | `TASK-AI-20; TASK-AI-25` |
| Assigned author | `CLAUDE` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-31.md`, `tools/ai-brain/qualification-gate.js`, `tools/ai-brain/test/qualification-gate.test.js`, `tools/ai-brain/acceptance/ac-31-*.js`, `tools/ai-brain/acceptance/lib/qualification-gate.js`, `tools/ai-brain/cli.js`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-31-impl-214433` |
| Pull Request | pending |

### Status transition ledger

Register `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `164` (`work_item_id` `TASK-AI-31`) is authoritative under `AGENTS.md` Unit of delivery. It records `BLOCKED_DEPENDENCY`; the Control table records the same value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | Register `delivery_order` `164`, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Binding: this file must never declare `READY_FOR_CODEX` or later while the register records `BLOCKED_DEPENDENCY`; the Codex review record below is therefore `NOT_REVIEWED`. Dependencies `TASK-AI-20` and `TASK-AI-25` are both merged on `origin/main`. `TASK-AI-30` (connection test/probe store) is also merged (`9a8c6b9`) and is a de-facto prerequisite not listed in the register's dependency cell — recorded here as a planning gap per `AGENTS.md` § Source of truth. `AC-AI-31-01` compares the Control `Status` cell against register row `164` and fails on divergence.

## Business outcome

`TASK-AI-30` proved a model can connect and answer. Nothing yet promotes that answer into a standing role grant. Today every account either declares `qualifiedRoles` in its registry fixture — a hand-edited placeholder — or has no `qualifiedRoles` field at all, in which case `capabilities.disqualify` leaves the gate open because the array condition only fires when the field is present. Neither state is evidence of fitness.

`TASK-AI-31` closes this gap: a model takes a role only after passing the fixed test set for that role. The qualification gate reads the probe result written by `TASK-AI-30`, evaluates it against the role's pass criteria, and writes a `qualifiedRoles` entry into the account registry only when the criteria pass. An account that never passes the gate, or whose result is stale, is never granted a role through this path.

Two properties make this safe: (1) **Grant is bounded** — the gate adds a role to `qualifiedRoles`; it never removes one (removal is `TASK-AI-25`'s narrowing rule). (2) **Grant requires source** — every written entry carries `{ roleId, grantedAt, source: 'qualification-gate', probeOutcome }` so the origin of every grant is auditable.

## Source references

- `AGENTS.md` § Role separation — qualification gate is the return path for a narrowed role; `TASK-AI-25` § AI-25-R03: "Removed role returns only via `TASK-AI-30`/`TASK-AI-31` probe with source measured."
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § TASK-AI-25 qualifiedRoles feedback rule — restoration through any path other than a fresh measured qualification is forbidden; `EVIDENCE_STALE` is a read-time refusal.
- `tools/ai-brain/capabilities.js:111-116` — `disqualify` reads `account.qualifiedRoles`; comment says "Promptfoo results are meant to write this field."
- `tools/ai-brain/qualification.js` — `RESULT_PATH`, `loadResults`, `recordKey`, `validateResultShape`, `OUTCOMES` — the stable probe result store this Work Item reads.
- `tools/ai-brain/acceptance/lib/role-feedback.js` — `WRITTEN_FIELDS`, `validateEntry`, `STALE_AFTER_MS` — narrowing rule; grant rule must be consistent and must not duplicate it.
- `tools/ai-brain/capabilities.js` — `ROLES`, `listRoles`, `getRole` — the fixed role set the gate evaluates against.
- `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `164` — registers `TASK-AI-31`, `BLOCKED_DEPENDENCY`, dependencies `TASK-AI-20; TASK-AI-25`.

## Preconditions and dependencies

| Dependency | Evidence |
|---|---|
| `TASK-AI-20` — Work Item spec coverage | Merged on `origin/main`; `git log origin/main --grep=TASK-AI-20` returns commits. |
| `TASK-AI-25` — qualifiedRoles feedback | Merged at `origin/main` (`3c6ac43`); `acceptance/lib/role-feedback.js` present. |
| `TASK-AI-30` — Connection test/probe store | Merged at `origin/main` (`9a8c6b9`); `tools/ai-brain/qualification.js` with `loadResults`/`recordKey` present. |

## Author boundary

`CLAUDE` is the assigned author per `AGENTS.md` § Role separation. Risk is `HIGH` because the gate writes `qualifiedRoles` into the account registry — a field that gates model dispatch. No production path currently writes `qualifiedRoles` from evidence; this Work Item is the first.

Prohibited: writing `grade`, `reviewGrade`, `quality`, `preference`, `limits`, `tier`, `cost`, `capabilities`, `forbiddenDomains`, or any credential; removing any role (that is `TASK-AI-25`); touching `capabilities.js`, `accounts.js`, `offerings.js`, `scheduler.js`, `executor.js`; introducing a second copy of `evaluateNarrowing`/`applyNarrowing`.

## In scope

1. **Gate module** `tools/ai-brain/qualification-gate.js`: reads probe result store, evaluates pass criteria per role, writes `qualifiedRoles` entries. Injectable dependencies; no network calls.
2. **Gate rule** `tools/ai-brain/acceptance/lib/qualification-gate.js`: the grant rule in exactly one place.
3. **CLI surface** `tools/ai-brain/cli.js`: `qualify` subcommand.
4. **Unit tests** `tools/ai-brain/test/qualification-gate.test.js`: injected functions only; no network, no real registry.
5. **Acceptance rows** `ac-31-01` through `ac-31-10`.

## Out of scope

- Removing roles from `qualifiedRoles` (narrowing is `TASK-AI-25`).
- Coding grade derivation (`TASK-AI-27`), review grading (`TASK-AI-41`).
- Wiring the probe itself (`TASK-AI-30`).
- Modifying `capabilities.js`, `accounts.js`, `offerings.js`, `scheduler.js`, `executor.js`.
- Any UI/dashboard surface.

## Business rules and edge cases

| Rule ID | Rule |
|---|---|
| `AI-31-R01` | A role is granted only when the probe result records `outcome: 'pass'` and is not stale (within `GRANT_CACHE_WINDOW_MS`). A `fail`, `timeout`, or `refused` outcome never grants. |
| `AI-31-R02` | Grant writes `qualifiedRoles` and `qualificationHistory` only. Must not write grade, quality, preference, limits, tier, cost, capabilities, forbiddenDomains, or any credential. |
| `AI-31-R03` | Grant never removes a role. `qualifiedRoles` after grant is a superset of what it was before. |
| `AI-31-R04` | Every written entry carries `{ roleId, grantedAt, source: 'qualification-gate', probeOutcome: 'pass' }`. An entry without `source` is invalid. |
| `AI-31-R05` | A stale result (older than `GRANT_CACHE_WINDOW_MS`) must be refused with `RESULT_STALE`, not silently treated as no result. |
| `AI-31-R06` | The grant rule lives in `tools/ai-brain/acceptance/lib/qualification-gate.js` and nowhere else. `qualification-gate.js` re-exports it by reference; a private copy is prohibited. |
| `AI-31-R07` | An account with no probe result, or whose result file is absent or corrupt, is refused with `RESULT_MISSING` or `RESULT_CORRUPT`, not silently granted. |
| `AI-31-R08` | If `qualifiedRoles` already contains the role, the grant is idempotent: history entry updated, no duplicate added, no other field changed. |
| `AI-31-R09` | The grant result record must not carry a credential or any secret value. |
| `AI-31-R10` | `--role` is optional; when omitted, the gate evaluates all known roles and grants those whose probe result passes. |

## UI states

N/A — CLI only. Output states: `QUALIFIED`, `ALREADY_QUALIFIED`, `RESULT_MISSING`, `RESULT_STALE`, `NOT_QUALIFIED`, exit 2 for bad argv.

## API, event and data impact

- **Reads:** `tools/ai-brain/qualification.js` result store; account registry via `accounts.loadRegistry` / `accounts.updateAccount`.
- **Writes:** `account.qualifiedRoles` array and `account.qualificationHistory` array via `accounts.updateAccount`. No other field written.
- **Idempotency:** calling `qualify` twice with the same passing result is idempotent.
- No migrations, no external events, no jobs.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-31-01` | Control table status matches register row 164 | Status cells agree | `node tools/ai-brain/acceptance/ac-31-01-status-alignment.js` exit 0, `CONTROL_ALIGNED` stdout |
| `AC-AI-31-02` | Tampered register reports divergence | Exit 1, `STATUS_DIVERGENCE` stderr | `node tools/ai-brain/acceptance/ac-31-02-status-divergence.js` exit 1 |
| `AC-AI-31-03` | Register declares dependency `TASK-AI-20; TASK-AI-25` | Declared dependency matches | `node tools/ai-brain/acceptance/ac-31-03-dependency-declared.js` exit 0 |
| `AC-AI-31-04` | Register with repointed dependency is refused | Exit 1, `DEPENDENCY_WRONG_DECLARED` stderr | `node tools/ai-brain/acceptance/ac-31-04-dependency-repointed.js` exit 1 |
| `AC-AI-31-05` | Gate rule holds over compliant grant configuration | Exit 0, `GATE_HOLDS` stdout | `node tools/ai-brain/acceptance/ac-31-05-gate-rule.js` exit 0 |
| `AC-AI-31-06` | Non-compliant grant configuration is refused | Exit 1, `GATE_VIOLATED` stderr | `node tools/ai-brain/acceptance/ac-31-06-gate-rule-refused.js` exit 1 |
| `AC-AI-31-07` | Grant result record carries no credential | Exit 0, `GRANT_CREDENTIAL_FREE` stdout | `node tools/ai-brain/acceptance/ac-31-07-grant-credential-free.js` exit 0 |
| `AC-AI-31-08` | A grant result carrying a credential is refused | Exit 1, `CREDENTIAL_IN_GRANT` stderr | `node tools/ai-brain/acceptance/ac-31-08-credential-in-grant.js` exit 1 |
| `AC-AI-31-09` | Negative proofs exit 2 outside repository | Each negative proof exits 2 with `SOURCE_MISSING` | `node tools/ai-brain/acceptance/ac-31-09-outside-repository.js` exit 0 |
| `AC-AI-31-10` | Unit tests pass | `fail 0` with tests > 0 | `node tools/ai-brain/acceptance/ac-31-10-unit-tests.js` exit 0 |

## Verification commands

```
node tools/ai-brain/acceptance/ac-31-01-status-alignment.js
node tools/ai-brain/acceptance/ac-31-02-status-divergence.js
node tools/ai-brain/acceptance/ac-31-03-dependency-declared.js
node tools/ai-brain/acceptance/ac-31-04-dependency-repointed.js
node tools/ai-brain/acceptance/ac-31-05-gate-rule.js
node tools/ai-brain/acceptance/ac-31-06-gate-rule-refused.js
node tools/ai-brain/acceptance/ac-31-07-grant-credential-free.js
node tools/ai-brain/acceptance/ac-31-08-credential-in-grant.js
node tools/ai-brain/acceptance/ac-31-09-outside-repository.js
node tools/ai-brain/acceptance/ac-31-10-unit-tests.js
node --test tools/ai-brain/test/qualification-gate.test.js
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | No Codex verdict posted. Register row stays `BLOCKED_DEPENDENCY`; `AC-AI-31-01`/`AC-AI-31-03` prove from repo+cell. |

## Residual limitations

- **Register row 164 stays `BLOCKED_DEPENDENCY`.** Only the governed reconciler (`TASK-AI-19`) clears it; `AC-AI-31-01` proves from both the repo file and register cell.
- **`TASK-AI-30` not in declared dependencies.** The register row lists `TASK-AI-20; TASK-AI-25`, not `TASK-AI-30`. The probe result store is a prerequisite in practice; this is a planning gap recorded here.
- **No live dispatch wiring tested end-to-end.** `qualification-gate.js` writes `qualifiedRoles` via `updateAccount`; `capabilities.disqualify` already reads it. Full dispatch integration is not tested here.
- **Probe is connectivity only.** A passing probe says the model answered; coding grade remains `TASK-AI-27`'s scope.

