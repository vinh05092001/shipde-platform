# Tool usage audit — 2026-11-07

Checkout: `229be4d125852b83ca4d96a5b1208d62071e9de0`.

Scope: union of the ecosystem manifest (orchestrator, adopted tools, product dependencies, candidates) and runtime tool manifest: 73 identifiers, with aliases shown together. Also record executable harnesses outside those inventories. Application libraries are outside this tool inventory. This audit makes no model or network calls.

## Evidence rules

- **INSTALLED**: `R` = repository dependency/engine/script evidence under the integration contract; `H` = host command resolves using `Get-Command`; `D` = declaration only; `V` = vendored content. H proves neither version nor health. Root `node_modules` is absent; R does not assert materialized dependencies. See `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md:INSTALLED`.
- **WIRED**: source reachability, conditional where stated; this is not a lifecycle promotion. An installer, profile membership or prompt recommendation alone is not execution wiring.
- **OBSERVED**: `F` = fake fixture/module execution; `S` = static/command-construction checks; `V` = vendored text loading; `N` = no execution evidence in this audit. Test references below name the exact tests. F/S never establish external tool execution or production usage.
- **NOT USED**: states the unobserved portion of this audit, not a historical assertion that a tool was never called. No raw logs or prompts were inspected. A missing graph edge is never proof of absence.

`E` below is `tools/ecosystem-manifest.json` (lifecycle/install policy); `T` is `tools/ai-brain/data/tool-manifest.json` (repository evidence/commands). T has 42 rows, 13 `installed:true`. E lifecycle labels and T booleans describe different claims and must not be collapsed.

## Manifest, launcher and call paths

1. `tools/ai-brain/prompt-compiler.js:compilePrompt` / `compileReviewPrompt` → `toolsForPrompt` → lazy `tool-manifest.js:toolsFor` → `load`. `toolsSectionLines` offers matching tools; `recordPromptTools` records offered ids, not invocations. Selection does not filter `installed:false` tools. A recommendation is not availability evidence.
2. `tools/ai-brain/orchestrate.js:runToolGates` → lazy `tool-manifest.js:gatesFor` / `appliesTo` → `runGateCommand` → `pnpm run <command>` in the worker root. Only applicable, installed gates with commands execute. Missing tools record UNAVAILABLE; a persistent fixture violation is refused after bounded repair (T4). Synthetic repo-test/lint/typecheck/security entries have empty triggers and cover no files.
3. `tools/ai-brain/executor.js:executePlan` → `resolveRoute` → `harness.js:getHarness` / adapter `launch` → `runHarness`, or `isolation-launcher.js:getIsolatedLauncher` when isolation is requested. The launcher executes the selected adapter and provisions optional RTK; it does not execute every tool offered in the prompt. `lane-launcher.js:launch` records jobs/locks; it is not an external-tool launcher.
4. `scripts/ai/ecosystem.ps1:Invoke-ShipDeActivate` reads profiles and explicitly starts requested optional services. Its launch branch supports nine-router and deepseek-harness and rejects unsupported optional services. Profile membership does not prove MCP/Prism activation. `install-ecosystem.ps1:Get-ShipDeCommandVersion` concerns installation/version probing, not worker invocation. Neither script was executed.

## Tool evidence table

Unless explicitly observed below, no external executable, service or provider was run. Null T commands can coexist with source wiring through a different entry point.

