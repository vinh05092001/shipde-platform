# TASK-AI-229 — Retire the former Docker writer lane and review shortcut

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-229` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 351 |
| Dependencies | `TASK-AI-228`, merged in #649 |
| Base | `ee70d7cb3ad1573e25adc9d896a568aa8a2b33cc` |
| Assigned author | `GEMINI` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-229-retire-docker-worker` |
| Allowed paths | `scripts/ai/docker-worker/Dockerfile`; `scripts/ai/docker-worker/docker-compose.yml`; `scripts/ai/docker-worker/start-worker.bat`; `scripts/ai/docker-worker/account-fingerprint.js`; `scripts/ai/create-docker-shortcut.ps1`; `scripts/ai/review-pr.ps1`; `.trivyignore`; `docs/product-spec/scripts/validate_docs.py`; `scripts/ai/README.md`; `docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md`; `tools/ai-brain/seed-accounts.js`; `tools/ai-brain/test/benchmarks.test.js`; `tools/ai-brain/test/task-ai-229-retire-docker-worker.test.js`; `docs/product-spec/work-items/TASK-AI-229.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |

## Business outcome

Remove the retired Docker writer and the old review shortcut so current tooling does not advertise unavailable paths. Preserve the native AGY pool and active review path.

## Operator decision and scope

On 2026-11-26 the operator approved retiring these entry points and the two narrowly scoped gate changes, as relayed by Claude from the direct decision. Remove the four listed files in `scripts/ai/docker-worker/`, `create-docker-shortcut.ps1`, and `review-pr.ps1`. Remove the live seed record `agy-docker-b` from `seed-accounts.js`. Check existing benchmark coverage against surviving seed accounts and adjust the existing test only if it relied on the retired record. Keep synthetic test fixtures and retirement history, including the `sources.json` retired record.

Remove only the Docker worker DS-0002 exception and its rationale in `.trivyignore`. Verify that it documented only the retired Dockerfile. Remove only the `review-pr.ps1` required-file entry in the documentation validator. Update the live README and Windows runbook to refer to the current Controller review path. Retain `bootstrap-worktrees.ps1`, `install-clis.ps1`, `install-control-shortcut.ps1`, and `protect-main.ps1`.

Do not modify historical Work Items, workflow/CI configuration, tool manifests or generic Docker support. Do not uninstall or delete anything on the host. Product feature authoring stays paused.

## Acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Retired files are absent and no current runtime, operator documentation or validator points to them. `agy-docker-b` is absent from active seeds. | Focused guard test fails on the base and passes after removal. Check tracked references across source, docs, scripts and configuration. Report historical and synthetic fixture hits separately. |
| AC2 | The validator no longer requires the old shortcut, the Docker-only exception is gone, and the other operator scripts and gate entries are retained. | Documentation validator and exact-path diff. Exercise the existing Trivy configuration scan or report remote evidence pending. |
| AC3 | Existing live seed consumers, the native AGY workflow and review tests pass. | Benchmark, scheduler and focused guard tests, then the full AI-brain suite. Record declared and reported tests, exact SHA and gates. |

## Verification

- `node --test tools/ai-brain/test/task-ai-229-retire-docker-worker.test.js tools/ai-brain/test/benchmarks.test.js tools/ai-brain/test/scheduler-reported.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- `git diff --check`
- `node scripts/ai/check-no-hardcode.mjs`

Run the existing pre-push gate and report Trivy evidence on the exact release head. Leave the gate configuration unchanged apart from the two approved removals. Stop after this Work Item and send the exact head for independent review.
