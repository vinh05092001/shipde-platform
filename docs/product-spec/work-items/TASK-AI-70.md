# TASK-AI-70 — The Controller sees today's working sources as data

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-70` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `198` |
| Dependencies | `TASK-AI-66`; `TASK-AI-67`; `TASK-AI-69` |
| Assigned author | `9ROUTER` via `paseo::cli::9router::ocz::ninerouter::ninerouter::ocz/big-pickle` |
| Risk | `MEDIUM` |
| Allowed paths | docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv; docs/product-spec/work-items/TASK-AI-70.md; tools/ai-brain/cli.js; tools/ai-brain/candidates.js; tools/ai-brain/discovery/catalogue-import.js; tools/ai-brain/discovery/read.js; tools/ai-brain/sources.json; tools/ai-brain/test/fixtures/task-ai-70/*; tools/ai-brain/test/task-ai-70.test.js |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-70-controller-data-sync` |
| Pull Request | `TBD` |

## Business outcome

The Controller can rank more than one candidate and choose a reviewer from a different failure domain, because the sources and models that actually work today are visible to it as data rather than as one hand-written model list. The reviewed WS1 model audit (2863 seven-part rows, `capability` in `CATALOG_ONLY` / `API_PASS` / `WORK_ITEM_PASS`, `logs/model-audit/WS1-FINAL-REPORT-20261001.md`, `logs/model-audit/FINAL-MODEL-REGISTRY.md`) becomes importable with `cli.js discovery import --catalogue <file>`, and an agent-CLI source such as Codex becomes a candidate because a bound account declares its models — never because a model name was written into code.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md` § Acceptance matrix, § Verification commands, § Residual limitations — required structure and evidence format for this Work Item.
- `AGENTS.md` § Source of truth, § Pull Request evidence, § Code review rules § Verification — no fabricated evidence, new behaviour needs tests at the lowest useful level plus the acceptance path.
- `docs/product-spec/work-items/TASK-AI-66.md` § In scope — gateway-advertised rows become concrete-account candidates on that account's own route; this Work Item supplies those rows as data.
- `docs/product-spec/work-items/TASK-AI-67.md` § Business outcome — cooldown, busy and reservation handling that ranking must already respect when it is given more than one candidate.
- `docs/product-spec/work-items/TASK-AI-68.md` § Specifications item 1 and `docs/product-spec/work-items/TASK-AI-69.md` § Business rules `AI-69-R04` — every selectable candidate keeps a seven-part identity `harness::accessPath::gateway::upstream::account::quotaScope::modelId`.
- `tools/ai-brain/sources.js` header rule — adding a source is an entry in `sources.json` plus a qualification probe; nothing in the dispatch path may branch on a source id.
- `tools/ai-brain/evidence.js` § ProofLevel, § proofLevelOf — the one-way ladder `API_PASS` → `HARNESS_PASS` → `WORK_ITEM_PASS`; nothing may promote a lower level on its own.
- `tools/ai-brain/routing.js` § rankForProfile — the profile floors that consume an imported candidate: Claude-family policy refusal, `WILDCARD_ACCOUNT`, `PROOF_FLOOR_NOT_MET:<observed>`, forbidden failure domains.
- `logs/model-audit/WS1-FINAL-REPORT-20261001.md` and `logs/model-audit/ws1gen/catalogue.jsonl` — the reviewed WS1 catalogue this Work Item imports.

## Preconditions and dependencies

- `TASK-AI-66` is merged: `candidates.gatewayAccountCandidates` already mints a concrete-account candidate for every advertised row a bound account can reach, so this Work Item only has to produce honest advertised rows and honest proof.
- `TASK-AI-67` is merged: cooldown, busy and reservation handling already exist, so ranking with several candidates needs no new policy.
- `TASK-AI-69` is merged: `agy-pool` discovery and `dispatch --report-outcome` exist, so real outcome files remain the only way a live execution becomes evidence.
- The reviewed WS1 catalogue is available on the operator machine at `logs/model-audit/ws1gen/catalogue.jsonl`. It is deliberately outside the repository: a clean checkout contains the importer, not the audit, and the refresh is an operator action.

## Author boundary

`9ROUTER` is the assigned author for this reserved task. Every condition in `AGENTS.md` § Author routing holds and is enforced by `AC-AI-70-05`: behaviour is fully specified by the acceptance matrix below, allowed files are bounded, completion is proved by deterministic tests through the real CLI, no authentication, authorization, tenant isolation, money, carrier side effect, database ownership or product UX decision is touched, and a failed attempt leaves no external effect (the importer only appends to discovery data and the evidence store under the paths it is given). No product decision is taken here that a human must approve; the policy decisions already in `routing.js` are read, never rewritten.

## In scope

- `tools/ai-brain/discovery/catalogue-import.js`: read a reviewed audit catalogue (JSON lines), resolve each row to a source through `sources.json` only, and map its proof faithfully.
- A row whose capability is `CATALOG_ONLY` (or absent) becomes an advertisement only: it is written to the discovery ledger with state `UNKNOWN` and never produces a proof, in the evidence store or in the discovery read surface.
- A row whose own text declares the observation was not probed (for example `live catalogue only — not probed`) never earns a proof, even when its capability claims one; the import counts it as `proofWithheld` with the reason.
- A row that claims a proof but is not currently available never earns a proof; only a current, probed success maps onto `evidence.ProofLevel`.
- Proof is recorded against the seven-part key that dispatch can actually match: the advertised row is expanded through `candidates.gatewayAccountCandidates` onto the concrete accounts that reach that gateway, and a row with no concrete account records no proof.
- `cli.js discovery import --catalogue <file>` performs the import and prints a summary (rows, advertised, proof per level, withheld and skipped reasons).
- `cli.js discovery candidates --view dispatch|planner` is a read-only listing of the seven-part candidates the two production readers produce, with observed proof and failure domain, so "what does the Controller see" is inspectable without a dispatch.
- `cli.js dispatch --profile` honours `--discovery-dir`, so the profile path reads the same injected discovery data as the item path.
- `sources.json` marks the Codex agent-CLI source as serving models whose models come only from a bound account (`servesModels: true`, `modelsFrom: "account"`), so an account with declared models yields seven-part `codex` candidates in the planner reader too. No model name is added to the registry.
- `discovery/read.js` ingests `catalogue-import-*` evidence files, so an imported advertisement is visible through the existing discovery read surface.

## Out of scope

- Rewriting or regenerating the committed `tools/ai-brain/data/discovery/catalogue.jsonl`. The ledger is append-only operator data; refreshing it is the operator's `discovery import` run against the reviewed audit file, and it is not reproducible from a clean checkout that has no audit file.
- Importing live execution outcomes. `dispatch --report-outcome` remains the only path that turns a real recorded job result into evidence.
- Fabricating, back-dating or inferring any proof the audit row does not carry.
- Turning `API_PASS` into `HARNESS_PASS` or `WORK_ITEM_PASS`, or admitting a Claude-family candidate to a worker or reviewer lane.
- Adding a new source, a new gateway, a new model, a new evidence store or a second candidate key format.
- Editing account quota, cooldowns, reservations, the account registry, the product application or any UI.
- Reading, copying, exporting or printing any credential value.

## Business rules and edge cases

- `AI-70-R01` — Registry-only identity: a row is imported only when its gateway resolves to a source in `sources.json`. An audit records the host it dialled while the registry records the endpoint that reaches it, so resolution is by registry host index first and by source id or label second; an unresolvable row is skipped and counted, never guessed into a candidate.
- `AI-70-R02` — Existing disposition wins: a retired or deferred source (for example a compromised credential) is skipped with the registry's own reason, and a source the registry declares as serving no models (a harness, an orchestrator, a decision service) is skipped as `SOURCE_SERVES_NO_MODELS`; the import never reinstates or reinterprets it.
- `AI-70-R03` — Advertisement is not proof: `CATALOG_ONLY` rows are ledger advertisements with state `UNKNOWN` and no evidence item, in either store.
- `AI-70-R04` — Withheld proof: a row whose evidence text says it was not probed, or whose availability is not current, contributes no proof and is reported under `proofWithheld` with the reason.
- `AI-70-R05` — Matchable proof only: proof is recorded against the account-bound seven-part key minted for that gateway, so `routing.proofObserved` can match it. No proof is written for a wildcard account.
- `AI-70-R06` — One-way ladder: an imported proof level is copied, never raised. The strongest level for a key wins when rows repeat.
- `AI-70-R07` — Idempotent ledger: re-importing the same catalogue appends no transition for a key the ledger already carries.
- `AI-70-R08` — Duplicate, malformed and empty input: a malformed line is counted and skipped, never aborting the import; an empty catalogue is refused with a named reason and no write.
- `AI-70-R09` — Failure rows are reported, not adjudicated: a row whose recorded status is a failure is counted in the summary and creates no cooldown, because a cooldown is the Controller's decision.
- `AI-70-R10` — Secret-free: only identity, capability, status and evidence text are carried, and text is scrubbed through `decisions.scrubText` before it is stored.
- `AI-70-R11` — Models come from data: no model, provider, gateway or account id is added to code, and an agent-CLI source's models come only from a bound account.

## UI states

No product UI. Console states for `discovery import`: per-level proof counts, `proofWithheld` and skipped-row reasons, and the written ledger and import-file paths; `--json` emits the same summary as one object. Console states for `discovery candidates`: the seven-part key, observed proof or `unproven`, failure domain and account, one line per candidate; `--view` selects which production reader is shown, and an empty reader prints `0 candidates` rather than a bare silence.

## API, event and data impact

- New module `tools/ai-brain/discovery/catalogue-import.js` exporting `importCatalogue`, `readCatalogueRows`, `resolveSource`, `proofVerdict` and `WITHHELD_REASONS`; it reads a JSON-lines audit catalogue and the source registry, and writes through `discovery/store.appendLine`, `evidence.recordProbe` and one import evidence file.
- Discovery ledger: append-only `UNKNOWN` transitions for keys not already present (`tools/ai-brain/data/discovery/catalogue.jsonl`, or `--discovery-dir`).
- Discovery import evidence: `tools/ai-brain/data/discovery/imports/catalogue-import-<timestamp>.json`, ingested by `discovery/read.js` because the new prefix is accepted there.
- Evidence store: `evidence.json` under `--evidence-dir` gains one passed item per proven account-bound key, with the audit row's own timestamp, so evidence age stays honest. No failure item and therefore no cooldown is ever written by an import.
- No migration, no schema change, no network call, no job, no external API. The import is idempotent for a repeated file.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-70-01` | Given a reviewed audit catalogue with proven rows on three upstreams and a bound account that reaches that gateway, when `cli.js discovery import --catalogue <file>` then `cli.js dispatch --dry-run --profile <file>` runs | The profile ranks at least two candidates whose failure domains differ, and the pinned key is one of the proven ones | `tools/ai-brain/test/task-ai-70.test.js`; CLI stdout assertions on `Top candidates:` and `Pinned (dry run` |
| `AC-AI-70-02` | Given `CATALOG_ONLY`, "live catalogue only — not probed", and historical-only rows beside proven ones, when the same import and profile dispatch run | Only the proven candidates are selectable; the others are rejected `PROOF_FLOOR_NOT_MET:NONE` and never appear above the proof floor | `tools/ai-brain/test/task-ai-70.test.js`; `dispatch --json` rejected reasons plus `readDiscoveryCatalogue` result-state assertions |
| `AC-AI-70-03` | Given a bound account whose provider is an agent-CLI source that declares models through accounts only, when `cli.js discovery candidates --view planner` runs | A seven-part `codex` candidate for that account's declared model is listed, and the registry entry carries no model of its own | `tools/ai-brain/test/task-ai-70.test.js`; CLI `--json` assertion on the seven-part key |
| `AC-AI-70-04` | Given the imported Claude-family row, when a `writer`/`reviewer` profile dispatch runs | The candidate is refused `CLAUDE_FAMILY_EXCLUDED_BY_POLICY` and is not pinned; the policy is unchanged by the import | `tools/ai-brain/test/task-ai-70.test.js`; `dispatch --json` rejected reasons |
| `AC-AI-70-05` | Given the Work Item's own acceptance matrix, when the new tests run | No model id from the imported catalogue and no model literal appears in the production modules it touches; the registry entry for the agent-CLI source carries no `models` array | `tools/ai-brain/test/task-ai-70.test.js`; repository file scan assertions |
| `AC-AI-70-06` | Given a second import of the same catalogue, an unknown-gateway row, a deferred-source row and a malformed line | The second import appends no transition for an existing key, the unknown and deferred rows are skipped with reasons, the malformed line is counted, and the ledger stays append-only | `tools/ai-brain/test/task-ai-70.test.js`; ledger and summary assertions |
| `AC-AI-70-07` | Given audit rows whose `source` label matches no registry id or label and whose only link to the registry is the gateway host, plus rows for gateways the registry does not carry | The host-resolved rows import as advertisements (`tencent`, `amd-radeon`), a registered gateway the registry declares as serving no models is skipped as `SOURCE_SERVES_NO_MODELS`, and every unregistered gateway is skipped as `UNKNOWN_SOURCE` | `tools/ai-brain/test/task-ai-70.test.js`; `discovery import --json` summary and ledger assertions |