| Tool | INSTALLED | WIRED | OBSERVED | NOT USED |
| --- | --- | --- | --- | --- |
| `agent-orchestrator` | E INSTALLED; `ao` unresolved | `scripts/ai/start-agent-orchestrator.ps1:Get-LiveAoProcess`; `tools/ai-brain/harness.js:RETIRED` rejects ao | N | Supervision not run; E conflicts with retired harness |
| `shipde-platform` | Checkout present; E INTEGRATED | `package.json:scripts.test:brain` | Node tests below | Full product gates not run |
| `shipde-brain` | E REJECTED; sibling not inspected | `tools/ecosystem-manifest.json:adopted` records deferred boundary | N | No workspace activation |
| `nine-router` | H `9router`; E ADOPTED; absent T | `scripts/ai/ecosystem.ps1:Invoke-ShipDeActivate` optional service | N | Gateway/provider calls prohibited |
| `deepseek-harness` | H `dsh`; E INSTALLED; absent T | `scripts/ai/ecosystem.ps1:Invoke-ShipDeActivate` optional web service | N | DSH process not launched |
| `gemini-cli` | H `gemini`; E REJECTED; T false | `tools/ai-brain/harness.js:paseo.launch` passes a selected provider; no dedicated Gemini adapter | N | Provider session not launched |
| `antigravity-cli` | H `agy`; E ADOPTED; absent T | `tools/ai-brain/harness.js:agyPool.launch` → `agy-pool-runtime` scheduled-job path | N | Scheduled job/author not launched |
| `codex-cli`, `codex` | H `codex`; E ADOPTED; T false | `tools/ai-brain/harness.js:codex.launch` requires closed isolation | N | No Controller dispatch; this writer is a temporary user assignment |
| `claude-code` | H `claude`; E ADOPTED; T false | `tools/ai-brain/harness.js:paseo.launch` passes provider; T prompt recommendation | N | Host-authenticated review/author session not launched |
| `playwright-cli` | H; E ADOPTED; T false | `tools/ai-brain/prompt-compiler.js:toolsForPrompt` recommendation, no command | N | Browser interaction not run |
| `gh` | H; E ADOPTED; absent T | `tools/ai-brain/publisher.js:ghRun` → shim-aware gh executable; orchestration publication path | N | GitHub calls prohibited |
| `docker-compose`, `compose` | H `docker`; E REJECTED; T false | `package.json:scripts.infra:up` → Compose | N | Containers/Compose version not probed |
| `chrome-devtools-mcp` | D; E on-demand; absent T | `tools/ecosystem-profiles.json:profiles` membership; no activation branch in ecosystem launcher | N | MCP not started |
| `vercel-agent-skills` | V `tools/ai-brain/skills/vercel`; absent T; raw byte hash mismatch | `tools/ai-brain/skill-pack.js:lockedPack` for UI roles | V role tests pass; T8 integrity fails | No live browser/design evidence |
| `lighthouse-ci` | R `apps/web/package.json:devDependencies`; T false | `apps/web/package.json:scripts.test:lighthouse` → lhci | N | Lighthouse not run; root perf verifier is separate |
| `storybook` | D; E PENDING; T false | `tools/ai-brain/tool-manifest.js:toolsFor` recommendation only; no dependency in inspected workspace manifests | N | Storybook not launched |
| `msw` | R `packages/testkit/package.json:dependencies`; T true | `packages/testkit/src/msw/handlers.ts:handlers`, package test script | N | MSW tests/server not run |
| `openapi-typescript` | R `package.json:devDependencies`; T true | `scripts/verify-contracts.ts:checkContractDrift` | N | Generation/contract gate not run |
| `open-spec` | E PENDING; external pinned-install wrapper; absent T | `package.json:scripts.test:specs` → `tools/openspec-check/run.sh:exec` | N | Wrapper may install; not executed |
| `spec-kit` | D; E REJECTED; absent T | `tools/ecosystem-manifest.json:adopted` records rejection | N | No activation |
| `beads` | D; E REJECTED; absent T | `tools/ecosystem-manifest.json:adopted` records rejection | N | No activation |
| `sylph` | D; E REJECTED; absent T | `tools/ecosystem-manifest.json:adopted` records rejection | N | No activation |
| `context7` | H `ctx7`; E ADOPTED; T false | `tools/ai-brain/cli.js:main` docs branch → `context7.js:runDocsCli` → `lookupDocs` / `runCtx7` | F, T5 | Real ctx7/npx/docs network not called |
| `hermes-agent` | H `hermes`; E PENDING; absent T | `tools/ai-brain/harness.js:hermes.launch`; `hermes-session.js:launchHermesSession` | N | No session/provider/auth inspection |
| `agent-scan` | D; command unresolved; T false/blocked | `tools/ai-brain/orchestrate.js:runToolGates` skips unavailable gate | F unavailable behavior, T1/T4 | Scanner not called; unavailable is not passed |
| `token-tracker`, `tokentracker` | D; E PENDING; T false; command unresolved | `tools/ai-brain/data/tool-manifest.json:triggers` empty; no command | N | Telemetry executable not called |
| `renovate` | H; E ADOPTED; T false | `scripts/ai/install-ecosystem.ps1:Get-ShipDeCommandVersion` install probe; T recommendation | N | No update bot/validator run |
| `lefthook` | R `package.json:devDependencies`; T true | `tools/ai-brain/isolation-launcher.js:resolveInstalledHook` / `hookedControllerGit` | N | No commit or hook execution |
| `serena` | V snapshot/wrapper; E PENDING; absent T; external server installation unverified | `tools/ai-brain/cli.js:main` serena live → `serena.js:runSerenaLive` → `serena-mcp.js:callSerena` | S guards/argv, T6 | No repository MCP server spawned; session's injected Serena manual is separate |
| `repomix` | H; E ADOPTED; T false | `tools/ai-brain/context-pack.js:createContextPack` / `createContextPackAsync` → resolved binary, else fallback | F fallback, T7 | Binary not executed; fallback is not Repomix usage |
| `prism` | H; E ADOPTED; T false | `tools/ecosystem-profiles.json:profiles` membership; T recommendation; no ecosystem activation branch | N | Prism not called; MSW is distinct |
| `gitleaks` | H; R script evidence; T true | `scripts/verify-secrets.ts:runCliVerification`; applicable host tool gate | S manifest/fixture gate behavior, T1/T4 | No secret scan or credential file read |
| `axe-core` | R `apps/web/package.json:devDependencies`; T false | `apps/web/e2e/a11y.spec.ts:AxeBuilder`; UI tool recommendation | S routing selection, T2 | Browser axe engine not run; root a11y scan is separate |
| `playwright-mcp` | D; E on-demand; T false | `tools/ai-brain/prompt-compiler.js:toolsForPrompt` recommendation; profile membership | N | MCP not started |
| `promptfoo` | E ADOPTED/isolated prefix; neither pf nor promptfoo resolves; absent T | `package.json:scripts.test:prompts` → `tools/controller-eval/run.sh:exec` | N | Isolated prefix unverified; wrapper may install |
| `trivy` | E CI-provisioned; host command unresolved; T false | `scripts/verify-trivy.ts:runTrivyVerification` via security:trivy | N | Scanner/CI not run |
| `opentelemetry-js` | R API/config dependencies; T true | `packages/config/src/telemetry.ts:initTelemetry` | N | No application tracing/export run |
| `vietnamese-provinces-database`, `vietnamese-provinces` | D; E PENDING; T false | `tools/ai-brain/data/tool-manifest.json:triggers` recommendation, no command | N | No dataset import/provenance verification |
| `opencode` | H; E ADOPTED; absent T | `tools/ai-brain/harness.js:opencodeDirect.launch`; isolation launcher stages worker config | N | No provider/worker launch |
| `paseo` | H; E ADOPTED; absent T | `tools/ai-brain/harness.js:paseo.launch` / resume / inspect | N | No session dispatch |
| `rtk` | H; E ADOPTED; absent T | `tools/ai-brain/isolation-launcher.js:getIsolatedLauncher` conditionally copies binary, prepends PATH, adds optional hint | N | No RTK invocation; PATH availability does not prove worker use |
| `superpowers` | V `tools/ai-brain/skills/superpowers`; absent T | `tools/ai-brain/skill-pack.js:lockedPack` selected non-UI roles | V, T4 | Upstream orchestration instructions remain constrained |
| `impeccable` | V `tools/ai-brain/skills/impeccable`; absent T | `tools/ai-brain/skill-pack.js:lockedPack` selected UI roles | V, T4 | No external npx/browser execution |
| `semgrep` | H; E CI-provisioned; T false | `package.json:scripts.security:semgrep` | N | Rules/scanner/CI not run or changed |
| `ast-grep` | R `package.json:devDependencies`; T false | `package.json:scripts.lint:ast` | N | Structural scan not run |
| `supertest` | R `apps/api/package.json:devDependencies`; T true; E product row DEFERRED | `apps/api/package.json:scripts.test` invokes supertest specs | N | API/database suites not run |
| `k6` | E CI-provisioned; command unresolved; T false | `package.json:scripts.test:load` → `tools/k6/run-health-smoke.sh` | N | Runner would start API/read env; not executed |
| `git` | H; T false; E INSTALLED | `tools/ai-brain/isolation-launcher.js:controllerGit` and repository tooling | rev-parse, diff/status read-only | No config mutation/commit/push |
| `node` | H; R `package.json:engines`; T true | `package.json:scripts.test:brain` | Actual node --test below | No model subprocess |
| `pnpm` | H; R `package.json:packageManager`; T true | `tools/ai-brain/orchestrate.js:runGateCommand` | N | Install/build/root gates not run |
| `eslint` | R `package.json:devDependencies`; T true | `package.json:scripts.lint` | N | Lint not run; dependencies unmaterialized |
| `prettier` | R `package.json:devDependencies`; T true | `scripts/verify-formatting.ts:checkFileFormatting` | N | Formatter not run; dependencies unmaterialized |
| `turborepo`, `turbo` | R `package.json:devDependencies`; T true for turbo | `package.json:scripts.build` / lint / test | N | Turbo not run |
| `nestjs` | R `apps/api/package.json:dependencies`; T true; E DEFERRED | `apps/api/src/main.ts:bootstrap` → NestFactory.create | N | API bootstrap not run |
| `prisma` | R `package.json:devDependencies`; T true | `package.json:scripts.db:generate` | N | No generate/migrate/database call |
| `bullmq` | R `apps/worker/package.json:dependencies`; E DEFERRED; absent T | `apps/worker/src/dispatcher/outbox.dispatcher.ts:OutboxDispatcher` → Queue | N | No Redis/queue call |
| `vitest` | D; E DEFERRED; absent T | `tools/ecosystem-manifest.json:product_dependencies` only; inspected tests use node/tsx | N | No Vitest invocation |
| `playwright` | R `apps/web/package.json:devDependencies` @playwright/test; T false | `apps/web/package.json:scripts.test:a11y` → playwright test | S routing selection, T2 | No browser/E2E execution |
| `storybook-addon-a11y`, `addon-a11y` | D; E DEFERRED; T false | `tools/ai-brain/tool-manifest.js:toolsFor` UI recommendation only | N | Addon not loaded |
| `msw-storybook-addon` | D; E DEFERRED; T false | `tools/ai-brain/tool-manifest.js:toolsFor` UI recommendation only | N | Addon not loaded |
| `pact-js` | E PILOT/installed false; T false | `tools/ai-brain/data/tool-manifest.json:triggers` recommendation only | N | No contract runner |
| `nock` | E WATCH/installed false; T false | `tools/ai-brain/data/tool-manifest.json:triggers` recommendation only | N | No interception |
| `hoverfly` | E WATCH/installed false; T false | `tools/ai-brain/data/tool-manifest.json:triggers` recommendation only | N | No virtualization service |
| `toxiproxy` | E PILOT/installed false; T false | `tools/ai-brain/data/tool-manifest.json:triggers` recommendation only | N | No proxy started |
| `syft` | E WATCH/installed false; T false | `tools/ai-brain/data/tool-manifest.json:triggers` recommendation only | N | No SBOM runner |
| `llmlingua` | E PILOT/installed false; absent T | `tools/ecosystem-manifest.json:candidates` only | N | No compression |
| `opa` | E WATCH/installed false; absent T | `tools/ecosystem-manifest.json:candidates` only | N | No policy runner |
| `cline` | H; outside E/T | `tools/ai-brain/harness.js:cline.launch` has no resume support | N | No author session |
| `openclaw` | H; outside E/T | `tools/ai-brain/harness.js:autoclaw.launch`; openclaw alias | N | No author session |

