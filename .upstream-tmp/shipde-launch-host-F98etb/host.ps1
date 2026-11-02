
$ErrorActionPreference = "Stop"
$nestedScript = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\run-target.ps1"
$verdictBytes = [Convert]::FromBase64String("e30=")
$env:SHIPDE_ISOLATION_VERDICT = [Text.Encoding]::UTF8.GetString($verdictBytes)
$markerPath = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\run-target.complete.json"
$completionNonce = "6bca993d2522e107e62d69055d62d588"
$usageLogPath = 'C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\.shipde\worker-output-6bca993d2522e107e62d69055d62d588.log'
$workerRoot = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
$env:HOME = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
$env:USERPROFILE = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
$wrapperPid = 0
$wrapperStartTime = Get-Date
@"
`$ErrorActionPreference = "Stop"
`$env:HOME = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
`$env:USERPROFILE = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
`$env:GH_CONFIG_DIR = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\.config\gh"
`$env:GIT_CONFIG_GLOBAL = "NUL"
`$env:GIT_CONFIG_COUNT = "1"
`$env:GIT_CONFIG_KEY_0 = "safe.directory"
`$env:GIT_CONFIG_VALUE_0 = "C:/Users/gumac/AI/shipde-platform/.worktrees/p-task-ai-166/.upstream-tmp/shipde-launch-host-F98etb"
`$env:TEMP = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\temp"
`$env:TMP = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\temp"
if (-not `$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX) { `$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "4096" }
`$env:pnpm_config_verify_deps_before_run = "warn"

`$workerCodexHome = "C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\p-task-ai-166\\.upstream-tmp\\shipde-launch-host-F98etb\\.codex"
if (-not (Test-Path `$workerCodexHome)) { New-Item -ItemType Directory -Path `$workerCodexHome | Out-Null }
`$env:CODEX_HOME = `$workerCodexHome
if (-not (Test-Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\temp")) { New-Item -ItemType Directory -Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\temp" | Out-Null }
if (-not (Test-Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\.shipde")) { New-Item -ItemType Directory -Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\.shipde" | Out-Null }
Set-Location -Path "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
`$env:SHIPDE_RUN_TARGET_PID = "`$PID"

`$usageLogDir = [System.IO.Path]::GetDirectoryName("C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\p-task-ai-166\\.upstream-tmp\\shipde-launch-host-F98etb\\.shipde\\worker-output-6bca993d2522e107e62d69055d62d588.log")
if (-not (Test-Path `$usageLogDir)) { New-Item -ItemType Directory -Path `$usageLogDir | Out-Null }
`$payloadArgs = @(Get-Content -LiteralPath "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\payload-args.json" -Raw | ConvertFrom-Json)
& "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" @payloadArgs | Tee-Object -FilePath "C:\\Users\\gumac\\AI\\shipde-platform\\.worktrees\\p-task-ai-166\\.upstream-tmp\\shipde-launch-host-F98etb\\.shipde\\worker-output-6bca993d2522e107e62d69055d62d588.log"
`$jobExit = `$LASTEXITCODE
if (`$null -eq `$jobExit) { exit 1 }
@{ nonce = "6bca993d2522e107e62d69055d62d588"; exitCode = [int]`$jobExit; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\run-target.complete.json" -Encoding UTF8
exit `$jobExit
"@ | Out-File $nestedScript -Encoding UTF8

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$nestedScript`""
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

# Clear environment to avoid leaking operator tokens (F4)
$psi.EnvironmentVariables.Clear()
# PATHEXT is not a secret and must survive the scrub: without it PowerShell's
# call operator falls off the CreateProcess path for an absolute .exe, returns
# before the job ran and leaves the payload orphaned — a green result for a
# job that never finished.
$allowed = @("PATH", "SystemRoot", "SystemDrive", "ALLUSERSPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramFiles(x86)", "PUBLIC", "PATHEXT", "pnpm_config_verify_deps_before_run")
foreach ($key in $allowed) {
    if ([Environment]::GetEnvironmentVariable($key)) {
        $psi.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key)
    }
}



$process = [System.Diagnostics.Process]::Start($psi)
$wrapperPid = $process.Id
$wrapperStartTime = $process.StartTime
$usageFile = 'C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\task-ai-141-live-usage.json'
$usageLogPath = 'C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\.shipde\worker-output-6bca993d2522e107e62d69055d62d588.log'
$usageModel = ''
$usageProvider = ''
$script:lastLiveUsageJson = ""
function Write-LiveUsage {
    if ([string]::IsNullOrWhiteSpace($usageFile)) { return }
    try {
        if (-not (Test-Path -LiteralPath $usageLogPath)) { return }
        $events = @(Get-Content -LiteralPath $usageLogPath -Tail 100 -ErrorAction Stop)
        $report = $null
        foreach ($line in $events) {
            try {
                $event = $line | ConvertFrom-Json
                $tokens = $event.tokens
                if ($null -eq $tokens -and $null -ne $event.part) { $tokens = $event.part.tokens }
                if ($null -eq $tokens) { continue }
                $inputTokens = [double]$tokens.input
                $outputTokens = [double]$tokens.output
                $totalTokens = [double]$tokens.total
                $cacheReadTokens = 0
                if ($null -ne $tokens.cache -and $null -ne $tokens.cache.read) {
                    $cacheReadTokens = [double]$tokens.cache.read
                } elseif ($null -ne $tokens.cache -and $null -ne $tokens.cache.read_tokens) {
                    $cacheReadTokens = [double]$tokens.cache.read_tokens
                } elseif ($null -ne $tokens.cacheRead) {
                    $cacheReadTokens = [double]$tokens.cacheRead
                } elseif ($null -ne $tokens.cache_read) {
                    $cacheReadTokens = [double]$tokens.cache_read
                } elseif ($null -ne $tokens.cache_read_tokens) {
                    $cacheReadTokens = [double]$tokens.cache_read_tokens
                }
                $accounted = $inputTokens + $cacheReadTokens + $outputTokens
                $effectiveTotal = [math]::Max($totalTokens, $accounted)
                $report = @{
                    session_id = $(if ($event.sessionID) { $event.sessionID } elseif ($event.sessionId) { $event.sessionId } else { $null })
                    model = $usageModel
                    provider = $usageProvider
                    usage = @{
                        input = $inputTokens
                        cacheRead = $cacheReadTokens
                        cache_read = $cacheReadTokens
                        cache_read_tokens = $cacheReadTokens
                        output = $outputTokens
                        total = $effectiveTotal
                    }
                } | ConvertTo-Json -Depth 5 -Compress
            } catch {}
        }
        if ($null -eq $report) { return }
        if ($script:lastLiveUsageJson -eq $report) { return }
        $script:lastLiveUsageJson = $report
        $temporary = $usageFile + '.live-' + $PID
        [System.IO.File]::WriteAllText($temporary, $report, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $usageFile -Force
    } catch {}
}
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$timeoutMs = 30000
$tokenBudgetJson = '{"maxTokens":50}'
$maxTokens = 0
$progressTimeoutMs = 0
$lastProgressAt = [System.Diagnostics.Stopwatch]::GetTimestamp()
$lastTotalTokens = $null
$lastCumulativeTokens = 0
$lastToolCalls = 0
$lastOutputSignature = ""
try {
    $initFiles = @(Get-ChildItem -LiteralPath $workerRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\/](.git|node_modules|.shipde)[\/]' } | Sort-Object FullName)
    if ($initFiles.Count -gt 0) { $lastOutputSignature = ($initFiles | ForEach-Object { $_.FullName + ':' + $_.Length + ':' + $_.LastWriteTimeUtc.Ticks }) -join '|' }
} catch {}
$requestTooLarge = $false
$requestTooLargeDetail = ""
try {
    $budgetConfig = $tokenBudgetJson | ConvertFrom-Json
    if ($null -ne $budgetConfig.maxTokens) { $maxTokens = [double]$budgetConfig.maxTokens }
} catch {}
$budgetExceeded = $false

function Stop-WorkerTree {
    $stragglers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
    foreach ($stragglerId in $stragglers) { Stop-Process -Id $stragglerId -Force -ErrorAction SilentlyContinue }
    if (-not $process.HasExited) { try { $process.Kill() } catch {} }
    try { & cmd.exe /c "taskkill /PID $wrapperPid /T /F >nul 2>&1" } catch {}
    [void]$process.WaitForExit(10000)
}

# Every process the wrapper started, walked up the parent chain. A process
# that predates the launch is never a descendant even if a recycled pid makes
# it look like one.
function Get-DescendantProcessIds {
    param([int]$AncestorPid, [datetime]$NotBefore)
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name -ErrorAction SilentlyContinue)
    $children = @{}
    $created = @{}
    foreach ($row in $rows) {
        if ($row.Name -ieq "conhost.exe") { continue }
        $rowPid = [int]$row.ProcessId
        $created[$rowPid] = $row.CreationDate
        $rowParent = [int]$row.ParentProcessId
        if (-not $children.ContainsKey($rowParent)) { $children[$rowParent] = @() }
        $children[$rowParent] += $rowPid
    }
    $found = @()
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($AncestorPid)
    $seen = @{}
    $seen[$AncestorPid] = $true
    while ($queue.Count -gt 0) {
        $currentPid = $queue.Dequeue()
        if (-not $children.ContainsKey($currentPid)) { continue }
        foreach ($childPid in $children[$currentPid]) {
            if ($seen.ContainsKey($childPid)) { continue }
            $seen[$childPid] = $true
            $queue.Enqueue($childPid)
            if ($created.ContainsKey($childPid) -and $null -ne $created[$childPid] -and $created[$childPid] -ge $NotBefore) { $found += $childPid }
        }
    }
    return $found
}

function Read-UsageTotal {
    if ([string]::IsNullOrWhiteSpace($usageFile) -or -not (Test-Path -LiteralPath $usageFile)) { return $null }
    try {
        $report = Get-Content -LiteralPath $usageFile -Raw | ConvertFrom-Json
        $usage = $report.usage
        if ($null -eq $usage) { return $null }
        $reportedTotal = $null
        if ($null -ne $usage.total_tokens) { $reportedTotal = [double]$usage.total_tokens }
        elseif ($null -ne $usage.total) { $reportedTotal = [double]$usage.total }
        if ($null -ne $usage.input_tokens -or $null -ne $usage.cache_read_tokens -or $null -ne $usage.output_tokens) {
            $accounted = [double]$usage.input_tokens + [double]$usage.cache_read_tokens + [double]$usage.output_tokens
            if ($null -ne $reportedTotal) { return [math]::Max($reportedTotal, $accounted) }
            return $accounted
        }
        if ($null -ne $usage.input -or $null -ne $usage.cacheRead -or $null -ne $usage.cache_read -or $null -ne $usage.output) {
            $cacheRead = $usage.cacheRead
            if ($null -eq $cacheRead) { $cacheRead = $usage.cache_read }
            $accounted = [double]$usage.input + [double]$cacheRead + [double]$usage.output
            if ($null -ne $reportedTotal) { return [math]::Max($reportedTotal, $accounted) }
            return $accounted
        }
        if ($null -ne $reportedTotal) { return $reportedTotal }
    } catch {}
    return $null
}

function Update-SessionProgress {
    if ($script:requestTooLarge) { return }
    $script:sessionToolCalls = 0
    $script:sessionCumTokens = 0
    $script:sessionMonotonic = $true
    if ([string]::IsNullOrWhiteSpace($usageLogPath) -or -not (Test-Path -LiteralPath $usageLogPath)) { return }
    try {
        $lines = @()
        $readOk = $false
        try {
            $fs = [System.IO.File]::Open($usageLogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
                try {
                    $rawContent = $sr.ReadToEnd()
                    if (-not [string]::IsNullOrEmpty($rawContent)) {
                        $lines = @($rawContent -split '?
')
                    }
                    $readOk = $true
                } finally {
                    $sr.Dispose()
                }
            } finally {
                $fs.Dispose()
            }
        } catch {}
        if (-not $readOk) {
            $lines = @(Get-Content -LiteralPath $usageLogPath -ErrorAction SilentlyContinue)
        }
        if ($lines.Count -eq 0) { return }
        $toolCount = 0
        $sumTokens = 0
        $prevStepTokens = $null
        $hasFluctuated = $false
        $found413 = $false
        $detail413 = ""
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $is413 = $false
            $matchText = ""
            $skipRaw413 = $false
            if ($trimmed.StartsWith('{') -and $trimmed.EndsWith('}')) {
                try {
                    $ev = $trimmed | ConvertFrom-Json
                    if ($null -ne $ev) {
                        if ($ev.type -eq "tool_use" -or ($null -ne $ev.part -and $ev.part.type -eq "tool") -or
                            ($ev.type -eq "item.completed" -and $null -ne $ev.item -and
                             $ev.item.type -eq "command_execution" -and $ev.item.status -eq "completed" -and
                             $null -ne $ev.item.exit_code -and $ev.item.exit_code -eq 0)) {
                            $toolCount++
                        }
                        $err = $null
                        if ($ev.type -eq "error" -and $null -ne $ev.error) { $err = $ev.error }
                        elseif ($null -ne $ev.error) { $err = $ev.error }
                        # A structured event without an error field is worker content (tool input/output,
                        # model text); a branch name or log line inside it must not read as an HTTP 413.
                        if ($null -eq $err -and $ev.type -ne "error") { $skipRaw413 = $true }
                        if ($null -ne $err) {
                            $code = $null
                            if ($null -ne $err.data -and $null -ne $err.data.statusCode) { $code = [int]$err.data.statusCode }
                            elseif ($null -ne $err.statusCode) { $code = [int]$err.statusCode }
                            elseif ($null -ne $err.status) { $code = [int]$err.status }

                            $msg = ""
                            if ($null -ne $err.data -and $null -ne $err.data.message) { $msg = [string]$err.data.message }
                            elseif ($null -ne $err.message) { $msg = [string]$err.message }
                            if ($null -ne $err.data -and $null -ne $err.data.responseBody) {
                                $msg = $msg + " " + [string]$err.data.responseBody
                            }
                            if ($code -eq 413 -or $msg -match '(?i)413|request.*too.*large|payload.*too.*large|entity.*too.*large|too.*large.*request|tokens?.*per.*minute|TPM.*limit|limit.*on.*TPM') {
                                $is413 = $true
                                $matchText = if ($msg) { $msg } else { "HTTP status 413" }
                            }
                        }
                        if (-not $is413 -and $ev.type -ne "error" -and $null -eq $ev.error) {
                            $t = $ev.tokens
                            if ($null -eq $t -and $null -ne $ev.part) { $t = $ev.part.tokens }
                            if ($null -ne $t) {
                                $in = [double]$t.input
                                $out = [double]$t.output
                                $tot = [double]$t.total
                                $cr = 0
                                if ($null -ne $t.cache -and $null -ne $t.cache.read) { $cr = [double]$t.cache.read }
                                elseif ($null -ne $t.cache -and $null -ne $t.cache.read_tokens) { $cr = [double]$t.cache.read_tokens }
                                elseif ($null -ne $t.cacheRead) { $cr = [double]$t.cacheRead }
                                elseif ($null -ne $t.cache_read) { $cr = [double]$t.cache_read }
                                elseif ($null -ne $t.cache_read_tokens) { $cr = [double]$t.cache_read_tokens }
                                $stepEffective = [math]::Max($tot, $in + $cr + $out)
                                if ($null -ne $prevStepTokens -and $stepEffective -lt $prevStepTokens) {
                                    $hasFluctuated = $true
                                }
                                $prevStepTokens = $stepEffective
                                $sumTokens += $stepEffective
                            }
                        }
                    }
                } catch {}
            }
            if (-not $is413 -and -not $skipRaw413) {
                if ($trimmed -match '(?i)413.*(?:request|payload|entity|toos+large|tpm)|(?:request|payload|entity)s+(?:iss+)?toos+large|413s+Request|413s+Payload|rates+limit.*tokens?s+pers+minute|TPM.*limit|limit.*on.*TPM') {
                    $is413 = $true
                    $matchText = $trimmed
                }
            }
            if ($is413) {
                $found413 = $true
                $detail413 = $matchText
            }
        }
        if ($found413) {
            $script:requestTooLarge = $true
            $script:requestTooLargeDetail = if ($detail413.Length -gt 250) { $detail413.Substring(0, 250) } else { $detail413 }
        }
        $script:sessionToolCalls = $toolCount
        $script:sessionCumTokens = $sumTokens
        $script:sessionMonotonic = (-not $hasFluctuated)
    } catch {}
}

# The wrapper is waited on with the bounded wait, then every process it
# started is polled until none remain, all inside the same budget. Waiting for
# the wrapper alone is not enough: a job the wrapper no longer waits for would
# otherwise be reported as finished while it is still running.
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$timedOut = $false
$stalled = $false
$progressDetail = ""
$waitSlice = 250
while ($true) {
    Write-LiveUsage
    $totalTokens = Read-UsageTotal
    if ($null -ne $totalTokens -and $maxTokens -gt 0 -and $totalTokens -gt $maxTokens) {
        $budgetExceeded = $true
        Stop-WorkerTree
        break
    }
    Update-SessionProgress
    if ($script:requestTooLarge) {
        Stop-WorkerTree
        break
    }
    if ($progressTimeoutMs -gt 0) {
        $outputSignature = ""
        try {
            $outputFiles = @(Get-ChildItem -LiteralPath $workerRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\/](.git|node_modules|.shipde)[\/]' } | Sort-Object FullName)
            if ($outputFiles.Count -gt 0) { $outputSignature = ($outputFiles | ForEach-Object { $_.FullName + ':' + $_.Length + ':' + $_.LastWriteTimeUtc.Ticks }) -join '|' }
        } catch {}
        $madeProgress = $false
        if ($outputSignature -ne $lastOutputSignature) {
            $lastOutputSignature = $outputSignature
            $madeProgress = $true
        }
        if ($script:sessionToolCalls -gt $lastToolCalls) {
            $lastToolCalls = $script:sessionToolCalls
            $madeProgress = $true
        }
        if ($script:sessionMonotonic -and $script:sessionCumTokens -gt $lastCumulativeTokens) {
            $lastCumulativeTokens = $script:sessionCumTokens
            $madeProgress = $true
        }
        if ($madeProgress) {
            $lastProgressAt = [System.Diagnostics.Stopwatch]::GetTimestamp()
        } elseif (([System.Diagnostics.Stopwatch]::GetTimestamp() - $lastProgressAt) * 1000 / [System.Diagnostics.Stopwatch]::Frequency -ge $progressTimeoutMs) {
            $stalled = $true
            $fileCount = $outputFiles.Count
            $usageState = if ($null -eq $totalTokens) { "unavailable" } else { [string]$totalTokens }
            $progressDetail = "stall detector observed no worker file signature change ($fileCount tracked files), no verified tool progress ($lastToolCalls tool calls), and no monotonic token usage increase (usage=$usageState) for $progressTimeoutMs ms"
            Stop-WorkerTree
            break
        }
    }
    $remaining = $timeoutMs - $stopwatch.ElapsedMilliseconds
    if ($remaining -le 0) { $timedOut = $true; break }
    if ($process.HasExited) { break }
    [void]$process.WaitForExit([math]::Min($waitSlice, $remaining))
}
$quietPolls = 0
if (-not $timedOut -and -not $stalled -and -not $budgetExceeded -and -not $requestTooLarge) {
    while ($true) {
        Write-LiveUsage
        $remaining = $timeoutMs - $stopwatch.ElapsedMilliseconds
        if ($remaining -le 0) { $timedOut = $true; break }
        $pidRecycled = $false
        try {
            $holder = Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue
            if ($null -ne $holder -and [math]::Abs(($holder.StartTime - $wrapperStartTime).TotalSeconds) -gt 5) {
                $pidRecycled = $true
            }
        } catch {
            # The pid cannot be attributed to this launch any more, so nothing
            # found under it can be trusted as this launch's descendant.
            $pidRecycled = $true
        }
        if ($pidRecycled) {
            $quietPolls = $quietPolls + 1
        } else {
            $leftovers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
            if ($leftovers.Count -eq 0) { $quietPolls = $quietPolls + 1 } else { $quietPolls = 0 }
        }
        $totalTokens = Read-UsageTotal
        if ($null -ne $totalTokens -and $maxTokens -gt 0 -and $totalTokens -gt $maxTokens) {
            $budgetExceeded = $true
            Stop-WorkerTree
            break
        }
        Update-SessionProgress
        if ($script:requestTooLarge) {
            Stop-WorkerTree
            break
        }
        if ($quietPolls -ge 3) { break }
        Start-Sleep -Milliseconds 250
    }
}

if ($timedOut) {
    Stop-WorkerTree
}
if ($stalled) { Stop-WorkerTree }
if ($script:requestTooLarge) { Stop-WorkerTree }
# A writer the operator cannot kill (another user's process) must not hang the
# host forever: the pipes are read with a bound, and a pipe that never closed
# is itself reported as a failure.
$stdout = ""
$stderr = ""
if ($stdoutTask.Wait(15000)) { $stdout = $stdoutTask.Result }
if ($stderrTask.Wait(15000)) { $stderr = $stderrTask.Result } else { $stderr = "[ISOLATION_LAUNCHER] worker output pipes never closed" }

if (-not $script:requestTooLarge) {
    Update-SessionProgress
    if (-not $script:requestTooLarge) {
        # Structured JSON events (tool calls, model text) are worker content, not transport errors.
        $combinedLines = @([regex]::Split(($stdout + [Environment]::NewLine + $stderr), '\r?\n') | Where-Object {
            -not ($_.TrimStart().StartsWith('{"type":"') -and -not $_.TrimStart().StartsWith('{"type":"error"'))
        })
        $combined = $combinedLines -join [Environment]::NewLine
        if ($combined -match '(?i)413.*(?:request|payload|entity|toos+large|tpm)|(?:request|payload|entity)s+(?:iss+)?toos+large|413s+Request|413s+Payload|rates+limit.*tokens?s+pers+minute|TPM.*limit|limit.*on.*TPM') {
            $script:requestTooLarge = $true
            $script:requestTooLargeDetail = "worker output indicated 413 / request too large / TPM limit"
        }
    }
}

# Positive evidence: the marker is written by run-target.ps1 after the payload
# returned, so it can only exist for a job that really ran to its end.
$completed = $false
$markerNonce = ""
$jobExit = -1
$failureReason = ""
$localFailure = ""
if ($budgetExceeded) {
    $failureReason = "TOKEN_BUDGET_EXCEEDED: live worker usage exceeded configured token budget"
} elseif ($timedOut) {
    $failureReason = "[ISOLATION_LAUNCHER] worker timed out after $timeoutMs ms and was killed"
} elseif ($script:requestTooLarge) {
    $failureReason = "REQUEST_TOO_LARGE: $script:requestTooLargeDetail; worker was killed"
} elseif ($stalled) {
    $failureReason = "STALLED_NO_PROGRESS: $progressDetail; worker was killed"
} elseif (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.nonce -ceq $completionNonce -and $null -ne $marker.exitCode) {
            $completed = $true
            $markerNonce = [string]$marker.nonce
            $jobExit = [int]$marker.exitCode
            if ($null -ne $marker.localFailure) { $localFailure = [string]$marker.localFailure }
        } else {
            $failureReason = "[ISOLATION_LAUNCHER] completion marker does not belong to this launch"
        }
    } catch {
        $failureReason = "[ISOLATION_LAUNCHER] completion marker unreadable: " + $_.Exception.Message
    }
} else {
    $failureReason = "[ISOLATION_LAUNCHER] the worker job never wrote its completion marker"
}
$exitValue = -1
if ($completed -and -not $timedOut -and -not $budgetExceeded -and -not $script:requestTooLarge) { $exitValue = $jobExit }
if ($failureReason.Length -gt 0) { $stderr = $stderr + [Environment]::NewLine + $failureReason }

Update-SessionProgress
$output = @{
    verifiedToolCalls = $script:sessionToolCalls
    exitCode = $exitValue
    stdout = $stdout
    stderr = $stderr
    timedOut = $timedOut
    budgetExceeded = $budgetExceeded
    requestTooLarge = $script:requestTooLarge
    completed = $completed
    completionNonce = $markerNonce
    failureReason = $failureReason
    progressDetail = $progressDetail
    localFailure = $localFailure
}
$output | ConvertTo-Json -Depth 10 | Out-File "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\shipde-launch-host-F98etb\launch-result.json" -Encoding UTF8