## Verification commands

- `node --test "tools/ai-brain/test/*.test.js"`
- `npx --package prettier@3.9.6 prettier --check docs/product-spec/work-items/TASK-AI-70.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv tools/ai-brain/cli.js tools/ai-brain/discovery/catalogue-import.js tools/ai-brain/discovery/read.js tools/ai-brain/sources.json tools/ai-brain/test/task-ai-70.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `f363551b4c6d880f693afdc166eeaa420cab0147` | `CHANGES_REQUIRED` | `F1` |

### Review repair round 1 evidence

Review `f363551b4c6d880f693afdc166eeaa420cab0147` (`logs/reviews/f363551b4c6d880f693afdc166eeaa420cab0147.md`) returned one open finding and could not run the suite in its sandbox.

- `F1` — `importCatalogue` passed `{ hosts: new Map() }` as the host cache, and `resolveSource` trusted any supplied map, so the import could never match a row by gateway host. Registered WS1 rows were then reported as `UNKNOWN_SOURCE` — 102 rows on the reviewed catalogue, including 90 `tencent`, 11 `amd-radeon` and 1 `jev`, of which 2 carried current proof.
  - Fix 1: `importCatalogue` builds the real registry index with `hostIndex(registry.sources)` once per run.
  - Fix 2: `resolveSource` treats an index that arrives empty as uninitialised and fills it from the registry, so no caller can switch host resolution off and have every registered row reported as unknown.
  - Fix 3: `hostOf` now rejects an audit placeholder (`n/a (local process)`, `n/a (harness)`) that previously parsed to the one-letter host `n`.
  - Fail before: with host resolution removed, `tools/ai-brain/test/task-ai-70.test.js` fails 5 of 12 tests, including the new `AC-AI-70-07` and the `resolveSource` unit test. With the empty cache but the repair in place the suite passes, which is the intended defence in depth.
  - Pass after: on the reviewed WS1 catalogue the import reports `advertised 1863 candidates from 9 registered source(s)` against `1762 … 7` before, `skipped 983x UNKNOWN_SOURCE` against `1085x`, and `proof API_PASS 33` against `31`. `tools/ai-brain/test/task-ai-70.test.js` is 12 tests, 12 pass, 0 fail.
- `AC-AI-70-07` added — the fixture now carries rows whose `source` label matches no registry id or label and whose only link to the registry is the gateway host (`Tencent TokenHub` → `tokenhub-intl.tencentcloudmaas.com`, `AMD Radeon` → `developer.amd.com.cn`, `Jev (typesafe /systemone)` → `api.typesafe.ai`), plus a second unregistered gateway (`api.pgsgrove.invalid`). The test asserts the first two are advertised into the ledger, the jev row is refused by the registry's own `servesModels: false` as `SOURCE_SERVES_NO_MODELS`, and both unregistered rows are skipped as `UNKNOWN_SOURCE`.
- `AI-70-R02` amended and a skip reason added: a source the registry declares as serving no models is never advertised. Without it the review's `jev` row would have become an advertised candidate for a decision service that `sources.json` says may not write code.
- Sandbox portability — the reviewer's managed environment refused `fs.mkdtempSync` under `%TEMP%` with `EPERM`. The suite now resolves a scratch base in order (`os.tmpdir()`, `TMPDIR`, `TEMP`, `TMP`, `HOME/.cache/ai-brain-tests`, `USERPROFILE/.cache/ai-brain-tests`), probes it for writability, never creates anything inside the repository, and reports itself skipped rather than failing when no base is writable. No test result in this record depends on that change: all 1218 tests still run and pass on the author's host, where `os.tmpdir()` is writable.

## Verification evidence

All commands ran in the FOREGROUND from this worktree on 2026-10-03 with `HOME`, `USERPROFILE`, `TEMP` and `TMP` pointed at a directory under the OS temp dir, outside the worktree. Nothing reached a network, a scheduled task or a credential.

- `node --test "tools/ai-brain/test/*.test.js"` → `# tests 1218`, `# pass 1218`, `# fail 0`, `# skipped 0`, `# todo 0`, `# duration_ms 92584`. This includes the 11 new tests in `tools/ai-brain/test/task-ai-70.test.js` and the existing `regression 10: discovery source and test files pass prettier format check` regression, which failed on the first run until the new files were formatted.
- `npx --package prettier@3.9.6 prettier --check docs/product-spec/work-items/TASK-AI-70.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv tools/ai-brain/cli.js tools/ai-brain/discovery/catalogue-import.js tools/ai-brain/discovery/read.js tools/ai-brain/sources.json tools/ai-brain/test/task-ai-70.test.js` → `All matched files use Prettier code style!`
- `git diff --cached --check` → clean, no whitespace error. The register diff is exactly one inserted line and the file keeps its LF endings (0 CR bytes).
- `tools/ai-brain/test/task-ai-70.test.js` alone → `# tests 11`, `# pass 11`, `# fail 0`.

