# TASK-AI-33 — Beads shadow mode for the dependency graph

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-33` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `166` |
| Dependencies | `TASK-AI-19` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-33.md`, `tools/ai-brain/acceptance/ac-33-*.js`, `tools/ai-brain/acceptance/lib/dependency-graph.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-33` |
| Pull Request | `Pending` |

## Business outcome

`FEATURE-DELIVERY-REGISTER.csv` is the single source of truth for what Ship Dễ
believes about its dependency graph: which Work Item waits on which, and what
that implies for readiness. The register's `dependencies` column is prose-bearing
free text — rows carry values as different as `TASK-AI-06` and
`TASK-FOUND-04; see BACKLOG-DEPENDENCIES.md` — and the only parser that decides
what such a cell means is `parseDependencies` in `tools/ai-brain/reconcile.js`.

`Beads` (`gastownhall/beads`, adopted for multi-agent coordination) can hold a
dependency graph of its own. Running it in **shadow mode** means projecting the
register's graph into a shadow store and comparing the two, so drift between what
the register says and what a coordination tool believes is visible before it
causes a wrong dispatch — **without the shadow ever owning state**.

The authority is not shared. The register remains the thing that decides; the
shadow is a read-only projection that may disagree and must say so. Concretely:

1. A deterministic projector turns the register's rows into a graph of nodes and
   dependency edges, using the reconciler's own edge rule rather than a second
   parser, and writes it to a local JSON shadow store.
2. A comparator reports every edge the shadow is missing and every edge it has
   invented, naming each one. A divergence is a finding to act on — fix the
   shadow, or investigate the register — never a reason to edit the register to
   match the shadow.
3. The projector and comparator never write the register. A comparison is proved
   to have left the register's bytes identical, and a shadow that could rewrite
   the authority to match itself would not be a shadow.

The outcome is falsifiable from the repository alone: the register's SHA-256
before and after a shadow pass, and the exact edge names a tampered shadow
produces.

## Source references

- `AGENTS.md` § Source of truth — Specification precedence over code; the register
  must never claim what repository evidence cannot prove.
- `AGENTS.md` § Role separation — One authority per question; a shadow observes,
  it does not decide.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § Profile
  activation contract — the `Multi-agent coordination` row names `Beads plus
  governed mailbox capability` as the governed capability set.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Governed
  Ecosystem Catalog — `gastownhall/beads` is an adopted Knowledge & Specification
  repository; the machine-readable entry is in `tools/ecosystem-manifest.json`.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — the
  authoritative graph; row `166` registers `TASK-AI-33` and its dependency.
- `docs/product-spec/work-items/TASK-AI-19.md` — the reconciler: it consumes the
  register's dependencies with `parseDependencies` and reports
  `BLOCK_NO_LONGER_TRUE` from the same edges this Work Item projects.
- `tools/ai-brain/reconcile.js` § `parseDependencies` — the one rule that decides
  which tokens in a `dependencies` cell are Work Item IDs and which are prose.
- `tools/ai-dashboard/register-adapter.js` § `parseRegisterCsv` — the canonical
  RFC 4180 register reader every script here re-uses instead of re-implementing.
- `tools/ai-brain/acceptance/lib/dependency-graph.js` — the single definition of
  the projection and comparison this Work Item's rows exercise.

## Preconditions and dependencies

