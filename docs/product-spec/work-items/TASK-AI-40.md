# TASK-AI-40 — Retire superseded or mis-described manifest entries

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-40` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `173` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `CODEX` (specification preparation); `GEMINI` (subsequent manifest-retirement implementation) |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-40.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-40-manifest-retire` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/27 |

## Business outcome

The Ship Dễ governed ecosystem catalog (`tools/ecosystem-manifest.json`) is the
machine-readable source of truth for tooling adoption, execution harnesses, and
quality gates across all AI agents and human contributors. Under repository
operating principles (`AGENTS.md` and policy `AI-TOOL-10`), the catalog must
strictly reflect reality: declared capabilities must exist, and absent or
mis-described tools must never be recorded as adopting or enforcing roles they do
not perform. "Removing a wrong entry is worth more than satisfying it."

Foundation reconciliation (`TASK-AI-17`) exposed that the ecosystem manifest
contained entries that either duplicate native internal systems or misrepresent
external repositories:

1. **`token-tracker` (`xiufengsun/TokenTracker`) is superseded**:
   Declared as an npm development tool for "Token usage tracking, telemetry budget
   auditing, and agent expense visibility". However, comprehensive token usage
   tracking and quota observability were already natively implemented in the
   repository under `TASK-AI-15`:
   - `tools/ai-dashboard/usage-adapter.js` provides multi-ledger token ingestion
     (Claude Code JSONL transcript ledger with turn summing, resumed session
     deduplication, cached token pricing, and home directory redaction; 9Router
     SQLite ledger with cost extraction).
   - `tools/ai-dashboard` provides real-time visibility, provider telemetry, pool
     utilization gauges, and quota ceiling monitoring, verified by 458 automated
     tests.
   Adopting `token-tracker` as an external dependency duplicates existing,
   tested internal functionality and creates conflicting sources of truth. It
   must be formally retired.

2. **`sylph` (`getnao/sylph`) is mis-described**:
   Declared in `tools/ecosystem-manifest.json` as an "AI agent execution harness,
   policy enforcement, and sandboxing" with source of truth boundary "Agent
   sandbox boundary; enforces single-writer and tool permission constraints" and
   health check `Test-Path tools/snapshots/sylph`. In reality, `getnao/sylph` is a
   collection of static Markdown prompt specifications with no backend runtime,
   no execution sandbox, and no programmatic policy enforcement mechanism.
   Furthermore, single-writer workspace protection is already implemented natively
   in `tools/ai-guard` (single-writer claim guard, pre-commit hook preventing
   cross-session collisions) under `TASK-AI-15` and `TASK-AI-16`. Claiming that
   `sylph` acts as an active policy runtime or execution harness is a severe
   mis-description that misleads operators and agents. It must be formally retired
   from its false role.

`TASK-AI-40` establishes the authoritative specification for retiring both
superseded and mis-described entries from the ecosystem catalog, defining:
1. The architectural justification and evidence for retiring `token-tracker`
   and `sylph`.
2. The clean removal of `token-tracker` and `sylph` from `tools/ecosystem-manifest.json`,
   `tools/ecosystem-profiles.json`, `tools/ai-brain/manifest-audit.js`,
   `scripts/ai/ecosystem.ps1`, and `AI-TOOLCHAIN-DECISIONS.md`.
3. Invariant boundaries: preservation of active CI gates (`gitleaks 8.24.0`
   `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned`), preservation of genuine pending
   gates (`lefthook`, `trivy`, `axe-core`, `lighthouse-ci`, `agent-scan`), and
   strict enforcement of zero manifest audit errors (`node tools/ai-brain/cli.js manifest`).

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern,
  existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent
  Codex review gate.