### Fail before, pass after

- `AC-AI-70-01`, `AC-AI-70-02`, `AC-AI-70-04`, `AC-AI-70-05`, `AC-AI-70-06` — at `a7687e1` `tools/ai-brain/discovery/catalogue-import.js` does not exist and `cli.js` has no `discovery` command; its usage banner reads `reconcile | manifest | prove | quota | dispatch | shadow | account | probe | qualify | serena`. `node tools/ai-brain/cli.js discovery import --catalogue <fixture>` at base exits 2 with `Lệnh không rõ: discovery`, so the import scenarios cannot run at all, and the file scan has no module to read.
- `AC-AI-70-03` — with every other change in place but `sources.json` at its `a7687e1` content (`codex.servesModels: false`), `node tools/ai-brain/cli.js discovery candidates --view planner` prints `Discovery candidates (planner view): 0`; the test fails with `no codex candidate in the planner view` (`# pass 10`, `# fail 1`). After the registry row declares `servesModels: true` with `modelsFrom: "account"` and no model of its own, the same command prints `codex::cli::::codex::codex-main::codex-main::codex-demo-model-a` and the file is `# pass 11`, `# fail 0`.

### Live proof on the reviewed WS1 catalogue

Run on the Controller host against the reviewed audit file `logs/model-audit/ws1gen/catalogue.jsonl` (2863 rows), writing only into a temporary discovery and evidence directory:

