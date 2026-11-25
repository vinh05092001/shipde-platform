# TASK-AI-227 — Recover a run and preview its cleanup without changing state

## Control

| Field | Value |
| --- | --- |
| Work Item ID | TASK-AI-227 |
| Feature ID | N/A |
| Status | READY_FOR_AUTHOR |
| Delivery order | 349 |
| Allowed paths | `tools/ai-brain/resume-status.js`, `tools/ai-brain/validate-work-item.js`, `tools/ai-brain/hygiene-check.js`, `tools/ai-brain/test/task-ai-227-ai-os-pilot.test.js`, `docs/product-spec/work-items/TASK-AI-227.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Dependencies | TASK-AI-226, merged in #646 |
| Base | 886cbe297ffa7ce5456d126309a4d26a53a1178f |
| Assigned author | GEMINI (AGY 08) |
| Reviewer | Independent reviewer on a different model |
| Branch | feat/task-ai-227-ai-os-pilot |
| Risk | LOW. Local read-only tooling with deterministic tests. |

## Business outcome

A fresh agent session can see what an existing run needs next, check whether a Work Item is ready to hand off, and identify what the run can safely clean up. Use the existing orchestration checkpoint for runtime facts and the delivery register for Work Item metadata.

## Reuse and scope

Use the checkpoint reader in orchestrate/runtime-helpers.js and the current checkpoint schema in orchestrate/checkpoint.js. Use reconcile.parseCsvRecords for register CSV and the existing Work Item metadata conventions. Report a missing, malformed or mismatched record explicitly. Keep CLI inputs explicit and output structured JSON without raw prompts, secrets, or worker logs.

These are standalone operator commands. Leave live routing, gates, checkpoint schema, AGENTS.md, hooks and automatic deletion outside this pilot. The pilot makes no provider/network calls and uses no Docker daemon or credentials for its acceptance tests.

Pilot boundary for `hygiene-check`: because no live worktree-lease/activity producer exists yet in the repository, historical or self-declared checkpoint flags never prove current inactivity; clean shipped worktrees are therefore conservatively held in `retained` with `ACTIVITY_UNOBSERVED` (`candidates: []`) until a live lease observer is wired in a follow-up Work Item.

## Acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | resume-status takes a WI ID, an explicit checkpoint path and an explicit checkout. A new process reads an existing mid-review run and reports the bound run, owner, base/head and review state where recorded, with the next actionable check or a reconciliation reason. Compare locally available Git HEAD with the durable record. Missing PR/CI/worker observations remain unknown and do not become PASS. A mismatched head must not recommend launching or merging. | Integration. Start two independent CLI processes against the same checkpoint and disposable repo, then change HEAD and check that the report changes to reconciliation. |
| AC2 | validate-work-item checks a specified WI against the corresponding register record. Verify identity, branch, status, allowed paths, acceptance and verification sections. Report missing or conflicting fields and duplicate register rows with a nonzero exit. Report only readiness of the handoff metadata. | Integration. Valid item passes, missing scope, mismatched branch and duplicate row fail. |
| AC3 | hygiene-check requires --dry-run and reports ownership-supported cleanup candidates, retained resources and unknowns for the selected run. For a worktree, eligibility requires a recorded path/owner, matching observed checkout, clean and inactive status, plus evidence of the shipped change. Hold anything dirty, active, outside the expected root, junction-ambiguous or lacking evidence. Inventory other resource types only when the checkpoint provides sufficient bindings and observations. | Integration. Bound clean candidate is listed, dirty/active/unbound fixtures are retained. A foreign worktree with a matching name is never included as a cleanup candidate. |
| AC4 | Commands do not write state, launch duplicate jobs, invoke providers, or stop/delete resources. Missing/invalid input produces a clear nonzero result. | Integration. Compare checkpoint, register, git state and fixtures before and after CLI invocations, and exercise refusal without --dry-run. |

## Verification

- Observe relevant new tests fail on the original code before implementing the commands.
- Run: node --test tools/ai-brain/test/task-ai-227-ai-os-pilot.test.js
- Run the existing AI-brain test suite and standard pre-push checks. Report declared and executed test counts, exact SHA and any unverified checks.
- Stop after the three commands and acceptance tests. Submit the exact head for independent review.
