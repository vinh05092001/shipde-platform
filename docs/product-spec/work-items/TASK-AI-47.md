# TASK-AI-47 — Account failover controller

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-47` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `179` |
| Dependencies | `TASK-AI-28; TASK-AI-45` |
| Assigned author | `CODEX` by explicit human approval on 2026-09-23 |
| Risk | `HIGH` |
| Governed decision | `HUMAN-DECISION-ACCOUNT-FAILOVER-2026-09-23` / `DEC-018` |
| Branch | `feat/task-ai-47-account-failover-controller` |
| Allowed paths | `tools/account-failover/**`, this Work Item, `BASELINE-AND-DECISIONS.md`, `FEATURE-DELIVERY-REGISTER.csv` |

## Business outcome

The operator can send a prompt through one local controller that selects among
explicitly configured, user-owned Gemini or Antigravity accounts and performs
bounded failover on authentication, quota, server, network, timeout, or CLI
failure. No credential is stored or logged and no authentication or provider
control is bypassed.

## Rules

| ID | Rule |
|---|---|
| `AI-47-R01` | Only enabled, configured accounts outside cooldown are eligible; lower priority wins unless the configured strategy says otherwise. |
| `AI-47-R02` | 401/403 disables the account in runtime state until an explicit operator enable; 429 cools it and selects another account. |
| `AI-47-R03` | Network/timeout retries the same account at most once; every account is attempted at most once after that retry. |
| `AI-47-R04` | Secrets resolve only from a named environment reference and are never written to config, state, response, or log. |
| `AI-47-R05` | Antigravity executable paths and argument arrays are explicit. The controller invents no CLI flag. |
| `AI-47-R06` | A separate Windows user is invoked only through an existing Scheduled Task and request/response spool protocol; no interactive password or `runas` flow exists. |
| `AI-47-R07` | Optional HTTP binds to `127.0.0.1` only and is off by default. |
| `AI-47-R08` | A process/task timeout terminates or ends the launched unit and records a failover-safe error. |
| `AI-47-R09` | TASK-AI-45 remains a pinned interactive pool; this controller does not reinterpret its four profiles as isolated accounts. |

## Acceptance

- `python -m unittest discover -s tools/account-failover/test -v`
- `python -m py_compile tools/account-failover/controller.py`
- `python docs/product-spec/scripts/validate_docs.py`
- `git diff --check`
- Manual Windows acceptance must verify Scheduled Task identity/ACLs and the
  configured Antigravity executable's official `--help` output before enabling
  that account.

## Known limitations

- No Antigravity non-interactive command is asserted because none has been
  verified on this host for this Work Item. GUI-only operation needs a
  supported local API or a user-context helper implementing the spool contract.
- The loopback HTTP server has no authentication and must not be forwarded.
- Environment variables are supported directly. Windows Credential Manager is
  intentionally left to a trusted launcher rather than adding an unpinned
  dependency or printing credential-manager output.
- Task creation is an operator action because its logon mode, ACLs, executable,
  and user identity are machine-specific and security-sensitive.

## Verification evidence

- `python -m unittest discover -s tools/account-failover/test -v`: 9 tests,
  9 passed, 0 failed on Python 3.12.10. The implementation uses Python 3.11
  language/library features only.
- `python -m py_compile tools/account-failover/controller.py`: passed.
- `python tools/account-failover/controller.py --config tools/account-failover/accounts.json status`:
  exited 0 and returned an empty, valid controller state.
- `python docs/product-spec/scripts/validate_docs.py`: passed with 180 delivery
  rows and 982 unique identifiers.
- `git diff --check`: passed; only expected Windows line-ending notices.
- Live Gemini and Antigravity calls were not attempted because no credential,
  verified endpoint, executable path, CLI contract, or Scheduled Task was
  supplied. They remain explicit manual acceptance gates rather than simulated
  success.

## Review record

| Round | Commit | Verdict | Notes |
|---|---|---|---|
| 1 | `pending` | `pending` | Awaiting independent review. |