- `discovery import` → `rows 2863 (malformed 0)`, `advertised 1863 candidates from 9 registered source(s)` (`9router` 905, `rqsty` 750, `tencent` 90, `thb` 68, `baseten` 13, `regolo` 18, `cohere` 16, `amd-radeon` 11, `inception` 4), `proof API_PASS 33 / HARNESS_PASS 0 / WORK_ITEM_PASS 3`, `withheld 1775x NOT_A_PROOF`, `withheld 60x PROOF_WITHHELD_NOT_PROBED`, `withheld 4x PROOF_WITHHELD_NOT_CURRENT`, `skipped 983x UNKNOWN_SOURCE`, `skipped 4x DEFERRED`, `skipped 1x SOURCE_SERVES_NO_MODELS`, `reported 28 failure row(s)`, `ledger 1863 new transition(s)`.
- With the operator's real account registry, `discovery candidates` reports 40 proven candidates spread over five failure domains — `9router/ag` 26, `9router/cohere` 6, `9router/cl` 4, `9router/ocz` 2, `9router/gh` 2 — on the `ninerouter` and `xkiro` accounts.
- `dispatch --dry-run --profile` with `role: reviewer`, `proofFloor: API_PASS` ranks `paseo::cli::9router::ag::ninerouter::ninerouter::ag/gemini-3-flash` first, where the same profile at `a7687e1` refused outright (`REFUSED: no candidate meets the profile floors`, `EXCLUDED 424x CLAUDE_FAMILY_EXCLUDED_BY_POLICY`, `EXCLUDED 1526x WILDCARD_ACCOUNT`, `EXCLUDED 1598x PROOF_FLOOR_NOT_MET:NONE`).
- The same profile with `forbiddenFailureDomains: ["ag"]` moves the reviewer to another failure domain: `paseo::cli::9router::cl::ninerouter::ninerouter::cl/cline-free/mimo-v2.6-flash` at `WORK_ITEM_PASS`, then `9router/cl` and `9router/cohere` behind it.

