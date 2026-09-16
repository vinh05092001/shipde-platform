param(
    [string]$AiRoot = $(
        $userHome = if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $env:USERPROFILE } elseif (-not [string]::IsNullOrWhiteSpace($env:HOME)) { $env:HOME } else { [System.IO.Path]::GetTempPath() }
        Join-Path $userHome "AI"
    ),
    [string]$AoExecutable = "",
    [string]$ProfilePath = $(
        $userHome = if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $env:USERPROFILE } elseif (-not [string]::IsNullOrWhiteSpace($env:HOME)) { $env:HOME } else { [System.IO.Path]::GetTempPath() }
        Join-Path $userHome ".claude"
    ),
    [int]$NineRouterPort = 20128,
    [string]$ExpectedAoVersion = "",
    [int]$StartupTimeoutSeconds = 30,
    [switch]$Restart,
    [scriptblock]$ProcessStarter = $null,
    [scriptblock]$StatusProbe = $null,
    [scriptblock]$EndpointTester = $null,
    [scriptblock]$VersionProbe = $null,
    [scriptblock]$ExistingProcessResolver = $null
)

. (Join-Path $PSScriptRoot "common.ps1")
$routerProcess = $null
$aoProcess = $null
$aoIdentity = $null
$temporaryPath = $null

$canonicalAoVersion = Get-ShipDePinnedAoVersion
if (-not [string]::IsNullOrWhiteSpace($ExpectedAoVersion) -and $ExpectedAoVersion -ne $canonicalAoVersion) {
    throw "Caller-supplied ExpectedAoVersion '$ExpectedAoVersion' contradicts canonical manifest pin '$canonicalAoVersion'. Bypassing the ecosystem manifest is prohibited."
}
$ExpectedAoVersion = $canonicalAoVersion

$profilePath = $ProfilePath
$settingsPath = Join-Path $profilePath "settings.json"
$handoffRoot = Join-Path $AiRoot "handoff"
$runtimePath = Join-Path $handoffRoot "ao-router-runtime.json"

if (-not (Test-Path $settingsPath)) {
    throw "9Router Claude profile is missing: $settingsPath"
}
$aoExecutablePath = if ([string]::IsNullOrWhiteSpace($AoExecutable)) {
    Resolve-ShipDeAoExecutable
} else {
    if (-not (Test-Path -LiteralPath $AoExecutable -PathType Leaf)) {
        throw "Agent Orchestrator executable is missing: $AoExecutable"
    }
    (Get-Item -LiteralPath $AoExecutable).FullName
}
$aoVersionProbe = if ($null -ne $VersionProbe) {
    & $VersionProbe $aoExecutablePath
} else {
    Get-ShipDeAoVersionProbe -AoExecutable $aoExecutablePath
}
$aoVersionEvidence = Assert-ShipDeAoVersionEvidence `
    -AoExecutable $aoExecutablePath `
    -ExpectedVersion $ExpectedAoVersion `
    -VersionText $aoVersionProbe.Text `
    -VersionExitCode $aoVersionProbe.ExitCode

try {
    $config = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    throw "9Router Claude profile contains invalid JSON: $settingsPath"
}

$baseUrl = [string]$config.env.ANTHROPIC_BASE_URL
$uri = $null
if (
    [string]::IsNullOrWhiteSpace($baseUrl) -or
    -not [Uri]::TryCreate($baseUrl, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne "http" -or
    $uri.Host -notin @("localhost", "127.0.0.1") -or
    $uri.Port -ne $NineRouterPort -or
    $uri.AbsolutePath.TrimEnd('/') -ne "/v1" -or
    -not [string]::IsNullOrWhiteSpace($uri.Query) -or
    -not [string]::IsNullOrWhiteSpace($uri.Fragment) -or
    -not [string]::IsNullOrWhiteSpace($uri.UserInfo)
) {
    throw "The .claude profile must route to http://localhost:$NineRouterPort/v1."
}

function Test-NineRouterEndpoint {
    if ($null -ne $EndpointTester) {
        return (& $EndpointTester)
    }
    if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $NineRouterPort)) {
        return $false
    }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$NineRouterPort/api/health" -Method Get -TimeoutSec 5
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$NineRouterPort/api/version" -Method Get -TimeoutSec 6
        return (
            $health.ok -eq $true -and
            [string]$version.currentVersion -eq "0.5.55"
        )
    } catch {
        return $false
    }
}

