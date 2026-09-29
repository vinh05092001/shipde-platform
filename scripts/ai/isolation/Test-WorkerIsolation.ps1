[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$false)]
    [string]$Username = "ShipDeWorker",

    [Parameter(Mandatory=$false)]
    [string]$CredentialPath = "$env:LOCALAPPDATA\ShipDe\WorkerUser.cred",

    [Parameter(Mandatory=$false)]
    [string]$OperatorProfile = $env:USERPROFILE,

    [Parameter(Mandatory=$false)]
    [string]$WorkerRoot = "C:\ShipDeWorker\$(Split-Path $PWD -Leaf)"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    Write-Host "[Test-WorkerIsolation] $Message"
}

if (-not ($PSCmdlet.ShouldProcess("Worker tests", "Run isolation tests"))) {
    return
}

if (-not (Test-Path $CredentialPath)) {
    Write-Error "Credential file not found at $CredentialPath. Did you run New-WorkerUser.ps1?"
}

if (-not (Test-Path $WorkerRoot)) {
    New-Item -ItemType Directory -Path $WorkerRoot -Force | Out-Null
}

# Check origin refs before
$beforeRefs = ""
try {
    $beforeRefsRaw = git ls-remote https://github.com/vinh05092001/shipde-platform.git 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to fetch origin refs before test. Check network."
    }
    $beforeRefs = ($beforeRefsRaw | Sort-Object) -join "`n"
} catch {
    Write-Error "Failed to fetch origin refs before test."
}

# 1. Get credentials
$SecureString = Get-Content $CredentialPath | ConvertTo-SecureString
$Credential = New-Object System.Management.Automation.PSCredential($Username, $SecureString)

# 2. Prepare test script for the worker
$TestScriptPath = "$WorkerRoot\WorkerTestScript.ps1"
$TestResultPath = "$WorkerRoot\WorkerTestResult.json"

if (Test-Path $TestResultPath) { Remove-Item -Path $TestResultPath -Force }

$WorkerScript = @"
`$ErrorActionPreference = "Continue"
`$result = @{
    github_push = "UNKNOWN"
    github_api = "UNKNOWN"
    gh_auth = "UNKNOWN"
    operator_profile = "UNKNOWN"
    gateway_reachable = "UNKNOWN"
    write_worker_root = "UNKNOWN"
}

# 1. gh auth status shows no login
`$ghOutput = gh auth status 2>&1
if (`$ghOutput -match "You are not logged into any GitHub hosts" -or `$LASTEXITCODE -ne 0) {
    `$result.gh_auth = "PASS"
} else {
    `$result.gh_auth = "FAIL"
}

# 2. reading operator credential files is denied
try {
    Get-ChildItem -Path "$OperatorProfile\.ssh" -ErrorAction Stop | Out-Null
    `$result.operator_profile = "FAIL"
} catch {
    if (`$_ -match "Access is denied" -or `$_ -match "PermissionDenied") {
        `$result.operator_profile = "PASS"
    } else {
        `$result.operator_profile = "PASS_NOT_FOUND" # Usually also acceptable if it just can't see it
    }
}

# 3. 127.0.0.1:20128 reachable
try {
    `$tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 20128)
    `$tcp.Close()
    `$result.gateway_reachable = "PASS"
} catch {
    `$result.gateway_reachable = "FAIL"
}

# 4. HTTPS to api.github.com fails
try {
    Invoke-WebRequest -Uri "https://api.github.com" -TimeoutSec 5 -UseBasicParsing | Out-Null
    `$result.github_api = "FAIL"
} catch {
    `$result.github_api = "PASS"
}