No evidence in this record was produced by a network call inside the test suite, and no outcome was invented: the proof counted above is the proof the reviewed audit states, on the account-bound keys the Controller can match.

## Residual limitations

- The reviewed WS1 catalogue lives outside the repository, so a clean checkout can prove the importer but cannot reproduce the operator's refresh. Owner: Controller operator. Risk: the committed discovery ledger stays as stale as its last import. Next action: run `cli.js discovery import --catalogue <ws1 catalogue.jsonl>` on the Controller host and commit the resulting ledger through a follow-up Work Item. Human acceptance: required before the ledger is refreshed.
- About 1000 of the 2863 WS1 rows name sources that are not in `sources.json` (llmtr, The Grid, PGS Grove, AgentRouter, xKiro direct, Scaleway, B.AI and others). They are skipped with `UNKNOWN_SOURCE` rather than invented. Owner: human. Risk: capacity that exists is invisible. Next action: add each source to `sources.json` with a qualification probe, then re-import. Human acceptance: required.
- Imported proof is exactly what the audit row claims. A row whose capability is `API_PASS` from a direct-HTTP nonce is still not harness-proven, and `routing.rankForProfile` scores it without quality, latency or cost until a real outcome reports them, so several proven candidates tie at score 0 and are ordered by key. Owner: Controller. Risk: ranking between proven candidates is decided by the key order, not by measured quality. Next action: report real outcomes through `dispatch --report-outcome`. Human acceptance: acknowledged.
- An advertisement never carries proof in the discovery read surface, even when the audit proved it: `readDiscoveryCatalogue` reports the ledger row as `UNTESTED` because a listing is not availability. The proof lives in the evidence store on the account-bound key, which is what `routing.proofObserved` reads. Owner: Controller. Risk: a report reading only the discovery ledger understates what is proven. Next action: read the evidence store, or `discovery candidates`, alongside the ledger. Human acceptance: acknowledged.
- A failure row in the audit creates no cooldown (`AI-70-R09`), so a currently broken gateway is advertised rather than cooled down until a real dispatch reports its failure. Owner: Controller. Risk: dispatch may pick a row the audit already saw failing. Next action: let the first real outcome set the cooldown. Human acceptance: acknowledged.
- `discovery/read.js` deduplicates import evidence by `importedFrom`, so two audit files that share a basename (`catalogue.jsonl`) contribute only the first file's import summary to the read surface. Both files' rows still reach the Controller through the append-only ledger, which is the authoritative advertisement source, so nothing is lost. Owner: Controller. Risk: low. Next action: if two audits must coexist in the read surface, give the dedupe key the run id.
- `discovery candidates` lists what the two production readers produce; it does not rank, reserve or launch anything, and it does not run the pool runtime unless `--pool-runtime-dir` is passed.