function Stop-StartedRouterProcess {
    param([AllowNull()][object]$Process)

    if ($null -eq $Process) {
        return
    }

    try {
        $pidToKill = $null
        if ($Process -is [int]) {
            $pidToKill = $Process
        } elseif ($Process.PSObject.Properties['Id']) {
            $pidToKill = [int]$Process.Id
        }

        if ($pidToKill) {
            try {
                $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $pidToKill" -ErrorAction SilentlyContinue)
                foreach ($child in $children) {
                    try {
                        Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
                    } catch {}
                }
            } catch {}

            try {
                $null = & taskkill.exe /PID $pidToKill /T /F 2>$null
            } catch {}
        }
        if (-not (Test-StartedRouterProcessExited -Process $Process)) {
            $Process | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # Cleanup must never replace the original launcher error.
    }

    try {
        $cleanupDeadline = (Get-Date).AddSeconds(3)
        while ((Get-Date) -lt $cleanupDeadline -and (Test-NineRouterEndpoint)) {
            Start-Sleep -Milliseconds 200
        }
    } catch {}
}

function Test-StartedRouterProcessExited {
    param([AllowNull()][object]$Process)

    if ($null -eq $Process) {
        return $false
    }

    try {
        $refreshMethod = $Process.PSObject.Methods['Refresh']
        if ($null -ne $refreshMethod) {
            $Process.Refresh()
        }
        return [bool]$Process.HasExited
    } catch {
        return $true
    }
}

if (-not (Test-NineRouterEndpoint)) {
    $routerCommand = Get-Command "9router" -ErrorAction SilentlyContinue
    if (-not $routerCommand) {
        throw "The expected local 9Router endpoint is unavailable and the 9router command is missing."
    }

    $escapedRouterPath = $routerCommand.Source.Replace("'", "''")
    $routerScript = "& '$escapedRouterPath' --host 127.0.0.1 --port $NineRouterPort"
    $encodedRouterScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($routerScript))
    try {
        $routerProcess = Start-Process powershell.exe -WindowStyle Minimized -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-EncodedCommand", $encodedRouterScript
        ) -PassThru

        $routerDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
        while (
            (Get-Date) -lt $routerDeadline -and
            -not (Test-NineRouterEndpoint)
        ) {
            Start-Sleep -Milliseconds 500
            if (Test-StartedRouterProcessExited -Process $routerProcess) {
                throw "9Router process exited during startup with code $($routerProcess.ExitCode)."
            }
        }
        if (-not (Test-NineRouterEndpoint)) {
            throw "Port $NineRouterPort is not serving the expected local 9Router health and version contract."
        }
    } catch {
        Stop-StartedRouterProcess -Process $routerProcess
        throw
    }
}

function Get-ExistingAoProcess {
    param([Parameter(Mandatory = $true)][string]$ExecutablePath)

    if ($null -ne $ExistingProcessResolver) {
        return @(& $ExistingProcessResolver $ExecutablePath)
    }

    $processes = @()
    foreach ($processName in @("ao", "agent-orchestrator")) {
        $processes += @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
    }

    $seen = @{}
    foreach ($process in $processes) {
        if ($seen.ContainsKey([string]$process.Id)) {
            continue
        }
        $seen[[string]$process.Id] = $true

        $identity = Get-ShipDeProcessIdentity -Process $process
        if ($null -eq $identity) {
            throw "AO process identity could not be verified; refusing to start a duplicate."
        }

        $sameExecutable = [StringComparer]::OrdinalIgnoreCase.Equals(
            [string]$identity.Path,
            [string]$ExecutablePath
        )
        if (-not $sameExecutable) {
            throw "AO process identity cannot be verified for '$($identity.Name)' at '$($identity.Path)'; refusing to start a duplicate."
        }
        $process
    }
}

function Get-LiveAoProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [AllowNull()][object]$StartedProcess
    )

    $processes = @()
    if ($null -ne $StartedProcess) {
        $processes += $StartedProcess
    }
    # AO may hand daemon ownership to a child process. Resolve the process
    # again after readiness instead of trusting Start-Process -PassThru's PID.
    $processes += @(Get-Process -ErrorAction SilentlyContinue)

    $seen = @{}
    foreach ($process in $processes) {
        $processId = [string](Get-ShipDeObjectProperty -Object $process -Names @("Id"))
        if ([string]::IsNullOrWhiteSpace($processId) -or $seen.ContainsKey($processId)) {
            continue
        }
        $seen[$processId] = $true

        $identity = Get-ShipDeProcessIdentity -Process $process
        if ($null -ne $identity -and
            [StringComparer]::OrdinalIgnoreCase.Equals([string]$identity.Path, $ExecutablePath)) {
            return $process
        }
    }
    return $null
}

