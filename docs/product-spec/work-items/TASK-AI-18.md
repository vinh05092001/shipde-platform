# TASK-AI-18 — Remove plaintext provider tokens from local storage

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-18` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `151` |
| Dependencies | `none` |
| Assigned author | `CLAUDE` |
| Risk | `HIGH` |
| Allowed paths | `tools/ai-brain/accounts.js`, `tools/ai-dashboard/usage-adapter.js`, `tools/ai-guard/cli.js`, `tools/ai-guard/secret-surface.js`, `tools/ai-guard/test/secret-surface.test.js`, `tools/ai-guard/test/fixtures/`, `scripts/ai/doctor.ps1`, `docs/product-spec/work-items/TASK-AI-18.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-18-token-encryption` |
| Pull Request | `pending` |

## Business outcome

Live credentials sit unencrypted on this machine, in a store Ship Dễ does not
own.

Measured in `C:/Users/gumac/AppData/Roaming/9router/db/data.sqlite`:

| Location | Finding |
|---|---|
| `apiKeys.key` | **2 of 2 rows** hold a plaintext gateway key (`sk-` prefix, 35 and 51 characters) |
| `providerConnections.data` | **1 of 13 rows** holds a plaintext provider token |

No value is reproduced here, and no acceptance row below reveals one.

The uncomfortable part is what Ship Dễ can and cannot do about it. 9Router is a
third-party application; its storage format is not ours to change, and a Work
Item that promised to encrypt it would be promising something it cannot
deliver. What *is* ours is every line of Ship Dễ code that can reach that file,
and the rule about what may be taken out of it.

Today that code is clean by accident rather than by rule.
`tools/ai-dashboard/usage-adapter.js` reads `providerConnections` selecting only
`provider, name, isActive, priority` — it never selects `data`, and never opens
`apiKeys` at all. Nothing enforces that. A future adapter, or an operator
script, can widen a `SELECT` to `*` and pull two live keys into a log, a
dashboard payload, or a JSON artifact committed to the repository, and no gate
would notice.

This Work Item turns that accident into a rule with a check behind it, and
routes every credential Ship Dễ genuinely needs through the encrypted store the
repository already has.

## Source references

- `tools/ai-brain/accounts.js` — `loadKey`, `setSecret`, `getSecret`, `hasSecret`, `KEY_FILE` (`~/.shipde/accounts.key`), `SECRETS_FILE` (`~/.shipde/accounts.secrets.enc`)
- `tools/ai-dashboard/usage-adapter.js:93,104` — the only Ship Dễ reader of the 9Router store, and the columns it selects
- `AI-TOOL-04` — 9Router is localhost-only, authenticated, logging and cloud sync off
- `AI-TOOL-10` — a failed or partial operation reports exact state and must not be recorded as healthy
- `.gitleaks.toml` — the repository secret-scan configuration and its narrow fixture allowlists

## Preconditions and dependencies

- No Work Item dependency. Register row 151 records `dependencies` as empty and
  the status as `BACKLOG`; this document does not advance it.
- The encrypted store already exists and works: `accounts.js` encrypts secrets
  under a key at `~/.shipde/accounts.key`, separate from the ciphertext at
  `~/.shipde/accounts.secrets.enc`.
- 9Router remains third-party. Nothing in scope modifies its schema, its files,
  or how it stores what it stores.
- Measured on `2026-09-15`, because the acceptance matrix depends on each one:
  - The shell is Windows PowerShell `5.1` (`powershell.exe`). `pwsh` is absent
    (`ENOENT`), so no row may invoke it, and no row may use `&&`, which
    PowerShell 5.1 does not support.
  - One command in the review harness is bounded at `30` seconds. `pnpm
    security:secrets` cannot be asserted here because `gitleaks` is
    `ci-provisioned` in `tools/ecosystem-manifest.json` and absent from `PATH`.
    `scripts/verify-secrets.ts` falls back to `%TEMP%\gitleaks\gitleaks.exe`,
    so a local run scans when a scratch copy happens to be there and exits `2`
    operationally when it is not — measured both ways on `2026-09-15`. A row
    whose outcome turns on the contents of a temp directory measures the
    workstation, not this Work Item. CI remains the owner of that gate.
  - `node:sqlite` resolves (`Node v24.15.0`; root `package.json` requires
    `>=24.0.0`), so a synthetic store fixture can be built in `os.tmpdir()`
    without a new dependency.
  - `.gitleaks.toml` hashes to `232e56d960dc7c86c417edba436cb2f89621c58d56dd7e91705edfcced3ef859`
    (SHA-256). `AC-AI-18-15` pins that digest, so any widening of the secret
    gate is a failing row rather than a silent edit.
  - `scripts/verify-formatting.ts` runs Prettier over files changed against a
    base ref and does not exclude `tools/`, so every `.ts` fixture added under
    `tools/ai-guard/test/fixtures/` must itself be Prettier-clean or
    `pnpm format:check` fails for a reason unrelated to this Work Item.

## Author boundary

The implementation may change only the files in `Allowed paths`. It may not
edit `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, any
workflow, or another Work Item document. It may not write to the 9Router
database, and it may not alter the delivery register schema or any status.

