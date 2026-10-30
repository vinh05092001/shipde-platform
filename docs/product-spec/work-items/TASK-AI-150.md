# TASK-AI-150 — Controller selects only sources with current quota evidence

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-150` |
| Feature ID | N/A — Controller infrastructure |
| Status | `READY_FOR_CODEX` |
| Delivery order | 268 |
| Dependencies | `TASK-AI-58`, `TASK-AI-65`, `TASK-AI-73`; ranking and route probe modules are present at baseline `9d63d9f4c1a0953c1c6f7bb06604f3bc3c42b2c7` |
| Assigned author | Codex — implementation explicitly assigned by the task owner in `p-ai-150` |
| Risk | MEDIUM — candidate admission and refusal evidence |
| Allowed paths | `tools/ai-brain/ranking.js`, `tools/ai-brain/routing.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/orchestrate.js`, `tools/ai-brain/writer-selection.js`, `tools/ai-brain/sources.js`, `tools/ai-brain/sources.json`, focused ranking/dispatch tests under `tools/ai-brain/test/`, this Work Item, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/task-ai-150-exclude-exhausted` |
| Pull Request | PR #478 (`feat/task-ai-150-exclude-exhausted`) |

## Business outcome

The Controller excludes sources whose quota is exhausted or whose cooldown is active, even when their quality score is high. Capacity observations expire under a configured freshness policy. A stale or unknown quota cannot put a source first until a bounded live probe verifies that exact candidate. When all candidates fail admission, the Controller returns `NO_ELIGIBLE_CANDIDATE` with reasons and evidence.

