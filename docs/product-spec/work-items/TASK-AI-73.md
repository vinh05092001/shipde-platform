# TASK-AI-73 — Live JEV advisory and evidence-based candidate selection

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-73` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `199` |
| Dependencies | `TASK-AI-64`; `TASK-AI-65`; `TASK-AI-70` |
| Assigned author | `Codex lane B — sole integrator` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-73.md`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/jev.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/ranking.js`; `tools/ai-brain/candidates.js`; `tools/ai-brain/evidence.js`; `tools/ai-brain/quota-store.js`; `tools/ai-brain/publisher.js`; `tools/ai-brain/review-loop.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-73-jev-live-profile` |
| Pull Request | `196` |

## Business Outcome

The live Controller asks JEV only for a closed weighting/profile advisory, then independently selects the full seven-part candidate key from current evidence, quota, cooldown, reservations and failure-domain rules. JEV never chooses a model, provider, account or gateway, and missing or low-confidence JEV advice is recorded as `UNDECIDED` with the Controller deciding deterministically.

## Source References

- `tools/ai-brain/sources.json` source `jev`: decision-service endpoint, credential env/store, confidence floor and no-code boundary.
- `docs/product-spec/work-items/TASK-AI-64.md`: live loop, review receipt, publisher fail-closed boundary.
- `docs/product-spec/work-items/TASK-AI-65.md`: task profile schema, JEV advisory, ranking floors and structured outcome path.
- `docs/product-spec/work-items/TASK-AI-70.md`: seven-part candidates and proof-level honesty.
- `AGENTS.md`: source-of-truth, no credential leakage, independent review, and PR evidence rules.

## In Scope

- Build live `jevAsk` from `sources.json` source data only, with credentials read only from `TYPESAFE_API_KEY` or `~/.typesafe-key`.
- Derive task profiles from the plan and Work Item fields instead of loose defaults.
- Require coding and review lanes to use `WORK_ITEM_PASS`, except explicit exploration Work Items.
- Use the Controller quota store and reservation state during live ranking.
- Record task profile, JEV outcome, weighting profile, top candidates, proof, capability evidence, quota/headroom/cooldown, reservations, failure domain, rejected reasons and review/publish evidence.
- Ensure draft PR evidence names the reviewer and decision evidence.

## Out of Scope

- Adding models, providers, accounts or gateways in code.
- Letting JEV maintain registry, quota, fallback or credential state.
- Publishing, merging, approving or pushing this branch.
- Writing the parallel contract test file `tools/ai-brain/test/task-ai-73.test.js`.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-73-01` | Live profile dispatch has no injected JEV seam | CLI builds JEV ask from `sources.json`; no URL/key is hard-coded; missing service/key becomes `UNDECIDED` with Controller fallback | Contract test plus decision log |
| `AC-AI-73-02` | Coding/review task profile is derived from Work Item | Profile carries role, complexity, capabilities, context, duration, latency, quality, cost, proof/resource floors and forbidden domains | Contract test decision record |
| `AC-AI-73-03` | Candidate selection runs after JEV advice | Controller chooses a seven-part key; JEV output never contains provider/model/account selection authority | Contract test on selected key and advisory payload |
| `AC-AI-73-04` | Quota is unknown or cooling | Unknown quota is not treated as available unless explicit exploration budget exists; cooldown/exhausted candidates are rejected | Contract test plus quota-store fixture |
| `AC-AI-73-05` | Decision log is written | Log records task profile, JEV outcome, top 3, proof, capability, quota, reservation, rejected reasons, fallback, reviewer and reviewed SHA evidence | Contract test on JSONL |
| `AC-AI-73-06` | Publisher sees incomplete review evidence | Publish refuses without reviewed SHA, reviewer key, review artifact, PASS on that SHA and writer/reviewer failure-domain separation | Contract test on publisher/refusal |
| `AC-AI-73-07` | Draft PR body is produced | Body names the reviewer and links decision evidence instead of `Reviewer: unrecorded` | Contract test or mocked publisher input |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-73.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `git diff --check`
- `npx --package prettier@3.9.6 prettier --check <changed files>`

## Evidence

Implementation evidence must include the merged contract-test commit status, focused and full brain-suite totals, whitespace check result, Prettier result, final commit SHA, and the exact files changed.

## Residual Limitations

JEV availability is intentionally not required for Controller progress. If the source is unreachable, times out, returns malformed output, or falls below `minConfidence`, the Controller records `UNDECIDED` and proceeds only through deterministic fallback weights and normal ranking gates.

## Data Gap and Evidence Analysis: WORK_ITEM_PASS Refusal

Following the resolution of Defect Y (TypeSafe JEV OpenAPI contract conformance) and Problem 2 defect fixes (reading capability evidence from bound accounts and treating `minContext` as `contextSize`), candidate filtering correctly evaluates capability floors.

### Root Cause Analysis of Live Run Refusal (`proof3-data`)

1. **JEV Adapter Defect Y (Resolved):**
   - Previous behavior: `buildJevAsk` posted `{kind, prompt, evidence, options}` to `/v1/systemone`, resulting in HTTP 400 'Invalid request' from `api.typesafe.ai`.
   - Resolution: Adapter conforms strictly to the OpenAPI specification (`POST /v1/systemone` with `{model, state, questions: {weightProfile: {type: 'choice', instructions, criteria}}}`), reads model `"jev-latest"` from `sources.json`, and records `jevModel`, `confidence`, and `probabilities` in the decision log.