## In scope

- A rule, and a check that enforces it, that no Ship Dễ code reads a
  credential-bearing column out of the 9Router store. Specifically:
  `apiKeys.key` and `providerConnections.data` are forbidden reads; `SELECT *`
  against either table is forbidden because it reaches them implicitly.
- A guard, `tools/ai-guard/secret-surface.js`, invoked from `tools/ai-guard/cli.js`,
  that scans Ship Dễ source for those reads and fails closed when it finds one.
- Route any credential Ship Dễ genuinely needs through `accounts.js`
  `getSecret`/`setSecret`, never by reading it from a third-party store at call
  time.
- Report the third-party exposure honestly in `scripts/ai/doctor.ps1`: count the
  plaintext rows, never print a value, and state plainly that Ship Dễ cannot fix
  a store it does not own.
- Author `tools/ai-guard/test/secret-surface.test.js` covering each rule with
  fixture source files, so the suite needs no real credential store.
- Commit the source fixtures the guard is judged against under
  `tools/ai-guard/test/fixtures/`, exactly `6` directories: `forbidden-api-keys-key`,
  `forbidden-provider-connections-data`, `forbidden-wildcard-select`,
  `safe-projections`, `unparsable-source`, `value-must-not-leak`. Each carries a
  file named `reader.ts`, and each offending statement sits on line `3`, so a
  violation's reported line number is deterministic rather than incidental.
- Freeze this CLI surface in `tools/ai-guard/cli.js`, because every acceptance
  row depends on it:
  - `node tools/ai-guard/cli.js secret-surface [--root <dir>]` scans `<dir>`
    (default: the repository root) and exits `0`, `1` or `2`.
  - `node tools/ai-guard/cli.js check [--secret-surface-root <dir>]` is the
    command the installed pre-commit hook already runs, so `check` also runs the
    scan. `--secret-surface-root` exists so the integration can be proved against
    a fixture without editing tracked source, in the same spirit as
    `--allow-fixture-write` in `TASK-AI-19`.
  - Exactly `3` output lines exist. Clean prints `SECRET_SURFACE_CLEAN`, then
    `files scanned: <n>`, exit `0`. A violation prints nothing but one
    `SECRET_SURFACE_VIOLATION: <file>:<line> <column>` line per violation, exit
    `1`, where `<column>` is `apiKeys.key`, `providerConnections.data`, or
    `SELECT * on apiKeys` / `SELECT * on providerConnections` for a wildcard. A
    file the scanner cannot read prints `SECRET_SURFACE_UNREADABLE: <file>`, exit
    `2`. No line in any state carries a value out of any row.
- Exclude `tools/ai-guard/test/fixtures/` from the default repository scan, and
  name that exclusion explicitly in the source. Without it the guard's own
  negative fixtures are violations and `AC-AI-18-01` can never be green.

