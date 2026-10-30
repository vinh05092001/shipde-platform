# TASK-AI-152 — DeepSeek Harness Controller source registration and discovery

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-152` |
| Feature ID | `N/A — controller DeepSeek Harness source registration and discovery` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `268` |
| Dependencies | `TASK-AI-146` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/sources.json`; `tools/ai-brain/sources.js`; `tools/ai-brain/harness.js`; `tools/ai-brain/source-discovery.js`; `tools/ai-brain/discovery/adapters.js`; `tools/ai-brain/test/task-ai-152-deepseek-harness-source.test.js`; `docs/product-spec/work-items/TASK-AI-152.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-152-deepseek-harness-source` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Establish DeepSeek Harness (pinned in `AI-TOOLCHAIN-DECISIONS.md` and `REPOSITORY-CLI-MANIFEST.md` as `@deepseek-ai/dsh@0.1.1-rc.2`) as a registered, discoverable, probeable, and ranked Controller source alongside existing CLI and router sources. The Controller can discover DeepSeek Harness from environment configuration and local settings, observe credential presence via `DEEPSEEK_API_KEY` without ever exposing secret values, verify CLI availability through bounded probing, execute author sessions via its harness adapter, and reject unauthenticated candidates while ranking authenticated ones.

## Source references

- `AGENTS.md` (Code review rules, No production hardcode, Verification commands)
- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` (DeepSeek Harness USE NOW, PIN)
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md` (CLI command `dsh`, pin `@deepseek-ai/dsh@0.1.1-rc.2`)
- `docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md` (DSH workspace and 9Router connection)
- `tools/ecosystem-manifest.json` (Entry `deepseek-harness`, CLI service on port 3080)
- `tools/ai-brain/sources.json` (Source registry and dispatch providers)
- `tools/ai-brain/sources.js` (Source lookups, aliases, credential presence, dispatch routing)
- `tools/ai-brain/harness.js` (Harness adapter lifecycle: launch, resume, stop, inspect, sessionIdFrom)
- `tools/ai-brain/source-discovery.js` (Local config discovery and source probe)
- `tools/ai-brain/discovery/adapters.js` (Discovery CLI adapter enumeration and presence resolution)
- `tools/ai-brain/ranking.js` (Candidate filtering, credential preflight, and ranking)

## Preconditions and dependencies

- Node.js >=20 and pnpm >=9 available.
- Prior Work Item `TASK-AI-146` present on baseline.
- Clean worktree on branch `feat/task-ai-152-deepseek-harness-source`.
- CLI status checked against host machine:
  - Command wrapper exists at `C:\ShipDeWorker\npm\dsh.ps1` and `C:\ShipDeWorker\npm\dsh.cmd`.
  - Node module `C:\ShipDeWorker\npm\node_modules\@deepseek-ai\dsh\lib\bin.js` is not installed (`MODULE_NOT_FOUND`).
  - Recorded as honest `NOT_INSTALLED` evidence; tests execute with fake CLI runner and assert graceful failure reporting.

## Author boundary

`GEMINI` authors this bounded controller brain enhancement. Changes are strictly confined to `tools/ai-brain/sources.json`, `tools/ai-brain/sources.js`, `tools/ai-brain/harness.js`, `tools/ai-brain/source-discovery.js`, `tools/ai-brain/discovery/adapters.js`, `tools/ai-brain/test/task-ai-152-deepseek-harness-source.test.js`, and documentation. No application UI, database migrations, carrier adapters, or gate allowlists are modified. Credential handling refers only to environment variable names, never values.

## In scope

- Register `deepseek-harness` in `tools/ai-brain/sources.json` with aliases `["dsh"]`, kind `agent-cli`, harness `dsh`, accessPath `cli`, reachedVia `9router`, credential env `DEEPSEEK_API_KEY`, and verify command `dsh --version`.
- Add `dsh` and `deepseek-harness` to `dispatch.providers` mapping in `tools/ai-brain/sources.json`.
- Support alias resolution in `bySource` within `tools/ai-brain/sources.js` so both primary id and alias return the source object.
- Implement `dsh` harness adapter in `tools/ai-brain/harness.js` with `launch`, `resume`, `stop`, `inspect`, and `sessionIdFrom`.
- Add discovery support in `tools/ai-brain/source-discovery.js` for local config files (`~/.dsh/config.json`, `~/.dsh/settings.json`) and operator environment variable `DEEPSEEK_API_KEY`.
- Extend `probeSource` in `tools/ai-brain/source-discovery.js` to support CLI-based verification (`version-command`), handling simulated success, failure, and ENOENT (not installed).
- Update `agentCliAdapter` in `tools/ai-brain/discovery/adapters.js` to preserve presence info from resolver.
- Comprehensive unit tests covering registration, aliases, credential presence, harness operations, discovery, probing (fake and real host), and candidate ranking.

## Out of scope

