param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [string]$AoExecutable = "C:\Program Files\agent-orchestrator\agent-orchestrator.exe",
    [int]$AgentRouterPort = 20128,
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
if (-not (Test-Path $AoExecutable)) {
    throw "Agent Orchestrator executable is missing: $AoExecutable"
}

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

if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $AgentRouterPort)) {
    $routerCommand = Get-Command "9router" -ErrorAction SilentlyContinue
    if (-not $routerCommand) {
        throw "AgentRouter is stopped and the 9router command is unavailable."
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
        -not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $AgentRouterPort)
    ) {
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $AgentRouterPort)) {
        throw "AgentRouter did not become ready on port $AgentRouterPort."
    }
}

$existing = @(Get-Process "agent-orchestrator" -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
    if (-not $Restart) {
        throw "Agent Orchestrator is already running. Re-run with -Restart to replace it with the governed AgentRouter profile."
    }

    if (Get-Command "ao" -ErrorAction SilentlyContinue) {
        & ao stop --timeout 15s 2>$null | Out-Null
    }
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

$aoProcess = Start-Process -FilePath $AoExecutable -PassThru

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($aoProcess.HasExited) {
        throw "Agent Orchestrator exited during startup with code $($aoProcess.ExitCode)."
    }
    if (Get-Command "ao" -ErrorAction SilentlyContinue) {
        & ao status --json 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
    }
}
if (-not $ready) {
    throw "Agent Orchestrator did not report ready within $StartupTimeoutSeconds seconds."
}

New-Item -ItemType Directory -Path $handoffRoot -Force | Out-Null
$runtime = @{
    process_id = $aoProcess.Id
    profile = $profilePath
    base_url = $baseUrl
    router_port = $AgentRouterPort
    started_at = (Get-Date).ToUniversalTime().ToString("o")
}
$temporaryPath = "$runtimePath.tmp"
$runtime | ConvertTo-Json | Set-Content -Path $temporaryPath -Encoding UTF8
Move-Item -LiteralPath $temporaryPath -Destination $runtimePath -Force

Write-Host "Agent Orchestrator is ready through AgentRouter."
Write-Host "Profile : $profilePath"
Write-Host "Base URL: $baseUrl"
Write-Host "AO PID  : $($aoProcess.Id)"
