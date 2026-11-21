# TASK-AI-185 — Patch the effect ReDoS advisory reported by Trivy

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-185` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | None |
| Assigned author | Claude Code (operator instruction 2026-11-21: fix what is failing) |
| Risk | `LOW`: transitive version raised within the same major version |
| Allowed paths | `pnpm-workspace.yaml`; `pnpm-lock.yaml`; `docs/product-spec/work-items/TASK-AI-185.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model from the author |
| Branch | `feat/task-ai-185-effect-cve` |

## Business outcome

The `dependency-scan` check (Trivy, TASK-AI-37) passes again on every pull request. It fails because `effect@3.21.0` has CVE-2026-121707 (HIGH, a ReDoS in the regular expression that `Schema.TemplateLiteral` compiles), and the fix is published in 3.22.1. `effect` reaches the workspace only through `@prisma/config@6.19.3`, which pins it exactly, so no direct dependency can be bumped.

## Scope and acceptance

1. `pnpm-workspace.yaml` overrides add `effect: ^3.22.1`, next to the existing Trivy overrides from GOAL-AUTOCLAW-REPOS-7.
2. `pnpm-lock.yaml` resolves `effect` to a 3.22.x release of at least 3.22.1 (3.22.5 today). Nothing else in the lockfile changes.
3. CI `dependency-scan` passes. Install, typecheck, tests and build in `current-application` still pass with the new `effect` under Prisma.

## Verification

- `git diff pnpm-lock.yaml`: only the override line and the `effect` entries change.
- CI: `dependency-scan`, `current-application`, `application-gate`, `contract`.
