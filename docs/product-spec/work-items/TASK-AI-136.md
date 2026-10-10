# TASK-AI-136 — Provision worker dependencies with an offline pnpm install

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-136` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `248` |
| Dependencies | `TASK-AI-127` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/task-ai-136.test.js`; `docs/product-spec/work-items/TASK-AI-136.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-136-deps-copy` |
| Pull Request | `Pending` |

## Business Outcome

### Confirmed host root cause

Reproduced against `C:\Users\gumac\AI\shipde-platform\.worktrees\isolation\node_modules` on 2026-10-10 by running the original `fs.cpSync(source, destination, { recursive: true, dereference: false })` into `.upstream-tmp`. It failed with native code `EPERM`, syscall `symlink`, at relative dependency path `node_modules`. The exact failing source was `node_modules/.pnpm/@aws-sdk+core@3.977.9/node_modules/@aws-sdk/core`; `fs.cpSync` attempted to create that target as a symlink at `.pnpm/@aws-sdk+checksums@3.1000.29/node_modules/@aws-sdk/core`, which is a pnpm directory junction on the host. Windows denied the symlink creation. This is why the original catch emitted only the generic “failed to copy dependencies from host”.

The launcher stages only `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json` and all workspace `package.json` files at matching paths. It runs `pnpm install --frozen-lockfile --offline` host-side in that staging directory, falling back to `pnpm install --frozen-lockfile` only when the offline store is incomplete. This lets pnpm create its Windows junctions and hard links itself, avoiding the observed `EPERM` while recreating pnpm symlinks. Provisioning failures remain non-blocking and give operators the real error code, message and relative path without exposing host profile paths or secrets.

WP-R01: record every dependency provisioning failure as `WORKER_DEPS_UNAVAILABLE` with the actual error code and message plus the relative path that failed. Do not include secrets or absolute user-profile paths beyond the configured shared deps directory.

WP-R02: stage only the lockfile, workspace YAML and package manifests at their original relative paths, then provision dependencies with an offline frozen-lockfile pnpm install. If offline installation fails because the local store lacks a package, retry with a normal frozen-lockfile install. Keep copy-once marker reuse, worker junctions, and non-blocking failure behavior.

WP-R03: add an integration test using a small real pnpm workspace fixture. Invoke the actual launcher provisioning path and verify the install, `.pnpm` store, worker junctions and ready-marker reuse. A forced install failure must preserve its code in the warning. The test must fail clearly when pnpm is unavailable and must not skip. It must pass on Windows and Linux.

WP-R04: append exactly one delivery register row numbered `248` for this Work Item, in the existing 14-column quoted format, status `READY_FOR_CODEX`, branch `fix/task-ai-136-deps-copy`. The register numstat must be `1 0`.

## Source references

- Repository delivery and review rules: `AGENTS.md`, sections “Semi-automatic workspaces”, “Role separation”, “Unit of delivery” and “Pull Request evidence”.
- Dependency provisioning guarantees and warning behavior: `docs/product-spec/work-items/TASK-AI-127.md`, Business Outcome WD-R01–WD-R04.
- Operational failure evidence and required behavior: `TASK-AI-136-spec.md`, Evidence and Acceptance criteria WP-R01–WP-R04.

## Preconditions and dependencies

- `TASK-AI-127` provides the existing shared dependency cache, ready marker, junction setup, secret filter and graceful warning path.
- pnpm is available on the host running the isolated worker.

## Author boundary

This is bounded deterministic maintenance of the isolated worker's dependency provisioning. The allowed files are listed in Control. Tests exercise the real provisioning path in a temporary tree. No product behavior, credentials, external carrier action, tenant boundary, or production dependency is changed.

## In scope

- Stage only the lockfile, workspace YAML and root/workspace package manifests under the shared dependency staging directory.
- Run a host-side frozen-lockfile offline pnpm install and fall back to online frozen-lockfile mode when the offline store lacks a package.
- Include safe, relative failure diagnostics in the existing best-effort warning without blocking launch.
- Add a real pnpm workspace integration test for install success, cache reuse, worker junctions and forced install failure.
- Document the Work Item and append its one register row.

## Out of scope

- Changing dependency installation, package manifests, lockfiles, cache-key derivation, worker isolation policy or the Work Item 127 marker contract.
- Exposing absolute host paths in decision logs or changing warning severity.

## Business rules and edge cases

- TASK-AI-127 WD-R01: the cache is populated once and reused through its ready marker.
- TASK-AI-127 WD-R02: root and workspace dependency directories in the worker are junctions into the shared cache.
- TASK-AI-127 WD-R03: provisioning failure warns and never blocks the launch.
- No host `node_modules` or secret files are staged; pnpm resolves dependencies from its configured store/registry.
- A missing host manifest or failed install retains its native code/message and identifies the relative path; absolute source/destination paths are not logged.

## UI states

Not applicable. This Work Item changes operator-side worker provisioning and its decision log, not a product screen.

## API, event and data impact

- No product API, persisted business data, schema, event, or external adapter changes.
- Existing append-only decision records continue to use warning `WORKER_DEPS_UNAVAILABLE`; the detail now carries `code=...; message=...; path=...`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| WP-R01 | Forced pnpm install error | Decision warning includes the real code, message and relative path, and omits absolute host paths | `task-ai-136.test.js` |
| WP-R02 | Manifest-only staging | Offline pnpm install provisions cache, marker reuse and worker junction behavior remain intact | `task-ai-136.test.js` plus TASK-AI-127 suite |
| WP-R03 | Real pnpm workspace fixture | Installed package and `.pnpm` virtual store exist; test errors clearly when pnpm is unavailable | `task-ai-136.test.js` |
| WP-R04 | Register update | One quoted row `248`; numstat `1 0` | `git diff --numstat` |
| REGRESSION | Full AI-brain tests | No failure beyond `origin/main` | Test command output |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-136.test.js tools/ai-brain/test/task-ai-127.test.js` — 7 passed
- `node --test tools/ai-brain/test/*.test.js` with `NINEROUTER_API_KEY` unset — 1,707 passed
- `./node_modules/.bin/prettier --check tools/ai-brain/isolation-launcher.js tools/ai-brain/test/task-ai-136.test.js docs/product-spec/work-items/TASK-AI-136.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Pending | Pending |

## Residual limitations

- Existing TASK-AI-127 cache-key and stale-ready-marker limitations remain unchanged. Only pnpm offline/store-miss errors trigger the frozen-lockfile online fallback; provisioning warns and never blocks if installation still fails.

