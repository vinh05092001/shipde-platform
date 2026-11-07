# TASK-AI-181 — Enforce ticket route scope throughout dispatch

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-181` |
| Feature ID | `N/A — AI dispatch` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `305` |
| Dependencies | `TASK-AI-171` (available on assigned base) |
| Assigned author | `Codex CLI — temporary operator dispatch; not Controller selection` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/{cli,candidates,ranking}.js`; `tools/ai-brain/test/task-ai-181-route-scope.test.js`; this Work Item; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/report.md` |
| Reviewer | Fresh independent review; author never approves or merges |
| Branch | `fix/task-ai-181-dispatch-combo-read` |
| Pull Request | `#521` |

## Business outcome

Dispatch obeys the writer ticket's combo scope and records why other routes were refused, including after advisory/probe reentry and during execution.

## Source references

- `BASELINE-AND-DECISIONS.md` — Change control; `PRODUCT-VISION-SCOPE.md` — Boundaries; `MASTER-FEATURE-CATALOG.md` — Shared platform (all under `docs/product-spec/docs/`).
- `docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md` — Role separation, Pull Request evidence.
- `TASK-AI-171.md` — Business rules `BR-ROUTING-07/08` (combo constituents and JEV advisory); `.oc/task.md` — F521 findings P1-1 through P2-3 and combo read check; operator Ticket A overrides commit/push instructions.

## Preconditions and dependencies

Assigned HEAD `e77cb9fbe8cf0c81bc23631c213e761a21076a5d`; base branch `6c506ece23568fcf60c89bbc0284de86a6314c0e`. Offline fake registry, combo configuration, JEV and launcher only. Delivery order is max(304, 304) + 1 from local `origin/main` (`1b7a969df3bcb8563f42752f2d77a4809bf9d93c`) and the base branch; no network refresh.

## Ambiguity and clarification markers

None. Assumptions: `comboMembers` identifies the whole-combo route kind only when source metadata proves 9Router; model names alone prove neither source nor route kind. Absent scope allows individual routes. Non-writer behavior and generation callers without a role remain compatible.

## Author boundary and slice sizing rule

One bounded Work Item. Operator assigns Codex CLI as temporary writer; no ranking-selection claim. Reuse assembly, scope, source identity, candidate keys, JEV assessment, ranking and decision persistence. No scoring, JEV policy, dependencies, credentials, production network/model calls, gates or git configuration changes. Coordinator verifies and commits; author leaves edits uncommitted.

## In scope / Out of scope

In scope: the six F521 findings and read-order check. Out of scope: Controller ranking implementation, unrelated dispatch-wiring failures and external liveness proof.

## Business rules and edge cases

`BR-181-01`: A direct/non-9Router suffix collision is individual. `BR-181-02`: retain inventory before scope; combo-only refuses individuals with `NOT_IN_COMBO_CONFIG`, or `COMBO_CONFIG_UNAVAILABLE` when unread. `BR-181-03`: injected candidates and reentry obey the same scope. `BR-181-04`: preserve exclusions in decision records before launch; scoped routes never return. `BR-181-05`: retain registry-supplied launch prefix.

## Constitution check

Tenant scope, RBAC, VND and carrier reconciliation: N/A (offline AI toolchain only). Audit/sensitive data: fake fixtures, temporary stores, no credential reads. Lowest useful tests cover negative scope, unread configuration, reinjection, durable records and launch argv; no application UI, schema or migration changes.

## UI states / API, event and data impact

No UI. Internal generator `routeScope: combo-and-routes` retains inventory for the shared scope filter; other callers keep existing behavior. Internal `routeScopeExclusions` carries prior refusals through reentry, and ranking accepts `excludedRoutes` before persisting its decision. Canonical reasons above remain unchanged.

## Acceptance matrix

All executable evidence is in `tools/ai-brain/test/task-ai-181-route-scope.test.js`.

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| P1-1 | Combo-name collisions | Source and combo route kind required; real combo kept | unit: `P1-1: combo origin requires the router source and the combo route kind` |
| P1-2 | Inventory absent from discovery | Default/combined scope keep individual; limited scope records refusal; no-role caller compatible | unit: both `P1-2:` tests |
| P1-3 | Injected candidates, read/unread config | Same scope and reasons | unit: `P1-3: injected candidates receive the same scope check and reasons` |
| P2-1 | JEV/probe reentry and execute | Both reasons retained; excluded route cannot launch | integration: four `P2-1:` tests (both reasons, both paths) |
| P2-2 | Combo and individual launch | Registry `ninerouter/` prefix applied once | integration: `P2-2: launch argv preserves the registry prefix for combo and individual 9router routes` |
| P2-3 | Contract and register | This Work Item; exactly one READY_FOR_CODEX row, order 305 | docs-inspection; test not applicable: delivery metadata |
| READ | Reviewer profile reads combo early | One wasted read; no writer combo enabled | unit: `combo read order: reviewer profile wastes one read but does not enable a writer combo` |

## Task breakdown / Author checklist

- [x] Write and reproduce failing regression tests, then apply narrow fixes.
- [x] Verify named offline suites and prefix behavior; report existing failures separately.
- [x] Add contract/register and `.oc/report.md`; leave independent review and commit to coordinator.
- [ ] Coordinator runs dependency-backed checks and fresh independent review.

## Verification commands

`node --test tools/ai-brain/test/task-ai-181-route-scope.test.js tools/ai-brain/test/task-ai-66*.test.js tools/ai-brain/test/*dispatch*.test.js`; `node scripts/ai/check-no-hardcode.mjs`; `pnpm security:secrets`. Format changed supported files with Prettier `--end-of-line auto`. Exact results and environment limitations: `.oc/report.md`.

## Codex review record

No independent verdict yet. Temporary Codex writer does not approve its own work.

## Known limitations

Combo config is read before ticket role resolution when a reader is supplied. READ test demonstrates a wasted reviewer read without a wrong candidate result; left unchanged. Owner: coordinator; next action: consider read optimization separately. The four base dispatch-wiring failures remain outside scope. No live route liveness, remote CI or merge evidence is claimed.

## Residual limitations

Dependency-backed guard/format checks require installed tooling. Coordinator owns reruns and independent review before publication; see `.oc/report.md`.

## Controller reads the combo itself and refuses routes outside the ticket scope (2026-11-07)

Outcome: A ticket's route scope is enforced at every entry point, and each refused route keeps its reason through JEV and execute.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` `tools/ai-brain/candidates.js` `tools/ai-brain/cli.js` `tools/ai-brain/ranking.js` `tools/ai-brain/test/task-ai-181-route-scope.test.js` `docs/product-spec/work-items/TASK-AI-181.md`

Evidence: `task-ai-181-route-scope.test.js`: 14/14 pass, rerun by Claude; each P1 fails on e77cb9fb per author. Full suite before the A2 repair: 3235 tests, 46 fail; 1 new subtest compared with 6c506ece, repaired in A2. `repo-integration-group-6.test.js` needs tsx, absent in the worktree, so CI ai-brain-tests is its evidence.

Limitations: Mock launch and JEV verify orchestration only, not route liveness. Combo read before role is a wasted read, recorded as a known limitation. Base #518 is not merged.
