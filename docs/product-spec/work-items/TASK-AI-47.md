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
| Pull Request | `#133` |
| Allowed paths | `tools/account-failover/**`, this Work Item, `BASELINE-AND-DECISIONS.md`, `FEATURE-DELIVERY-REGISTER.csv` |

## Business outcome

The operator can send a prompt through one local controller that selects among
explicitly configured, user-owned Gemini or Antigravity accounts and performs
bounded failover on authentication, quota, server, network, timeout, or CLI
failure. No credential is stored or logged and no authentication or provider
control is bypassed.

Each account carries two quota groups (`gemini` and `external`). The controller
exhausts all groups on the current account before moving to the next account,
so that the external group's allowance is not wasted when only the gemini
group is spent.

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
| `AI-47-R10` | Each account has an ordered list of quota groups. The controller exhausts all groups on the current account (inner loop) before advancing to the next account (outer loop). An account is only left behind when all of its groups are on cooldown or disabled. |
| `AI-47-R11` | Cooldown from a quota refusal (429 / `RESOURCE_EXHAUSTED`) applies to the specific group, not the whole account. Authentication errors (401/403) still disable the entire account. |
| `AI-47-R12` | The order of quota groups and models within each group is configured in `accounts.json` as the `quota_groups` array on each account. Adding a model or group requires only a config entry, never a code branch. |
| `AI-47-R13` | Every rotation decision is logged with account, group, model, and action. A rotation that cannot be reconstructed from logs is a rotation that cannot be debugged. |

## Design decisions

### Q1. What counts as "exhausted" for a group

A group is considered exhausted when a runtime refusal is received — any
response classified as `"quota"` by `classify_http` or the CLI exit-code
classifier (429, `RESOURCE_EXHAUSTED`, `QUOTA`, `RATE LIMIT`). This puts the
group on cooldown for the configured `cooldown_seconds`.

The `agy -p /quota --output-format json` endpoint returns per-group
`remaining_fraction` at zero token cost. This is a valuable proactive check,
but it is Antigravity-specific (raw `api_key` accounts have no equivalent)
and adds latency to every request. It is **not** implemented in this change.

**QUESTION FOR HUMAN**: Should a pre-flight quota check be added for
`antigravity_profile` and `windows_user` account types? This would avoid
wasting a call when the group is known-empty, at the cost of one extra CLI
invocation (zero tokens but ~1–2s latency) before each request.

### Q2. Which model inside a group to pick

The first model in the configured `models` array of the active group is used.
The controller does not currently select among models within a group — it uses
the first one as the representative.

A model-level refusal is treated as a **group-level exhaustion**. Justification:
the quota signal (429 / `RESOURCE_EXHAUSTED`) from providers applies to the
entire quota group, not individual models. A refusal on `gemini-3.1-pro-high`
means the "Gemini Models" quota bucket is spent — trying `gemini-3.8-flash-high`
from the same bucket will get the same refusal.

**QUESTION FOR HUMAN**: If a future provider separates model-level rate limits
from group-level quotas, should the controller attempt other models in the same
group before declaring it exhausted? This would require distinguishing
model-specific rate limits from group-level quotas in the error classification.

### Q3. What the cooldown applies to

- **Quota refusal (429)**: cooldown applies to the **group** on the specific
  account. Other groups on the same account remain available.
- **Authentication error (401/403)**: disables the **entire account**. The
  credential is shared across groups; a credential problem affects everything.
- **Network/timeout**: retries once on the same group, then moves to the next
  group. No cooldown is applied to the group; the problem is transient.
- **Server error (500/503)**: cooldown applies to the **group** (same as quota).

Legacy accounts without `quota_groups` use the original account-level cooldown.

### Q4. Where the order of groups and models is configured

In `accounts.json` (and `accounts.example.json`) as the `quota_groups` array
on each account entry:

```json
"quota_groups": [
  {
    "name": "gemini",
    "models": ["gemini-3.1-pro-high", "gemini-3.8-flash-high", ...],
    "cooldown_seconds": 300
  },
  {
    "name": "external",
    "models": ["claude-opus-4-6-thinking", "claude-sonnet-4-6", "gpt-oss-120b-medium"],
    "cooldown_seconds": 300
  }
]
```

The array order determines iteration order: gemini first, then external.
Adding a model requires adding a string to the `models` array. Adding a new
quota group requires adding an object to `quota_groups`. No code change is
needed in either case.

## Acceptance

- `python -m unittest discover -s tools/account-failover/test -v`
- `python -m py_compile tools/account-failover/controller.py`
- `python docs/product-spec/scripts/validate_docs.py`
- `git diff --check`
- Manual Windows acceptance must verify Scheduled Task identity/ACLs and the
  configured Antigravity executable's official `--help` output before enabling
  that account.

### Acceptance matrix — group rotation

| # | Scenario | Expected | Covered by |
|---|----------|----------|------------|
| 1 | Gemini group quota exhausted on account A | Try external group on account A (same account) | `test_exhausts_gemini_then_external_before_next_account` |
| 2 | Both groups exhausted on account A | Move to account B | `test_moves_to_next_account_only_when_all_groups_spent` |
| 3 | Quota cooldown targets group, not account | Group on cooldown, account itself not | `test_group_cooldown_is_per_group` |
| 4 | Auth error on any group | Disables the whole account | `test_auth_error_in_group_disables_account` |
| 5 | Network error within a group | Retries once, then tries next group | `test_network_retries_once_within_group` |
| 6 | Legacy account (no quota_groups) | Single-level failover unchanged | `test_legacy_account_works_unchanged` |
| 7 | All groups on all accounts exhausted | `NoAccountAvailable` raised | `test_all_groups_all_accounts_spent_raises` |
| 8 | Config validation of quota_groups | Rejects empty/malformed groups | `test_validates_quota_groups_structure` |
| 9 | Result traceability | Result includes group and model | `test_result_includes_group_and_model` |
| 10 | Health check with groups | Shows per-group cooldown state | `test_health_check_includes_group_status` |
| 11 | Mixed group + legacy accounts | Both types work in the same config | `test_mixed_group_and_legacy_accounts` |

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
- The controller selects the first model in each group's `models` array. It
  does not yet pass the model name to the underlying send mechanism
  (`_send_with`); the caller (e.g., `worker-core.ps1`) is responsible for
  including the model in the dispatch. This is sufficient because the group
  cooldown is the actionable signal, but passing the model through would
  enable the controller to set `--model` on the CLI invocation automatically.
- Pre-flight quota check via `agy -p /quota` is not implemented. See Q1 above.

## Verification evidence

- `python -m unittest discover -s tools/account-failover/test -v`: 20 tests,
  20 passed, 0 failed on Python 3.13.12. The implementation uses Python 3.11
  language/library features only.
- `python -m py_compile tools/account-failover/controller.py`: passed.
- `python docs/product-spec/scripts/validate_docs.py`: see report.
- `git diff --check`: see report.
- Live Gemini and Antigravity calls were not attempted because no credential,
  verified endpoint, executable path, CLI contract, or Scheduled Task was
  supplied. They remain explicit manual acceptance gates rather than simulated
  success.

## Review record

| Round | Commit | Verdict | Notes |
|---|---|---|---|
| 1 | `pending` | `pending` | PR #133 awaiting independent review. |