## Out of scope

- Encrypting the 9Router store. It is a third-party application and its storage
  is not Ship Dễ's to change. Claiming otherwise would be the overstatement this
  repository's gates exist to catch.
- Rotating the exposed credentials. Rotation is an operator action with an
  operator's judgement about blast radius; this Work Item surfaces the exposure
  and refuses to hide it.
- Changing `AI-TOOL-04` or how 9Router is launched.
- Scanning the machine generally for secrets. The scope is the 9Router store
  and Ship Dễ's own source.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-18-R01` | **Forbidden columns are named, not inferred.** `apiKeys.key` and `providerConnections.data` are the credential-bearing columns of the 9Router store. Ship Dễ source may not select either, and may not use `SELECT *` on either table, because a wildcard reaches a forbidden column without naming it. |
| `AI-18-R02` | **The guard fails closed.** When `secret-surface` cannot parse a file, cannot locate the source tree, or cannot determine whether a query is safe, it reports failure with the reason. An unreadable file is never treated as clean. |
| `AI-18-R03` | **No credential ever leaves the guard.** The guard reports file, line, and the offending column name. It never reads the database, never prints a value, and never includes a query result in its output. |
| `AI-18-R04` | **Ship Dễ credentials come from the encrypted store.** Any secret Ship Dễ needs is written with `accounts.setSecret` and read with `accounts.getSecret`. Reading a credential from a third-party store at call time is forbidden even when it would work, because it spreads the plaintext to a second process and its logs. |
| `AI-18-R05` | **The key never sits beside the ciphertext.** `KEY_FILE` and `SECRETS_FILE` stay separate paths, as they already are. A change that puts them in one file, or derives the key from the ciphertext's own contents, is rejected. |
| `AI-18-R06` | **Doctor counts, never quotes.** The health report states how many rows in each table hold a plaintext credential and nothing about their contents — not a prefix, not a length, not a masked form. A masked value still leaks length and alphabet. |
| `AI-18-R07` | **The third-party exposure is reported as unfixable-by-us, not as resolved.** Doctor output must state that the 9Router store is outside Ship Dễ's control. Reporting it as a Ship Dễ finding that Ship Dễ then closes would be a false claim of remediation. |
| `AI-18-R08` | **A test fixture is never a real credential.** Test files use synthetic values that cannot authenticate anywhere. The existing `.gitleaks.toml` fixture allowlists are the precedent, and the guard's own tests must not require widening them. |
| `AI-18-R09` | **The guard runs where it can block.** `secret-surface` is invoked by `tools/ai-guard/cli.js` so the existing pre-commit hook can reach it. A check that only runs when someone remembers is not a control. |
| `AI-18-R10` | **Operator scripts are in scope for the rule even when out of scope for the scan.** The rule binds any code that reads the store, including ad-hoc scripts outside the repository. The scan covers what it can see; the documentation states plainly that it cannot see everything, so the rule is not mistaken for full coverage. |
| `AI-18-R11` | **The fixture directory is excluded by name, not by pattern.** The default scan skips exactly `tools/ai-guard/test/fixtures/`. A broad skip such as `**/test/**` would also blind the guard to a forbidden read written into `tools/ai-guard/test/secret-surface.test.js` itself, which is the more likely place for one to appear. |
| `AI-18-R12` | **One violation is one line, and a clean scan is two.** Violations print one `SECRET_SURFACE_VIOLATION:` line each and nothing else; a clean scan prints `SECRET_SURFACE_CLEAN` and then a file count. Keeping the clean-line count off the first line is what lets a row assert an exact string instead of a string with a number in it. |
| `AI-18-R13` | **The secret gate is pinned, not trusted.** `.gitleaks.toml` is not edited and its SHA-256 is asserted. Adding an allowlist entry so a new fixture passes the scanner is the specific weakening this rule forbids; a fixture that needs one is the wrong fixture. |

## UI states