## Gaps and disposition

- **Catalog drift:** E labels Agent Orchestrator INSTALLED while `harness.js:RETIRED` rejects `ao`; E REJECTED Gemini/Docker still resolve on the host; NestJS/BullMQ/Supertest remain DEFERRED in product rows despite dependency/call evidence. These are recorded disagreements, not authority to reactivate them.
- **Runtime inventory lag:** T records false for repository dependencies such as axe-core, Lighthouse, Playwright and ast-grep, while R evidence exists; T lacks several harnesses, RTK, Serena and skill packs. ID aliases also differ (codex-cli/codex, docker-compose/compose, turborepo/turbo, addon names, dataset names, tracker names). No manifest promotion made.
- **Profile versus activation:** MCP tools and Prism appear in profiles, but `Invoke-ShipDeActivate` only implements the two optional-service launch branches above. Adding a service lifecycle needs installation, process identity, cleanup and offline negative evidence; this is not a proven small wiring fix.
- **Observed use:** no production history was established. `prompt_tools` means offered; RTK `provided` means availability; Repomix `fallback` means built-in packing. None proves the external tool ran. No named log supplied warrants reading broad logs/prompts.
- **Vendored byte integrity:** T8 fails for `react-best-practices/SKILL.md` against `tools/ai-brain/skills/vercel/NOTICE.md:sha256`. All three recorded files have CRLF bytes; computing SHA-256 after in-memory CRLF→LF normalization matches each recorded hash. This establishes a checkout line-ending discrepancy, not a clean raw-byte check. No files, hashes or git configuration were changed to hide it.
- **Safe-fix decision:** no production wiring change. Converting declarations/rejected tools into enabled behavior would require decisions and execution evidence beyond this audit; protected gates/manifests/profiles remain untouched. The only new executable check validates this document against existing inventories.

