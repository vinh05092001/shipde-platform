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
| Allowed paths | `tools/ai-brain/accounts.js`, `tools/ai-dashboard/usage-adapter.js`, `tools/ai-guard/cli.js`, `tools/ai-guard/secret-surface.js`, `tools/ai-guard/test/secret-surface.test.js`, `scripts/ai/doctor.ps1`, `docs/product-spec/work-items/TASK-AI-18.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
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

## UI states

Not applicable as a screen. Operator-visible output is confined to two places:

- **`ai-guard secret-surface`** — reports either `SECRET_SURFACE_CLEAN` with the
  number of files scanned, or one line per violation naming file, line and
  column, and exits non-zero.
- **`doctor.ps1`** — a section stating the plaintext row counts in the
  third-party store and that Ship Dễ does not own it.

## API, event and data impact

- No database schema, backend API, or carrier protocol change.
- No change to the 9Router store. It is read by the existing usage adapter for
  non-credential columns only, and that remains true.
- `~/.shipde/accounts.secrets.enc` may gain entries. Its format is unchanged.

## Acceptance matrix

**Evidence boundary.** Every row runs the real guard against fixture source
files. No row is satisfied by citing this document, and no row reimplements the
scan inline — a row that rebuilt the column matching would pass with the guard
absent. **No row reads the credential store or prints any value.**

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-18-01` | Current Ship Dễ source is clean, so the rule starts from a true baseline | `node tools/ai-guard/cli.js secret-surface` | `0` | `SECRET_SURFACE_CLEAN` | command stdout |
| `AC-AI-18-02` | Negative proof: a direct read of `apiKeys.key` is caught | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: a select of apiKeys.key is reported with file and line` | TAP output |
| `AC-AI-18-03` | Negative proof: a read of `providerConnections.data` is caught | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: a select of providerConnections.data is reported` | TAP output |
| `AC-AI-18-04` | Negative proof: `SELECT *` on a credential table is caught even though no column is named | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: a wildcard select on a credential table is reported` | TAP output |
| `AC-AI-18-05` | The existing usage adapter is not a false positive | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: selecting provider, name, isActive, priority is clean` | TAP output |
| `AC-AI-18-06` | The guard never emits a credential value | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: a violation report contains no value from the row` | TAP output |
| `AC-AI-18-07` | The guard fails closed on an unreadable file | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: an unreadable file reports failure, never clean` | TAP output |
| `AC-AI-18-08` | The encrypted store keeps key and ciphertext at separate paths | `node -e "const a=require('./tools/ai-brain/accounts');if(a.KEY_FILE===a.SECRETS_FILE){console.error('KEY_BESIDE_CIPHERTEXT');process.exit(1)}console.log('KEY_AND_CIPHERTEXT_SEPARATE')"` | `0` | `KEY_AND_CIPHERTEXT_SEPARATE` | `tools/ai-brain/accounts.js` |
| `AC-AI-18-09` | A round trip through the encrypted store returns the value and stores no plaintext | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: setSecret then getSecret round-trips without plaintext on disk` | TAP output |
| `AC-AI-18-10` | Doctor counts the third-party exposure without quoting it | `node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js` | `0` | `# Subtest: the report carries counts and no fragment of any value` | TAP output |
| `AC-AI-18-11` | Negative proof that the TAP rows above are not vacuous | `node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const f='tools/ai-guard/test/secret-surface.test.js';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1)"` | `1` | `VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ` | command stdout |
| `AC-AI-18-12` | The guard is reachable from the CLI the hook already calls | `node tools/ai-guard/cli.js --help` | `0` | `secret-surface` | command stdout |
| `AC-AI-18-13` | The new suite is green | `node --test tools/ai-guard/test/secret-surface.test.js` | `0` | `fail 0` | test runner stdout |
| `AC-AI-18-14` | The repository secret scan is unbroken | `pnpm security:secrets` | `0` | `0 phát hiện` | command stdout |

Rows `AC-AI-18-02` through `AC-AI-18-10` name the TAP subtest rather than
asserting an exit code alone, because `node --test` exits `0` when
`--test-name-pattern` matches nothing — measured, and the reason
`AC-AI-18-11` exists.

## Verification commands

```bash
# 1. The guard on the real source tree
node tools/ai-guard/cli.js secret-surface

# 2. The guard's own suite, with named subtests visible
node --test --test-reporter=tap tools/ai-guard/test/secret-surface.test.js

# 3. Negative proof that a non-matching pattern is rejected
node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,'tools/ai-guard/test/secret-surface.test.js'],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED');process.exit(n>0?0:1)"
# Expected exit code: 1

# 4. Key and ciphertext stay apart
node -e "const a=require('./tools/ai-brain/accounts');console.log(a.KEY_FILE===a.SECRETS_FILE?'KEY_BESIDE_CIPHERTEXT':'KEY_AND_CIPHERTEXT_SEPARATE')"

# 5. Repository secret scan
pnpm security:secrets

# 6. Whole repository suite
pnpm test
```

## Codex review record

| Round | Commit | Verdict | Notes |
|---|---|---|---|
| 1 | `pending` | `pending` | Awaiting independent review. |

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
