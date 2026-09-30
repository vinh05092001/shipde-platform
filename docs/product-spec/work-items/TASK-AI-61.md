# TASK-AI-61 - Implement OS-level isolation for live E2E worker

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-61` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `191` |
| Dependencies | `TASK-AI-59` |
| Assigned author | `Gemini` |
| Risk | `HIGH` |
| Allowed paths | `scripts/ai/isolation/*`, `tools/ai-brain/*`, `docs/product-spec/work-items/TASK-AI-61.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex - fresh independent task` |
| Branch | `feat/task-ai-61-worker-user-isolation` |
| Pull Request | `N/A` |

## Business outcome

Implement the chosen Option A + D isolation from TASK-AI-59: a dedicated local Windows user, ACL boundary, outbound network deny by user, and a separate publisher script. This enforces the `CLOSED` live E2E requirement without container overhead, ensuring a compromised or escaping worker cannot read the operator profile, reach GitHub, or push commits.

## Source references

- `TASK-AI-59.md` (Threat model and isolation design)

## Author boundary

The agent wrote the PowerShell scripts and Node integration but executed no admin commands. All setup and rollback must be run by the operator.

## Implementation details

1. **PowerShell Provisioning Scripts (`scripts/ai/isolation/*.ps1`)**:
   - `New-WorkerUser.ps1`: Creates a local non-admin user (`ShipDeWorker`) and securely stores a DPAPI-protected password for the operator.
   - `Set-WorkerAcl.ps1`: Restricts access by explicitly denying the worker read access to the operator's profile while granting it modify rights to its own workspace.
   - `Set-WorkerFirewall.ps1`: Implements default-deny for the worker user using WFP/New-NetFirewallRule `-LocalUser` mapping. It allows `127.0.0.1:20128` (model gateway) and named model endpoints, explicitly blocking GitHub IPs.
   - `Remove-WorkerIsolation.ps1`: Safe rollback deleting the user, ACLs, firewall rules, and lingering processes.
   - `Test-WorkerIsolation.ps1`: An automated verification script invoked by the host as the worker, producing a JSON verdict of `CLOSED`, `PARTIAL`, or `OPEN`.

2. **Controller Integration (`tools/ai-brain`)**:
   - The CLI includes an `--isolated-worker` flag.
   - `isolation-launcher.js` intercepts process spawning. It reads the test verdict and refuses to launch if it's missing, stale, or not `CLOSED`.
   - The launcher prepares a temporary runner script and spawns the worker using PowerShell with the DPAPI credential, correctly injecting environment variables (`HOME`, `GH_CONFIG_DIR`, etc.) to point into the isolated boundary.

3. **Publisher (`tools/ai-brain/publisher.js`)**:
   - A standalone Node module that accepts a reviewed SHA, approval ID, expiry, verdict, and the push destination (`remoteUrl`, `branch`).
   - The push destination comes ONLY from trusted controller input (the options the operator/controller passes, backed by the operator-side approval registry). The publisher never reads `remote.origin.url`, `.git/config`, or any other file inside the worker-writable tree, so a worker that rewrites its own git config cannot redirect the push.
   - The only missing-registry fallback is an explicit injected `testMode` option used exclusively by tests; there is no argv or environment heuristic.
   - Acts as the true external writer.

## OPERATOR RUNBOOK

These commands must be run in an elevated PowerShell session (Run as Administrator) to provision the isolated environment on the host.

### 1. Provision the worker user

```powershell
# Creates the user and saves the DPAPI password
.\scripts\ai\isolation\New-WorkerUser.ps1
```
*Expected output*: `[New-WorkerUser] User created and password saved to ...`

### 2. Apply ACL boundaries

```powershell
# Denies access to your real profile, grants access to C:\ShipDeWorker
.\scripts\ai\isolation\Set-WorkerAcl.ps1
```
*Expected output*: `[Set-WorkerAcl] Applied Deny rule on ... \ Applied Modify rule on ...`

### 3. Apply Firewall rules

```powershell
# Blocks outbound traffic for the worker user, allows gateway and explicitly blocks GitHub
.\scripts\ai\isolation\Set-WorkerFirewall.ps1
```
*Expected output*: Log entries showing created block and allow rules.

> **Fix note (2026-09)**: `New-NetFirewallRule -LocalUser` requires an SDDL string, not a bare SID — the original script failed with `HRESULT 0x80070057` at rule creation. The script now builds `$LocalUserSddl = "D:(A;;CC;;;$Sid)"` once and passes it to every `-LocalUser`; it fails closed (no username fallback) when the worker user does not exist, removes any leftover `ShipDe-Worker-<user>-*` rules before creating (idempotent re-run), and the launcher's boundary verifier now also checks each rule's SDDL scope via `Get-NetFirewallSecurityFilter`.
>
> **Fix note (2026-09-29, TASK-AI-61 boundary verification)**: `Get-NetFirewallRule` and `Get-NetFirewallSecurityFilter` (CIM cmdlets) return nothing when run non-elevated, causing `ISOLATION_BOUNDARY_MISSING` false negatives on operator hosts. The boundary verifier now reads rules non-elevated from the registry at `HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules` where each rule value contains `LUAuth=SDDL`. It verifies: (1) all three firewall profiles have `EnableFirewall=1` (fail closed with `FW_OFF` if any profile is off); (2) every expected `ShipDe-Worker-<user>-*` rule is present by parsing each registry value on `|` into `key=value` fields and comparing exactly — `Name`, `Active=TRUE`, `Dir=Out`, `Action=Block`, `Protocol` equal to 6/17/1/58 for TCP/UDP/ICMPv4/ICMPv6 (not a substring, so `Protocol=17` does not satisfy ICMPv4 and `Protocol=60` does not satisfy TCP), and `LUAuth` exactly matching `D:(A;;CC;;;` + worker SID + `)`; a Name that merely contains the expected name does not match; (3) operator profile has a Deny ACE for the worker SID. Any parse failure, missing field, or profile-off = boundary missing (fail closed). Tests use captured registry-string fixtures for English locale.

### 4. Verify Isolation

Run this from the worktree root the controller will launch jobs from — the verdict records the full worktree path and the launcher binds it, so two jobs sharing a directory leaf cannot share one attestation.

```powershell
# Tests git push, gh auth, credential reading, and network from inside the worker boundary
.\scripts\ai\isolation\Test-WorkerIsolation.ps1
```
*Expected output*: `[Test-WorkerIsolation] Final Verdict: CLOSED`

Notes:
- Interactive logon for `ShipDeWorker` is intentionally retained: the spawn mechanism (CreateProcessWithLogonW) requires it; remote/RDP logon is denied via `SeDenyRemoteInteractiveLogonRight`.
- The worker process wait is bounded (default 30 minutes, override with `workerTimeoutMs`); a hung worker is killed, not waited on forever.
- Isolation stays PARTIAL until an administrator applies this runbook on the host; code changes alone never make it CLOSED.
- **Fix note (2026-09)**: `GetOwner` call tolerates processes that vanish between enumeration and invocation (HRESULT 0x80041002) — each process lookup is wrapped in try/catch with `-ErrorAction Stop`, skipped on failure, and lookup failure never counts as isolation evidence; if the owner of a still-running process cannot be determined, the check fails closed for that process.
- **Fix note (2026-09-30, live E2E attempt 2)**: the attempt passed every launcher gate (verdict `CLOSED`, non-stale, worktree path bound) and then failed to start the worker, because the generated host script — the `ProcessStartInfo` block outside the nested here-string, so the escaping was not needed there — carried backtick-escaped `` `$false ``/`` `$true `` for `UseShellExecute`, `CreateNoWindow`, `RedirectStandardOutput` and `RedirectStandardError`. The literal backticks made the emitted script fail to parse, so the worker process was never started. The launcher now writes real `$false`/`$true`; a test parses the generated script with the PowerShell AST parser and fails if any escaped boolean survives.

### Rollback (if needed)

```powershell
# Reverts all ACLs, firewall rules, and deletes the worker user
.\scripts\ai\isolation\Remove-WorkerIsolation.ps1
```
*Expected output*: Scripts confirms removal of rules, ACLs, and user.
