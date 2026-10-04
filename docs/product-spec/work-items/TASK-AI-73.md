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
