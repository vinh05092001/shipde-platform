# AccountFailoverController

Windows-first, bounded failover across accounts that the operator owns. The
controller does not bypass authentication, impersonate devices, copy cookies,
or attempt to evade provider controls. A quota refusal only moves work to a
separately configured, valid account.

## Architecture

`controller.py` contains four layers: configuration/secret resolution,
strategy-based selection, HTTP/process/Scheduled Task adapters, and atomic
state plus redacted logging. The optional HTTP surface binds to loopback only.

The checked-in `accounts.json` is intentionally empty. Copy
`accounts.example.json` to a machine-local `accounts.json` and replace every
`REPLACE_...` value. The local file is ignored by Git.

## Install and run

Requires Python 3.11 or later and has no package dependency:

```powershell
cd tools\account-failover
Copy-Item accounts.example.json accounts.json
python controller.py --config accounts.json status
$env:GEMINI_KEY_1 = '<load from your approved secret store>'
python controller.py --config accounts.json run --prompt 'Hello'
```

Never save a real secret assignment in source control or shell history.
`credential_ref` is an environment-variable name, not a credential. A trusted
launcher may read Windows Credential Manager and inject a value into the child
environment; this controller never shells out to print stored credentials.

```powershell
python controller.py --config accounts.json list-accounts
python controller.py --config accounts.json accounts list
python controller.py --config accounts.json accounts enable --name gemini-01
python controller.py --config accounts.json accounts disable --name gemini-01
python controller.py --config accounts.json switch-account --name gemini-01
python controller.py --config accounts.json enable-account --name gemini-01
python controller.py --config accounts.json disable-account --name gemini-01
python controller.py --config accounts.json reset-state
python controller.py --config accounts.json serve --port 8765
```

The server exposes `POST /generate`, `GET /status`, and
`POST /accounts/{name}/enable|disable`. It has no authentication; do not expose
it through port forwarding or a public reverse proxy.

## HTTP accounts

Configure an explicit `metadata.endpoint`; no model or URL is guessed.
`gemini_generate_content` sends `contents[].parts[].text` plus optional
`generationConfig`. `prompt` sends `{ "prompt": ..., "options": ... }` for a
local proxy. API keys default to `x-goog-api-key`; OAuth tokens use Bearer auth.

## Antigravity and current-user profiles

`antigravity_profile` requires `executable_path` and an argument-array
`args_template`. First inspect the configured binary:

```powershell
& 'C:\the\configured\path\agy.exe' --help
```

Copy only documented non-interactive arguments. Supported placeholders are
`{prompt}`, `{profile_path}`, and `{options_json}`. No shell is used. A GUI-only
app has no reliable prompt/result protocol; use a supported local API or a
background helper instead.

## Separate Windows users

`windows_user` never accepts a password and never invokes interactive `runas`.
Create a Scheduled Task under the correct local user using the secure logon
mode and ACLs appropriate to the machine. Its background helper must:

1. read `task_request_path` containing `request_id`, `prompt`, `options`, and
   `created_at`;
2. call only the installed, documented Antigravity interface;
3. atomically write `task_response_path` with either
   `{ "request_id": "...", "ok": true, "result": "..." }` or
   `{ "request_id": "...", "ok": false, "error_type": "quota",
   "status_code": 429, "error": "..." }`;
4. exit.

The controller verifies and starts the task, waits with a timeout, then calls
`schtasks /End` if it hangs. Do not share credential files between Windows
users. Prior host evidence showed that changing profile environment variables
alone did not prove Agy credential isolation; separate users plus a task/helper
or supported local API is the safe boundary. GUI login still needs visible
operator verification.

## Failure behavior

- 401/403: mark credential review required until explicit enable.
- 429/`RESOURCE_EXHAUSTED`: cooldown and select another account.
- 500/503 or non-zero process exit: cooldown and select another account.
- Network/timeout: retry once on the same account, then fail over.
- No account: exit code 2 with an actionable error.

Logs go to stderr and `logs/controller.log`; atomic state goes to `state.json`.
Resolved credentials are written to neither.

## Test

```powershell
python -m unittest discover -s test -v
python -m py_compile controller.py
```

Manual Windows acceptance must also verify task ACLs, timeout termination,
visible account identity, and the installed CLI's documented behavior.

## Ship De Windows Agy pool bridge

The machine-local `agy01` through `agy10` pool uses the existing
`\ShipDe\ShipDe-agyNN` Scheduled Tasks without changing their principals or
stored logon credentials. Install `windows-pool-dispatcher.ps1` as
`C:\Tools\agy-pool\worker.ps1`, preserve the previous worker as
`worker-core.ps1`, and install `windows-pool-worker.ps1` beside them.

The dispatcher keeps dashboard quota jobs on `worker-core.ps1`. Controller
requests use `controller-request.json` and atomically publish
`controller-response.json`. Real identities and `accounts.json` remain
machine-local and ignored; never commit Gmail addresses or credential data.
