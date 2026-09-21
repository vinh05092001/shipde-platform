param(
    [ValidateSet("Register", "Unregister", "Status", "Test")]
    [string]$Action = "Status",

    [switch]$Remove,

    [string]$TaskName = "ShipDe-AI-Controller",

    [string]$TaskPath = "\",

    [ValidateSet("Daily", "Logon", "Hourly")]
    [string]$Trigger = "Daily",

    [string]$Time = "09:00",

    [int]$IntervalHours = 1,

    [ValidateSet("Resume", "Supervise", "Doctor", "Menu")]
    [string]$ControllerAction = "Resume",

    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),

    [string]$WorkingDirectory = $null,

    [string]$TargetScript = $null,

    [ValidateSet("Limited", "Highest")]
    [string]$RunLevel = "Limited",

    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if ($Remove) {
    $Action = "Unregister"
}

$commonPath = Join-Path $PSScriptRoot "common.ps1"
if (Test-Path -LiteralPath $commonPath -PathType Leaf) {
    . $commonPath
}

$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
    if (Get-Command "Get-ShipDePaths" -ErrorAction SilentlyContinue) {
        $paths = Get-ShipDePaths -AiRoot $AiRoot
        $WorkingDirectory = $paths.Main
    } else {
        $WorkingDirectory = (Split-Path -Parent $PSScriptRoot)
    }
}

if ([string]::IsNullOrWhiteSpace($TargetScript)) {
    $TargetScript = Join-Path $WorkingDirectory "scripts\ai\control.ps1"
}

$arguments = "-NonInteractive -ExecutionPolicy Bypass -File `"$TargetScript`" -Action $ControllerAction"

function Get-ShipDeScheduledTaskStatus {
    param(
        [string]$Name,
        [string]$Path
    )

    $task = Get-ScheduledTask -TaskName $Name -TaskPath $Path -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Write-Host "=== SHIP DE TASK SCHEDULER STATUS ==="
        Write-Host "Status     : REGISTERED"
        Write-Host "Task Name  : $($task.TaskName)"
        Write-Host "Task Path  : $($task.TaskPath)"
        Write-Host "State      : $($task.State)"
        Write-Host ""
        Write-Host "To unregister this task, run:"
        Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -TaskName `"$Name`" -Action Unregister -Apply"
        return [PSCustomObject]@{
            Registered = $true
            TaskName   = $task.TaskName
            TaskPath   = $task.TaskPath
            State      = [string]$task.State
            TaskObject = $task
        }
    } else {
        Write-Host "=== SHIP DE TASK SCHEDULER STATUS ==="
        Write-Host "Status     : NOT REGISTERED"
        Write-Host "Task Name  : $Name"
        Write-Host "Note       : The optional Ship De scheduled task is not registered."
        Write-Host ""
        Write-Host "To opt in and register this task, run:"
        Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -TaskName `"$Name`" -Action Register -Apply"
        return [PSCustomObject]@{
            Registered = $false
            TaskName   = $Name
            TaskPath   = $Path
            State      = "NotRegistered"
            TaskObject = $null
        }
    }
}