Not applicable as a screen. Operator-visible output is confined to three places:

- **`ai-guard secret-surface`** — prints one of 3 frozen states. Clean:
  `SECRET_SURFACE_CLEAN`, then `files scanned: <n>`, exit `0`. Violation: one
  `SECRET_SURFACE_VIOLATION: <file>:<line> <column>` line and nothing else, exit
  `1`. Unreadable file: `SECRET_SURFACE_UNREADABLE: <file>`, exit `2`. Every
  state names a file, a line and a column; no state names a value.
- **`doctor.ps1`** — a section stating the plaintext row counts in the
  third-party store and that Ship Dễ does not own it.
- **`pre-commit`** — the hook already runs `node tools/ai-guard/cli.js check`.
  With the scan wired into `check`, a commit whose staged source reads a
  credential column is refused by the same command that refuses a concurrent
  writer, and a clean commit passes with `SECRET_SURFACE_CLEAN` on stdout. The
  writer-claim failure text is unchanged, so a blocked commit still says which
  session holds the branch and how to release it.

## API, event and data impact

- No database schema, backend API, or carrier protocol change.
- No change to the 9Router store. It is read by the existing usage adapter for
  non-credential columns only, and that remains true.
- `~/.shipde/accounts.secrets.enc` may gain entries. Its format is unchanged.

## Acceptance matrix

