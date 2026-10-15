# TASK-AI-142 — Writer selection and review-repair handoff

## Ownership and base

- Assignment: user items 4 + 6 and review-repair result tests, 2026-10-15.
- Base fetched from `origin/main`: `f0911093743fad89ef5e09a3453b662a2683b694`.
- Branch: `fix/task-ai-142-writer-selection-review`.
- Worktree: `C:/Users/gumac/AI/shipde-platform/.worktrees/w-selectloop-codex`.
- Read root `AGENTS.md` and `docs/product-spec/work-items/TASK-AI-142.md`; this assignment expands the original Work Item's H2 file boundary.
- Existing `w-selectloop` was inspected at `da09c4669e3f38300caf7d6f88a39bc009101223`, branch `feat/task-ai-142-realtime-selection`. Its dirty CLI, Hermes, orchestrate, priors, ranking, route-probe, routing and untracked discovery/selection/prior work was preserved. No changes were copied over or committed from that worktree.
- The earlier draft already refreshes inventory/JEV/quota, but probes the entire candidate set, throws on JEV UNDECIDED, and is behind newer main writer fixes. This branch implements bounded writer selection against the fetched main instead.
- Source/key configuration and persisted source schema remain Gemini's responsibility. This change creates an in-memory inventory view only; no source-schema coordination is required.

Files owned here: `tools/ai-brain/{candidates,cli,orchestrate,route-probe,routing,writer-selection}.js`; `tools/ai-brain/test/task-ai-142-{writer-selection,writer-probe,review-repair-result}.test.js`; this handoff.

## Reviewable changes

1. `1d554c20c12a8b7bc5903c77d359eed697eb6905`: regression tests for successful, failed and throwing review-repair launches. Each must emit exactly one `writer-launch-result` with the correct route/kind/exit code and redact secret values.
2. Writer selection implementation and further tests:
   - Refresh enabled router `/models` inventory once per orchestration. CLI production calls enable refresh; explicit fixture registries/candidates stay offline unless refresh is requested.
   - Router inventory expands independently of OpenCode's configured catalogue, scoped by source and deduplicated. Missing harness, endpoint, account, credential, task capability, proof, quality, quota and failed-route checks remain separate gates.
   - Inventory records distinguish listing availability and count from inference proof. Selection records carry `routeEvidence` (`listed`, `configured`, `probeSucceeded`) and `quotaEvidence` when available. A listing never creates a successful probe or benchmark evidence.
   - Retain existing bounded, concurrent, account-aware route probes, stopping at a usable route. Zero reported quota excludes that candidate even after HTTP success. Missing quota headers remain `unknown`; no remaining balance is invented. Existing unknown-quota policy/exploration gates remain in force.
   - Cache JEV assessments, including failures, per run and unchanged assessment input. Source model, endpoint, confidence policy, task profile and injected ask changes invalidate reuse. JEV errors retain the deterministic Controller fallback. Trivial/simple work uses the existing latency/cost-oriented preset, complex/high-risk work uses the quality preset; all eligibility floors still apply. No model-name preferences or synthetic benchmark scores were added.
   - Writer result redaction also receives injected worker environment secrets, for normal writer, host-gate repair and review repair.

## Validation

- Fixture inventory: 909 listed models with 82 OpenCode declarations produces 909 distinct candidates from one mock `/models` request, zero inference requests.
- Integration fixture: successful first probe with exhausted quota is skipped, the next route launches, and the unchanged writer assessment calls JEV once.
- Candidate/routing/new selection/result tests: **83/83 passed** (`candidates.test.js`, `task-ai-65.test.js`, `task-ai-142-writer-selection.test.js`, `task-ai-142-review-repair-result.test.js`).
- Final TASK-AI-142 suite: **248/248 passed**, zero skipped, after the injected-environment redaction change. Focused post-launch/review-repair checks: **13/13 passed**. Prettier `--check`, ESLint on all owned JavaScript files, and `git diff --check` passed.
- Commands: `node --test "tools/ai-brain/test/task-ai-142*.test.js"`; `node --test tools/ai-brain/test/candidates.test.js tools/ai-brain/test/task-ai-65.test.js tools/ai-brain/test/task-ai-142-writer-selection.test.js tools/ai-brain/test/task-ai-142-review-repair-result.test.js`; Prettier `--check`, ESLint and `git diff --check` on the owned files.
- Local logs: `%TEMP%/shipde-writer-142-final.log`, `%TEMP%/shipde-writer-core-tests.log`.
- An earlier TASK-AI-142 run failed `wall-clock deadline aborts concurrent probes and never launches` at `signals.length > 0`. The exact test also failed on a clean detached base worktree `w-selectloop-baseline` at `f0911093`. A later complete run passed; treat this as a baseline timing sensitivity, not a removed/relaxed test.
- Git hooks run with the already installed Lefthook executable via `LEFTHOOK_BIN`; no hook bypass. First commit: staged secret scan clean. AO daemon was unavailable, so writer-claim checks were local only.

## Remaining external evidence

No real 9Router/JEV/provider calls, bulk probes, new agents, publishing, independent approval or merge were performed. Live inventory size, account quota and provider availability are unverified in this assignment. Claude must integrate this branch with Gemini's source/key work and the preserved `w-selectloop` draft before live acceptance.