function Register-ShipDeScheduledTask {
    param(
        [string]$Name,
        [string]$Path,
        [string]$TriggerType,
        [string]$TriggerTime,
        [int]$TriggerIntervalHours,
        [string]$Executable,
        [string]$ScriptArguments,
        [string]$WorkingDir,
        [string]$Level,
        [switch]$DoApply
    )

    Write-Host "=== SHIP DE TASK SCHEDULER: REGISTER ==="
    Write-Host "Task Name        : $Name"
    Write-Host "Task Path        : $Path"
    Write-Host "Trigger          : $TriggerType"
    if ($TriggerType -eq "Daily") {
        Write-Host "Schedule Time    : $TriggerTime"
    } elseif ($TriggerType -eq "Hourly") {
        Write-Host "Interval Hours   : $TriggerIntervalHours"
    }
    Write-Host "Run Level        : $Level"
    Write-Host "Target Executable: $Executable"
    Write-Host "Arguments        : $ScriptArguments"
    Write-Host "Working Directory: $WorkingDir"

    if (-not $DoApply) {
        Write-Host "`nPREVIEW ONLY. Re-run with -Action Register -Apply to register this scheduled task."
        return [PSCustomObject]@{
            Applied  = $false
            TaskName = $Name
            Status   = "PREVIEW_ONLY"
        }
    }

    if (-not (Test-Path -LiteralPath $Executable)) {
        throw "Target executable not found: $Executable"
    }

    $taskAction = New-ScheduledTaskAction `
        -Execute $Executable `
        -Argument $ScriptArguments `
        -WorkingDirectory $WorkingDir

    $taskTrigger = switch ($TriggerType) {
        "Logon" {
            New-ScheduledTaskTrigger -AtLogOn
        }
        "Daily" {
            New-ScheduledTaskTrigger -Daily -At $TriggerTime
        }
        "Hourly" {
            New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours $TriggerIntervalHours)
        }
    }

    $taskSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2)

    $taskPrincipal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType Interactive `
        -RunLevel $Level

    try {
        $reg = Register-ScheduledTask `
            -TaskName $Name `
            -TaskPath $Path `
            -Action $taskAction `
            -Trigger $taskTrigger `
            -Settings $taskSettings `
            -Principal $taskPrincipal `
            -Description "Ship De AI semi-automatic workflow controller ($ControllerAction)" `
            -Force
    } catch {
        if ($TriggerType -eq "Logon" -and $_.Exception.Message -match "(?i)access is denied") {
            throw "Failed to register scheduled task: AtLogOn trigger requires elevated Administrator privileges on this Windows system. Run PowerShell as Administrator, or choose -Trigger Daily for standard user scheduling."
        }
        throw "Failed to register scheduled task '$Name': $($_.Exception.Message)"
    }

    Write-Host "`nTASK REGISTERED SUCCESSFULLY"
    Write-Host "Task Name: $($reg.TaskName)"
    Write-Host "State    : $($reg.State)"
    Write-Host ""
    Write-Host "To remove this task at any time, run:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -TaskName `"$Name`" -Action Unregister -Apply"

    return [PSCustomObject]@{
        Applied    = $true
        TaskName   = $reg.TaskName
        State      = [string]$reg.State
        TaskObject = $reg
    }
}

function Unregister-ShipDeScheduledTask {
    param(
        [string]$Name,
        [string]$Path,
        [switch]$DoApply
    )

    Write-Host "=== SHIP DE TASK SCHEDULER: UNREGISTER ==="
    Write-Host "Task Name : $Name"
    Write-Host "Task Path : $Path"

    if (-not $DoApply) {
        Write-Host "`nPREVIEW ONLY. Re-run with -Action Unregister -Apply (or -Remove -Apply) to remove this scheduled task."
        return [PSCustomObject]@{
            Applied  = $false
            TaskName = $Name
            Status   = "PREVIEW_ONLY"
        }
    }

    $existing = Get-ScheduledTask -TaskName $Name -TaskPath $Path -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        Write-Host "`nTask '$Name' is not registered; nothing to remove."
        return [PSCustomObject]@{
            Applied  = $true
            TaskName = $Name
            Status   = "NOT_FOUND"
        }
    }

    Unregister-ScheduledTask -TaskName $Name -TaskPath $Path -Confirm:$false
    Write-Host "`nTASK REMOVED SUCCESSFULLY: $Name"
    return [PSCustomObject]@{
        Applied  = $true
        TaskName = $Name
        Status   = "REMOVED"
    }
}

function Invoke-ShipDeScheduleTaskTests {
    $testScript = Join-Path $PSScriptRoot "schedule-task.Tests.ps1"
    if (Test-Path -LiteralPath $testScript) {
        & $powerShellPath -ExecutionPolicy Bypass -File $testScript
        if ($LASTEXITCODE -ne 0) {
            throw "schedule-task.Tests.ps1 failed with exit code $LASTEXITCODE"
        }
    } else {
        throw "Test file not found: $testScript"
    }
}

switch ($Action) {
    "Status" {
        Get-ShipDeScheduledTaskStatus -Name $TaskName -Path $TaskPath
    }
    "Register" {
        Register-ShipDeScheduledTask `
            -Name $TaskName `
            -Path $TaskPath `
            -TriggerType $Trigger `
            -TriggerTime $Time `
            -TriggerIntervalHours $IntervalHours `
            -Executable $powerShellPath `
            -ScriptArguments $arguments `
            -WorkingDir $WorkingDirectory `
            -Level $RunLevel `
            -DoApply:$Apply
    }
    "Unregister" {
        Unregister-ShipDeScheduledTask `
            -Name $TaskName `
            -Path $TaskPath `
            -DoApply:$Apply
    }
    "Test" {
        Invoke-ShipDeScheduleTaskTests
    }
}