**Evidence boundary.** Every row runs the real guard against fixture source
files. No row is satisfied by citing this document, and no row reimplements the
scan inline — a row that rebuilt the column matching would pass with the guard
absent. Every row also names the guard's own command, its exit code, one exact
line it must print, and the file that line comes from; a row that asserted a
return code alone is not admissible either, because that is the same claim with
the guard removed. **No row reads the credential store and no row prints any
value.**

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-18-01` | The real Ship Dễ source tree is clean with the new fixtures present, so the rule starts from a true baseline | `node tools/ai-guard/cli.js secret-surface` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/secret-surface.js` scanning the repository root; command stdout |
| `AC-AI-18-02` | **Negative proof, must fail:** a direct read of `apiKeys.key` is reported with file and line | `node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/forbidden-api-keys-key` | `1` | `SECRET_SURFACE_VIOLATION: reader.ts:3 apiKeys.key` | `tools/ai-guard/test/fixtures/forbidden-api-keys-key/reader.ts`; command stdout |
| `AC-AI-18-03` | **Negative proof, must fail:** a direct read of `providerConnections.data` is reported with file and line | `node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/forbidden-provider-connections-data` | `1` | `SECRET_SURFACE_VIOLATION: reader.ts:3 providerConnections.data` | `tools/ai-guard/test/fixtures/forbidden-provider-connections-data/reader.ts`; command stdout |
| `AC-AI-18-04` | **Negative proof, must fail:** `SELECT *` against a credential table is caught although no column is named | `node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/forbidden-wildcard-select` | `1` | `SECRET_SURFACE_VIOLATION: reader.ts:3 SELECT * on apiKeys` | `tools/ai-guard/test/fixtures/forbidden-wildcard-select/reader.ts`; command stdout |
| `AC-AI-18-05` | The projection the existing usage adapter uses is not a false positive, so the guard does not block real work | `node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/safe-projections` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/test/fixtures/safe-projections/reader.ts`; command stdout |
| `AC-AI-18-06` | **Negative proof, must fail closed:** a file the scanner cannot read is reported neither as clean nor as a violation | `node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/unparsable-source` | `2` | `SECRET_SURFACE_UNREADABLE: reader.ts` | `tools/ai-guard/test/fixtures/unparsable-source/reader.ts`; command stdout |
| `AC-AI-18-07` | **Negative proof, must fail, and no value may leave:** the fixture reads `apiKeys.key` on line 3 and carries the synthetic gateway-key shape the existing `.gitleaks.toml` allowlist already exempts on line 4, so one exit-`1` run proves the shape is present in the file and absent from the report | `node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/value-must-not-leak` | `1` | `SECRET_SURFACE_VIOLATION: reader.ts:3 apiKeys.key` — the whole of stdout, which by construction cannot contain anything from line 4 | `tools/ai-guard/test/fixtures/value-must-not-leak/reader.ts`; command stdout |
| `AC-AI-18-08` | The hook's own path is clean on this repository, so the scan does not block normal commits | `node tools/ai-guard/cli.js check` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/cli.js` `check` branch; command stdout |
| `AC-AI-18-09` | **Negative proof, must fail:** the same command that refuses a concurrent writer also refuses a forbidden read | `node tools/ai-guard/cli.js check --secret-surface-root tools/ai-guard/test/fixtures/forbidden-api-keys-key` | `1` | `SECRET_SURFACE_VIOLATION: reader.ts:3 apiKeys.key` | `tools/ai-guard/cli.js`; command stdout |
| `AC-AI-18-10` | The encrypted store keeps key and ciphertext at separate paths | `node -e "const a=require('./tools/ai-brain/accounts');if(a.KEY_FILE===a.SECRETS_FILE){console.error('KEY_BESIDE_CIPHERTEXT');process.exit(1)}console.log('KEY_AND_CIPHERTEXT_SEPARATE')"` | `0` | `KEY_AND_CIPHERTEXT_SEPARATE` | `tools/ai-brain/accounts.js` |
| `AC-AI-18-11` | The new suite is green | `node --test tools/ai-guard/test/secret-surface.test.js` | `0` | `ℹ fail 0` | `tools/ai-guard/test/secret-surface.test.js`; test runner stdout |
| `AC-AI-18-12` | A round trip through the encrypted store returns the value and leaves no plaintext on disk | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: setSecret then getSecret round-trips without plaintext on disk` | TAP output from `tools/ai-guard/test/secret-surface.test.js` |
| `AC-AI-18-13` | Doctor counts the third-party exposure and quotes nothing from it | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: the doctor report carries counts and no fragment of any value` | TAP output from `tools/ai-guard/test/secret-surface.test.js` |
| `AC-AI-18-14` | **Negative proof that no row may rest on a pattern:** `node --test` exits `0` and prints `pass 1` when `--test-name-pattern` matches nothing, so a pattern is not a control | `node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const f='tools/ai-guard/test/secret-surface.test.js';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1)"` | `1` | `VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ` | command stdout |
| `AC-AI-18-15` | The repository secret gate is unchanged, so no allowlist entry was added to admit a new fixture | `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('.gitleaks.toml')).digest('hex');if(h!=='232e56d960dc7c86c417edba436cb2f89621c58d56dd7e91705edfcced3ef859'){console.error('GITLEAKS_CONFIG_CHANGED: '+h.slice(0,12));process.exit(1)}console.log('GITLEAKS_CONFIG_UNCHANGED')"` | `0` | `GITLEAKS_CONFIG_UNCHANGED` | `.gitleaks.toml`; command stdout |

Rows `AC-AI-18-01` through `AC-AI-18-09` each name a different guard command
against a different fixture, so no single run can satisfy more than one of them.
`AC-AI-18-12` and `AC-AI-18-13` are the only two rows that share a command, and
each asserts a differently named subtest that exists only inside the delivered
suite. No row carries an assertion through `--test-name-pattern`, because a
pattern that matches nothing still exits `0`; `AC-AI-18-14` measures that trap
directly. Measured on `2026-09-15`:
`node --test --test-name-pattern=ZZZ_MATCHES_NOTHING_AI18 tools/ai-brain/test/reconcile.test.js`
printed `ℹ tests 1`, `ℹ pass 1` and exited `0`.

`AC-AI-18-15` stands where `pnpm security:secrets` would have stood. The gate
itself is `ci-provisioned` and cannot be executed here (see Preconditions), so
what is asserted locally is the property this Work Item could actually violate:
that the gate's configuration is byte-for-byte unchanged, and therefore that no
fixture bought its passage with an allowlist entry.

## Verification commands