## Offline evidence and reproduction

All test paths below are under `tools/ai-brain/test/`. Commands use `node --test` and fake fixtures only. Set TEMP/TMP to `.oc/tmp` to keep temporary fixtures inside this worktree.

| Ref | Named test file and representative test | Evidence boundary |
| --- | --- | --- |
| T1 | `tool-manifest-truth.test.js` — AC-1: installed:true claims match the real contents of the cited package.json files | Repository declarations; not installed binaries |
| T2 | `task-ai-109-tools.test.js` — UI change (.tsx file) includes playwright and axe-core; tool-manifest.js does no I/O except reading JSON | Selection, schema and purity |
| T3 | `manifest-audit.test.js` — a ci-provisioned gate no workflow installs is still reported missing | Fake manifests/workflows; no real CI assertion |
| T4 | `repo-integration-group-2.test.js` — Controller executes available gate and refuses a persistent violation after one repair; unavailable tool has an explicit unavailable record, never an individual pass | Actual gate function with injected fake commands; skill text loading |
| T5 | `context7.test.js` — lookup takes Context7 first-ranked library and keeps only cited snippets; failure modes stay distinct and never pass | Injected fake library/docs responses |
| T6 | `serena-mcp.test.js` — editing tools are refused without launching Serena; server runs the pinned ref over stdio with the tools interface and no dashboard | Guard and argv construction only |
| T7 | `context-pack-repomix.test.js` — a pack without repomix says so instead of passing as a repomix pack | Fake source tree, fallback and resolution only |
| T8 | `repo-integration-vercel-skills.test.js` — vendored Vercel files equal the bytes recorded in NOTICE.md; non-UI roles never receive Vercel texts | Hashes and role-bound text loading |
| T9 | `tool-usage-audit.test.js` — audit covers both manifests, product dependencies and candidates with explicit evidence; audit coverage rejects an omitted inventory row | Dynamic inventory completeness and existing citation files |