- Direct installation or upgrade of `@deepseek-ai/dsh` package on the host machine.
- Modifications to 9Router combo definitions or proxy daemon logic.
- Changes to database migrations, UI pages, or carrier integration endpoints.
- Editing gate allowlists, baselines, or security validators.

## Business rules and edge cases

- **BR-DSH-01 (No Secrets in State/Logs):** Credential references use environment variable names (`DEEPSEEK_API_KEY`). Secret values are never stored, logged, or returned by `credentialPresence` or `describeAll`.
- **BR-DSH-02 (Alias Equivalence):** `deepseek-harness` and `dsh` are recognized as equivalent aliases across `getSource`, `getSourceAliases`, and `dispatchRoute`.
- **BR-DSH-03 (Honest CLI Evidence):** When the CLI command is uninstalled, broken, or missing, the probe fails closed with status `unavailable` and explicit reasons (`CLI_NOT_INSTALLED`, `CLI_PROBE_FAILED`), never faking availability.
- **BR-DSH-04 (Credential Preflight):** When `DEEPSEEK_API_KEY` is missing or empty, candidates using the source are rejected during ranking preflight with `reason: no credential: env DEEPSEEK_API_KEY unset`.
- **BR-DSH-05 (Fail Closed on Missing Config):** Missing CLI command or corrupt configuration fails closed without unhandled exceptions.

## UI states

N/A — Controller brain tooling and source discovery logic; no user interface modified.

## API, event and data impact

- `tools/ai-brain/sources.json`: Added entry for `deepseek-harness` and dispatch provider mapping for `dsh`.
- `tools/ai-brain/sources.js`: `bySource` indexes aliases to allow alias lookups via `getSource`.
- `tools/ai-brain/harness.js`: Exported `dsh` and `deepseek-harness` in `HARNESSES`.
- `tools/ai-brain/source-discovery.js`: Added `~/.dsh` config scanning and CLI `probeSource` execution.
- `tools/ai-brain/discovery/adapters.js`: Added presence reporting for `servesModels: false` agent-cli sources.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-152-01 | Source registration in `sources.json` | `deepseek-harness` source is present with alias `dsh`, kind `agent-cli`, harness `dsh`, accessPath `cli`, reachedVia `9router`, credential env `DEEPSEEK_API_KEY`, and verify `dsh --version` | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-02 | Bidirectional alias resolution | Both `getSource('deepseek-harness')` and `getSource('dsh')` return the source; aliases expand correctly | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-03 | Dispatch route mapping | `dispatchRoute('dsh')` and `dispatchRoute('deepseek-harness')` return `{ harness: 'dsh', provider: 'dsh', modelPrefix: '' }` | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-04 | Describe all capacity classification | `describeAll` lists `deepseek-harness` with `countsAsCapacity: false` | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-05 | Credential presence reporting | `present: true` when `DEEPSEEK_API_KEY` is set; `present: false` when unset; secret value never returned | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-06 | Harness adapter lifecycle | `dsh` adapter supports `launch`, `resume`, `stop`, `inspect`, and `sessionIdFrom` | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-07 | Local config and env discovery | `discoverSources` detects DSH from `~/.dsh/config.json` and from `DEEPSEEK_API_KEY` in environment | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-08 | CLI probe with fake runner | Exit code 0 returns `status: 'available'` with version; exit code 1 returns `unavailable` with `CLI_PROBE_FAILED`; ENOENT returns `unavailable` with `CLI_NOT_INSTALLED` | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-09 | Real machine CLI probe evidence | Host machine probe of `dsh --version` honestly returns `unavailable` due to `MODULE_NOT_FOUND` (`lib/bin.js` missing) | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-10 | Candidate preflight and ranking | Candidate rejected without credential (`no credential: env DEEPSEEK_API_KEY unset`); candidate admitted and ranked with credential | Automated test in `task-ai-152-deepseek-harness-source.test.js` |
| AC-AI-152-11 | Hardcode check | `node scripts/ai/check-no-hardcode.mjs` exits 0 with 0 new instances | CLI execution output |
| AC-AI-152-12 | Formatting check | `pnpm exec prettier --check <files>` passes | CLI execution output |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-152-deepseek-harness-source.test.js`
- `node --test tools/ai-brain/test/sources.test.js tools/ai-brain/test/source-discovery.test.js tools/ai-brain/test/task-ai-142-direct-writer-harness.test.js tools/ai-brain/test/task-ai-142-sources-isolation.test.js`
- `node scripts/ai/check-no-hardcode.mjs`
- `pnpm exec prettier --check tools/ai-brain/sources.json tools/ai-brain/sources.js tools/ai-brain/harness.js tools/ai-brain/source-discovery.js tools/ai-brain/discovery/adapters.js tools/ai-brain/test/task-ai-152-deepseek-harness-source.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `1cfbd85be3b0d2f3b3f6a41dd26d39b1b182b083` | `READY_FOR_CODEX` | Initial complete implementation of DeepSeek Harness source, discovery, CLI probe, harness mapping, and tests |

## Residual limitations

None