```powershell
# Acceptance rows, in the order of the matrix. One command, one expected exit code.
node tools/ai-guard/cli.js secret-surface
# Expected exit code: 0, stdout contains SECRET_SURFACE_CLEAN

node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/forbidden-api-keys-key
# Expected exit code: 1, stdout is exactly SECRET_SURFACE_VIOLATION: reader.ts:3 apiKeys.key

node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/forbidden-provider-connections-data
# Expected exit code: 1, stdout is exactly SECRET_SURFACE_VIOLATION: reader.ts:3 providerConnections.data

node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/forbidden-wildcard-select
# Expected exit code: 1, stdout is exactly SECRET_SURFACE_VIOLATION: reader.ts:3 SELECT * on apiKeys

node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/safe-projections
# Expected exit code: 0, stdout contains SECRET_SURFACE_CLEAN

node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/unparsable-source
# Expected exit code: 2, stdout contains SECRET_SURFACE_UNREADABLE: reader.ts

node tools/ai-guard/cli.js secret-surface --root tools/ai-guard/test/fixtures/value-must-not-leak
# Expected exit code: 1, stdout is that one violation line and nothing from line 4 of the fixture

node tools/ai-guard/cli.js check
# Expected exit code: 0, stdout contains SECRET_SURFACE_CLEAN

node tools/ai-guard/cli.js check --secret-surface-root tools/ai-guard/test/fixtures/forbidden-api-keys-key
# Expected exit code: 1, stdout is exactly SECRET_SURFACE_VIOLATION: reader.ts:3 apiKeys.key

node -e "const a=require('./tools/ai-brain/accounts');if(a.KEY_FILE===a.SECRETS_FILE){console.error('KEY_BESIDE_CIPHERTEXT');process.exit(1)}console.log('KEY_AND_CIPHERTEXT_SEPARATE')"
# Expected exit code: 0, KEY_AND_CIPHERTEXT_SEPARATE

node --test tools/ai-guard/test/secret-surface.test.js
# Expected exit code: 0, the runner summary reports zero failures

node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js
# Expected exit code: 0, and the two subtests named by AC-AI-18-12 and AC-AI-18-13 are present

node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const f='tools/ai-guard/test/secret-surface.test.js';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1)"
# Expected exit code: 1, VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ

node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('.gitleaks.toml')).digest('hex');if(h!=='232e56d960dc7c86c417edba436cb2f89621c58d56dd7e91705edfcced3ef859'){console.error('GITLEAKS_CONFIG_CHANGED: '+h.slice(0,12));process.exit(1)}console.log('GITLEAKS_CONFIG_UNCHANGED')"
# Expected exit code: 0, GITLEAKS_CONFIG_UNCHANGED

# Repository gates that must stay green, per AGENTS.md
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
node tools/ai-brain/cli.js manifest
python docs/product-spec/scripts/validate_docs.py

# `pnpm security:secrets` is deliberately absent from this list. Gitleaks is
# ci-provisioned and CI owns that gate; run locally on a machine without the
# pinned binary it exits 2 operationally instead of scanning, so asserting it
# here would assert the workstation rather than this Work Item. AC-AI-18-15
# asserts what is locally checkable: that the gate was not widened.
```

## Codex review record

| Round | Commit | Verdict | Notes |
|---|---|---|---|
| 1 | `pending` | `pending` | Awaiting independent review. |

Before review round 1 the acceptance matrix was repaired on `2026-09-15` for
four reasons that would each have been a review finding:

1. Nine rows (`AC-AI-18-02` … `AC-AI-18-10`) shared one command — a single
   `node --test` run of the new suite — so one run satisfied nine rows. Seven of
   them now name a distinct guard command against a distinct fixture; the two
   suite rows that remain assert differently named subtests that exist only
   inside the delivered suite.
2. Those rows were labelled "Negative proof" while asserting exit `0` from a
   passing test. `AC-AI-18-02` through `-07` and `-09` now run the guard against
   a committed fixture that must fail, each with its exact failure line.