T1–T7 initial run: **55 pass, 0 fail, 0 skip, 0 cancelled**. T9 against the incomplete draft: **1 pass, 2 fail, 0 skip** (missing tool row and source citations). T8+T9 completed-document run: **5 pass, 1 fail, 0 skip, 0 cancelled**; the failure is the existing Vercel byte check above. Final combined results and exact commands are recorded in `.oc/report.md`. No sandbox EPERM occurred.

Graph commands: `bash C:/Tools/graphify/sha-check.sh C:/Users/gumac/AI/shipde-platform/.worktrees/x-G` reported GRAPH 229be4d1 missing. Explicit check with `bbfde976` reported present but stale. `node C:/Tools/graphify/q.js bbfde976 toolsFor` located `tool-manifest.js:toolsFor`, load/filter callees and only an inferred export caller. No model/index build was run. `git diff --name-only bbfde976 HEAD -- tools/ai-brain/tool-manifest.js tools/ai-brain/prompt-compiler.js tools/ai-brain/orchestrate.js` was empty for these files, but does not certify the whole graph.

Follow-up `rg -n 'tool-manifest|toolsFor|gatesFor' tools/ai-brain -g '*.js'` found the lazy callers; opening `prompt-compiler.js:toolsForPrompt` and `orchestrate.js:runToolGates` confirmed them, and T2/T4 exercised the corresponding selector/gate behavior. Separate `rg` searches covered context7, serena, repomix, rtk, prism and harness commands in launcher/CLI/scripts. This source confirmation, not graph absence, supports the wiring statements.
