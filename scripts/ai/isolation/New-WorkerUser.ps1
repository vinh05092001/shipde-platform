[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$false)]
    [string]$Username = "ShipDeWorker",

    [Parameter(Mandatory=$false)]
    [string]$CredentialPath = "$env:LOCALAPPDATA\ShipDe\WorkerUser.cred"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    Write-Host "[New-WorkerUser] $Message"
}

# Test-HasDenyRdpToken-begin (extraction contract for tools/ai-brain/test/isolation.test.js; keep in sync)
# secedit exports user rights as asterisk-prefixed SIDs (*S-1-5-...), so token
# matching strips the '*' and compares by SID (and name) case-insensitively.
function Test-HasDenyRdpToken {
    param([string]$ExistingValue, [string]$Sid, [string]$Username)
    foreach ($rawToken in ($ExistingValue -split ',')) {
        $token = $rawToken.Trim().TrimStart('*')
        if ($token -ieq $Sid -or $token -ieq $Username) {
            return $true
        }
    }
    return $false
}
# Test-HasDenyRdpToken-end

# Get-UpdatedDenyRdpValue-begin (extraction contract for tools/ai-brain/test/isolation.test.js; keep in sync)
# Q2: appends the worker SID without producing a leading comma when the
# exported right is present but EMPTY (the naive "$existing,*$Sid" form yields
# a leading comma that secedit may reject or misapply). Returns $null when
# the SID is already present so the caller can skip secedit /configure.
function Get-UpdatedDenyRdpValue {
    param([string]$ExistingValue, [string]$Sid, [string]$Username)
    if (Test-HasDenyRdpToken -ExistingValue $ExistingValue -Sid $Sid -Username $Username) {
        return $null
    }
    if ($ExistingValue) {
        return "$ExistingValue,*$Sid"
    }
    return "*$Sid"
}
# Get-UpdatedDenyRdpValue-end

$User = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
$UserSid = $null

if ($User) {
    Write-Log "User '$Username' already exists."
    $UserSid = $User.SID.Value
    if (-not (Test-Path $CredentialPath)) {
        Write-Log "Credential file not found at $CredentialPath. Generating new password."
        if ($PSCmdlet.ShouldProcess($Username, "Set new password and save to DPAPI file")) {
            $bytes = New-Object Byte[] 32
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            $rng.GetBytes($bytes)
            $rawPass = [Convert]::ToBase64String($bytes) + "Aa1!"
            $SecureString = ConvertTo-SecureString -String $rawPass -AsPlainText -Force
            Set-LocalUser -Name $Username -Password $SecureString
            $dir = Split-Path $CredentialPath -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
            $SecureString | ConvertFrom-SecureString | Out-File $CredentialPath
            $UserSid | Out-File "$CredentialPath.sid" -Force
            Write-Log "Password updated and saved to $CredentialPath"
        }
    }
} else {
    Write-Log "Creating user '$Username'..."
    if ($PSCmdlet.ShouldProcess($Username, "Create local standard user and save DPAPI password")) {
        $bytes = New-Object Byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $rawPass = [Convert]::ToBase64String($bytes) + "Aa1!"
        $SecureString = ConvertTo-SecureString -String $rawPass -AsPlainText -Force

        New-LocalUser -Name $Username -Password $SecureString -FullName "Ship De Worker" -Description "Isolated worker for Ship De AI" -AccountNeverExpires

        $CreatedUser = Get-LocalUser -Name $Username
        $UserSid = $CreatedUser.SID.Value

        $dir = Split-Path $CredentialPath -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        $SecureString | ConvertFrom-SecureString | Out-File $CredentialPath
        $UserSid | Out-File "$CredentialPath.sid" -Force
        Write-Log "User created and password saved to $CredentialPath"
    }
}

# Q1: the SeDenyRemoteInteractiveLogonRight ensure is hoisted OUT of the
# user-existence branches so it runs on EVERY invocation, including when the
# user already exists. Without this, two realistic recovery paths silently
# produced a worker WITHOUT the deny-RDP right: (a) re-running after a first
# provisioning whose secedit /configure failed (user exists, right absent),
# and (b) partial teardown that cleared the right but left the user. The
# ensure is idempotent (Test-HasDenyRdpToken by SID); when the token is
# already present secedit /configure is skipped entirely; every secedit
# failure fails closed. The right is recorded as the asterisk-prefixed SID
# (the form secedit itself exports) so re-provisioning and teardown both
# match by SID instead of by name.
if ($UserSid) {
    if ($PSCmdlet.ShouldProcess($Username, "Ensure SeDenyRemoteInteractiveLogonRight via secedit")) {
        $exportPath = "$env:TEMP\sec.inf"
        secedit /export /cfg $exportPath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "secedit /export failed (exit $LASTEXITCODE); refusing to continue"
        }
        $lines = Get-Content $exportPath
        $newLines = @()
        $sawRight = $false
        $needsUpdate = $false
        foreach ($line in $lines) {
            if ($line -match "^SeDenyRemoteInteractiveLogonRight\s*=\s*(.*)") {
                $sawRight = $true
                $updatedValue = Get-UpdatedDenyRdpValue -ExistingValue $matches[1] -Sid $UserSid -Username $Username
                if ($null -ne $updatedValue) {
                    $needsUpdate = $true
                    $line = "SeDenyRemoteInteractiveLogonRight = $updatedValue"
                }
            }
            $newLines += $line
        }
        if (-not $sawRight) {
            $insertIdx = $newLines.IndexOf("[Privilege Rights]")
            if ($insertIdx -ge 0) {
                $newLines = $newLines[0..$insertIdx] + "SeDenyRemoteInteractiveLogonRight = *$UserSid" + $newLines[($insertIdx+1)..($newLines.Count-1)]
                $needsUpdate = $true
            } else {
                Write-Error "secedit export has no [Privilege Rights] section; refusing to continue"
            }
        }
        if ($needsUpdate) {
            $newLines | Out-File $exportPath -Encoding ascii
            secedit /configure /db "$env:TEMP\sec.sdb" /cfg $exportPath /areas USER_RIGHTS | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Error "secedit /configure failed (exit $LASTEXITCODE); deny-logon right NOT applied"
            }
            Write-Log "SeDenyRemoteInteractiveLogonRight ensured for $Username ($UserSid)."
        } else {
            Write-Log "SeDenyRemoteInteractiveLogonRight already present for $Username; no secedit change needed."
        }
    }
}


Write-Log "Done."
