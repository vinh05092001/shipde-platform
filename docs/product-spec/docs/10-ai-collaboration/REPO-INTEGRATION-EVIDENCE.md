# Ship Dễ — Repository Integration Evidence Contract

## Purpose

This contract defines the five-state integration lifecycle every external repository, tool or
dependency moves through, and the evidence a Work Item must carry at each step. It exists so that
no tool is reported as "attached" to Ship Dễ without a verifiable pointer on disk: a real file in
this repository that proves the claim. A declaration in a planning document is not an installation,
and an installation is not a wired command, and a wired command is not a verified execution.

`tools/ai-brain/data/tool-manifest.json` is the machine-readable inventory that this contract
governs; `REPOSITORY-CLI-MANIFEST.md` owns the human-readable install policy for the same tools.

## The five states

```
DECLARED --> INSTALLED --> WIRED --> EXECUTION_VERIFIED --> ACCEPTED
```

The ladder is strictly monotonic. A tool may not skip a rung, and a tool may not be reported at a
rung it has not proved.

### 1. `DECLARED`

- Definition: the tool or repository is formally adopted in the specification layer
  (`REPOSITORY-CLI-MANIFEST.md`, `AI-TOOLCHAIN-DECISIONS.md`) with a purpose, roles, triggers and a
  gate classification.
- Prerequisite: none beyond a written adoption decision.
- Evidence: an entry in `tool-manifest.json` with `installed: false` and an `evidenceRef` naming a
  real repository file that carries the declaration.
- Meaning of `installed: false` here: the tool is declared but this repository does not pin, vendor
  or otherwise prove its presence. "Present on one operator's machine" is not the claim being made;
  the claim is that the repository cannot yet point at a file that proves the tool is part of the
  workspace, so it stays at `DECLARED` and no test, gate or report may treat it as available.

### 2. `INSTALLED`

- Definition: the tool exists in this workspace as a pinned dependency, a resolved engine, a
  package-manager pin, or a checked-in script/wrapper that the repository owns.
- Prerequisite: a real file in this repository declares it (`package.json`,
  `apps/api/package.json`, `packages/testkit/package.json`, ...).
- Evidence: `installed: true` together with an `evidenceRef` of the form
  `<path>/package.json:<key>` where that file exists and that key really holds the dependency.
  The verification command in `tool-manifest-truth.test.js` re-reads the cited file and asserts the
  dependency is genuinely present, so `installed: true` can never be a bare assertion.

### 3. `WIRED`

- Definition: the tool is reachable from the repository's own entry points — a root or workspace
  npm script, a git hook, or a Controller tool-gate.
- Prerequisite: a non-null `command` on the manifest entry that names a defined script or an
  executable target checked into the repository.
- Evidence: the manifest `command` field, plus the script definition in the cited `package.json`,
  `lefthook.yml` or `.github/workflows/` file.

### 4. `EXECUTION_VERIFIED`

- Definition: the wired command has actually been run in this environment, with both a positive run
  (exit `0` on clean input) and a demonstrated negative run (non-zero exit on a real violation or
  negative fixture).
- Prerequisite: the tool reached `WIRED`.
- Evidence: recorded exit codes and command output in the Work Item's acceptance matrix, and an
  automated test in `tools/ai-brain/test/` that reproduces the outcome.

### 5. `ACCEPTED`

- Definition: CI is green on the exact commit, a fresh independent review returned `PASS`, and the
  commit is merged into the integration baseline.
- Prerequisite: independent review verdict `PASS`; the author never approves its own work.
- Evidence: the merged commit OID, the review record on the Work Item, and the register row in the
  `MERGED` state.

## State transition rules

1. Monotonic ladder: `DECLARED` -> `INSTALLED` -> `WIRED` -> `EXECUTION_VERIFIED` -> `ACCEPTED`.
   Movement is one rung at a time and only forward.
2. No promotion without evidence: a rung may not be claimed if its evidence row above is missing or
   points at a file that does not exist in the repository.
3. Fail-closed gates: any entry with `gate: true` that has no runnable command must carry
   `command: null` and be explicitly marked `blocked: true` with a non-empty `blockedReason`. Such a
   gate records `TOOL_GATE_UNAVAILABLE`, is never counted as a pass, and never blocks a run.
4. No retroactive rewriting: a previously verified rung may only be lowered with a written reason
   and the evidence that invalidated it.