- `TASK-AI-19` (Deterministic register reconciler with write-back) is merged. Its
  Work Item specification merged to `main` as Pull Request #23 at
  `8d49b1a8d9b851afa7b4290329452687c1f0b3b6`, and the reconciler and its audited
  runs landed on `main` through the follow-on increments, the latest being
  `ab54b3f6b128517c537eaa0402dfb2de88bb353c` (Pull Request #61). Both commits are
  reachable from `origin/main`.
- Authoritative delivery register status: row `166` records `TASK-AI-33` as
  `BLOCKED_DEPENDENCY` on `TASK-AI-19`. The Control table above records
  `BLOCKED_DEPENDENCY` and no other value. The row becomes eligible for
  `READY_FOR_AUTHOR` only through the reconciler's write-back path
  (`tools/ai-brain/reconcile.js`, `AI-19-R03`) once its dependency is `MERGED`
  and evidenced; it is never advanced by hand.
- `tools/ai-brain/reconcile.js` exports `parseDependencies`, so the shadow's edge
  rule can be the reconciler's rather than a copy of it.
- `node tools/ai-brain/cli.js reconcile` reports `Tổng: 0 lỗi` against the real
  register, so the graph being projected is the register the reconciler agrees
  with.
- A local Node.js v24 runtime. `Beads` itself is not required to run the shadow
  store this Work Item defines: the store is a deterministic local projection,
  and no network access or credential is involved (`AI-TOOL-04`, `AI-TOOL-05`).

## Author boundary

`GEMINI` is the assigned author. This Work Item authors the specification and the
acceptance harness that prove it, bounded to the three allowed paths above. It
writes documents and scripts; it does not change application code.

Implementation of the projector, comparator and CLI is a subsequent task by
`GEMINI` within these additional paths:

- `tools/ai-brain/shadow.js`
- `tools/ai-brain/cli.js` (the `shadow` sub-command)
- `tools/ai-brain/test/shadow.test.js`
- `docs/product-spec/docs/10-ai-collaboration/audit/` (shadow pass records, if the
  implementation writes any)
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` (the
  decision entry recording that Beads runs in shadow mode)

Prohibited in this Work Item:

- Writing the delivery register, in whole or in part, from the shadow. A
  divergence is never resolved by editing the register to agree with the shadow.
- Advancing, clearing or setting any row's status, or promoting a row toward
  readiness. That belongs to the reconciler and to planning.
- Installing, enabling or making `Beads` a required runtime dependency, or
  reaching the network from a shadow pass.
- Parsing `dependencies` a second time. A private edge rule is exactly the defect
  this Work Item is written to avoid.
- Weakening, skipping or narrowing the reconciler's rules, or editing
  `docs/product-spec/scripts/`.
- Author self-approval.

## In scope

- Author the deterministic projector and comparator `tools/ai-brain/shadow.js`
  and the `node tools/ai-brain/cli.js shadow` command that projects the register's
  dependency graph into a local shadow store and compares the two.
- Support `--register <path>`, `--shadow <path>`, `--project`, `--compare`,
  `--json` and `--dry-run`. Unknown or misspelled options are rejected with exit
  code 1 rather than silently ignored, so no comparison can run against a
  different register than the one it names.
- Derive every node and edge from the register rows with the reconciler's
  `parseDependencies`; never carry a second edge rule.
- Make the projection deterministic: nodes and edges sorted and de-duplicated, no
  timestamp or host value in the store, so a fixed register produces byte-stable
  output and a second projection is a no-op.
- Report divergences as two named sets — `MISSING_IN_SHADOW` and
  `EXTRA_IN_SHADOW` — each entry naming the `from` and `to` Work Item IDs.
- Guarantee, and prove by SHA-256, that a projection or comparison leaves the
  register's bytes identical: the shadow owns no state.
- Fail closed when the register or a shadow store cannot be read, rather than
  treating an unreadable source as an empty graph that agrees.
- Author acceptance rows that exercise the projection and comparison against the
  real register, and the negative proofs that a tampered shadow is rejected by
  the same rule and that all scripts exit 2 outside the repository.

## Out of scope

- Authoring the register or its `dependencies` column; authoring the missing Work
  Item specifications (`TASK-AI-20`); reconciling the register (`TASK-AI-19`).
- Making `Beads` authoritative for anything, or adding a second writer to the
  delivery lifecycle.
- Multi-agent mailbox or coordination beyond the read-only graph projection.
- Any network call, credential, or GitHub query.
- Changing `tools/ai-brain/reconcile.js`'s rules or the register's column schema.
- Editing `docs/product-spec/scripts/validate_docs.py` or any other validator.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-33-R01` | **Register authority**: the delivery register is the sole source of truth for the dependency graph. A shadow projection or comparison must leave the register's bytes identical, proved by SHA-256 before and after the run. A shadow that could write the register is not a shadow. |
| `AI-33-R02` | **One edge rule**: shadow edges are parsed by the reconciler's own `parseDependencies` (`tools/ai-brain/reconcile.js`), re-exported by reference. No second parser for the `dependencies` cell exists in this Work Item. |
| `AI-33-R03` | **Divergence is reported, never reconciled**: an edge the shadow is missing or has invented is a finding naming the `from` and `to` IDs. The response is to fix the shadow or investigate the register; editing the register to match the shadow is prohibited. |
| `AI-33-R04` | **Deterministic projection**: nodes and edges are sorted and de-duplicated, and no timestamp, path or random value enters the store, so a fixed register produces byte-stable output and a repeated projection is a zero-diff no-op. |
| `AI-33-R05` | **Fail-closed on an unreadable source**: a missing or unparseable register or shadow store is an operational failure (exit 2 in the acceptance scripts), never an empty graph that reads as agreement. |
| `AI-33-R06` | **Local and offline**: the shadow store is a local JSON projection. A shadow pass performs no network call and requires no credential, consistent with `AI-TOOL-04` and `AI-TOOL-05`. |
| `AI-33-R07` | **No lifecycle authority**: the shadow never changes a row's status, verdict, branch or merge commit, and never promotes a row toward readiness. Clearing a stale block and recording a merge remain the reconciler's (`AI-19-R03`, `AI-19-R04`). |
| `AI-33-R08` | **No vacuous verification**: every acceptance row reads real files and asserts observable state. No row compares two string literals written into its own command, no row asserts through `node --test --test-name-pattern` (which exits `0` when the pattern matches nothing), and no count that drifts with the repository is pinned. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing CLI
states for `node tools/ai-brain/cli.js shadow`:

- **Projected** (`--project`): writes the shadow store, prints
  `Projected <n> nodes, <m> edges to <path>`, and leaves the register untouched;
  exits 0.
- **Compared, in agreement** (`--compare`): prints `Shadow agrees with the
  register: <n> nodes, <m> edges, 0 divergences`; exits 0.
- **Compared, divergent** (`--compare`): prints each `MISSING_IN_SHADOW` and
  `EXTRA_IN_SHADOW` edge with its `from` and `to` IDs; exits 1.
- **Refusal**: an unknown option, an unreadable register, or an unreadable shadow
  store prints the reason to stderr and exits 1 with the register untouched.

## API, event and data impact

No database schema, migration or runtime API change. The Work Item adds a Brain
CLI sub-command (`shadow`) and a local shadow-store file format:

```json
{
  "nodes": ["TASK-AI-01"],
  "edges": [{ "from": "TASK-AI-20", "to": "TASK-AI-19" }]
}
```

`nodes` and `edges` are sorted and de-duplicated. The delivery register's column
schema is unchanged, and the shadow store is derived data that may be deleted and
regenerated at any time.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-33-01` | Register graph and shadow agree, and the comparison leaves the register byte-identical | `node tools/ai-brain/acceptance/ac-33-01-shadow-parity.js` exits 0 and prints the string `SHADOW_PARITY: 0 divergences, register unchanged`. The rule is not written into this row: the script requires `tools/ai-brain/acceptance/lib/dependency-graph.js`, the same module `AC-AI-33-02` and `AC-AI-33-03` require, and it exits 2 outside the repository | command stdout |
| `AC-AI-33-02` | **Negative proof, must fail:** a tampered shadow that dropped a real register edge is rejected, after a CONTROL proving the untouched shadow agrees; the register's bytes stay identical | `node tools/ai-brain/acceptance/ac-33-02-shadow-divergence.js` exits 1 and prints the string `SHADOW_DIVERGENCE_DETECTED: MISSING_IN_SHADOW`. It reads the real register, tampers only a shadow copy in `os.tmpdir()`, and exits 2 outside the repository | command stderr; `tools/ai-brain/acceptance/ac-33-02-shadow-divergence.js`, `tools/ai-brain/acceptance/lib/dependency-graph.js` |
| `AC-AI-33-03` | The shadow's edge rule is the reconciler's, not a second copy | `node tools/ai-brain/acceptance/ac-33-03-rule-single-source.js` exits 0 and prints the string `RULE_SINGLE_SOURCE: shadow edges parsed by tools/ai-brain/reconcile.js`, after CONTROLing that the shared parser keeps an ID and discards the prose beside it in a real register cell | command stdout; `tools/ai-brain/acceptance/ac-33-03-rule-single-source.js`, `tools/ai-brain/reconcile.js` |
| `AC-AI-33-04` | **Negative proof:** the three scripts above fail operationally (exit 2), not as findings, when run where no register exists | `node tools/ai-brain/acceptance/ac-33-04-outside-repository.js` exits 0 and prints the string `OUTSIDE_REPOSITORY_PROBE: 3 subjects exited 2 with no register present` | command stdout; `tools/ai-brain/acceptance/ac-33-04-outside-repository.js` |
| `AC-AI-33-05` | The register the shadow is projected from is the register the reconciler agrees with | `node tools/ai-brain/cli.js reconcile` exits 0 and prints the string `Tổng: 0 lỗi` (the warning and note counts are deliberately not pinned) | command stdout; `tools/ai-brain/cli.js` |

### Acceptance matrix: why each negative proof is not vacuous

Every command in the table was extracted from the markdown and executed verbatim
against `origin/main` at `ab54b3f`. All five rows produced the exit code and the
string stated above.

| Script | In the repository | From an empty directory, no repository | The CONTROL it performs |
|---|---|---|---|
| `ac-33-01-shadow-parity.js` | exit `0`, `SHADOW_PARITY: 0 divergences, register unchanged` | exit `2`, `SOURCE_MISSING` | drops one edge from a shadow copy and requires the comparator to report exactly that edge as `MISSING_IN_SHADOW`, so "0 divergences" cannot come from a comparator that never reports |
| `ac-33-02-shadow-divergence.js` | exit `1`, `SHADOW_DIVERGENCE_DETECTED: MISSING_IN_SHADOW` | exit `2`, `SOURCE_MISSING` | proves the untouched shadow agrees with the register before the tampered copy is rejected, and re-checks the register's SHA-256 afterwards |
| `ac-33-03-rule-single-source.js` | exit `0`, `RULE_SINGLE_SOURCE:` | exit `2`, `SOURCE_MISSING` | proves the shared parser keeps the Work Item ID and discards the prose in a real `dependencies` cell, so a parser returning nothing could not carry the row |
| `ac-33-04-outside-repository.js` | exit `0`, `OUTSIDE_REPOSITORY_PROBE:` | exit `2`, `SOURCE_MISSING` | spawns each subject with a fresh empty working directory and fails if any subject exits without `SOURCE_MISSING` |

A command that still printed its expected string and exited as expected from an
empty directory would prove nothing; none of these does. `AC-AI-33-05` reads the
real register through the real reconciler, so it too cannot pass where no
register exists. No row asserts through `node --test --test-name-pattern`, and no
row pins a count that drifts with the repository — the measured graph
(`178` nodes, `174` edges at `ab54b3f`) is printed as evidence and never asserted.

### One rule, one module

`AC-AI-33-01` (the invariant), `AC-AI-33-02` (its negative proof) and
`AC-AI-33-03` (the coupling row) exercise the same rule — "the register's
dependency graph is projected and compared by the reconciler's edge rule, and the
register is never written". The rule is defined once, in
`tools/ai-brain/acceptance/lib/dependency-graph.js`, and all three scripts require
it, so editing the rule there changes the gate and the proof of the gate together.
The module re-exports `parseDependencies` from `tools/ai-brain/reconcile.js` by
reference as `parseEdges` — a fact `AC-AI-33-03` asserts directly — and it
re-exports `parseRegisterCsv` from `tools/ai-dashboard/register-adapter.js`
instead of carrying a second CSV parser.

## Verification commands

```bash
# 1. The invariants, as the acceptance matrix runs them
node tools/ai-brain/acceptance/ac-33-01-shadow-parity.js      # exit 0
node tools/ai-brain/acceptance/ac-33-02-shadow-divergence.js  # exit 1 (negative proof)
node tools/ai-brain/acceptance/ac-33-03-rule-single-source.js # exit 0
node tools/ai-brain/acceptance/ac-33-04-outside-repository.js # exit 0

# 2. The register the shadow projects is the register the reconciler agrees with
node tools/ai-brain/cli.js reconcile
# Expected exit code: 0, Tổng: 0 lỗi

# 3. Documentation and formatting gates
python docs/product-spec/scripts/validate_docs.py
node tools/ai-guard/cli.js secret-surface
pnpm format:check

# 4. The projector's own tests, added during implementation
node --test tools/ai-brain/test/shadow.test.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `PENDING` | Initial specification authoring for TASK-AI-33. |

## Residual limitations

- **`Beads` itself is not exercised.** This Work Item defines and proves the
  shadow *store* and its comparison against the register; it does not run the
  upstream `gastownhall/beads` tool, which is not installed and is not a runtime
  dependency. A green parity row therefore means "a projection of the register
  agrees with the register", never "Beads agrees with the register". Wiring an
  actual Beads instance remains a later, separately reviewed step.

- **The shadow cannot detect a graph the register itself gets wrong.** The
  comparison is only as good as the register's `dependencies` column. If a row
  omits a dependency it truly has, the shadow inherits the omission and reports
  agreement; detecting that requires reconciling the dependency claim against
  repository evidence, which is `TASK-AI-19`'s territory, not this Work Item's.

- **Stale-block resolution stays with the reconciler.** Clearing a
  `BLOCKED_DEPENDENCY` row to `BACKLOG` is `AI-19-R03`, driven by the register's
  own rows. The shadow reports edges; it never changes a status.

- **The measured graph is recorded, not pinned.** `178` nodes and `174` edges
  were measured at `ab54b3f`; both grow with every merged Work Item, so the
  acceptance rows print them as evidence and assert neither.
