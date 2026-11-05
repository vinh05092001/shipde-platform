# TASK-AI-169 — Diagnosis

## CI failure reproduced

- Job: `current-application` (application-gate)
- Failing step: `pnpm format:check` (i.e. `tsx scripts/verify-formatting.ts`)
- Error: `❌ PHÁT HIỆN 1 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER: - .oc/pr-body.md`

## Root cause

`.oc/pr-body.md` had inconsistent trailing whitespace in its markdown table
cells. The `PASS`/`BLOCKED_BY_SANDBOX` result column was padded with
variable-length trailing spaces per row, e.g.:

```
| ... | PASS               | ... |
| ... | PASS               | ... |
| ... | BLOCKED_BY_SANDBOX | ... |
```

Prettier's markdown table formatter normalises each cell to the minimum
width required by the widest cell in that column, so the per-row padding was
flagged as unformatted.

## Fix

Ran `npx prettier --write .oc/pr-body.md` (the exact command the CI error
message recommends). Prettier re-aligned the table columns to a uniform
width and stripped the excess trailing whitespace.

## Verification (re-run as CI runs it)

```
$ npx prettier --check .oc/pr-body.md tools/ai-brain/run-ledger-helpers.js tools/ai-brain/run-ledger.js tools/ai-brain/test/run-ledger.test.js
Checking formatting...
All matched files use Prettier code style!
EXIT: 0
```

Also re-ran the full CI command `BASE_SHA=<merge-base> npx tsx
scripts/verify-formatting.ts`: `.oc/pr-body.md` is now green. The remaining
unformatted files reported by that run are untracked local artifacts
(`.oc/task.md`, `.oc/history.md`, ...) that do not exist in CI's clean
checkout, so they are not part of this Work Item's delta.

All 9 tracked changed files (base..HEAD) pass Prettier individually:
`.oc/pr-body.md`, `package.json`, `pnpm-lock.yaml`,
`tools/ai-brain/run-ledger.js`, `tools/ai-brain/run-ledger-helpers.js`,
`tools/ai-brain/test/run-ledger.test.js`, and the two docs files.

## Command used to reproduce and verify

```
npx prettier --check .oc/pr-body.md tools/ai-brain/run-ledger-helpers.js tools/ai-brain/run-ledger.js tools/ai-brain/test/run-ledger.test.js
```