- `AGENTS.md` § Role separation (L36-L40) — Codex prepares the complete Work Item
  from approved sources, chooses the implementation author and moves the durable
  register to `READY_FOR_AUTHOR`; Gemini implements and opens the Pull Request.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking; capabilities must be verified.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — Declared lifecycle states
  must match reality; mis-described entries must not be maintained to fake coverage.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Governed
  Ecosystem Catalog — Entries for `token-tracker` and `sylph`.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` row 173 —
  `TASK-AI-40`: "token-tracker duplicates the built usage adapter; sylph is markdown,
  not a policy runtime".
- `docs/product-spec/work-items/TASK-AI-15.md` — Native token usage adapter and
  realtime cockpit dashboard implementation.
- `docs/product-spec/work-items/TASK-AI-16.md` & PR #17 — Native single-writer
  claim guard in `tools/ai-guard`.
- `docs/product-spec/work-items/TASK-AI-17.md` — Reconcile the ecosystem manifest
  against reality.

## Preconditions and dependencies

- `TASK-AI-17` merged (`1f587dd`), unblocking `TASK-AI-40` and establishing
  truthful `PENDING` states for absent tools while keeping `gitleaks` `ADOPTED`
  and `ci-provisioned`.
- `tools/ai-brain/cli.js manifest` reports 0 errors, exactly 1 warning
  (`PINNED_VERSION_DRIFT` for `codex-cli` observed `0.154.0` vs pinned `0.151.0`), and 2 notes.
- `tools/ai-brain/cli.js reconcile` reports 0 errors, 1 warning (`TASK-AI-07`), and 161 notes.
- Combined test suite across `tools/ai-brain`, `tools/ai-dashboard`, and `tools/ai-guard`
  reports 458 passed, 0 failed across 106 suites.
- Native usage adapter (`tools/ai-dashboard/usage-adapter.js`) and dashboard
  (`tools/ai-dashboard`) are active, tested, and passing all unit tests (19 passed, 0 failed).
- Native claim guard (`tools/ai-guard/cli.js`) is active, tested, and guarding
  worktree sessions (33 passed, 0 failed).

## Author boundary

This Work Item is currently in Codex planning preparation. `CODEX` is the author
of the specification document itself; its scope is strictly bounded to authoring
`docs/product-spec/work-items/TASK-AI-40.md` and it does not implement production
code during planning. `GEMINI` is the nominated implementation author for the
subsequent manifest-retirement change, and that boundary applies only to that
later implementation Work Item phase.

Planning does not constitute an implementation handoff. The durable register
(`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` row 173)
remains authoritative and currently reads `BLOCKED_DEPENDENCY` on `TASK-AI-17`.
The Control status above mirrors the register and is not advanced ahead of it.
When Codex releases this specification and the dependency is cleared in the
register, the register moves to `READY_FOR_AUTHOR` with `GEMINI` recorded as the
implementation author; this specification PR never sets that state itself.

Two distinct markers must not be conflated. The Pull Request body line
`Review status: READY_FOR_CODEX` is the review-submission marker enforced by
`docs/product-spec/scripts/validate_pr_contract.py`; it records only that the
Pull Request is submitted for an independent Codex review-only task, and the
`contract` CI job fails closed without it. The Work Item Control `Status` field
and the durable register row 173 are the lifecycle state, and both remain
`BLOCKED_DEPENDENCY`. Setting the Pull Request review-submission marker never
advances the lifecycle state, and the lifecycle state is never edited to satisfy
the Pull Request contract gate.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
  `docs/product-spec/scripts/*`.
- Declaring `gitleaks` absent, removing `gitleaks` from CI, or downgrading its
  `lifecycle_state` or `blocking_policy`.
- Modifying `tools/ecosystem-manifest.json` or `tools/ecosystem-profiles.json` in
  this specification PR (retirement execution belongs to the subsequent
  implementation commit/phase).
- Dropping, skipping, or weakening any verification gate.
- Advancing the Work Item lifecycle state inside this PR: editing the Control
  `Status` field ahead of the durable register, or writing `READY_FOR_CODEX` /
  `READY_FOR_AUTHOR` into the Control table or into register row 173. This
  prohibition governs the lifecycle state only. It does not govern the Pull
  Request body line `Review status: READY_FOR_CODEX`, which is the separate
  review-submission marker required by the `contract` CI job and must be present
  whenever this PR is open for Codex review.
- Author never approves own work; the specification is released to an independent
  Codex review-only task, and the register transition to `READY_FOR_AUTHOR` is
  Codex's planning act, not this document's.

## In scope

- Detail the architectural rationale and empirical evidence for the formal
  retirement of `token-tracker` (`xiufengsun/TokenTracker`).
- Detail the factual analysis and evidence demonstrating that `sylph` (`getnao/sylph`)
  is Markdown documentation without an executable sandbox or runtime, and record
  its formal retirement from its mis-described role in the manifest.
- Specify the complete inventory of manifest files, profile arrays, audit maps,
  and documentation to be updated during the implementation phase:
  1. `tools/ecosystem-manifest.json`: Remove entries for `token-tracker` and `sylph`.
  2. `tools/ecosystem-profiles.json`: Remove `token-tracker` from `FOUNDATION` and
     `NIGHTLY_MAINTENANCE`; remove `sylph` from `SECURITY_REVIEW`.
  3. `tools/ai-brain/manifest-audit.js`: Remove package alias mapping `'token-tracker': 'tokentracker'`.
  4. `scripts/ai/ecosystem.ps1`: Remove `getnao/sylph` from repository clone list.
  5. `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`: Update
     catalog count from 37 to 35 adopted repositories, explicitly recording the
     formal retirement of `token-tracker` and `sylph`.
- Formulate business rules (`AI-40-R01` through `AI-40-R08`) governing manifest
  truthfulness, non-duplication of native capabilities, zero-error manifest audit
  enforcement, and the prohibition on retiring an entry merely to silence an audit
  finding (`AI-40-R08`).
- Formulate the acceptance matrix (`AC-AI-40-01` through `AC-AI-40-08`) defining
  verifiable criteria for review and delivery.
- Author complete Work Item specification `TASK-AI-40.md`.

## Out of scope

- Modifying `package.json` or installing any new dependencies.
- Re-implementing or altering `tools/ai-dashboard/usage-adapter.js` or `tools/ai-guard`.
- Retiring or modifying any genuine quality gate (`gitleaks`, `lefthook`, `trivy`,
  `axe-core`, `lighthouse-ci`, `agent-scan`).
- Upgrading or changing `codex-cli` pinned version (governed human decision).

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-40-R01` | Manifest truthfulness invariant: An ecosystem manifest entry must accurately describe the tool's actual nature, kind, and role. Falsely declaring documentation repositories as execution harnesses or policy runtimes is prohibited. |
| `AI-40-R02` | Native capability non-duplication: External tools that duplicate existing, verified native repository systems (e.g. `token-tracker` duplicating `tools/ai-dashboard/usage-adapter.js`) must not be adopted. Retiring a redundant entry takes precedence over satisfying it - but only once the duplication is independently evidenced under `AI-40-R08`; the precedence in this rule never applies on the strength of an audit result alone. |
| `AI-40-R03` | Formal retirement of `token-tracker`: `token-tracker` is formally retired from the ecosystem manifest. The native usage adapter `tools/ai-dashboard/usage-adapter.js` (exports `collectUsageState`, `collectClaudeUsage`, `collectRouterUsage`) and the dashboard in `tools/ai-dashboard` remain the sole authoritative token and quota tracking system. The manifest's current `source_of_truth_boundary` string mis-locates this adapter under `tools/ai-brain`; the implementation phase must correct or remove that string rather than propagate it. |
| `AI-40-R04` | Formal retirement of `sylph` from runtime role: `sylph` is formally retired from the ecosystem manifest as an execution harness and sandboxing policy runtime. The single-writer invariant is strictly enforced by `tools/ai-guard/cli.js` and `scripts/ai/control.ps1`. |
| `AI-40-R05` | Atomic cleanup of manifest profiles and references: When retired in implementation, all references across `tools/ecosystem-manifest.json`, `tools/ecosystem-profiles.json`, `tools/ai-brain/manifest-audit.js`, and `scripts/ai/ecosystem.ps1` must be removed synchronously to prevent dangling profile IDs or unresolvable audit aliases. |
| `AI-40-R06` | Preservation of security baseline and quality gates: Retirement of superseded/mis-described tools must not touch, downgrade, or alter the `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned` status of `gitleaks 8.24.0`, nor the `PENDING` status of genuine upcoming quality gates (`lefthook`, `trivy`, `axe-core`, `lighthouse-ci`, `agent-scan`). |
| `AI-40-R07` | Audit and reconciler green gate invariance: Retirement implementation must preserve 0 errors on `node tools/ai-brain/cli.js manifest` (with only the single `codex-cli` drift warning permitted) and 0 errors on `node tools/ai-brain/cli.js reconcile`. This zero-error requirement is a regression guard on an already-justified retirement; it is never itself a justification to remove an entry (`AI-40-R08`). |
| `AI-40-R08` | Retirement requires independent evidence, never audit silencing: A manifest audit failure, warning, note, or the mere absence of a tool on the host never justifies retiring an entry, for any entry - not only the named quality gates protected by `AI-40-R06`. Retirement is permitted only when reproducible evidence recorded outside this specification establishes either (a) supersession - a named native artifact in this repository provides the declared capability, evidenced by that artifact's exports and its passing test file, or (b) fundamental mis-description - inspection of the pinned upstream artifact itself contradicts the declared `kind`, `role`, or `source_of_truth_boundary`. Where neither is independently evidenced, the entry must remain in the manifest carrying a truthful lifecycle state (`PENDING` for absent-but-genuine tools) and the audit finding must be resolved by correcting the entry, not by deleting it. Citing a rule or assertion of this Work Item is not evidence. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and
operator-facing outputs are CLI logs from:
- `node tools/ai-brain/cli.js manifest`: Must report 0 errors, exactly 1 warning (`codex-cli`
  pinned version drift `0.151.0` vs `0.154.0`), and 2 notes.
- `node tools/ai-brain/cli.js reconcile`: Must report 0 errors, 1 warning (`TASK-AI-07`),
  and 161 notes.
- `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"`:
  Must report 458 passed, 0 failed across 106 suites.

## API, event and data impact

No schema, database, migration, or runtime API change. Affects governed
ecosystem toolchain metadata files (`tools/ecosystem-manifest.json`,
`tools/ecosystem-profiles.json`, `tools/ai-brain/manifest-audit.js`,
`scripts/ai/ecosystem.ps1`) and architectural documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-40-01` | Verify truthfulness of baseline security gate status in manifest and CI workflow | `node -e "const fs = require('fs'); const wf = fs.readFileSync('.github/workflows/security-baseline.yml', 'utf8'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const g = m.adopted.find(x => x.id === 'gitleaks'); const pin = g.pinned_version_or_commit; const l = m.adopted.find(x => x.id === 'lefthook'); const t = m.adopted.find(x => x.id === 'trivy'); const valid = g.lifecycle_state === 'ADOPTED' && g.blocking_policy === 'BLOCKING_GATE' && wf.includes('GITLEAKS_VERSION=\x22' + pin + '\x22') && l.lifecycle_state === 'PENDING' && t.lifecycle_state === 'PENDING'; console.log('Baseline gates verified: gitleaks ' + pin + ' (ADOPTED/BLOCKING_GATE in CI), lefthook ' + l.lifecycle_state + ', trivy ' + t.lifecycle_state + ' -> ' + valid); if (!valid) process.exit(1);"` exits 0 and prints the string `Baseline gates verified: gitleaks 8.24.0 (ADOPTED/BLOCKING_GATE in CI), lefthook PENDING, trivy PENDING -> true` | command stdout |
| `AC-AI-40-02` | Negative proof: verify missing or decoyed workflow fails closed on CI-provisioned gate | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const os = require('os'); const fs = require('fs'); const path = require('path'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-decoy-')); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(d, '.github', 'workflows', 'decoy.yml'), 'steps:\n  - run: echo no-gitleaks\n'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const res = auditManifest(m, { rootDir: d }); const f = res.findings.find(x => x.id === 'gitleaks'); fs.rmSync(d, { recursive: true, force: true }); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"` exits 1 and prints the string `QUALITY_GATE_MISSING: gitleaks` | command stderr |
| `AC-AI-40-03` | Independent evidence for the `token-tracker` retirement premise: inspect the pinned upstream npm artifact and prove the real native deliverable covers the declared capability | `node -e "const cp = require('child_process'); const meta = JSON.parse(cp.execSync('npm view token-tracker@1.0.1 --json', { encoding: 'utf8' })); const mismatch = !meta.repository.url.includes('xiufengsun/TokenTracker'); const blockchain = meta.description.indexOf('token balances over block') >= 0; const out = cp.execSync('node --test tools/ai-dashboard/test/usage-adapter.test.js', { encoding: 'utf8' }); const api = Object.keys(require('./tools/ai-dashboard/usage-adapter.js')); const covered = api.includes('collectUsageState') && api.includes('collectClaudeUsage') && api.includes('collectRouterUsage'); const ok = mismatch && blockchain && covered && out.indexOf('pass 19') >= 0 && out.indexOf('fail 0') >= 0; console.log('token-tracker retirement evidence: pinned npm artifact token-tracker@1.0.1 resolves to ' + meta.repository.url + ' (not xiufengsun/TokenTracker) described as ' + meta.description + ' blockchain-not-ai=' + blockchain + '; native tools/ai-dashboard/usage-adapter.js exports collectUsageState+collectClaudeUsage+collectRouterUsage=' + covered + ' with pass 19 fail 0 -> ' + ok); if (!ok) process.exit(1);"` exits 0 and prints the string `token-tracker retirement evidence: pinned npm artifact token-tracker@1.0.1 resolves to git+ssh://git@github.com/BunsDev/token-tracker.git (not xiufengsun/TokenTracker) described as A module for tracking token balances over block changes. blockchain-not-ai=true; native tools/ai-dashboard/usage-adapter.js exports collectUsageState+collectClaudeUsage+collectRouterUsage=true with pass 19 fail 0 -> true` - falsifiable in both directions: the premise fails if the pinned npm artifact does resolve to `xiufengsun/TokenTracker` or describes AI token usage, or if the real deliverable `tools/ai-dashboard/usage-adapter.js` stops exporting the three collectors or its own test file stops reporting `pass 19` / `fail 0` | command stdout; pinned npm registry metadata for `token-tracker@1.0.1`; module exports of `tools/ai-dashboard/usage-adapter.js`; run output of `tools/ai-dashboard/test/usage-adapter.test.js` |
| `AC-AI-40-04` | Independent evidence for the `sylph` retirement premise: inspect the pinned upstream repository tree itself and prove the real native deliverable covers the declared capability | `node -e "const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const SHA = 'd31a9c05f19de0f14e255d9301bbdb0f872354b3'; const tags = cp.execSync('git ls-remote --tags https://github.com/getnao/sylph', { encoding: 'utf8' }).trim(); const pinResolvable = tags.length > 0; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-evidence-')); cp.execSync('git clone --quiet --filter=blob:none https://github.com/getnao/sylph \"' + d + '\"'); cp.execSync('git -C \"' + d + '\" checkout --quiet ' + SHA); const files = cp.execSync('git -C \"' + d + '\" ls-files', { encoding: 'utf8' }).trim().split('\n'); const md = files.filter(f => f.endsWith('.md')).length; const js = files.filter(f => f.endsWith('.js')).length; const pkg = files.filter(f => path.basename(f) === 'package.json').length; fs.rmSync(d, { recursive: true, force: true }); const guard = cp.execSync('node --test tools/ai-guard/test/writer-claim.test.js', { encoding: 'utf8' }); const ok = !pinResolvable && pkg === 0 && js === 1 && md === 112 && files.length === 210 && guard.indexOf('pass 33') >= 0 && guard.indexOf('fail 0') >= 0; console.log('sylph retirement evidence: pinned tag 0.1.0 resolvable=' + pinResolvable + '; upstream ' + SHA + ' contains 210 files = 112 markdown, 1 javascript, 0 package.json, 0 runtime entrypoint; native tools/ai-guard writer-claim pass 33 fail 0 -> ' + ok); if (!ok) process.exit(1);"` exits 0 and prints the string `sylph retirement evidence: pinned tag 0.1.0 resolvable=false; upstream d31a9c05f19de0f14e255d9301bbdb0f872354b3 contains 210 files = 112 markdown, 1 javascript, 0 package.json, 0 runtime entrypoint; native tools/ai-guard writer-claim pass 33 fail 0 -> true` - the premise is falsified if upstream `getnao/sylph` at that commit ships a `package.json`, a runtime entrypoint, or a resolvable `0.1.0` tag matching the manifest pin, or if the real deliverable `tools/ai-guard` stops reporting `pass 33` / `fail 0` | command stdout; `getnao/sylph` upstream tree at commit `d31a9c05f19de0f14e255d9301bbdb0f872354b3` (210 tracked files); `git ls-remote --tags` output for manifest pin `0.1.0`; run output of `tools/ai-guard/test/writer-claim.test.js` |
| `AC-AI-40-05` | Verify the complete cleanup target inventory across all five unabbreviated repository files, including the governed catalog document and its adopted-repository count | `node -e "const fs = require('fs'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const p = JSON.parse(fs.readFileSync('tools/ecosystem-profiles.json', 'utf8')); const ma = fs.readFileSync('tools/ai-brain/manifest-audit.js', 'utf8'); const eco = fs.readFileSync('scripts/ai/ecosystem.ps1', 'utf8'); const dec = fs.readFileSync('docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md', 'utf8'); const hasM = m.adopted.some(x => x.id === 'token-tracker') && m.adopted.some(x => x.id === 'sylph'); const hasP = p.profiles.FOUNDATION.allowed_tools.includes('token-tracker') && p.profiles.NIGHTLY_MAINTENANCE.allowed_tools.includes('token-tracker') && p.profiles.SECURITY_REVIEW.allowed_tools.includes('sylph'); const hasMa = ma.includes('token-tracker'); const hasEco = eco.includes('getnao/sylph'); const hasDec = dec.includes('Governed Ecosystem Catalog (37 Adopted Repositories)') && dec.includes('**37 adopted repositories**') && dec.includes('getnao/sylph') && dec.includes('xiufengsun/TokenTracker'); const manifestCount = m.adopted.length; const ok = hasM && hasP && hasMa && hasEco && hasDec && manifestCount === 37; console.log('Retirement inventory verified in tools/ecosystem-manifest.json, tools/ecosystem-profiles.json, tools/ai-brain/manifest-audit.js, scripts/ai/ecosystem.ps1, docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md: manifest adopted=' + manifestCount + ', catalog declares 37 with both listings present -> ' + ok); if (!ok) process.exit(1);"` exits 0 and prints the string `Retirement inventory verified in tools/ecosystem-manifest.json, tools/ecosystem-profiles.json, tools/ai-brain/manifest-audit.js, scripts/ai/ecosystem.ps1, docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md: manifest adopted=37, catalog declares 37 with both listings present -> true`, pinning the pre-retirement state of all five files. The retirement implementation is complete only when this exact command exits 1 and, additionally, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` carries the heading `## Governed Ecosystem Catalog (35 Adopted Repositories)` and the phrase `**35 adopted repositories**`, lists neither `getnao/sylph` nor `xiufengsun/TokenTracker` in its catalog listings, and `tools/ecosystem-manifest.json` reports exactly 35 adopted entries | command stdout; `tools/ecosystem-manifest.json`; `tools/ecosystem-profiles.json`; `tools/ai-brain/manifest-audit.js`; `scripts/ai/ecosystem.ps1`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| `AC-AI-40-06` | Run manifest truth audit against production manifest reporting zero errors and one permitted warning | `node tools/ai-brain/cli.js manifest` exits 0 and prints the string `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` naming `codex-cli` | command stdout |
| `AC-AI-40-07` | Run full test suite regression checks across ai-brain, ai-dashboard, and ai-guard | `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"` exits 0 and prints the string `pass 458` | command stdout |
| `AC-AI-40-08` | Verify zero angle-bracket placeholders anywhere in the specification, including every cell of the Codex review record, using a dedicated scanner rather than the documentation validator (which accepts template values) | `python -c "import re, pathlib, sys; text = pathlib.Path('docs/product-spec/work-items/TASK-AI-40.md').read_text(encoding='utf-8'); pat = chr(60) + '[^' + chr(62) + chr(10) + ']+' + chr(62); matches = re.findall(pat, text); print('Angle bracket placeholders found:', len(matches)); sys.exit(0 if len(matches) == 0 else 1)"` exits 0 and prints the string `Angle bracket placeholders found: 0` | command stdout |

## Verification commands

### 1. Standard repository verification suite

```powershell
# Manifest truth audit: 0 errors, 1 warning (codex-cli version drift 0.151.0 vs 0.154.0), 2 notes
node tools/ai-brain/cli.js manifest
# Expected: Exit code 0, "Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú", 1 warning (codex-cli)

# Delivery register reconciliation: 0 errors, 1 warning (TASK-AI-07), 161 notes
node tools/ai-brain/cli.js reconcile
# Expected: Exit code 0, "Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú"

# Full unit test regression suite across ai-brain, ai-dashboard, and ai-guard
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
# Expected: Exit code 0, "pass 458", "fail 0", 106 suites passed

# Repository documentation structural validation
python docs/product-spec/scripts/validate_docs.py
# Expected: Exit code 0, "Documentation validation passed: 82 markdown files, 130 feature IDs, 178 delivery rows, 522 unique identifiers."

# Zero angle-bracket placeholder check
python -c "import re, pathlib, sys; text = pathlib.Path('docs/product-spec/work-items/TASK-AI-40.md').read_text(encoding='utf-8'); pat = chr(60) + '[^' + chr(62) + chr(10) + ']+' + chr(62); matches = re.findall(pat, text); print('Angle bracket placeholders found:', len(matches)); sys.exit(0 if len(matches) == 0 else 1)"
# Expected: Exit code 0, "Angle bracket placeholders found: 0"
```

### 2. Behavioral assertions for retirement invariants and CI security gates

```powershell
# A. Baseline security gates: gitleaks 8.24.0 in CI (ADOPTED/BLOCKING_GATE), lefthook and trivy PENDING
node -e "const fs = require('fs'); const wf = fs.readFileSync('.github/workflows/security-baseline.yml', 'utf8'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const g = m.adopted.find(x => x.id === 'gitleaks'); const pin = g.pinned_version_or_commit; const l = m.adopted.find(x => x.id === 'lefthook'); const t = m.adopted.find(x => x.id === 'trivy'); const valid = g.lifecycle_state === 'ADOPTED' && g.blocking_policy === 'BLOCKING_GATE' && wf.includes('GITLEAKS_VERSION=\x22' + pin + '\x22') && l.lifecycle_state === 'PENDING' && t.lifecycle_state === 'PENDING'; console.log('Baseline gates verified: gitleaks ' + pin + ' (ADOPTED/BLOCKING_GATE in CI), lefthook ' + l.lifecycle_state + ', trivy ' + t.lifecycle_state + ' -> ' + valid); if (!valid) process.exit(1);"
# Expected: Exit code 0, "Baseline gates verified: gitleaks 8.24.0 (ADOPTED/BLOCKING_GATE in CI), lefthook PENDING, trivy PENDING -> true"

# B. Negative proof: decoyed or missing workflow on CI-provisioned gate fails closed
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const os = require('os'); const fs = require('fs'); const path = require('path'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-decoy-')); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(d, '.github', 'workflows', 'decoy.yml'), 'steps:\n  - run: echo no-gitleaks\n'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const res = auditManifest(m, { rootDir: d }); const f = res.findings.find(x => x.id === 'gitleaks'); fs.rmSync(d, { recursive: true, force: true }); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"
# Expected: Exit code 1, "QUALITY_GATE_MISSING: gitleaks"

# C. token-tracker retirement premise: pinned npm artifact inspection plus native adapter coverage (AI-40-R08)
node -e "const cp = require('child_process'); const meta = JSON.parse(cp.execSync('npm view token-tracker@1.0.1 --json', { encoding: 'utf8' })); const mismatch = !meta.repository.url.includes('xiufengsun/TokenTracker'); const blockchain = meta.description.indexOf('token balances over block') >= 0; const out = cp.execSync('node --test tools/ai-dashboard/test/usage-adapter.test.js', { encoding: 'utf8' }); const api = Object.keys(require('./tools/ai-dashboard/usage-adapter.js')); const covered = api.includes('collectUsageState') && api.includes('collectClaudeUsage') && api.includes('collectRouterUsage'); const ok = mismatch && blockchain && covered && out.indexOf('pass 19') >= 0 && out.indexOf('fail 0') >= 0; console.log('token-tracker retirement evidence: pinned npm artifact token-tracker@1.0.1 resolves to ' + meta.repository.url + ' (not xiufengsun/TokenTracker) described as ' + meta.description + ' blockchain-not-ai=' + blockchain + '; native tools/ai-dashboard/usage-adapter.js exports collectUsageState+collectClaudeUsage+collectRouterUsage=' + covered + ' with pass 19 fail 0 -> ' + ok); if (!ok) process.exit(1);"
# Expected: Exit code 0, "token-tracker retirement evidence: pinned npm artifact token-tracker@1.0.1 resolves to git+ssh://git@github.com/BunsDev/token-tracker.git (not xiufengsun/TokenTracker) described as A module for tracking token balances over block changes. blockchain-not-ai=true; native tools/ai-dashboard/usage-adapter.js exports collectUsageState+collectClaudeUsage+collectRouterUsage=true with pass 19 fail 0 -> true"

# D. sylph retirement premise: pinned upstream tree inspection plus native writer-claim coverage (AI-40-R08)
node -e "const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const SHA = 'd31a9c05f19de0f14e255d9301bbdb0f872354b3'; const tags = cp.execSync('git ls-remote --tags https://github.com/getnao/sylph', { encoding: 'utf8' }).trim(); const pinResolvable = tags.length > 0; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-evidence-')); cp.execSync('git clone --quiet --filter=blob:none https://github.com/getnao/sylph \"' + d + '\"'); cp.execSync('git -C \"' + d + '\" checkout --quiet ' + SHA); const files = cp.execSync('git -C \"' + d + '\" ls-files', { encoding: 'utf8' }).trim().split('\n'); const md = files.filter(f => f.endsWith('.md')).length; const js = files.filter(f => f.endsWith('.js')).length; const pkg = files.filter(f => path.basename(f) === 'package.json').length; fs.rmSync(d, { recursive: true, force: true }); const guard = cp.execSync('node --test tools/ai-guard/test/writer-claim.test.js', { encoding: 'utf8' }); const ok = !pinResolvable && pkg === 0 && js === 1 && md === 112 && files.length === 210 && guard.indexOf('pass 33') >= 0 && guard.indexOf('fail 0') >= 0; console.log('sylph retirement evidence: pinned tag 0.1.0 resolvable=' + pinResolvable + '; upstream ' + SHA + ' contains 210 files = 112 markdown, 1 javascript, 0 package.json, 0 runtime entrypoint; native tools/ai-guard writer-claim pass 33 fail 0 -> ' + ok); if (!ok) process.exit(1);"
# Expected: Exit code 0, "sylph retirement evidence: pinned tag 0.1.0 resolvable=false; upstream d31a9c05f19de0f14e255d9301bbdb0f872354b3 contains 210 files = 112 markdown, 1 javascript, 0 package.json, 0 runtime entrypoint; native tools/ai-guard writer-claim pass 33 fail 0 -> true"

# E. Manifest cleanup target inventory across all five files, including the governed catalog document
node -e "const fs = require('fs'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const p = JSON.parse(fs.readFileSync('tools/ecosystem-profiles.json', 'utf8')); const ma = fs.readFileSync('tools/ai-brain/manifest-audit.js', 'utf8'); const eco = fs.readFileSync('scripts/ai/ecosystem.ps1', 'utf8'); const dec = fs.readFileSync('docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md', 'utf8'); const hasM = m.adopted.some(x => x.id === 'token-tracker') && m.adopted.some(x => x.id === 'sylph'); const hasP = p.profiles.FOUNDATION.allowed_tools.includes('token-tracker') && p.profiles.NIGHTLY_MAINTENANCE.allowed_tools.includes('token-tracker') && p.profiles.SECURITY_REVIEW.allowed_tools.includes('sylph'); const hasMa = ma.includes('token-tracker'); const hasEco = eco.includes('getnao/sylph'); const hasDec = dec.includes('Governed Ecosystem Catalog (37 Adopted Repositories)') && dec.includes('**37 adopted repositories**') && dec.includes('getnao/sylph') && dec.includes('xiufengsun/TokenTracker'); const manifestCount = m.adopted.length; const ok = hasM && hasP && hasMa && hasEco && hasDec && manifestCount === 37; console.log('Retirement inventory verified in tools/ecosystem-manifest.json, tools/ecosystem-profiles.json, tools/ai-brain/manifest-audit.js, scripts/ai/ecosystem.ps1, docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md: manifest adopted=' + manifestCount + ', catalog declares 37 with both listings present -> ' + ok); if (!ok) process.exit(1);"
# Expected: Exit code 0, "Retirement inventory verified in tools/ecosystem-manifest.json, tools/ecosystem-profiles.json, tools/ai-brain/manifest-audit.js, scripts/ai/ecosystem.ps1, docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md: manifest adopted=37, catalog declares 37 with both listings present -> true"
# Post-retirement expectation: the same command exits 1, the catalog heading reads
# "## Governed Ecosystem Catalog (35 Adopted Repositories)" and tools/ecosystem-manifest.json holds exactly 35 adopted entries
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `51a1539` | `CHANGES_REQUIRED` | [Issue comment](https://github.com/vinh05092001/shipde-platform/pull/27#issuecomment-5667870155) and [PR review comment](https://github.com/vinh05092001/shipde-platform/pull/27#discussion_r4006992728): (1) Replaced intent-only acceptance descriptions with 4-part executable contracts naming exact commands, expected exit codes, required output strings, and output sources. (2) Added expected exit codes and output assertions to all verification commands. (3) Eliminated all angle-bracket placeholders from review record and specification. (4) Added exact manifest and workflow assertions proving CI-provisioned gitleaks 8.24.0 ground truth. (5) Added deterministic test and audit commands proving token-tracker and sylph retirement invariants. (6) Expanded abbreviated paths in cleanup inventory to full repository paths. |
| 2 | `9569768` | `CHANGES_REQUIRED` | Round-2 Codex review of commit `9569768` returned five findings on this file: [r4006992699](https://github.com/vinh05092001/shipde-platform/pull/27#discussion_r4006992699) keep specification preparation in the Codex planning stage; [r4006992711](https://github.com/vinh05092001/shipde-platform/pull/27#discussion_r4006992711) prohibit retirement solely to silence audit failures; [r4006992718](https://github.com/vinh05092001/shipde-platform/pull/27#discussion_r4006992718) require independent evidence for each retirement; [r4006992722](https://github.com/vinh05092001/shipde-platform/pull/27#discussion_r4006992722) include the governed catalog document in cleanup acceptance; [r4006992728](https://github.com/vinh05092001/shipde-platform/pull/27#discussion_r4006992728) resolve the placeholders that fail `AC-AI-40-06`. All five are resolved in round 3. |
| 3 | `4ee61e0` | Awaiting independent Codex review | Resolutions: (1) Control `Assigned author` records `CODEX` for specification preparation and `GEMINI` for the later manifest-retirement implementation; the durable register row 173 stays `BLOCKED_DEPENDENCY` and the Control status is not advanced ahead of it, and this PR is prohibited from declaring `READY_FOR_CODEX` or `READY_FOR_AUTHOR`. (2) New rule `AI-40-R08` forbids retiring any entry to silence an audit failure, warning, note, or host absence, and narrows the `AI-40-R02` precedence and the `AI-40-R07` zero-error gate accordingly. (3) `AC-AI-40-03` and `AC-AI-40-04` now derive their premises from pinned upstream artifacts - npm registry metadata for `token-tracker@1.0.1` and the `getnao/sylph` tree at commit `d31a9c05f19de0f14e255d9301bbdb0f872354b3` - combined with the real native deliverables' exports and test runs, instead of citing this specification. (4) `AC-AI-40-05` adds `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` with its 37-to-35 count and both catalog listings to the cleanup set. (5) Every cell in this review record holds a literal recorded value; the specification contains zero angle-bracket placeholders, proven by the dedicated `AC-AI-40-08` scanner rather than by the documentation validator. |

## Residual limitations

The delivery register row 173 (`FEATURE-DELIVERY-REGISTER.csv`) records `TASK-AI-40`
as `BLOCKED_DEPENDENCY` on `TASK-AI-17`. While PR #19 (`fix/task-ai-17-manifest-truth`)
has been merged into `fix/task-ai-16-codex-launch-flags` (commit `1f587dd`), register
row 150 remains `READY_FOR_CODEX` pending automated register write-back under
`TASK-AI-19`. The Work Item Control table is strictly aligned to the register
(`BLOCKED_DEPENDENCY`) in compliance with governance precedence rules.

Retiring `token-tracker` and `sylph` removes misleading or redundant entries from
the catalog but does not alter developer workflow, since neither tool was ever
installed on the host or integrated into CI. Local quota visibility continues to
be provided by `tools/ai-dashboard` (verified by 19 unit tests in
`tools/ai-dashboard/test/usage-adapter.test.js`), and workspace isolation continues to be
enforced by `tools/ai-guard` (verified by 33 unit tests in
`tools/ai-guard/test/writer-claim.test.js`). Pinned `codex-cli` version drift
(`0.154.0` observed vs pinned `0.151.0`) remains documented pending a formal
human upgrade decision per `AI-TOOLCHAIN-DECISIONS.md`.