The reported 2026-10-30 reviewer dry run put two unavailable sources first. Both item ranking and profile ranking must enforce the same admission rule because `dispatch --dry-run --item TASK-AI-146 --role reviewer.code` uses profile ranking.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`, “Decision statuses” and “Evidence levels”: unknown evidence must remain unknown.
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`, “Boundaries”: evidence must support an availability claim.
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`, “Shared platform”: this Work Item changes Controller infrastructure and implements no product Feature ID.
- `AGENTS.md`, “Code review rules / Business completeness” and “Verification”: model data comes from configuration/live sources and changed behavior requires consequential tests.
- `docs/product-spec/work-items/TASK-AI-65.md`, “In scope” item 3 and `AC-AI-65-03`: exhausted candidates fail admission before scoring.
- `docs/product-spec/work-items/TASK-AI-73.md`, `AC-AI-73-04` and `AC-AI-73-05`: quota admission and named rejection evidence belong to the Controller.
- Task-owner assignment for `TASK-AI-150`, requirements (1)–(3): exclude exhausted/cooling sources, expire quota evidence, probe uncertain sources, and return an explicit empty outcome.

## Preconditions and dependencies

The isolated branch and installed dependencies are available. The baseline includes `rankAndRecord`, `rankForProfile`, quota-store readings, the configured route probe budget, and `route-probe.boundedProbe`. No provider credential file is required or read by this change. Deterministic tests inject HTTP responses and use their own temporary directories.

## Author boundary

The task owner explicitly assigned this implementation to Codex. The author cannot independently approve or merge it. Scope is limited to quota admission, the existing probe boundary, decision evidence, compatibility fixtures, and the delivery handoff. A separate reviewer must review the published commit.

## In scope

- Exclude exhausted and cooling candidates before they appear in a selectable ranking; retain their identity, cause, scope and quota evidence in the decision.
- Apply configured quota freshness to all access paths, including normalized cached readings. An unexpired cooldown remains a blocking observation.
- Require fresh evidence from a live probe bound to the complete candidate key before uncertain quota permits first selection.
- Reuse the existing bounded route probe and registry route/credential references; use configuration for freshness, timeouts and probe budget.
- Reject failed, timed-out, unbound, stale or missing probe evidence. An HTTP success with exhausted remaining quota still fails admission.
- Record `NO_ELIGIBLE_CANDIDATE` and rejected candidates through the existing decision writer, including when no winner exists.
- Cover item ranking, profile ranking, and the dispatch path with focused regression tests.

## Out of scope

Changing model priors, scoring weights, provider inventories, credentials, gate configuration, validators, product APIs, tenant data, frontend screens, or merge policy. No live worker launch, commit, push or merge is authorized for this run.

## Business rules and edge cases

- `AI-150-R01`: exhausted quota and active cooldown are admission failures, independent of score.
- `AI-150-R02`: an observation older than the configured quota window, without a timestamp, or from the future cannot prove capacity. An explicit unexpired cooldown continues to block.
- `AI-150-R03`: unknown capacity requires current live probe evidence for the same seven-part candidate key. A plain success flag, another account's probe or historical task completion does not meet this requirement.
- `AI-150-R04`: failed probes, cancellation, unavailable transport and budget expiry fail closed. No response body, credential or header value is copied into decision evidence.
- `AI-150-R05`: fresh open/tight quota keeps the existing scoring behavior; probe evidence never overrides known exhausted capacity.
- `AI-150-R06`: no admitted candidate produces `NO_ELIGIBLE_CANDIDATE` with `chosen: null` and named rejection evidence. Non-dry decisions are recorded even on refusal.

## UI states

No screens change. The CLI exposes admitted candidates, probe evidence, exclusions and the explicit empty outcome. Dry-run evidence remains a preflight result, not proof of a completed worker task.

## API, event and data impact

The synchronous ranking APIs retain their return shape with additive quota/probe evidence and an explicit outcome. Asynchronous dispatch reuses the bounded live probe before final ranking. Freshness is a positive configuration value; missing or invalid configuration fails closed. Decision JSONL remains owned and scrubbed by `decisions.js`. No database migration, product route or tenant-owned entity changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-AI-150-01` | A high-quality candidate has fresh exhausted quota | Excluded from ranking; named quota rejection and account/candidate evidence retained | Focused item/profile ranking tests |
| `AC-AI-150-02` | A candidate has an active cooldown | Excluded without consuming live probe budget | Cooldown and probe-effect tests |
| `AC-AI-150-03` | Open quota is older than the configured freshness window | Becomes unknown; no first selection until an exact-candidate live probe succeeds | Stale quota, probe and dispatch tests |
| `AC-AI-150-04` | Current open quota is supplied | Existing score order and selection remain valid | Fresh quota regression tests |
| `AC-AI-150-05` | Every candidate is excluded | `NO_ELIGIBLE_CANDIDATE`, `chosen: null`, rejected reasons and refusal JSONL | All-excluded decision test |
| `AC-AI-150-06` | Probe fails, times out, is stale/unbound, or reports zero remaining quota | Candidate fails admission; no secret response content in the decision | Negative probe/evidence tests |
| `AC-AI-150-07` | Freshness configuration is absent or invalid | Configuration error or unverified capacity; selection fails closed | Configuration tests |

## Verification commands

Run changed/failing AI-brain test files with `node --test --test-concurrency=1 --test-reporter=spec`, then `node scripts/ai/check-no-hardcode.mjs` and `pnpm exec prettier --check` on changed files. The worker-specific Windows exception leaves the full `pnpm test:brain` suite to Linux CI. TypeScript is outside this Work Item, so app lint/typecheck do not apply. Final command names, counts and limitations are recorded with the handoff after verification.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| 1 | `0eed5fd47e4f1dae86059105c36cb95292c95f47` | CHANGES_REQUIRED | Resolved: preserve underlying observation timestamp in accountHeadroom calculations; require validated live probe (hasLiveQuotaProbe) before quota promotion; fix Prettier formatting across changed files; fix negative probe assertions to start from valid proof and invalidate one field per case |
| 2 | Current HEAD | READY_FOR_CODEX | Resolves all round 1 P1/P2 review findings with regression tests; CI formatting and ai-brain test suites green |

## Residual limitations

Native sources without fresh quota and without a supported live probe remain unavailable until the operator refreshes evidence. Deterministic tests mock route probes and do not touch external network.
