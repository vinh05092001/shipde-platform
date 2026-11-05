# THIS ROUND = ONE STEP (TASK-AI-160)

Jev rated the whole job hard, so it is split into small steps; this round is one of them.

Step 1 of this job: reproduce the failing CI step locally exactly as CI runs it, find the ROOT CAUSE of the first error, fix only that cause, and write the cause and the command you used in .oc/diagnosis.md. Do not change anything else.

CI: CI failing: contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.
Error seen: Pull Request contract validation failed:
Error seen: ##[error]Process completed with exit code 1.

Then run the narrow check for this step, commit "[TASK-AI-160] <what this step fixed>" and stop.

---
Full task for context only (do NOT do the rest now):

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 659e275d1a0761c160be7dac975c4ac90e6e27b0

1. **P1 — CI failing:** contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 126979578544) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.16/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.16/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.16/x64/lib
Pull Request contract validation failed:
- missing PR section: ## Source requirements
- missing PR section: ## Scope integrity
--
- missing PR section: ## Risks and limitations
- missing PR section: ## Codex review
- PR is not marked READY_FOR_CODEX
##[error]Process completed with exit code 1.
```


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.

SEARCH RULE (2026-11-05): never search the whole disk (`find /`, `find C:/`, `dir /s C:\`, `Get-ChildItem C:\ -Recurse`). One such command ran 8 hours at 100% CPU. Search only inside this repository (`rg`, `git ls-files`, `find . -path ./node_modules -prune -o ...`). Tools are already on PATH (`npx prettier`, `pnpm`, `node`); do not hunt for their binaries. Any command expected to run over 5 minutes must be wrapped in `timeout 300`.
