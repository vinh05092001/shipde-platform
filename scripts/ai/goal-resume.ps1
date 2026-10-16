param(
    [Parameter(Mandatory = $true)]
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

if ($GoalId -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid GoalId" }
if (-not (Test-Path -LiteralPath $WorkDir -PathType Container)) { throw "WorkDir not found" }

# Provider keys live in the user's environment; a scheduled task may start
# without them. Copy names that are missing in this process; values are never printed.
foreach ($scope in @("Machine", "User")) {
    $vars = [Environment]::GetEnvironmentVariables($scope)
    foreach ($name in $vars.Keys) {
        if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
            [Environment]::SetEnvironmentVariable($name, [string]$vars[$name], "Process")
        }
    }
}

Set-Location -LiteralPath $WorkDir
$goalDir = Join-Path $WorkDir (Join-Path "data\goals" $GoalId)
New-Item -ItemType Directory -Force -Path $goalDir | Out-Null
$log = Join-Path $goalDir "scheduled-status.log"

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$resumeOutput = & $NodeCommand "tools/ai-brain/cli.js" "goal" "resume" $GoalId 2>&1 | Select-Object -Last 3
$resumeExit = $LASTEXITCODE
$statusOutput = & $NodeCommand "tools/ai-brain/cli.js" "goal" "status" $GoalId 2>&1 | Select-Object -Last 40

$block = @("=== $stamp goal resume exit=$resumeExit") + @($resumeOutput | ForEach-Object { "$_" }) + @("--- status") + @($statusOutput | ForEach-Object { "$_" })
Add-Content -LiteralPath $log -Value $block -Encoding UTF8
exit $resumeExit