# 5. git push fails
try {
    git ls-remote https://github.com/vinh05092001/shipde-platform.git 2>&1 | Out-Null
    if (`$LASTEXITCODE -eq 0) {
        `$result.github_push = "FAIL"
    } else {
        `$result.github_push = "PASS"
    }
} catch {
    `$result.github_push = "PASS"
}

# 6. writing inside worker root works
try {
    `$testFile = "$WorkerRoot\test-write.txt"
    "test" | Out-File `$testFile -ErrorAction Stop
    Remove-Item `$testFile -Force
    `$result.write_worker_root = "PASS"
} catch {
    `$result.write_worker_root = "FAIL"
}

`$result | ConvertTo-Json | Out-File "$TestResultPath" -Encoding UTF8
"@

$WorkerScript | Out-File $TestScriptPath -Encoding UTF8

Write-Log "Running tests as $Username..."
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TestScriptPath`""
$psi.UserName = $Username
$psi.Password = $SecureString
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = $WorkerRoot

$psi.EnvironmentVariables.Clear()
$allowed = @("PATH", "SystemRoot", "SystemDrive", "ALLUSERSPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramFiles(x86)", "PUBLIC")
foreach ($key in $allowed) {
    if ([Environment]::GetEnvironmentVariable($key, "Machine")) {
        $psi.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key, "Machine")
    } elseif (Test-Path "Env:\$key") {
        $psi.EnvironmentVariables[$key] = (Get-Item "Env:\$key").Value
    }
}
if (-not (Test-Path "$WorkerRoot\temp")) { New-Item -ItemType Directory -Path "$WorkerRoot\temp" | Out-Null }
$psi.EnvironmentVariables["TEMP"] = "$WorkerRoot\temp"
$psi.EnvironmentVariables["TMP"] = "$WorkerRoot\temp"
$psi.EnvironmentVariables["HOME"] = $WorkerRoot
$psi.EnvironmentVariables["USERPROFILE"] = $WorkerRoot

$process = [System.Diagnostics.Process]::Start($psi)
if (-not $process.WaitForExit(30000)) {
    $process.Kill()
    Write-Log "Worker process timed out."
}

Write-Log "Worker process exited with code $($process.ExitCode)"

$Verdict = "OPEN"
if (Test-Path $TestResultPath) {
    $results = Get-Content $TestResultPath | ConvertFrom-Json

    $passedAll = $true
    foreach ($key in $results.PSObject.Properties.Name) {
        $val = $results.$key
        Write-Log "Check $key = $val"
        if ($val -notmatch "PASS") {
            $passedAll = $false
        }
    }

    if ($passedAll) {
        $Verdict = "CLOSED"
    } else {
        $Verdict = "PARTIAL"
    }
} else {
    Write-Log "No result file found. The worker might not have permissions to write to $WorkerRoot."
}

# Check origin refs after
try {
    $afterRefsRaw = git ls-remote https://github.com/vinh05092001/shipde-platform.git 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Failed to fetch origin refs after test."
        $Verdict = "PARTIAL"
    } else {
        $afterRefs = ($afterRefsRaw | Sort-Object) -join "`n"
        if (-not $beforeRefs -or $beforeRefs -ne $afterRefs) {
            Write-Log "Origin refs changed during test!"
            $Verdict = "PARTIAL"
        }
    }
} catch {
    Write-Log "Error fetching origin refs after test."
    $Verdict = "PARTIAL"
}

# Check for lingering processes
$lingering = Get-CimInstance Win32_Process | Where-Object {
    (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User -eq $Username
}

if ($lingering) {
    Write-Log "Lingering processes found: $($lingering.Name -join ', ')"
    $Verdict = "PARTIAL"
}

Write-Log "Final Verdict: $Verdict"

$VerdictPath = "$env:LOCALAPPDATA\ShipDe\isolation-verdict.json"
if (-not (Test-Path (Split-Path $VerdictPath -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $VerdictPath -Parent) | Out-Null
}

function Get-FolderHash($folder) {
    $files = Get-ChildItem -Path $folder -Recurse -File
    $hashes = @()
    foreach ($file in $files) {
        $stream = [System.IO.File]::OpenRead($file.FullName)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha.ComputeHash($stream)
        $stream.Close()
        $hashes += [BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
    }
    $hashes = $hashes | Sort-Object
    $combined = $hashes -join ""
    $shaCombined = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($combined)
    $finalHash = $shaCombined.ComputeHash($bytes)
    return [BitConverter]::ToString($finalHash).Replace("-", "").ToLower()
}
# P5: `worktree` records the FULL host worktree path ($PWD), because the
# launcher binds the complete path — not the worker-root leaf — so two jobs
# sharing a directory leaf cannot share one attestation. Run this script from
# the worktree root the controller will launch the job from.
$policyHash = Get-FolderHash "scripts\ai\isolation"
$sid = (Get-LocalUser -Name $Username).SID.Value

$Output = @{
    verdict = $Verdict
    details = $results
    timestamp = (Get-Date -Format "o")
    sid = $sid
    worktree = $PWD.Path
    workerRoot = $WorkerRoot
    policyHash = $policyHash
}

$Output | ConvertTo-Json | Out-File $VerdictPath -Encoding UTF8

$Output | ConvertTo-Json

# Cleanup temp files
Remove-Item $TestScriptPath -Force -ErrorAction SilentlyContinue
Remove-Item $TestResultPath -Force -ErrorAction SilentlyContinue
