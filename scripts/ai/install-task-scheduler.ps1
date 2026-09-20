<#
.SYNOPSIS
    Installs, configures, queries, or uninstalls the opt-in Windows Task Scheduler job
    for Ship Dễ autonomous background supervision and recovery.

.DESCRIPTION
    Per AI-TOOL-15 in AI-TOOLCHAIN-DECISIONS.md:
    "The final unattended entrypoint is control.ps1 -Action Resume; Supervise remains
     a stage-specific recovery action until TASK-AI-12 completes convergence."

    This script configures a scheduled task in Windows Task Scheduler that periodically
    invokes `control.ps1 -Action Resume` to perform unattended state recovery, clean stale
    locks, reconcile completed tasks, and resume interrupted pipeline runs.

    Mutations require the `-Apply` switch and are blocked when `-DryRun` or `-Preview`
    is passed. Default invocation without `-Apply` acts as a dry-run preview.

.PARAMETER Action
    The action to perform: "Status" (default), "Install", or "Uninstall".

.PARAMETER IntervalMinutes
    Repetition interval in minutes for periodic execution (default: 15, range: 1 to 1440).

.PARAMETER Profile
    Optional 9Router or ecosystem profile path to pass to control.ps1.

.PARAMETER TaskName
    Name of the scheduled task (default: "ShipDe-Autonomous-Supervisor").

.PARAMETER AiRoot
    Root directory for AI workspaces (defaults to ~/AI).

.PARAMETER DryRun
    When set, previews the action without modifying Windows Task Scheduler.

.PARAMETER Preview
    Alias for DryRun.

.PARAMETER Apply
    Required switch to apply changes when Action is "Install" or "Uninstall".

.PARAMETER AtStartup
    When set during Install, also creates a trigger to run at user logon.
#>

[CmdletBinding()]
param(
    [ValidateSet("Install", "Uninstall", "Status")]
    [string]$Action = "Status",

    [ValidateRange(1, 1440)]
    [int]$IntervalMinutes = 15,

    [string]$Profile = "",

    [string]$TaskName = "ShipDe-Autonomous-Supervisor",

    [string]$AiRoot = $(
        $userHome = if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $env:USERPROFILE } elseif (-not [string]::IsNullOrWhiteSpace($env:HOME)) { $env:HOME } else { [System.IO.Path]::GetTempPath() }
        Join-Path $userHome "AI"
    ),

    [switch]$DryRun,
    [switch]$Preview,
    [switch]$Apply,
    [switch]$AtStartup
)

$ErrorActionPreference = "Stop"

# Dot-source common.ps1 if available
$commonScript = Join-Path $PSScriptRoot "common.ps1"
if (Test-Path $commonScript) {
    . $commonScript
}

$paths = if (Get-Command Get-ShipDePaths -ErrorAction SilentlyContinue) {
    Get-ShipDePaths -AiRoot $AiRoot
} else {
    $mainDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    [PSCustomObject]@{ Main = $mainDir }
}

$controlScript = Join-Path $paths.Main "scripts\ai\control.ps1"
if (-not (Test-Path $controlScript)) {
    throw "Controller script missing: $controlScript"
}

# Resolve target PowerShell executable
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $powerShellPath)) {
    $powerShellPath = "powershell.exe"
}

