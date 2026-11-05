# TASK-AI-166 — Refresh live model evidence and restore unattended coordination

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-166` |
| Feature ID | N/A — internal Controller |
| Status | `IN_PROGRESS` |
| Delivery order | 273 |
| Dependencies | Existing Controller scanners and governed publication contracts on origin/main |
| Assigned author | Codex — operator assigned repair/implementation, 2026-11-02 |
| Risk | HIGH — unattended git and review coordination |
| Allowed paths | `tools/ai-brain/`, `package.json`, this Work Item, one register row, `AI-TOOLCHAIN-DECISIONS.md`, `.oc/pr-body.md` |
| Reviewer | Fresh independent reviewer from a different model family |
| Branch | `feat/task-ai-166-refresh-model-catalogue` |
| Pull Request | Coordinator updates the existing TASK-AI-166 PR after host commit; no push from this sandbox |

## Business outcome

The operator can refresh the Controller's own live model listings, benchmark priors and quota evidence daily without Hermes. The Controller can coordinate bounded writer and review rounds while preserving normal publication gates and exact-SHA independent review.

## Source references

- `BASELINE-AND-DECISIONS.md`: DEC-005, DEC-013, HUMAN-DECISION-CONCURRENCY-CEILING-2026-09-22.
- `PRODUCT-VISION-SCOPE.md`: Boundaries and Definition of full product.
- `MASTER-FEATURE-CATALOG.md`: Identity, carriers, audit and settlement are review checklist domains only; this item changes no product behavior.
- `AGENT-CONTRACT-DETAILS.md`: Role separation, Pull Request evidence, Verification, Security and tenancy.
- `AI-TOOLCHAIN-DECISIONS.md`: Provider and harness policy, Transient failure classification, TASK-AI-166 operational refresh and coordination.
- Operator instruction 2026-11-02: Part 1 plus Part 2 ("gộp vào"), sandbox override forbidding git writes during authoring.
- Read-only `.oc/reference/{pipeline.sh,route.js,push-review.sh,fanout.sh,codex-delta-review.sh}`: implementation evidence, never authority or executable dependencies.

## Preconditions and dependencies

Live refresh requires outbound public HTTPS, configured OpenCode providers, host-authenticated `agy models`, and the existing per-user scheduled lane adapters. Tests inject their boundaries and never require credentials, Docker or live model calls. The host coordinator requires installed commit hooks and git metadata access.

## Ambiguity and clarification markers

Operator explicitly authorizes the combined scope and Codex implementation. Sandbox failures are recorded as evidence; they never justify invented live scores, removals or freshness. Optional fan-out is disabled unless requested in coordinator configuration. Shared files belong to lane 1; unresolved ownership or conflicts stop the item for a human.

## Author boundary

Codex implements the explicitly assigned Controller changes. It cannot approve itself, merge a PR, push, commit, modify protected gates, or inspect authentication stores in this turn. Runtime git code is exercised through injected command boundaries in node:test; the coordinator executes it on the host with real hooks.

## Slice sizing rule

The operator approved both parts in this one Work Item on 2026-11-02, superseding the advisory 400-line sizing target for this delivery. One branch, one PR, one register row.

## In scope

Live discovery, sourced priors, ordered repeatable refresh, 48-hour dispatch freshness refusal, daily scheduling, writer liveness/cooldown, host commit handoff, pre-review merge and publication guards, different-family two-phase review, persisted four-round history, quota-aware writer escalation, optional disjoint repair lanes, review metrics and summary.

## Out of scope

Product APIs/UI/database, auth stores, new model credentials, automatic PR merge, `.github/`, gate configs, allowlists, baselines and semgrep rules; executing reference scripts.

## Business rules and edge cases

- BR-166-01: Refresh priors, discovery, quota in that order; failed stages keep last good evidence and cannot mark a catalogue fresh. An unchanged successful listing can advance observation freshness. Failed listings cannot remove candidates.
- BR-166-02: Scores retain source URLs, retrieval time, verified flag and declared scale. Benchmark evidence never averages distinct benchmarks; existing prior normalization stays separate.
- BR-166-03: Live dispatch dry-run fails with `STALE_CATALOGUE` after 48 hours, or for missing/invalid evidence; fixture-injected candidate tests do not assert live freshness.
- BR-166-04: Writer alive means live PID OR current launch log modified within 180 seconds. Dead reroutes occur at most once per item per 480 seconds; unknown liveness fails closed.
- BR-166-05: A dead sandbox writer's output is committed by the host excluding `.oc/`, `.serena/`, `.oc-codex-task.md`; hooks are mandatory, never `--no-verify`.
- BR-166-06: Clean merge of origin/main precedes push/review. Only register CSV conflicts may use deterministic row union; all other conflicts abort and return findings. Bad subjects, protected paths and whitespace reject publication. Red CI returns CHANGES_REQUIRED with zero reviewer tokens; pending CI waits.
- BR-166-07: Two-phase full-contract review verifies tenant scope, RBAC/empty scope, negative tests, acceptance rows, integer VND, idempotency/reconcile, audit/PII, UI states and FIXED/NOT FIXED prior findings before an open sweep. Reviewer family differs from every contributing writer family, including repair lanes and earlier rounds. Exact SHA is mandatory. Mixed finding status and truncated output cannot authorize PASS. Four unsuccessful rounds produce STUCK.
- BR-166-08: Quota/rate log classifications exclude that model until cooldown expires, without storing raw logs. One failed round triggers stronger-model preference; high-risk work prefers score >=80. Maximum two model launches in twenty minutes across items. OpenCode routes must exist in its configuration.
- BR-166-09: Optional <=3 lanes use separate worktrees, connected file ownership and lane-1 shared contracts. Unexpected file writes or merge conflicts stop fan-out; merge in lane order and re-review the combined SHA.
- BR-166-10: One metrics record per review, deduplicated by PR/SHA/round; summary reports median/p90 rounds to PASS, CI red rate and tokens per confirmed merged PR. Daily refresh is single-flight and persisted; failed refresh retries on the next day and freshness still blocks dispatch.

## Constitution check

- [x] Tenant/RBAC: no product access changes; both are mandatory review checks.
- [x] Audit/sensitive data: no raw credentials or provider error bodies in committed evidence.
- [x] Integer VND and carrier reconciliation: unchanged, explicitly reviewed.
- [x] Lowest useful negative tests: discovery, quota, publication, independent review, bounded output and metadata masking, with red/green evidence in `.oc/pr-body.md`.
- [ ] Complete live acceptance evidence: AC-166-01/02 retain their live-log requirement; unavailable host checks are identified separately in `.oc/pr-body.md` and must be completed by the coordinator.

## UI states

N/A — internal CLI. Truthful CLI states: waiting for writer/CI, refresh error, CHANGES_REQUIRED, PASS, STUCK; PASS alone never means merged.

## API, event and data impact

Adds `ai:refresh-catalogue`, `ai:metrics` and a coordinator CLI; versioned discovery freshness/report JSON and local `.oc/` state/history. Discovery source results include an additive `incomplete` flag. Refresh uses a private per-attempt discovery observation before atomically publishing the canonical freshness record. Persisted author families and per-launch quota observation times survive restart. Existing imports and candidate consumers remain compatible. No product schema migration.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-166-01 | Refresh and current public payloads | Ordered calls, provenance preserved, failures never fabricated | unit + live log |
| AC-166-02 | Discovery succeeds, changes, fails or stays unchanged | Honest additions/removals; failure preserves history; freshness only on success | unit + live log |
| AC-166-03 | Catalogue age exceeds 48h | Dispatch dry-run refuses STALE_CATALOGUE | unit |
| AC-166-04 | Writer alive or dead inside cooldown | No overlapping writer; bounded reroute; sandbox output host commit | unit |
| AC-166-05 | Main merge, publication guards, red/pending CI | Clean/CSV-only merge; reject bad push; red skips reviewer | unit |
| AC-166-06 | Review family, prompts, history and budget | Full two-phase exact-SHA review; four failures STUCK | unit |
| AC-166-07 | Quota, failed round, risk and launch limit | Exclusion/escalation and only configured OpenCode routes | unit |
| AC-166-08 | Optional findings fan-out | <=3 disjoint worktrees, shared lane 1, fixed merges, conflict stop | unit |
| AC-166-09 | Review metrics and daily loop | One row/review; correct summary; single-flight daily refresh | unit |
| AC-166-10 | Handoff | One row, LF, ten-section PR body, exact checks and source changes | docs-inspection; test not applicable: handoff document |

## Task breakdown

- [x] T01 Write failing scanner/coordination tests, including round-4 findings and prior-round regressions.
- [x] T02 Implement refresh/scanner/freshness and coordinator runtime repairs.
- [x] T03 Preserve previously recorded live evidence; do not invent additions, removals, scores or freshness. Attempt/check results are in `.oc/pr-body.md`.
- [x] T04 Run available verification, repair the append-only ledger regression without changing its immutable prefix/hash evidence, and prepare the coordinator handoff. Record incomplete host/API checks explicitly.

## Verification commands

`pnpm ai:refresh-catalogue`; `pnpm lint`; `pnpm format:check`; `pnpm typecheck`; `pnpm --filter @shipde/api test`; `pnpm test`; `pnpm test:brain`; `node scripts/ai/check-no-hardcode.mjs`; `git diff --check origin/main...HEAD`; `git diff --check` for uncommitted output. Runtime tests inject Git commands, and the discovery regression reads the working ledger without writing Git objects. Git publication and Docker control remain host-only under the operator instruction. Exact local results are in `.oc/pr-body.md`.

## Codex review record

Round 3 reviewed `4d708d736fd27508fbd08ab1191fabee9e068b9b`; round 4 reviewed `df63795e5ea10091ade7f94254f6ca006df25513`. Both returned `CHANGES_REQUIRED`; the complete supplied history remains in `.oc/history.md` and current findings in `.oc/review.txt`. File targets split into <=300 lines each, AC tests confirmed green (27/27). A fresh independent review must evaluate the coordinator's resulting exact SHA after the required checks. Author tests and self-checks do not grant PASS.

## Residual limitations

Git publication, Docker control and full live discovery require the coordinator. The LF-only OpenAPI assertion passes after byte-equivalent local LF normalization; product source and contract content remain unchanged from `origin/main`. The API command stalls in its DB-backed RBAC HTTP suite, and the root test command exits at the API task without a conclusive failing-step diagnostic. These are incomplete verification results, not PASS claims. Owner: host coordinator; next action: complete live and full-suite verification, commit `[TASK-AI-166] Address review: preserve discovery and independent publication` through installed hooks, run CI, and obtain independent review of that exact SHA. Finding-to-test mappings and command outcomes are in `.oc/pr-body.md`.