3. `AC-AI-18-14` asserted `pnpm security:secrets` locally, which cannot hold on
   a machine where Gitleaks is `ci-provisioned` and absent from `PATH`. It is
   replaced by `AC-AI-18-15`, which pins `.gitleaks.toml`'s SHA-256 and so
   detects the weakening this Work Item could actually cause.
4. `AC-AI-18-12` asserted that `secret-surface` appeared in `--help`, but
   `tools/ai-guard/cli.js` implements no `--help` at all. Measured: `--help`
   falls through to the default status command, printing the branch, identity
   and live AO sessions and exiting `0`, so the row asserted exit `0` against
   output that never contained the word; an unknown command exits `2`.
   Reachability from the hook is now proved by running `check`, the command the
   installed hook already invokes.

`Allowed paths` gained `tools/ai-guard/test/fixtures/` in the same change,
because the matrix names six fixture directories under it and a matrix whose
fixtures are outside its own author boundary is not writable as specified.
`TASK-AI-19` recorded the same omission as a residual limitation instead of
fixing it; this document fixes it.

## Residual limitations

- **The plaintext credentials remain plaintext.** This Work Item does not
  encrypt the 9Router store and cannot: the store belongs to a third-party
  application. Two gateway keys and one provider token stay readable by any
  process running as this user, and that is the honest state after this Work
  Item ships. Rotation and any decision to stop using that gateway are operator
  calls.
- **The scan sees only the repository.** `AI-18-R10` binds the rule to any code
  that reads the store, but the guard scans Ship Dễ source. An ad-hoc operator
  script outside the repository can still read a key and the guard will not know.
  That gap is real and is named here rather than papered over — this document's
  own author wrote such a script today, reading the gateway key out of the store
  to drive a review, which is exactly the behaviour `AI-18-R04` forbids and the
  scan would not have caught.
- **A guard that matches queries can be evaded.** String concatenation, a
  computed column name, or an ORM would defeat textual matching. The guard
  raises the cost of the mistake; it does not make it impossible.
- **Twelve of thirteen provider connections were not flagged**, which means the
  detector found no plaintext token in them — not that they are proven
  encrypted. An OAuth record stored in a shape the detector does not recognise
  reads the same as a safe one.
- **The fixture directory is excluded from the default scan by name.** A
  forbidden read written *inside* `tools/ai-guard/test/fixtures/` is not reported
  by `AC-AI-18-01`. The exclusion is what makes the negative fixtures possible at
  all, and `AI-18-R11` keeps it narrow enough to leave
  `tools/ai-guard/test/secret-surface.test.js` itself in scope, but the gap is
  real and is not closed by anything this Work Item ships.
- **The secret gate is pinned, not exercised.** `AC-AI-18-15` proves the Gitleaks
  configuration was not widened. It cannot prove the scanner still detects what
  it detected before, because the binary is `ci-provisioned` and absent here. A
  pinned digest also fails on any legitimate future change to that file, which is
  the intended direction for a gate change but does mean the row must be updated
  deliberately rather than incidentally.
- **`pnpm security:secrets` is not asserted locally at all.** CI owns that
  gate. It can appear to pass locally when `%TEMP%\gitleaks\gitleaks.exe`
  exists from unrelated work, which is a reason not to assert it rather than a
  reason to.
  If CI is ever skipped for a change to this Work Item's own files — the
  fixtures, which are the only new files that could carry a literal — nothing
  local would catch it. `AI-18-R08` and the `.gitleaks.toml` allowlist shape are
  the only local defence.
- **`scripts/ai/doctor.ps1` is not executed by any acceptance row.** It probes
  `11` CLIs with a `60`-second bound each and exceeds the harness's `30`-second
  command budget, so no row can run it. Its counting and its refusal to quote a
  value are covered by `AC-AI-18-13`, which asserts the subtest that tests the
  report rather than the PowerShell rendering of that report. A defect in the
  rendering alone would not be caught by this matrix.