# Construct arguments per AI-TOOL-15: unattended entrypoint is control.ps1 -Action Resume
$profileArg = if (-not [string]::IsNullOrWhiteSpace($Profile)) { " -NineRouterProfilePath `"$Profile`"" } else { "" }
$targetArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$controlScript`" -Action Resume$profileArg"

# Preview / DryRun evaluation: mutations require -Apply and neither -DryRun nor -Preview
$isPreview = $DryRun -or $Preview -or (-not $Apply -and $Action -ne "Status")

if ($isPreview) {
    Write-Host "[PREVIEW] [DRY-RUN] Task Scheduler action '$Action' for task '$TaskName'"
    Write-Host "  Task Name:         $TaskName"
    Write-Host "  Action:            $Action"
    Write-Host "  Interval (mins):   $IntervalMinutes"
    Write-Host "  Target Executable: $powerShellPath"
    Write-Host "  Target Arguments:  $targetArguments"
    Write-Host "  Working Directory: $($paths.Main)"
    Write-Host "  Startup Trigger:   $(if ($AtStartup) { 'Yes' } else { 'No' })"
    if ($Action -ne "Status") {
        Write-Host "[TASK-SCHEDULER] PREVIEW ONLY. Pass -Apply (without -DryRun or -Preview) to apply mutations to Windows Task Scheduler."
    }
    exit 0
}

if ($Action -eq "Status") {
    $task = $null
    if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
        try {
            $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        } catch {
            $task = $null
        }
        if ($null -ne $task) {
            Write-Host "[TASK-SCHEDULER] Task '$TaskName' is REGISTERED (State: $($task.State))."
            Write-Host "  Task Path:    $($task.TaskPath)"
            Write-Host "  Description:  $($task.Description)"
            exit 0
        } else {
            Write-Host "[TASK-SCHEDULER] Task '$TaskName' is NOT_REGISTERED."
            exit 0
        }
    } else {
        # Fallback to schtasks.exe
        $schtasksOutput = & cmd /c "schtasks.exe /Query /TN `"$TaskName`" /FO LIST 2>nul"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[TASK-SCHEDULER] Task '$TaskName' is REGISTERED (via schtasks.exe)."
            Write-Host $schtasksOutput
            exit 0
        } else {
            Write-Host "[TASK-SCHEDULER] Task '$TaskName' is NOT_REGISTERED."
            exit 0
        }
    }
}

if ($Action -eq "Install") {
    Write-Host "[TASK-SCHEDULER] Registering scheduled task '$TaskName'..."
    $installed = $false

    if (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue) {
        try {
            $taskAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument $targetArguments -WorkingDirectory $paths.Main
            $triggers = @()
            $repTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 9999)
            $triggers += $repTrigger
            if ($AtStartup) {
                $triggers += New-ScheduledTaskTrigger -AtLogOn
            }
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
            $null = Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $triggers -Settings $settings -Description "Ship De autonomous background supervisor and recovery (AI-TOOL-15)" -Force
            $installed = $true
        } catch {
            Write-Warning "[TASK-SCHEDULER] PowerShell cmdlet registration failed: $_. Falling back to schtasks.exe..."
        }
    }

    if (-not $installed) {
        $command = "`"$powerShellPath`" $targetArguments"
        $output = & cmd /c "schtasks.exe /Create /SC MINUTE /MO $IntervalMinutes /TN `"$TaskName`" /TR `"$command`" /F 2>&1"
        if ($LASTEXITCODE -ne 0) {
            throw "[TASK-SCHEDULER] Failed to register task with schtasks.exe: $output"
        }
        $installed = $true
    }

    Write-Host "[TASK-SCHEDULER][INSTALLED] Task '$TaskName' registered successfully (Interval: $IntervalMinutes minutes, Entrypoint: Resume)."
    exit 0
}

if ($Action -eq "Uninstall") {
    Write-Host "[TASK-SCHEDULER] Unregistering scheduled task '$TaskName'..."
    $uninstalled = $false

    if (Get-Command Unregister-ScheduledTask -ErrorAction SilentlyContinue) {
        $existing = try { Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch { $null }
        if ($null -eq $existing) {
            Write-Host "[TASK-SCHEDULER] Task '$TaskName' is not registered. Nothing to uninstall."
            exit 0
        }
        try {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            $uninstalled = $true
        } catch {
            Write-Warning "[TASK-SCHEDULER] PowerShell cmdlet unregister failed: $_. Falling back to schtasks.exe..."
        }
    }

    if (-not $uninstalled) {
        $output = & cmd /c "schtasks.exe /Delete /TN `"$TaskName`" /F 2>&1"
        if ($LASTEXITCODE -ne 0) {
            if ($output -match "The system cannot find the file specified" -or $output -match "ERROR: The system cannot find") {
                Write-Host "[TASK-SCHEDULER] Task '$TaskName' is not registered. Nothing to uninstall."
                exit 0
            }
            throw "[TASK-SCHEDULER] Failed to unregister task with schtasks.exe: $output"
        }
        $uninstalled = $true
    }

    Write-Host "[TASK-SCHEDULER][UNINSTALLED] Task '$TaskName' removed successfully."
    exit 0
}

