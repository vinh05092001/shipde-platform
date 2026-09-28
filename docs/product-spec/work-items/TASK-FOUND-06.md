# TASK-FOUND-06 — Testkit PrismaClient export failure

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-FOUND-06` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `185` |
| Dependencies | `TASK-FOUND-05` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `turbo.json` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-found-06-testkit-prisma` |
| Pull Request | `` |

## Business outcome

Ensure `pnpm test` and `pnpm lint` pass on a clean checkout by enforcing the generation of the PrismaClient before building testkit, thereby restoring a stable baseline.

## Source references

- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `AGENTS.md` (Foundation verification commands)

## Preconditions and dependencies

- `TASK-FOUND-05` is merged.
- Node.js environment with `pnpm` available.

## Author boundary

`9ROUTER` is appropriate as this is a deterministic, low-risk build configuration change restricted to `turbo.json`.

## In scope

- Fix `turbo.json` so that `build`, `test`, `typecheck`, and `lint` pipeline steps correctly depend on the root workspace task `//#db:generate`.

## Out of scope

- Changes to Prisma schema.
- Changes to source code inside packages.

## Business rules and edge cases

- Verification commands MUST run without a manual step (i.e. `pnpm install --frozen-lockfile` followed by `pnpm test` must pass).

## UI states

N/A

## API, event and data impact

N/A

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-1` | Clean checkout, `pnpm install --frozen-lockfile && pnpm test` | Tests pass without manually generating PrismaClient | Log from verification showing zero exit code |

## Verification commands

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm format:check
pnpm test:brain
python docs/product-spec/scripts/validate_docs.py
git diff --check
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | | | |

## Residual limitations

None
