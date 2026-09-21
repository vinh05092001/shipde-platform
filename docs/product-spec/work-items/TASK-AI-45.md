# TASK-AI-45 — Four-profile Agy worker pool

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-45` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `179` |
| Dependencies | `None`; direct governed human decision recorded as `DEC-018` |
| Assigned author | `CODEX` by explicit human request |
| Risk | `HIGH` |
| Governed decision | `HUMAN-DECISION-AGY-POOL-FOUR-2026-09-21` / `DEC-018` |
| Branch | `feat/task-ai-45-agy-worker-pool` |
| Allowed paths | `tools/agy-pool/**`, `scripts/ai/open-agy-profile.ps1`, `scripts/ai/start-agy-pool.ps1`, this Work Item, `BASELINE-AND-DECISIONS.md`, `AI-TOOLCHAIN-DECISIONS.md`, `FEATURE-DELIVERY-REGISTER.csv`, `scripts/ai/README.md` |

## Business outcome

The operator can keep four fixed Agy account profiles on the Windows host, see whether each profile has local credential evidence, and open an isolated login or chat terminal for one selected profile. Profiles are workers, not a quota-rotation chain: exhaustion pauses the assigned worker, and no other account is selected automatically.

The manager runs beside the read-only AI dashboard on `127.0.0.1:3344`. Mutating actions require a per-process confirmation token, are audited without credentials, and open the official Agy CLI rather than proxying Gemini OAuth.

## Rules

| ID | Rule |
|---|---|
| `AI-45-R01` | Exactly four profiles (`agy-1` through `agy-4`) are created under the untracked user pool root. |
| `AI-45-R02` | Every profile receives distinct `HOME`, `USERPROFILE` and `JETSKI_APP_DATA_DIR` values. |
| `AI-45-R03` | The manager never reads, copies, displays or logs token contents; it reports file presence only. |
| `AI-45-R04` | Login/open actions bind to one explicit profile and require the UI action token. |
| `AI-45-R05` | No quota-triggered or automatic account switching exists. |
| `AI-45-R06` | The manager binds to loopback only and writes an append-only JSONL action audit outside Git. |
| `AI-45-R07` | The primary dashboard remains read-only; this manager is a separate local operational surface. |
| `AI-45-R08` | Four profiles never imply four writers on one Work Item: each active implementation profile has a distinct Work Item, branch and worktree. |

## Acceptance

- `node --test tools/agy-pool/test/pool.test.js`
- PowerShell parsing succeeds for both Agy pool launch scripts.
- `GET /api/state` reports four profiles without credential values.
- A POST without the action token returns `403`.
- A confirmed action launches only its selected profile.
- Documentation validation and formatting checks pass.

## Known limitations

- On Windows, the OS credential manager may still supply a shared host login ahead of profile-local token files. Presence is therefore evidence, not proof of account identity. The operator must verify the displayed Google account inside each Agy terminal.
- This Work Item opens pinned interactive workers. Automatic Work Item dispatch remains owned by the governed scheduler/controller and is not silently added here.
- Runtime state is local to the pool-manager process; restarting it does not claim that previously opened terminals are still alive.

## Verification evidence

- `node --test tools/agy-pool/test/pool.test.js`: 3 tests, 3 pass, 0 fail.
- `python docs/product-spec/scripts/validate_docs.py`: passed with 180 delivery rows and 982 unique identifiers.
- Prettier check over all changed JavaScript, HTML, PowerShell and Markdown files: passed.
- `git diff --check`: passed; line-ending warnings only.
- Live smoke test at `127.0.0.1:3344`: four profiles returned (`agy-1` through `agy-4`), no token-shaped fields returned, and an unauthenticated POST returned `403`.
- Visual browser QA: unavailable because no browser provider was available in the execution environment; the live pool remains available for operator inspection at `http://127.0.0.1:3344`.
