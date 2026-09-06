param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [string]$AoExecutable = "",
    [int]$AgentRouterPort = 20128,
    [string]$ExpectedAoVersion = "0.12.10",
    [int]$StartupTimeoutSeconds = 30,
    [switch]$Restart
)

. (Join-Path $PSScriptRoot "common.ps1")

$profilePath = Join-Path $env:USERPROFILE ".claude"
$settingsPath = Join-Path $profilePath "settings.json"
$handoffRoot = Join-Path $AiRoot "handoff"
$runtimePath = Join-Path $handoffRoot "ao-router-runtime.json"

if (-not (Test-Path $settingsPath)) {
    throw "AgentRouter Claude profile is missing: $settingsPath"
}
$aoExecutablePath = if ([string]::IsNullOrWhiteSpace($AoExecutable)) {
    Resolve-ShipDeAoExecutable
} else {
    if (-not (Test-Path -LiteralPath $AoExecutable -PathType Leaf)) {
        throw "Agent Orchestrator executable is missing: $AoExecutable"
    }
    (Get-Item -LiteralPath $AoExecutable).FullName
}
$aoVersionProbe = Get-ShipDeAoVersionProbe -AoExecutable $aoExecutablePath
$aoVersionEvidence = Assert-ShipDeAoVersionEvidence `
    -AoExecutable $aoExecutablePath `
    -ExpectedVersion $ExpectedAoVersion `
    -VersionText $aoVersionProbe.Text `
    -VersionExitCode $aoVersionProbe.ExitCode

try {
    $config = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    throw "AgentRouter Claude profile contains invalid JSON: $settingsPath"
}

$baseUrl = [string]$config.env.ANTHROPIC_BASE_URL
$uri = $null
if (
    [string]::IsNullOrWhiteSpace($baseUrl) -or
    -not [Uri]::TryCreate($baseUrl, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne "http" -or
    $uri.Host -notin @("localhost", "127.0.0.1") -or
    $uri.Port -ne $AgentRouterPort -or
    $uri.AbsolutePath.TrimEnd('/') -ne "/v1" -or
    -not [string]::IsNullOrWhiteSpace($uri.Query) -or
    -not [string]::IsNullOrWhiteSpace($uri.Fragment) -or
    -not [string]::IsNullOrWhiteSpace($uri.UserInfo)
) {
    throw "The .claude profile must route to http://localhost:$AgentRouterPort/v1."
}

function Test-AgentRouterEndpoint {
    if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $AgentRouterPort)) {
        return $false
    }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$AgentRouterPort/api/health" -Method Get -TimeoutSec 5
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$AgentRouterPort/api/version" -Method Get -TimeoutSec 6
        return (
            $health.ok -eq $true -and
            [string]$version.currentVersion -eq "0.5.55"
        )
    } catch {
        return $false
    }
}

if (-not (Test-AgentRouterEndpoint)) {
    $routerCommand = Get-Command "9router" -ErrorAction SilentlyContinue
    if (-not $routerCommand) {
        throw "The expected local 9Router endpoint is unavailable and the 9router command is missing."
    }

    $escapedRouterPath = $routerCommand.Source.Replace("'", "''")
    $routerScript = "& '$escapedRouterPath'"
    $encodedRouterScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($routerScript))
    Start-Process powershell.exe -WindowStyle Minimized -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", $encodedRouterScript
    ) | Out-Null

    $routerDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while (
        (Get-Date) -lt $routerDeadline -and
        -not (Test-AgentRouterEndpoint)
    ) {
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-AgentRouterEndpoint)) {
        throw "Port $AgentRouterPort is not serving the expected local 9Router health and version contract."
    }
}

$existing = @(Get-Process "agent-orchestrator" -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
    if (-not $Restart) {
        throw "Agent Orchestrator is already running. Re-run with -Restart to replace it with the governed AgentRouter profile."
    }

    & $aoExecutablePath stop --timeout 15s 2>$null | Out-Null
    foreach ($process in $existing) {
        if (-not $process.HasExited -and $process.MainWindowHandle -ne 0) {
            $process.CloseMainWindow() | Out-Null
        }
    }
    Start-Sleep -Seconds 2
    $remaining = @(Get-Process "agent-orchestrator" -ErrorAction SilentlyContinue)
    if ($remaining.Count -gt 0) {
        $remaining | Stop-Process -Force
    }
}

$env:CLAUDE_CONFIG_DIR = $profilePath
Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

$aoProcess = Start-Process -FilePath $AoExecutable -PassThru

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$ready = $false
try {
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if ($aoProcess.HasExited) {
            Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
            throw "Agent Orchestrator exited during startup with code $($aoProcess.ExitCode)."
        }
        $statusOutput = @(& $aoExecutablePath status --json 2>$null)
        if ($LASTEXITCODE -eq 0 -and $statusOutput.Count -gt 0) {
            try {
                $status = ($statusOutput -join [Environment]::NewLine) | ConvertFrom-Json
                if ([string]$status.state -eq "ready") {
                    $ready = $true
                    break
                }
            } catch {}
        }
    }
    if (-not $ready) {
        if ($aoProcess -and -not $aoProcess.HasExited) {
            $aoProcess | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
        throw "Agent Orchestrator did not report ready within $StartupTimeoutSeconds seconds."
    }
} catch {
    if ($aoProcess -and -not $aoProcess.HasExited) {
        $aoProcess | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
    throw
}

New-Item -ItemType Directory -Path $handoffRoot -Force | Out-Null
$runtime = @{
    process_id = $aoProcess.Id
    profile = $profilePath
    base_url = $baseUrl
    router_port = $AgentRouterPort
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

Write-Host "Agent Orchestrator is ready through AgentRouter."
Write-Host "Profile : $profilePath"
Write-Host "Base URL: $baseUrl"
Write-Host "AO PID  : $($aoProcess.Id)"
