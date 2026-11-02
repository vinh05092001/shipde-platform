$ErrorActionPreference = "Stop"
$env:HOME = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d"
$env:USERPROFILE = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d"
$env:GH_CONFIG_DIR = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\.config\gh"
$env:GIT_CONFIG_GLOBAL = "NUL"
$env:GIT_CONFIG_COUNT = "1"
$env:GIT_CONFIG_KEY_0 = "safe.directory"
$env:GIT_CONFIG_VALUE_0 = "C:/Users/gumac/AI/shipde-platform/.worktrees/p-task-ai-166/.upstream-tmp/shipde-launch-host-FjuR3d"
$env:TEMP = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\temp"
$env:TMP = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\temp"
if (-not $env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX) { $env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "4096" }
$env:pnpm_config_verify_deps_before_run = "warn"

$workerCodexHome = "C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\p-task-ai-166\\.upstream-tmp\\shipde-launch-host-FjuR3d\\.codex"
if (-not (Test-Path $workerCodexHome)) { New-Item -ItemType Directory -Path $workerCodexHome | Out-Null }
$env:CODEX_HOME = $workerCodexHome
if (-not (Test-Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\temp")) { New-Item -ItemType Directory -Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\temp" | Out-Null }
if (-not (Test-Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\.shipde")) { New-Item -ItemType Directory -Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\.shipde" | Out-Null }
Set-Location -Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d"
$env:SHIPDE_RUN_TARGET_PID = "$PID"

$usageLogDir = [System.IO.Path]::GetDirectoryName("C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\p-task-ai-166\\.upstream-tmp\\shipde-launch-host-FjuR3d\\.shipde\\worker-output-8dbe52430be08d3bd638db5371e70b02.log")
if (-not (Test-Path $usageLogDir)) { New-Item -ItemType Directory -Path $usageLogDir | Out-Null }
$payloadArgs = @(Get-Content -LiteralPath "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\payload-args.json" -Raw | ConvertFrom-Json)
& "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" @payloadArgs | Tee-Object -FilePath "C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\p-task-ai-166\\.upstream-tmp\\shipde-launch-host-FjuR3d\\.shipde\\worker-output-8dbe52430be08d3bd638db5371e70b02.log"
$jobExit = $LASTEXITCODE
if ($null -eq $jobExit) { exit 1 }
@{ nonce = "8dbe52430be08d3bd638db5371e70b02"; exitCode = [int]$jobExit; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-FjuR3d\run-target.complete.json" -Encoding UTF8
exit $jobExit