$existing = @(Get-ExistingAoProcess -ExecutablePath $aoExecutablePath)
if ($existing.Count -gt 0) {
    if (-not $Restart) {
        throw "Agent Orchestrator is already running. Re-run with -Restart to replace it with the governed 9Router profile."
    }

    & $aoExecutablePath stop --timeout 15s 2>$null | Out-Null
    foreach ($process in $existing) {
        if (-not $process.HasExited -and $process.MainWindowHandle -ne 0) {
            $process.CloseMainWindow() | Out-Null
        }
    }
    Start-Sleep -Seconds 2
    $remaining = @(Get-ExistingAoProcess -ExecutablePath $aoExecutablePath)
    if ($remaining.Count -gt 0) {
        $remaining | Stop-Process -Force
    }
}

$env:CLAUDE_CONFIG_DIR = $profilePath
Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

$aoArgs = @()
if ((Split-Path $aoExecutablePath -Leaf) -ieq "ao.exe") {
    $aoArgs = @("daemon")
}
try {
    $aoProcess = if ($null -ne $ProcessStarter) {
        & $ProcessStarter $aoExecutablePath $aoArgs
    } else {
        Start-Process -FilePath $aoExecutablePath -ArgumentList $aoArgs -PassThru
    }
    if ($null -eq $aoProcess) {
        throw "Agent Orchestrator process was not created."
    }

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $statusOutput = @(
            if ($null -ne $StatusProbe) {
                & $StatusProbe $aoExecutablePath
            } else {
                & $aoExecutablePath status --json 2>$null
            }
        )
        if (($null -ne $StatusProbe -or $LASTEXITCODE -eq 0) -and $statusOutput.Count -gt 0) {
            try {
                $status = ($statusOutput -join [Environment]::NewLine) | ConvertFrom-Json
                if ([string]$status.state -eq "ready") {
                    $ready = $true
                    break
                }
            } catch {}
        }
        if ($aoProcess.HasExited -and -not $ready) {
            Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
            throw "Agent Orchestrator exited during startup with code $($aoProcess.ExitCode)."
        }
    }
    if (-not $ready) {
        if ($aoProcess -and -not $aoProcess.HasExited) {
            $aoProcess | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        Stop-StartedRouterProcess -Process $routerProcess
        Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
        throw "Agent Orchestrator did not report ready within $StartupTimeoutSeconds seconds."
    }

    $liveAoProcess = Get-LiveAoProcess -ExecutablePath $aoExecutablePath -StartedProcess $aoProcess
    if ($null -eq $liveAoProcess) {
        throw "AO reported ready, but its live daemon process could not be verified; refusing to write a runtime marker."
    }
    $aoProcess = $liveAoProcess
    $aoIdentity = Get-ShipDeProcessIdentity -Process $aoProcess
    if ($null -eq $aoIdentity) {
        throw "AO reported ready, but its daemon process identity could not be verified; refusing to write a runtime marker."
    }

    New-Item -ItemType Directory -Path $handoffRoot -Force | Out-Null
    $runtime = @{
        marker_version = 2
        process_id = $aoIdentity.Id
        process_name = $aoIdentity.Name
        process_path = $aoIdentity.Path
        process_start_time = $aoIdentity.StartTimeUtc
        profile = $profilePath
        base_url = $baseUrl
        router_port = $NineRouterPort
        ao_version = $aoVersionEvidence.EffectiveVersion
        ao_binary_version = $aoVersionEvidence.BinaryVersion
        ao_version_source = $aoVersionEvidence.Source
        ao_executable = $aoExecutablePath
        credential_overrides_cleared = @("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
        started_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    $temporaryPath = "$runtimePath.tmp"
    $runtime | ConvertTo-Json | Set-Content -Path $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $runtimePath -Force
} catch {
    if ($aoProcess -and -not $aoProcess.HasExited) {
        $aoProcess | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Stop-StartedRouterProcess -Process $routerProcess
    if ($null -ne $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
    throw
}

Write-Host "Agent Orchestrator is ready through 9Router."
Write-Host "Profile : $profilePath"
Write-Host "Base URL: $baseUrl"
Write-Host "AO PID  : $($aoProcess.Id)"