2. **Capability Evidence & `minContext` (Resolved):**
   - Previous behavior: `generateCandidates` and `gatewayAccountCandidates` dropped `capabilities` declared on bound accounts (`ninerouter`). Furthermore, `buildProfile` added `minContext: 200000` to `requiredCapabilities` as a capability name rather than mapping it to `contextSize`.
   - Resolution: Bound account capabilities (`jsonSchema`, `tools`, `contextWindow`) are now attached to candidate objects, and `minContext` in role requirements sets `contextSize: 200000` without polluting `requiredCapabilities`. Candidates successfully pass the capability floor.

3. **Remaining Refusal: Proof Floor Honesty (`WORK_ITEM_PASS`):**
   - Complex coding tasks (such as `TASK-AI-74` in `proof3-data`) require `proofFloor: WORK_ITEM_PASS`.
   - The evidence store (`tools/ai-brain/data/evidence/`) currently contains **zero** `WORK_ITEM_PASS` records for any of the 24 live candidates discovered from the 9Router gateway.
   - Per AGENTS.md, TASK-AI-65, and TASK-AI-70, the proof floor **must not be lowered** to mask missing evidence. The candidates are honestly and correctly refused with `PROOF_FLOOR_NOT_MET:NONE`.

### Candidate Evidence Audit (Live Proof Run)

- **Candidates with `WORK_ITEM_PASS` in Evidence Store:** 0 of 24 (None)
- **Candidates lacking `WORK_ITEM_PASS` in Evidence Store:** 24 of 24 (All refused with `PROOF_FLOOR_NOT_MET:NONE`):
  1. `paseo::http://127.0.0.1:20128/v1::9router::xmtp::ninerouter::ninerouter::xmtp/mimo-v2.6-pro`
  2. `paseo::http://127.0.0.1:20128/v1::9router::xmtp::codex::codex::xmtp/mimo-v2.6-pro`
  3. `paseo::http://127.0.0.1:20128/v1::9router::xmtp::ninerouter::ninerouter::xmtp/mimo-v2.6-flash`
  4. `paseo::http://127.0.0.1:20128/v1::9router::xmtp::codex::codex::xmtp/mimo-v2.6-flash`
  5. `paseo::http://127.0.0.1:20128/v1::9router::kgw::ninerouter::ninerouter::kgw/nvidia/nemotron-3-super-120b-a12b:free`
  6. `paseo::http://127.0.0.1:20128/v1::9router::kgw::codex::codex::kgw/nvidia/nemotron-3-super-120b-a12b:free`
  7. `paseo::http://127.0.0.1:20128/v1::9router::ocz::ninerouter::ninerouter::ocz/big-pickle`
  8. `paseo::http://127.0.0.1:20128/v1::9router::ocz::codex::codex::ocz/big-pickle`
  9. `paseo::http://127.0.0.1:20128/v1::9router::cl::ninerouter::ninerouter::cl/nvidia/nemotron-3-ultra-550b-a55b:free`
  10. `paseo::http://127.0.0.1:20128/v1::9router::cl::codex::codex::cl/nvidia/nemotron-3-ultra-550b-a55b:free`
  11. `paseo::http://127.0.0.1:20128/v1::9router::cl::ninerouter::ninerouter::cl/cline-free/muse-spark-1.3-contributor`
  12. `paseo::http://127.0.0.1:20128/v1::9router::cl::codex::codex::cl/cline-free/muse-spark-1.3-contributor`
  13. `opencode::cli::9router::xmtp::ninerouter::ninerouter::ninerouter/xmtp/mimo-v2.6-pro`
  14. `opencode::cli::9router::xmtp::codex::codex::ninerouter/xmtp/mimo-v2.6-pro`
  15. `opencode::cli::9router::xmtp::ninerouter::ninerouter::ninerouter/xmtp/mimo-v2.6-flash`
  16. `opencode::cli::9router::xmtp::codex::codex::ninerouter/xmtp/mimo-v2.6-flash`
  17. `opencode::cli::9router::kgw::ninerouter::ninerouter::ninerouter/kgw/nvidia/nemotron-3-super-120b-a12b:free`
  18. `opencode::cli::9router::kgw::codex::codex::ninerouter/kgw/nvidia/nemotron-3-super-120b-a12b:free`
  19. `opencode::cli::9router::ocz::ninerouter::ninerouter::ninerouter/ocz/big-pickle`
  20. `opencode::cli::9router::ocz::codex::codex::ninerouter/ocz/big-pickle`
  21. `opencode::cli::9router::cl::ninerouter::ninerouter::ninerouter/cl/nvidia/nemotron-3-ultra-550b-a55b:free`
  22. `opencode::cli::9router::cl::codex::codex::ninerouter/cl/nvidia/nemotron-3-ultra-550b-a55b:free`
  23. `opencode::cli::9router::cl::ninerouter::ninerouter::ninerouter/cl/cline-free/muse-spark-1.3-contributor`
  24. `opencode::cli::9router::cl::codex::codex::ninerouter/cl/cline-free/muse-spark-1.3-contributor`

To graduate these candidates for production coding, exploration runs (such as probe items or exploration work items) must be executed to record verified `WORK_ITEM_PASS` evidence in the repository's evidence store.
