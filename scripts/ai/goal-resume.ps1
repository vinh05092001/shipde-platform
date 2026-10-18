param(
    [string]$GoalId,

    [Parameter(Mandatory = $true)]
    [string]$WorkDir,

    [string]$NodeCommand = "node"
)

# Scheduled goal resume (TASK-AI-142). Runs the Controller's own goal resume,
# which refuses to start a second run while one is active, then appends the
# goal status to a log. No model is called by this script.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if ($GoalId -and $GoalId -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid GoalId" }
if (-not (Test-Path -LiteralPath $WorkDir -PathType Container)) { throw "WorkDir not found" }

# Provider keys live in the user's environment; a scheduled task may start
# without them. Copy names that are missing in this process; values are never printed.
if ($env:AI_BRAIN_MACHINE_DATA -ne "none") {
    foreach ($scope in @("Machine", "User")) {
        $vars = [Environment]::GetEnvironmentVariables($scope)
        foreach ($name in $vars.Keys) {
            if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
                [Environment]::SetEnvironmentVariable($name, [string]$vars[$name], "Process")
            }
        }
    }
}

Set-Location -LiteralPath $WorkDir
function Test-GoalHasLiveOwner {
    param([string]$Directory)
    $lockFile = Join-Path $Directory "run.lock"
    if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) { return $false }
    try {
        $owner = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
        $ownerPid = if ($owner -is [ValueType]) { [int]$owner } else { [int]$owner.pid }
        if ($ownerPid -le 0) { return $true }
        return $null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
    } catch {
        # Unknown ownership fails closed; do not erase recovery state.
        return $true
    }
}

if ([string]::IsNullOrWhiteSpace($GoalId)) {
    $goalsDir = Join-Path $WorkDir "data\goals"
    if (-not (Test-Path -LiteralPath $goalsDir -PathType Container)) { exit 0 }
    foreach ($directory in (Get-ChildItem -LiteralPath $goalsDir -Directory | Sort-Object Name)) {
        if ($directory.Name -notmatch '^[A-Za-z0-9._-]+$') { continue }
        $goalFile = Join-Path $directory.FullName "goal.json"
        if (-not (Test-Path -LiteralPath $goalFile -PathType Leaf)) { continue }
        try {
            $goal = Get-Content -LiteralPath $goalFile -Raw | ConvertFrom-Json
            if ($goal.status -notin @("OPEN", "PLANNED", "RUNNING")) { continue }
        } catch { continue }
        if (Test-GoalHasLiveOwner -Directory $directory.FullName) { continue }
        $GoalId = $directory.Name
        break
    }
    if ([string]::IsNullOrWhiteSpace($GoalId)) { exit 0 }
}

$goalDir = Join-Path $WorkDir (Join-Path "data\goals" $GoalId)
if (Test-GoalHasLiveOwner -Directory $goalDir) { exit 0 }
# Controller goal resume owns atomic lock acquisition, including a process that
# starts after this check. The scheduler never deletes or rewrites its lock.
New-Item -ItemType Directory -Force -Path $goalDir | Out-Null
$log = Join-Path $goalDir "scheduled-status.log"

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$resumeOutput = & $NodeCommand "tools/ai-brain/cli.js" "goal" "resume" $GoalId 2>&1 | Select-Object -Last 3
$resumeExit = $LASTEXITCODE
$statusOutput = & $NodeCommand "tools/ai-brain/cli.js" "goal" "status" $GoalId 2>&1 | Select-Object -Last 40

$block = @("=== $stamp goal resume exit=$resumeExit") + @($resumeOutput | ForEach-Object { "$_" }) + @("--- status") + @($statusOutput | ForEach-Object { "$_" })
Add-Content -LiteralPath $log -Value $block -Encoding UTF8
exit $resumeExit
