# scripts/ai/schedule-task.Tests.ps1
# Acceptance and behavioral tests for TASK-AI-12: Optional Windows startup/scheduling script
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$scriptUnderTest = Join-Path $PSScriptRoot "schedule-task.ps1"
if (-not (Test-Path -LiteralPath $scriptUnderTest)) {
    throw "Target script not found: $scriptUnderTest"
}

$testTaskName = "ShipDe-Test-TASK-AI-12-Auto-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
$testTaskPath = "\"
$passed = 0
$failed = 0

function Assert-Condition {
    param(
        [string]$Description,
        [bool]$Condition
    )

    if ($Condition) {
        Write-Host "  [PASS] $Description" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "  [FAIL] $Description" -ForegroundColor Red
        $script:failed++
        throw "Assertion failed: $Description"
    }
}

Write-Host "================================================================"
Write-Host "TASK-AI-12: Windows Task Scheduler Integration Tests"
Write-Host "Test Task: $testTaskName"
Write-Host "================================================================"

try {
    # 1. Clean initial state: Ensure test task does not exist
    $initialCheck = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
    Assert-Condition "Precondition: test task is not already present" ($null -eq $initialCheck)

    # 2. Pure opt-in: Mere script presence does not create task
    $presenceCheck = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
    Assert-Condition "Opt-in: mere file presence does not register task" ($null -eq $presenceCheck)

    # 3. Status on unregistered task reports Registered = False without error
    $statusUnreg = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Status
    Assert-Condition "Status check on unmanaged task returns Registered = False" ($statusUnreg.Registered -eq $false)
    Assert-Condition "Status check returns State = 'NotRegistered'" ($statusUnreg.State -eq "NotRegistered")

    # 4. Preview-only Register: Register without -Apply does NOT create task
    $regPreview = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register
    Assert-Condition "Register without -Apply returns Applied = False" ($regPreview.Applied -eq $false)
    Assert-Condition "Register without -Apply returns Status = 'PREVIEW_ONLY'" ($regPreview.Status -eq "PREVIEW_ONLY")
    $postPreviewCheck = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
    Assert-Condition "Register preview does NOT mutate Windows Task Scheduler" ($null -eq $postPreviewCheck)

    # 5. Preview-only Unregister: Unregister without -Apply does NOT delete anything
    $unregPreview = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Unregister
    Assert-Condition "Unregister without -Apply returns Applied = False" ($unregPreview.Applied -eq $false)
    Assert-Condition "Unregister without -Apply returns Status = 'PREVIEW_ONLY'" ($unregPreview.Status -eq "PREVIEW_ONLY")

    # 6. Apply Register: Registers the scheduled task
    $regApplied = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register -Apply
    Assert-Condition "Register with -Apply returns Applied = True" ($regApplied.Applied -eq $true)
    Assert-Condition "Register with -Apply returns State = 'Ready'" ($regApplied.State -eq "Ready")

    # 7. Status on registered task reports Registered = True and State = 'Ready'
    $statusReg = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Status
    Assert-Condition "Status on registered task returns Registered = True" ($statusReg.Registered -eq $true)
    Assert-Condition "Status on registered task returns State = 'Ready'" ($statusReg.State -eq "Ready")

    # 8. Unregister preview does NOT delete existing task
    $unregPreview2 = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Unregister
    Assert-Condition "Unregister preview reports PREVIEW_ONLY" ($unregPreview2.Status -eq "PREVIEW_ONLY")
    $stillThere = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
    Assert-Condition "Task still exists after unregister preview" ($null -ne $stillThere)

    # 9. Apply Unregister: Cleanly removes the task
    $unregApplied = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Unregister -Apply
    Assert-Condition "Unregister with -Apply returns Applied = True" ($unregApplied.Applied -eq $true)
    Assert-Condition "Unregister with -Apply returns Status = 'REMOVED'" ($unregApplied.Status -eq "REMOVED")
    $postUnregCheck = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
    Assert-Condition "Task is completely removed from Windows Task Scheduler" ($null -eq $postUnregCheck)

    # 10. Idempotent Unregister: Removing non-existent task succeeds gracefully
    $unregIdempotent = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Unregister -Apply
    Assert-Condition "Unregistering absent task returns Status = 'NOT_FOUND'" ($unregIdempotent.Status -eq "NOT_FOUND")

    # 11. -Remove switch works as alias for Unregister
    $regForRemove = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register -Apply
    Assert-Condition "Registered task for -Remove switch test" ($regForRemove.Applied -eq $true)
    $removeAlias = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Remove -Apply
    Assert-Condition "-Remove -Apply returns Status = 'REMOVED'" ($removeAlias.Status -eq "REMOVED")
    $postRemoveCheck = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
    Assert-Condition "Task verified removed via -Remove switch" ($null -eq $postRemoveCheck)

    # 12. Hourly trigger option
    $regHourly = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register -Trigger Hourly -IntervalHours 2 -Apply
    Assert-Condition "Registered hourly task successfully" ($regHourly.Applied -eq $true)
    $cleanHourly = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Unregister -Apply
    Assert-Condition "Cleaned up hourly task" ($cleanHourly.Status -eq "REMOVED")

    # 13. Periodic trigger option (e.g. 10 minutes)
    $regPeriodic = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register -Trigger Periodic -IntervalMinutes 10 -Apply
    Assert-Condition "Registered periodic task successfully" ($regPeriodic.Applied -eq $true)
    $statusPeriodic = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Status
    Assert-Condition "Status on periodic task returns State = 'Ready'" ($statusPeriodic.State -eq "Ready")
    $cleanPeriodic = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Unregister -Apply
    Assert-Condition "Cleaned up periodic task" ($cleanPeriodic.Status -eq "REMOVED")

    # 14. GoalResume action targets goal-resume.ps1 in the given working directory (preview only)
    $goalWork = Join-Path ([System.IO.Path]::GetTempPath()) ("shipde-goal-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $goalWork | Out-Null
    try {
        $previewGoal = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register -Trigger Periodic -IntervalMinutes 10 -ControllerAction GoalResume -GoalId TEST-GOAL -WorkingDirectory $goalWork 6>$null
        Assert-Condition "GoalResume preview is not applied" ($previewGoal.Applied -eq $false)
        $goalArgs = & $scriptUnderTest -TaskName $testTaskName -TaskPath $testTaskPath -Action Register -Trigger Periodic -IntervalMinutes 10 -ControllerAction GoalResume -GoalId TEST-GOAL -WorkingDirectory $goalWork *>&1 | Out-String -Width 4096
        Assert-Condition "GoalResume runs goal-resume.ps1 with the goal and working directory" ($goalArgs -match "goal-resume\.ps1" -and $goalArgs -match "-GoalId TEST-GOAL" -and $goalArgs.Contains($goalWork))

        # 15. goal-resume.ps1 appends a status block using the injected node command
        $stub = Join-Path $goalWork "fake-node.cmd"
        Set-Content -LiteralPath $stub -Value "@echo stub %3 %4" -Encoding ASCII
        & (Join-Path $PSScriptRoot "goal-resume.ps1") -GoalId TEST-GOAL -WorkDir $goalWork -NodeCommand $stub | Out-Null
        $statusLog = Join-Path $goalWork "data\goals\TEST-GOAL\scheduled-status.log"
        Assert-Condition "goal-resume.ps1 wrote the status log" (Test-Path -LiteralPath $statusLog)
        $logText = Get-Content -LiteralPath $statusLog -Raw
        Assert-Condition "status log records resume and status output" ($logText -match "goal resume exit=0" -and $logText -match "stub resume TEST-GOAL" -and $logText -match "stub status TEST-GOAL")
    } finally {
        Remove-Item -LiteralPath $goalWork -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "----------------------------------------------------------------"
    Write-Host "ALL $passed SCHEDULED TASK INTEGRATION TESTS PASSED" -ForegroundColor Green
    Write-Host "----------------------------------------------------------------"
} finally {
    # Defense-in-depth: Ensure test task is never left behind
    try {
        $residual = Get-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -ErrorAction SilentlyContinue
        if ($null -ne $residual) {
            Unregister-ScheduledTask -TaskName $testTaskName -TaskPath $testTaskPath -Confirm:$false
            Write-Host "Cleaned up residual test task in finally block."
        }
    } catch {}
}
