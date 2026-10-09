[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$false)]
    [string]$Username = "ShipDeWorker",

    [Parameter(Mandatory=$false)]
    [string]$OperatorProfile = $env:USERPROFILE,

    [Parameter(Mandatory=$false)]
    [string]$WorkerRoot = "C:\ShipDeWorker",

    [Parameter(Mandatory=$false)]
    [string]$CredentialPath = "$env:LOCALAPPDATA\ShipDe\WorkerUser.cred"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    Write-Host "[Remove-WorkerIsolation] $Message"
}

$RulePrefix = "ShipDe-Worker-$Username"

# Get-RemainingDenyRdpTokens-begin (extraction contract for tools/ai-brain/test/isolation.test.js; keep in sync)
# secedit exports user rights as asterisk-prefixed SIDs (*S-1-5-...), so the
# revert matches by SID (and name) with the '*' stripped, case-insensitively.
function Get-RemainingDenyRdpTokens {
    param([string]$ExistingValue, [string]$Sid, [string]$Username)
    $kept = @()
    foreach ($rawToken in ($ExistingValue -split ',')) {
        $token = $rawToken.Trim().TrimStart('*')
        if ($Sid -and $token -ieq $Sid) { continue }
        if ($token -ieq $Username) { continue }
        if ($rawToken.Trim() -ne "") { $kept += $rawToken.Trim() }
    }
    return ,$kept
}
# Get-RemainingDenyRdpTokens-end

# Resolve the worker SID up front. The persisted .sid file is authoritative
# (it survives user deletion, so orphaned-SID Deny ACEs can still be matched);
# the live user is only a fallback.
$User = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
$SidStr = $null
if (Test-Path "$CredentialPath.sid") {
    $SidStr = (Get-Content "$CredentialPath.sid" -Raw).Trim()
}
if (-not $SidStr -and $User) {
    $SidStr = $User.SID.Value
}
if (-not $SidStr) {
    Write-Log "WARNING: no SID available (user gone and no .sid file). ACL and secedit cleanup may be incomplete."
}

# 1. Kill worker processes first
Write-Log "Killing processes owned by $Username..."
if ($PSCmdlet.ShouldProcess("Processes", "Kill all processes for $Username")) {
    Get-CimInstance Win32_Process | Where-Object {
        (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User -eq $Username
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Log "Worker processes killed."
}

# 2. Remove Firewall Rules
Write-Log "Removing Firewall rules with prefix '$RulePrefix'..."
if ($PSCmdlet.ShouldProcess("Firewall", "Remove rules")) {
    Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Log "Firewall rules removed."
}

# 3. Revert ACLs on Operator Profile
Write-Log "Removing Deny rules on Operator Profile: $OperatorProfile"
if ($PSCmdlet.ShouldProcess($OperatorProfile, "Remove Deny Read/Write for $Username")) {
    $acl = Get-Acl $OperatorProfile
    # Match by SID (orphaned ACEs keep the raw SID after user deletion) with
    # the Deny filter applied to every branch of the match.
    $rules = $acl.Access | Where-Object {
        (
            ($SidStr -and $_.IdentityReference.Value -match [regex]::Escape($SidStr)) -or
            ($_.IdentityReference.Value -match [regex]::Escape($Username))
        ) -and $_.AccessControlType -eq "Deny"
    }
    foreach ($rule in $rules) {
        $acl.RemoveAccessRule($rule) | Out-Null
    }
    Set-Acl -Path $OperatorProfile -AclObject $acl
    Write-Log "Deny rules removed from $OperatorProfile"
}

# 4. Remove Worker Root
Write-Log "Removing Worker Root: $WorkerRoot"
if ($PSCmdlet.ShouldProcess($WorkerRoot, "Remove directory forcefully")) {
    if (Test-Path $WorkerRoot) {
        Remove-Item -Path $WorkerRoot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "Worker root removed."
    }
}

# 5. Remove Credential file and secedit right
Write-Log "Removing DPAPI credential file at $CredentialPath..."
if ($PSCmdlet.ShouldProcess($CredentialPath, "Remove file and revert secedit")) {
    if (Test-Path $CredentialPath) {
        Remove-Item -Path $CredentialPath -Force
        Write-Log "Credential file removed."
    }

    # Revert SeDenyRemoteInteractiveLogonRight via secedit. The exported value
    # lists asterisk-prefixed SIDs, so tokens are filtered by SID (and name)
    # with the '*' stripped. When no token remains, the right is written with
    # an EMPTY value — dropping the line would leave the policy untouched, and
    # an unverified revert must fail closed, not silently no-op.
    $exportPath = "$env:TEMP\sec.inf"
    secedit /export /cfg $exportPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "secedit /export failed (exit $LASTEXITCODE); refusing to revert blindly"
    }
    $lines = Get-Content $exportPath
    $newLines = @()
    foreach ($line in $lines) {
        if ($line -match "^SeDenyRemoteInteractiveLogonRight\s*=\s*(.*)") {
            $parts = Get-RemainingDenyRdpTokens -ExistingValue $matches[1] -Sid $SidStr -Username $Username
            if ($parts.Count -gt 0) {
                $line = "SeDenyRemoteInteractiveLogonRight = " + ($parts -join ',')
            } else {
                $line = "SeDenyRemoteInteractiveLogonRight = "
            }
        }
        $newLines += $line
    }
    $newLines | Out-File $exportPath -Encoding ascii
    secedit /configure /db "$env:TEMP\sec.sdb" /cfg $exportPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "secedit /configure failed (exit $LASTEXITCODE); deny-logon right may still be present"
    }

    if (Test-Path "$CredentialPath.sid") {
        Remove-Item -Path "$CredentialPath.sid" -Force
    }
}

# 6. Remove Verdict file
$VerdictPath = "$env:LOCALAPPDATA\ShipDe\isolation-verdict.json"
if ($PSCmdlet.ShouldProcess($VerdictPath, "Remove file")) {
    if (Test-Path $VerdictPath) {
        Remove-Item -Path $VerdictPath -Force
        Write-Log "Verdict file removed."
    }
}

# 7. Remove User and Profile
Write-Log "Removing local user '$Username'..."
if ($PSCmdlet.ShouldProcess($Username, "Remove local user")) {
    $User = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
    if ($User) {
        Remove-LocalUser -Name $Username
        Write-Log "User $Username removed."
    } else {
        Write-Log "User $Username already removed."
    }
    # Remove profile
    Get-CimInstance Win32_UserProfile | Where-Object LocalPath -match $Username | Remove-CimInstance -ErrorAction SilentlyContinue
}

Write-Log "Done."