5. `installed` is a boolean, never `UNKNOWN`. An untestable tool is `false` (i.e. `DECLARED`), not
   unknown — an unknown state would let a missing tool be silently treated as present.

## Mandatory fields for Work Items that attach a repository

Every Work Item that introduces, upgrades, wires or verifies a repository/tool integration must
record an evidence entry containing all of the following fields.

| Field | Type | Description | Allowed values / constraints |
|---|---|---|---|
| `workItemId` | `string` | The Work Item identifier | Non-empty, e.g. `GOAL-AUTOCLAW-REPOS-1` |
| `toolId` | `string` | Tool identifier, matching a `tool-manifest.json` entry `id` | Non-empty; must match a manifest entry |
| `repo` | `string` | Canonical repository identity | `owner/repo`, e.g. `gitleaks/gitleaks` |
| `state` | `string` | Current integration lifecycle state | Exactly one of `DECLARED`, `INSTALLED`, `WIRED`, `EXECUTION_VERIFIED`, `ACCEPTED` |
| `evidenceRef` | `string` | Repository file that proves the state | `<path>:<key>`; the path must exist in the repository |
| `command` | `string \| null` | Command wired to run the tool | Non-empty string, or `null` when blocked/unavailable |
| `blocked` | `boolean` | Whether execution is blocked | `true` or `false` |
| `blockedReason` | `string \| null` | Why the tool is blocked | Non-empty when `blocked === true`, otherwise `null` |
| `verifiedAt` | `string` | When the state was verified | ISO-8601 date-time, e.g. `2026-10-14T12:00:00.000Z` |
| `verifiedBy` | `string` | Role or agent that performed the verification | Non-empty, e.g. `gemini`, `codex`, `human` |

`repo-integration-evidence.test.js` implements this table as `validateEvidenceRecord()` and proves
it rejects a missing field, an unknown `state`, an `evidenceRef` pointing at a file that does not
exist, and `blocked: true` without a reason.

## Baseline state of the current manifest

Derived from `tools/ai-brain/data/tool-manifest.json`; `installed: true` means the tool is pinned in
this workspace and its `evidenceRef` was re-read from the cited `package.json` by the truth test.

| Tool | Repository | State | Evidence reference | Command | Gate |
|---|---|---|---|---|---|
| `eslint` | `eslint/eslint` | `WIRED` | `package.json:devDependencies` | `lint` | no |
| `lefthook` | `evilmartians/lefthook` | `INSTALLED` | `package.json:devDependencies` | — | no |
| `supertest` | `forwardemail/supertest` | `INSTALLED` | `apps/api/package.json:devDependencies` | — | no |
| `gitleaks` | `gitleaks/gitleaks` | `WIRED` | `package.json:scripts.security:secrets` | `security:secrets` | yes |
| `msw` | `mswjs/msw` | `INSTALLED` | `packages/testkit/package.json:dependencies` | — | no |
| `nestjs` | `nestjs/nest` | `INSTALLED` | `apps/api/package.json:dependencies` | — | no |
| `node` | `nodejs/node` | `INSTALLED` | `package.json:engines` | — | no |
| `opentelemetry-js` | `open-telemetry/opentelemetry-js` | `INSTALLED` | `apps/api/package.json:dependencies` | — | no |
| `openapi-typescript` | `openapi-ts/openapi-typescript` | `INSTALLED` | `package.json:devDependencies` | — | no |
| `pnpm` | `pnpm/pnpm` | `INSTALLED` | `package.json:packageManager` | — | no |
| `prettier` | `prettier/prettier` | `WIRED` | `package.json:devDependencies` | `format:check` | no |
| `prisma` | `prisma/orm` | `WIRED` | `package.json:devDependencies` | `db:generate` | no |
| `turbo` | `vercel/turborepo` | `INSTALLED` | `package.json:devDependencies` | — | no |
| `agent-scan` | `snyk/agent-scan` | `DECLARED` (blocked gate) | `REPOSITORY-CLI-MANIFEST.md` | `null` | yes |
| all other entries | — | `DECLARED` | `REPOSITORY-CLI-MANIFEST.md` | `null` | no |

The machine-wide CLI layer (git, gh, docker, 9router, dsh, codex, claude, gemini/agy, promptfoo,
trivy) is installed on operator machines by `scripts/ai/install-clis.ps1`, not by this repository.
The repository therefore records those tools as `DECLARED` (`installed: false`), which is the truth
about what this repository can prove, and each one is promoted to `INSTALLED` only when its
assigned Foundation Work Item pins or wraps it.
