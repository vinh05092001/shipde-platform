# TASK-AI-29 — Account and quota entry form on the cockpit

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-29` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `162` |
| Dependencies | `TASK-AI-26` (merged into `origin/main`; register row 159 not yet reconciled to `MERGED`) |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-29.md`, `tools/ai-brain/accounts.js`, `tools/ai-brain/limits.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/account-entry.js`, `tools/ai-brain/test/accounts.test.js`, `tools/ai-brain/test/account-entry.test.js`, `tools/ai-brain/acceptance/ac-29-*.js`, `tools/ai-brain/acceptance/lib/account-entry.js`, `tools/ai-dashboard/index.html`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-29` |
| Pull Request | `pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 162) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 162, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality but not yet recorded: `TASK-AI-26` is merged into `origin/main` at `3ccf49b7fed6127a54676fef23980e50f4d6bca1` (PR #41), while register row 159 still reads `BACKLOG`. `AC-AI-29-03` proves the merge from the repository rather than from the register, because the register status is stale rather than true.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler (`TASK-AI-19`) before this item is stage-eligible for review routing.
- `AC-AI-29-01` mechanically compares the `Status` cell of the Control table above against row 162 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

Registering an account means editing a file by hand. `tools/ai-brain/accounts.js` already has everything the operation needs — `addAccount` validates and appends, `setSecret` encrypts the credential under a key kept apart from the ciphertext, `listAccounts` reduces the credential to a presence flag — but the only surface an operator has is `~/.shipde/accounts.registry.json`, a plain readable JSON file, and the `seed-accounts.js` script that writes it from a repository constant.

Three consequences were measured in the source rather than assumed:

1. **A hand edit is unvalidated until it is read.** `validateAccount` runs on the way in through `addAccount` and `updateAccount`. A direct edit of the file bypasses both, so an account with no `provider`, a `codingGrade` outside the ladder, or — worse — a credential pasted into the registry is accepted by the file and only surfaces later, when something reads it.
2. **A quota declared by hand has no provenance.** `tools/ai-brain/limits.js` (TASK-AI-26) refuses a declared ceiling with no recognised provenance, naming the account and the window, and keeps a window with no ceiling visible as `unknownBudget`. Nothing about the file makes an operator declare the second field, so the honest state is unreachable through the surface that exists.
3. **There is no write path that is not a file edit.** The cockpit's HTTP service is observational by an explicit rule — `tools/ai-dashboard/server.js` refuses every method but `GET`, `HEAD` and `OPTIONS` with `405` and the text `AI15-R09` — so the account that was supposed to be entered "on the cockpit" has no way to be entered there at all.

This Work Item replaces the file edit with a validated, audited entry path: a local command that composes the registry entry through the shipped module, refuses what the module refuses, requires every ceiling to name its provenance, stores the credential only through the encrypted store, and prints back exactly what it wrote and what is still unknown. The cockpit renders the form for it and stays read-only.

## Source references

- `tools/ai-brain/accounts.js` — `validateAccount`, `addAccount`, `updateAccount`, `setSecret`, `getSecret`, `listAccounts`, `loadKey`, `Tier`, `REGISTRY_FILE`, `SECRETS_FILE`, `KEY_FILE`
- `tools/ai-brain/limits.js` — `PROVENANCE`, `resolveLimits`, and the `rejected` list that names the account and the window a bad declaration came from
- `tools/ai-brain/cli.js` — the sub-command surface this entry path joins, and the `reconcile` sub-command's refusal of an unrecognised option rather than a silent default
- `tools/ai-dashboard/server.js` — the fixed allowlist, the loopback binding and the `405` that keeps the cockpit observational
- `docs/product-spec/work-items/TASK-AI-15.md` § `AI15-R09` — "No hidden mutation: Dashboard endpoints and controls are observational. Any future operational action requires a separate approved Work Item, authorization model, audit trail, and confirmation design."
- `docs/product-spec/work-items/TASK-AI-26.md` § `AI-26-R01`, `AI-26-R02` — a ceiling without provenance is refused naming the account and the window, and a window with no ceiling stays unknown rather than being filled with a default
- `docs/product-spec/work-items/TASK-AI-18.md` § `AI-18-R04`, `AI-18-R05` — a Ship Dễ credential comes from the encrypted store, and the key never sits beside the ciphertext
- `docs/product-spec/work-items/TASK-AI-30.md` — the qualification probe that will run against an account this Work Item registers
- `AI-TOOL-10` — a failed or partial operation reports exact state and must not be recorded as healthy

## Preconditions and dependencies

- Prerequisite `TASK-AI-26` (Declare quota limits for every registered account) is merged into `origin/main` at `3ccf49b7fed6127a54676fef23980e50f4d6bca1` (PR #41), and `tools/ai-brain/limits.js` is on `main` with it. `AC-AI-29-03` proves this from Git rather than from the register.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 162 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly. The block is stale rather than true: the dependency is merged in Git, and clearing the row is the reconciler's write-back (`TASK-AI-19`), never a hand edit.
- The encrypted store works today: `setSecret` encrypts under `loadKey`, which takes `SHIPDE_ACCOUNT_KEY` when it is at least 32 characters and otherwise keeps a key file separate from the ciphertext. `getSecret` round-trips, and a decrypt that fails under the current key is retried once under the untrimmed one.
- `accounts.validateAccount` is the shipped validator and names every failing field rather than the first, so one round trip is enough to fix an entry.
- `limits.resolveLimits` is the shipped limit rule: it refuses a declared entry whose `provenance` is absent or unrecognised, naming the account and the window, and leaves a window with no ceiling at `unknownBudget: true`.
- The cockpit's read-only enforcement is already covered by its own suite, `tools/ai-dashboard/test/dashboard.test.js`, whose subtest `rejects unsafe mutation methods with 405 Method Not Allowed (AI15-R05, AI15-R09)` the matrix below re-uses rather than restates.

## Author boundary

`CLAUDE` is the assigned author for this Work Item. Scope is strictly bounded to a validated, audited entry path for accounts, their model limits and their credential, within `tools/ai-brain/`, the cockpit page, and this specification.

Prohibited in this Work Item:

- Do NOT add a mutating method, route or endpoint to `tools/ai-dashboard/server.js`. `AI15-R09` binds it, and `AC-AI-29-10` asserts it still holds. The form composes a command; the dashboard stays observational.
- Do NOT write `~/.shipde/accounts.registry.json` or `accounts.secrets.enc` from any code path other than `accounts.js`. A second writer of the same file is a second answer to what is registered.
- Do NOT store a credential in the registry, in a log, in a printed record, or in an audit artifact. Only `setSecret` writes one, only into the encrypted store, and nothing ever prints its value.
- Do NOT write a limit as a bare number. A ceiling carries `value`, `provenance` and `assertedAt`.
- Do NOT fill an undeclared window with a default, a zero, or a median of another account. A window with no ceiling is reported unknown (`AI-26-R02`).
- Do NOT weaken, bypass or bypass-by-reimplementation `validateAccount` or `resolveLimits`. The entry path refuses what they refuse.
- Do NOT change any status or lifecycle state, in the register or anywhere else, and do NOT write under `docs/product-spec/`.
- Do NOT touch `.github/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Do NOT auto-test or qualify a new model here; that is `TASK-AI-30`.

## In scope

1. **A local entry command**:
   - `node tools/ai-brain/cli.js account add` creates a registry entry through `accounts.addAccount`; `node tools/ai-brain/cli.js account limits` sets ceilings on an existing entry through `accounts.updateAccount`; `node tools/ai-brain/cli.js account secret` stores a credential through `accounts.setSecret`, reading it from a prompt or a file descriptor rather than an argument, so it never lands in shell history or a process listing.
   - The command refuses any option it does not understand, following the `reconcile` sub-command, so a mistyped flag cannot write a different account than the one named.
   - Every write prints back what it wrote: the account id, the windows now known and the windows still unknown, the provenance of each ceiling, and whether a credential is present.
2. **Validation at the boundary**:
   - An entry is written only when `accounts.validateAccount` accepts it. When it does not, every failing field is reported and nothing is written.
3. **Limits with provenance**:
   - A ceiling is written as `{ value, provenance, assertedAt }` with provenance `operator-declared` for a figure the operator asserts. The entry path must also be able to add a `vendor-documented` figure the operator is transcribing, and must never claim `observed` for something it did not measure.
   - A window the operator leaves undeclared is written as no entry at all, so `resolveLimits` reports it unknown.
4. **The credential never enters the registry**:
   - The credential reaches `accounts.setSecret` and nothing else. The registry entry written by the command is asserted to carry no readable copy of it, and a credential field inside a registry entry is refused by `validateAccount` before anything is written.
5. **The cockpit form**:
   - The cockpit page gains a form that collects the same fields and renders the exact command to run, because the page may not submit it (`AI15-R09`). The form states which fields will be written and which windows will stay unknown before the command is run.
6. **A refusal path that is not a partial write**:
   - When any part of an entry is refused — a bad field, an unrecognised option, a limit without provenance — nothing is written at all. A registry entry created and a credential not stored is a half-registered account that reads as usable, so the command either completes or writes nothing.
7. **Deterministic tests**:
   - `tools/ai-brain/test/account-entry.test.js` covers each rule below against injected paths under `os.tmpdir()`, with no real registry, no real home directory and no credential.

## Out of scope

- The qualification probe and the qualification record a new model needs (`TASK-AI-30`).
- Declaring a ceiling from vendor documentation or from observation (`TASK-AI-26` owns the declaration and the provenance arithmetic; this Work Item only supplies an operator's entry).
- Removing an account, rotating a credential, or recording an operator's identity beyond the session the command already sees.
- A mutating HTTP surface on the cockpit, an authorization model for one, or CSRF and origin handling for one. `AI15-R09` makes that a separate Work Item with its own confirmation design; see § Residual limitations.
- Registering an account for a provider that does not exist, or adding a new provider.
- Changing the delivery register schema or any lifecycle state.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-29-R01` | **The cockpit stays observational.** `tools/ai-dashboard/server.js` refuses every method but `GET`, `HEAD` and `OPTIONS` with `405`, and this Work Item does not change it. The entry form is rendered by the cockpit and executed by a local command, because `AI15-R09` forbids the observational service from mutating anything. |
| `AI-29-R02` | **One writer for the registry.** Every write goes through `accounts.addAccount`, `updateAccount` or `setSecret`. No hand edit, and no code path that serialises the registry itself. A second writer of one file is a second answer to what is registered, and only one of the two validates. |
| `AI-29-R03` | **The validator is the gate, and it names every failing field.** An entry is written only when `accounts.validateAccount` accepts it, and a refusal lists every failing field rather than the first, so one round trip fixes the entry instead of revealing one problem at a time. |
| `AI-29-R04` | **A credential never enters the registry.** The registry is a plain readable file by design. The credential reaches `accounts.setSecret` and no other destination; a registry entry carrying `apiKey`, `token`, `accessToken`, `secret` or `password` is refused before anything is written, and nothing ever reads a credential back except `getSecret`. |
| `AI-29-R05` | **A ceiling entered by hand carries its provenance.** The command writes `{ value, provenance, assertedAt }` and never a bare number. A figure the operator asserts is `operator-declared`; a figure transcribed from a provider's own documentation is `vendor-documented`; `observed` is never claimed for a value this path did not measure. A declared limit with no recognised provenance is refused at load naming the account and the window, and that rule is `limits.resolveLimits` — not a second copy of it. |
| `AI-29-R06` | **A window left undeclared stays unknown.** The form must permit a ceiling to be omitted, and an omitted window is written as nothing at all so the resolver reports `unknownBudget: true`. A blank is honest; a zero is a claim. |
| `AI-29-R07` | **An unrecognised option is refused, not ignored.** The command rejects any option it does not understand, so a mistyped flag cannot operate on a different account, window or provider than the one the operator named. |
| `AI-29-R08` | **Either the entry completes or nothing is written.** A refusal on any part — a bad field, an unknown option, a limit with no provenance — leaves no registry entry, no limit and no credential behind. A half-written account reads as usable and is not. |
| `AI-29-R09` | **Every write is readable back, and the credential is never in it.** The command prints the account id, the windows now known and the windows still unknown, the provenance of each ceiling, and whether a credential is present. It never prints the credential, not even masked, because a masked value still carries length and alphabet. |
| `AI-29-R10` | **An account with no credential is reported as such.** An entry written without a credential reports `hasSecret: false` and the command says the account cannot authenticate yet. Reporting it as ready would be the exact state `AI-TOOL-10` forbids. |
| `AI-29-R11` | **The entry path writes no lifecycle state.** It cannot change a register row, a Work Item document, a branch, or anything under `docs/product-spec/`. Registration of an account is not registration of a Work Item. |

## UI states

The cockpit page gains one panel with four observable states. All four are read-only renderings; none of them submits anything.

- **Ready** — the operator has filled id, provider, model and capabilities; the panel shows the exact command and states which windows will be written and which will stay unknown.
- **Refused** — a field fails the validator; the panel names every failing field and shows no command, because a command that would be refused is not offered.
- **Unknown windows** — the operator has declared some ceilings and not others; the panel names the windows that will remain unknown, so a blank is visible before the write rather than after.
- **Applied** — the operator has run the command; the panel reports the account id, the known and unknown windows, the provenance of each ceiling, and whether a credential is present. It never reports the credential.

## API, event and data impact

- No database schema and no carrier protocol change.
- **No new HTTP route, method or endpoint.** `tools/ai-dashboard/server.js` is unchanged; its method allowlist and its `405` remain as they are.
- A new Brain CLI sub-command group, `account`, with `add`, `limits` and `secret`. Like every existing sub-command it refuses an unrecognised option with exit code `1`.
- `accounts.registry.json` gains `limits` entries of the shape TASK-AI-26 already reads, `{ value, provenance, assertedAt }`. An entry with an empty `limits` object remains valid and reports every window unknown.
- `accounts.secrets.enc` may gain an entry. Its format is unchanged, and `listAccounts` continues to expose the credential as a boolean presence flag and nothing else.

## Acceptance matrix

**Evidence boundary.** Every row runs against the real modules in `tools/ai-brain/`
or against a copy of a real repository file written to `os.tmpdir()`. No row is
satisfied by citing this document, no row compares two string literals written
into its own command, no row asserts through `node --test --test-name-pattern`,
and no row pins a count that drifts with the repository. No command is stored
inline in a table cell: a raw `|` inside a cell splits it, and a mangled command
that dies on a syntax error exits `1`, which is the code several rows below
expect. Every row is a committed script or a command that already exists.

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-29-01` | Control table status and delivery register row 162 cannot diverge | `node tools/ai-brain/acceptance/ac-29-01-status-alignment.js` | `0` | `Control status matches register row 162: BLOCKED_DEPENDENCY (declared TASK-AI-29)` | `docs/product-spec/work-items/TASK-AI-29.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-29-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-29-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-29-01` runs detects it | `node tools/ai-brain/acceptance/ac-29-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-29-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr |
| `AC-AI-29-03` | Dependency resolution truthfulness: register row 162 declares `TASK-AI-26`, and `TASK-AI-26` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-29-03-dependency-merged.js` | `0` | `TASK-AI-26 dependency verified: merged into origin/main for TASK-AI-29` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-29-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js` |
| `AC-AI-29-04` | **Negative proof, must fail:** a copy of the real register that names a dependency with no merge commit is refused by the same rule `AC-AI-29-03` runs | `node tools/ai-brain/acceptance/ac-29-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-29-04-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`; command stderr |
| `AC-AI-29-05` | Every account the committed registry ships passes the entry rule the form must apply | `node tools/ai-brain/acceptance/ac-29-05-entry-rule.js` | `0` | `ENTRY_RULE_HOLDS: every account the registry declares passes the entry rule the form must apply` | `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/accounts.js`, `tools/ai-brain/limits.js`, `tools/ai-brain/acceptance/ac-29-05-entry-rule.js`, `tools/ai-brain/acceptance/lib/account-entry.js` |
| `AC-AI-29-06` | **Negative proof, must fail:** copies of a real declaration carrying a credential field and a ceiling with no provenance are refused by the same rule `AC-AI-29-05` runs | `node tools/ai-brain/acceptance/ac-29-06-entry-rule-refused.js` | `1` | `ENTRY_RULE_VIOLATED: REGISTRY_VALIDATOR,LIMIT_PROVENANCE (agy-docker-b tokensPerDay: provenance is missing or unrecognised)` | `tools/ai-brain/acceptance/ac-29-06-entry-rule-refused.js`, `tools/ai-brain/acceptance/lib/account-entry.js`; command stderr |
| `AC-AI-29-07` | The real entry path stores the credential so the registry carries no readable copy of it | `node tools/ai-brain/acceptance/ac-29-07-registry-credential-free.js` | `0` | `REGISTRY_CREDENTIAL_FREE: the entry path wrote the credential through accounts.setSecret and the registry carries no readable copy of it` | `tools/ai-brain/accounts.js`, `tools/ai-brain/acceptance/ac-29-07-registry-credential-free.js`, `tools/ai-brain/acceptance/lib/account-entry.js` |
| `AC-AI-29-08` | **Negative proof, must fail:** a copy of the registry the real entry path wrote, with the credential pasted into the entry, is refused by the same rule `AC-AI-29-07` runs | `node tools/ai-brain/acceptance/ac-29-08-credential-in-registry.js` | `1` | `CREDENTIAL_IN_REGISTRY: accounts.registry.json` | `tools/ai-brain/acceptance/ac-29-08-credential-in-registry.js`, `tools/ai-brain/acceptance/lib/account-entry.js`; command stderr |
| `AC-AI-29-09` | The four negative proofs above fail operationally (exit 2), not as findings, when run where no repository exists | `node tools/ai-brain/acceptance/ac-29-09-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 subjects exited 2 with no repository present` | `tools/ai-brain/acceptance/ac-29-09-outside-repository.js`; command stdout |
| `AC-AI-29-10` | The cockpit's HTTP service still refuses every mutating method, so the entry path cannot be the dashboard | `node --test --test-reporter=tap tools/ai-dashboard/test/dashboard.test.js` | `0` | `# Subtest: rejects unsafe mutation methods with 405 Method Not Allowed (AI15-R05, AI15-R09)` | `tools/ai-dashboard/server.js`, `tools/ai-dashboard/test/dashboard.test.js`; TAP output. This is TASK-AI-15's own rule asserted by TASK-AI-15's own suite, re-used rather than restated |
| `AC-AI-29-11` | The register does not overstate: no ready or terminal row names a specification or a merge it cannot prove | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js`; command stdout; warning and note totals are deliberately unpinned |
| `AC-AI-29-12` | Specification and documentation validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py`; command stdout |

### Evidence notes for the invariant rows

`AC-AI-29-10`, `-11` and `-12` assert invariants (`fail 0`, `0 lỗi`, a passing
validator), never exact totals, because this Work Item itself adds a markdown
specification file and nine acceptance scripts, so any pinned count is stale on
arrival. The counts below are recorded as evidence of the observed baseline only.
A change in any of them does not falsify the corresponding acceptance row, and no
row may be rewritten to assert them.

| Row | Asserted invariant | Observed baseline (evidence only, not asserted) |
|---|---|---|
| `AC-AI-29-10` | the mutation-refusal subtest is present and the dashboard suite is green | `87` tests, `87` pass, `0` fail, in about `11` seconds at the time of writing |
| `AC-AI-29-11` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled, `0` warnings and `150` notes at the time of writing |
| `AC-AI-29-12` | `Documentation validation passed:` from `validate_docs.py` | `94` markdown files, `130` feature IDs, `178` delivery rows at the time of writing |
| `AC-AI-29-05` | every declared account passes the entry rule | `3` declared accounts, `0` findings at the time of writing; the count is printed as evidence and never asserted, because adding a provider is a change the rule must keep admitting |

### Why each negative proof is not vacuous

Every command in the table above was extracted from this markdown and executed
verbatim against this branch. Each row produced the exit code and the string
stated. The four negative rows are not tautologies:

| Row | Negative proof of which rule | CONTROL (real input accepted) | Tamper (copy in `os.tmpdir()`) | Rejection |
|---|---|---|---|---|
| `AC-AI-29-02` | status alignment `AC-AI-29-01` | the real `TASK-AI-29.md` agrees with real register row 162 | `Status` cell flipped to `READY_FOR_AUTHOR` in a copy of the specification | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-29-04` | dependency proof `AC-AI-29-03` | real declared dependency `TASK-AI-26` has a merge commit on `origin/main` | `dependencies` cell repointed to `TASK-AI-99` in a copy of the register | `DEPENDENCY_UNPROVEN`, exit `1` |
| `AC-AI-29-06` | entry rule `AC-AI-29-05` | the real `seed-accounts.js` declarations pass both halves of the rule | a credential field added to one copy, and a ceiling declared with no provenance in another | `ENTRY_RULE_VIOLATED: REGISTRY_VALIDATOR,LIMIT_PROVENANCE`, exit `1` |
| `AC-AI-29-08` | registry rule `AC-AI-29-07` | the registry written by the real `addAccount` and `setSecret` carries no readable copy of the credential | the credential pasted into the entry of a copy of that registry | `CREDENTIAL_IN_REGISTRY`, exit `1` |

Each of the four exits `2`, never `1`, when its real source is missing; that
property is measured by `AC-AI-29-09`, which spawns all four from an empty
temporary directory with no repository on disk and requires `SOURCE_MISSING` from
each. A proof that died for an unrelated reason cannot be mistaken for a
detection.

`AC-AI-29-07` carries its own trap and names it. A credential-leak test passes
trivially when the write silently did nothing, so the CONTROL requires
`getSecret` to return the credential and `listAccounts` to report
`hasSecret: true` before the registry document is inspected at all. A registry
with no credential in it is evidence only once the credential is known to exist
somewhere.

### One rule, one module

`AC-AI-29-05` (the invariant) and `AC-AI-29-06` (its negative proof) exercise the
same rule, and `AC-AI-29-07` and `AC-AI-29-08` exercise its registry half. The
rule is defined once, in `tools/ai-brain/acceptance/lib/account-entry.js`, and all
four scripts `require` that module, so editing the rule there changes both the
gate and the proof of the gate.

Nothing is restated in that module either. The registry rule is
`accounts.validateAccount`, the limit rule is `limits.resolveLimits`, and the
store is `accounts.setSecret` and `getSecret` — all re-exported **by reference**
and consulted, never copied. The register pair re-uses
`lib/spec-status-alignment.js` and `lib/dependency-merged.js`, each of which is
the single definition shared by the Work Item whose rule it is. The dashboard
row re-uses TASK-AI-15's own suite rather than writing a second method-allowlist
check.

**Coupling proof (mutation test).** `tools/ai-brain/acceptance/lib/account-entry.js`
was edited, without touching any script, and the rows were re-run. The module was
restored from a file backup afterwards, not from Git, so no uncommitted work was
discarded.

| Mutation to `account-entry.js` | `AC-AI-29-05` exit | `AC-AI-29-06` exit | `AC-AI-29-07` exit | `AC-AI-29-08` exit | Reading |
|---|---|---|---|---|---|
| none (restored) | `0` | `1` | `0` | `1` | baseline |
| `entryFindings` returns `[]` always | `2` | `0` | `0` | `1` | `AC-AI-29-06` **fails**: both tampered copies are admitted, so it prints `ENTRY_RULE_NOT_ENFORCED` and exits `0` instead of `1`; `AC-AI-29-05` stops at exit `2` because its own control can no longer make the rule refuse a provider-less entry |
| `registryExposesCredential` returns `false` always | `0` | `1` | `0` | `0` | `AC-AI-29-08` **fails**: the credential pasted into the registry copy is no longer reported |
| the `LIMIT_PROVENANCE` loop dropped from `entryFindings` | `2` | `0` | `0` | `1` | both entry rows **fail**: the invariant's control can no longer refuse a ceiling with no provenance, and the negative proof reports `ENTRY_RULE_NOT_ENFORCED` |
| the `REGISTRY_VALIDATOR` loop dropped from `entryFindings` | `2` | `0` | `0` | `1` | both entry rows **fail** the same way, on the credential half |

Emptying `entryFindings` leaves the negative proof at `0` where the row requires
`1` while the invariant's control can no longer demonstrate that the rule refuses
anything, and emptying `registryExposesCredential` breaks `AC-AI-29-08` alone.
That is the evidence that each negative proof depends on the invariant's own rule
rather than on a private copy of it.

The last two mutations are recorded for what they do *not* distinguish. Each half
of the entry rule is load-bearing — dropping either one fails both entry rows —
but the rows cannot say which half broke, because `AC-AI-29-06` reports only that
at least one tampered copy was admitted. The evidence is sufficient for the claim
the rows make, that a change to the shared rule changes their outcome; it is not
sufficient to attribute a failure to one half, and that is stated here rather
than left for a reader to discover.

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-29
node tools/ai-brain/acceptance/ac-29-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-29-02-status-divergence.js

# 3. Dependency truthfulness: TASK-AI-26 merged into origin/main
node tools/ai-brain/acceptance/ac-29-03-dependency-merged.js

# 4. Negative proof: a dependency with no merge commit is refused
node tools/ai-brain/acceptance/ac-29-04-dependency-unproven.js

# 5. The entry rule over the accounts the registry really declares
node tools/ai-brain/acceptance/ac-29-05-entry-rule.js

# 6. Negative proof: a credential in the registry, and a ceiling with no provenance
node tools/ai-brain/acceptance/ac-29-06-entry-rule-refused.js

# 7. The real entry path stores the credential so the registry does not
node tools/ai-brain/acceptance/ac-29-07-registry-credential-free.js

# 8. Negative proof: a registry copy carrying the credential is refused
node tools/ai-brain/acceptance/ac-29-08-credential-in-registry.js

# 9. Outside-repository probe: the negative proofs exit 2, never 1
node tools/ai-brain/acceptance/ac-29-09-outside-repository.js

# 10. The cockpit still refuses every mutating method
node --test --test-reporter=tap tools/ai-dashboard/test/dashboard.test.js

# 11. Register reconciliation audit
node tools/ai-brain/cli.js reconcile

# 12. Specification structural validation
python docs/product-spec/scripts/validate_docs.py

# 13. Repository gates that must stay green
node tools/ai-guard/cli.js secret-surface
pnpm format:check
node --test "tools/ai-brain/test/*.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-29: an account and quota entry form backed by a validated, audited local command. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Contradictions found in neighbouring specifications

1. **The register asks for a form on a surface that is forbidden to mutate.**
   Row 162's feature is "Account and quota entry form on the cockpit", and
   `TASK-AI-15.md` `AI15-R09` states that "Dashboard endpoints and controls are
   observational. Any future operational action requires a separate approved Work
   Item, authorization model, audit trail, and confirmation design." The same rule
   is enforced in code: `tools/ai-dashboard/server.js` answers every mutating
   method with `405` and the text `AI15-R09`. Two readings are possible, and the
   register does not choose between them. This specification takes the reading
   `AI15-R09` already authorises: the form is rendered by the cockpit, which
   stays observational, and the write is a local command carrying its own
   authorization (an unrecognised option is refused rather than ignored), audit
   (every write is printed back) and confirmation (nothing is written until the
   whole entry validates). A genuine in-page submit needs a separate approved
   write service and is out of scope here; `AC-AI-29-10` asserts this Work Item
   did not take it by quietly widening the dashboard.
2. **`AI-26-R01`'s wording and `limits.resolveLimits` disagree for one input
   shape.** The rule says a limit with an absent or unrecognised source is
   "rejected at registry load with the account id and window named, not silently
   dropped". Measured at HEAD: a declaration that is an object carrying `value`
   but no `provenance` is rejected exactly as stated, but a declaration written as
   a bare number is neither rejected nor reported — `resolveLimits` treats it as
   no declaration at all and the window stays unknown. Both end with the window
   unknown, so the difference is invisible from the outside. This Work Item
   requires the form to write `{ value, provenance, assertedAt }` and never a bare
   number (`AI-29-R05`), which avoids the gap rather than resolving it, and
   records it here because `TASK-AI-26` is merged and is not this Work Item's to
   edit.
3. **`TASK-AI-29`'s register row names a dependency that is merged, while the row
   still reads `BLOCKED_DEPENDENCY`.** The same class of staleness `TASK-AI-08.md`
   and `TASK-AI-20.md` both document for their own rows: register row 159
   (`TASK-AI-26`) reads `BACKLOG` although `TASK-AI-26` is merged at
   `3ccf49b7fed6127a54676fef23980e50f4d6bca1`. `AC-AI-29-03` proves the dependency
   from Git instead of asserting the register status, which would fail while the
   reconciler correctly refuses to write `MERGED`.

## Residual limitations

- **The form is rendered, not submitted.** `AI15-R09` forbids the cockpit from
  mutating, so the operator runs the composed command. That is one step more than
  a form that submits, and it is the step `AI15-R09` requires to exist. An
  in-page submit needs a separate approved write service, an authorization model
  and a confirmation design, and none of that is in this Work Item.
- **The entry path exists as a specification, not as code.** The command, the
  panel and `tools/ai-brain/test/account-entry.test.js` are specified here and
  delivered during implementation. Every acceptance row below asserts a rule that
  the shipped modules already satisfy; none of them asserts the command, which
  does not exist at HEAD.
- **A credential passed on a command line is a credential in the shell history.**
  The specification requires it to be read from a prompt or a file descriptor
  instead, but nothing here can prove an operator did not paste it into an
  argument. The requirement reduces the exposure; it does not remove it.
- **Nothing verifies the figure the operator types.** A ceiling declared
  `operator-declared` is taken as asserted. A wrong number produces a confident
  runway that is wrong in the same direction, and the only route back is the
  staleness report `AI-26-R10` defines.
- **`AC-AI-29-10` couples this Work Item to TASK-AI-15's suite.** The row fails if
  any test in `tools/ai-dashboard/test/dashboard.test.js` fails, including one
  unrelated to the read-only rule. That coupling is deliberate — the row exists to
  assert that the dashboard was not widened — but it is a coupling, and it is
  recorded rather than hidden.
- **The coupling evidence cannot attribute a failure to one half of the rule.**
  Dropping either loop inside `entryFindings` produces the same exit codes across
  the four entry rows, so a future regression tells the operator that the entry
  rule stopped firing without saying which half stopped. Splitting the rule into
  two reported codes would fix it and is not done here; the numbers are recorded
  so the limitation is visible rather than inferred.
- **Removing or rotating an account is not specified.** The command group covers
  adding, setting limits and storing a credential. `accounts.removeAccount`
  exists and is deliberately not surfaced here, because deleting an account that
  a Work Item was dispatched to is a decision with an operator's judgement about
  in-flight work.
