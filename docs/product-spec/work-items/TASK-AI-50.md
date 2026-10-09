# TASK-AI-50 — Hermes pinned execution and Jev advisory under the Controller

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-50` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `185` |
| Dependencies | `TASK-AI-49; TASK-AI-58; TASK-AI-56` |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/**`, `docs/product-spec/work-items/TASK-AI-50.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex - fresh independent task` |
| Branch | `feat/task-ai-50-hermes-on-main` |
| Pull Request | `TBD` |

## Business outcome

The Controller can assign work to Hermes without giving Hermes authority to
choose or replace its model route. Hermes receives a pinned seven-part
candidate and returns a structured result. Jev provides only confidence-gated
closed-question advice; uncertain advice is handed back to the reasoning
controller and is never eligible as a selected candidate.

## Source references

- `AGENTS.md` - role separation, one writer per Work Item, no hidden fallback.
- `docs/product-spec/work-items/TASK-AI-49.md` - source registry and harness
  adapter boundary.
- `docs/product-spec/work-items/TASK-AI-58.md` - Controller MVP ownership of
  source selection, scoped fallback and checkpoint resume.
- `docs/product-spec/work-items/TASK-AI-56.md` - AI-brain test suite in CI.
- `tools/ai-brain/sources.json` - Hermes and Jev registry entries.

## Preconditions and dependencies

TASK-AI-49, TASK-AI-58 and TASK-AI-56 are present on `origin/main` for this
branch. Hermes and Jev are exercised through injected fakes in tests; this Work
Item does not require network access or real external agents.

## Author boundary

`CLAUDE` authors it because the change touches dispatch controller behavior,
failure scoping, process ownership and checkpoint semantics. 9Router is not
appropriate: the task is not mechanical and crosses the harness/controller
boundary. No database, web UI, carrier or money behavior is in scope.

## In scope

- `getHarness('hermes')` returns a Hermes adapter with `launch`, `resume`,
  `inspect`, `stop`, durable handle support and process-tree stop semantics.
- Hermes dispatch receives the full seven-part candidate key and cannot change
  model, provider, account, gateway, upstream or quota scope.
- Hermes disables internal fallback and bounded retry; the Controller owns
  fallback, reservation, evidence, cooldown and decision logging.
- Hermes progress inspection classifies running-with-progress, stalled and
  unknown from real activity markers.
- Context-window verification for Hermes fails closed.
- Hermes subagent slices require visible Controller assignments/accounting.
- Jev answers only closed questions and returns `UNDECIDED` on low confidence,
  malformed output, unavailable service or insufficient evidence.
- `UNDECIDED` advice is handed to the reasoning controller and is never
  eligible as a candidate decision.
- Regression tests cover the fourteen numbered acceptance scenarios.

## Out of scope

- Installing Hermes or Jev on the host.
- Live network calls to Hermes, Jev, 9Router or any model provider.
- A second registry, quota store, ranking engine or checkpoint store.
- Web/UI changes, snapshots and generated logs.
- Merging, pushing, approving or writing a Codex PASS verdict.

## Business rules and edge cases

1. The Controller is the only selector of candidate, fallback, quota, cooldown,
   fairness, reservation, ranking and checkpoint decisions.
2. Hermes runs a pinned assignment and reports a structured outcome:
   `{candidateKey,status,errorClass,failureScope,retryable,cooldownUntil,checkpoint,artifacts,lastProgressAt,reason}`.
3. A quota, gateway, upstream, account or model failure is scoped by the
   classifier, and the next Controller attempt avoids the failed scope where a
   different failure domain exists.
4. A Hermes candidate with missing or too-small context window is rejected
   before launch.
5. A quiet Hermes process with no real progress past the stall window is
   `STALLED`, not healthy.
6. Jev may advise on classification only; it never writes code, ranks
   candidates, owns quota or starts a worker.

## UI states

No user-facing UI changes.

## API, event and data impact

No API, database, migration or event changes. Local decision and evidence logs
continue to be written through existing AI-brain modules.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-50-01` | `getHarness('hermes')` | Adapter is returned | `tools/ai-brain/test/task-ai-50.test.js` test 1 |
| `AC-AI-50-02` | Controller dispatches Hermes | Full candidate key is passed intact | test 2 |
| `AC-AI-50-03` | Hermes launch args | Candidate/model are not changed and fallback is disabled | test 3 |
| `AC-AI-50-04` | Quota failure | Structured failure includes class and scope | test 4 |
| `AC-AI-50-05` | First candidate fails | Controller selects another candidate | test 5 |
| `AC-AI-50-06` | Gateway/upstream failure | Different failure domain is preferred | test 6 |
| `AC-AI-50-07` | Resume checkpoint | Durable selected candidate is reused | test 7 |
| `AC-AI-50-08` | Stop Hermes | Whole process tree stop is invoked | test 8 |
| `AC-AI-50-09` | Running without progress | Classified as `STALLED` | test 9 |
| `AC-AI-50-10` | Hermes subagent | Refused without Controller accounting | test 10 |
| `AC-AI-50-11` | Jev low confidence | Returns `UNDECIDED` | test 11 |
| `AC-AI-50-12` | Jev undecided | Reasoning controller receives handoff | test 12 |
| `AC-AI-50-13` | Hermes adapter source | No concrete model/provider is hard-coded | test 13 |
| `AC-AI-50-14` | New source in data | Candidate appears without controller code change | test 14 |

## Verification commands

- `node --test "tools/ai-brain/test/*.test.js"`
- `python docs/product-spec/scripts/validate_docs.py`
- `pnpm format:check`
- `pnpm lint`
- `git diff --check origin/main...HEAD`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `TBD` | `TBD` | `TBD` |

## Residual limitations

None.
