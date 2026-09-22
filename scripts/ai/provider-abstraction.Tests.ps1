# TASK-AI-48: Provider abstraction tests
# Tests the execution provider abstraction layer and verifies that the controller
# can run with either AO or Paseo, and that provider selection is deterministic.

param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI")
)

. (Join-Path $PSScriptRoot "common.ps1")

$script:TestsPassed = 0
$script:TestsFailed = 0
$script:TestResults = @()

function Assert-TestCondition {
    param(
        [Parameter(Mandatory = $true)][string]$TestId,
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)][bool]$Condition,
        [string]$FailureMessage = ""
    )

    if ($Condition) {
        Write-Host "[PASS] $TestId - $Description" -ForegroundColor Green
        $script:TestsPassed++
        $script:TestResults += [PSCustomObject]@{
            TestId = $TestId
            Description = $Description
            Result = "PASS"
            Message = ""
        }
    } else {
        Write-Host "[FAIL] $TestId - $Description" -ForegroundColor Red
        if ($FailureMessage) {
            Write-Host "       $FailureMessage" -ForegroundColor Yellow
        }
        $script:TestsFailed++
        $script:TestResults += [PSCustomObject]@{
            TestId = $TestId
            Description = $Description
            Result = "FAIL"
            Message = $FailureMessage
        }
    }
}

Write-Host "=== TASK-AI-48 Provider Abstraction Tests ==="
Write-Host ""

# Load control.ps1 to access provider functions
$controlScript = Join-Path $PSScriptRoot "control.ps1"
if (-not (Test-Path $controlScript)) {
    Write-Host "[ERROR] control.ps1 not found at $controlScript" -ForegroundColor Red
    exit 1
}

# AC-AI-48-01: AO provider selected, AO present
Write-Host "--- AC-AI-48-01: AO provider with AO present ---"
$aoCmd = Get-Command ao -ErrorAction SilentlyContinue
if ($aoCmd) {
    $env:SHIPDE_EXECUTION_PROVIDER = "ao"
    try {
        . $controlScript -Action Test 6>$null
        Assert-TestCondition `
            -TestId "AC-AI-48-01-A" `
            -Description "Provider initialization selects 'ao' when SHIPDE_EXECUTION_PROVIDER=ao" `
            -Condition ($script:CurrentProvider -eq "ao") `
            -FailureMessage "Expected 'ao', got '$script:CurrentProvider'"

        Assert-TestCondition `
            -TestId "AC-AI-48-01-B" `
            -Description "AO assertions are available when provider=ao" `
            -Condition ((Get-Command Assert-ShipDeAoCommand -ErrorAction SilentlyContinue) -ne $null) `
            -FailureMessage "Assert-ShipDeAoCommand function not found"

        $readiness = Test-ShipDeProviderReadiness
        Assert-TestCondition `
            -TestId "AC-AI-48-01-C" `
            -Description "Provider readiness check returns structured result" `
            -Condition ($null -ne $readiness -and $readiness.PSObject.Properties['Ready'] -ne $null) `
            -FailureMessage "Readiness check did not return expected structure"

    } catch {
        Assert-TestCondition `
            -TestId "AC-AI-48-01-ERROR" `
            -Description "AO provider initialization should not throw" `
            -Condition $false `
            -FailureMessage $_.Exception.Message
    } finally {
        $env:SHIPDE_EXECUTION_PROVIDER = $null
    }
} else {
    Write-Host "[SKIP] AC-AI-48-01: AO not installed on this system" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ""

# AC-AI-48-04: Provider name not recognised
Write-Host "--- AC-AI-48-04: Unrecognised provider name ---"
$env:SHIPDE_EXECUTION_PROVIDER = "invalid-provider-name"
try {
    $errorThrown = $false
    $errorMessage = ""
    try {
        . $controlScript -Action Test 6>$null
    } catch {
        $errorThrown = $true
        $errorMessage = $_.Exception.Message
    }

    Assert-TestCondition `
        -TestId "AC-AI-48-04-A" `
        -Description "Unrecognised provider throws during initialization" `
        -Condition $errorThrown `
        -FailureMessage "No error was thrown for invalid provider"

    Assert-TestCondition `
        -TestId "AC-AI-48-04-B" `
        -Description "Error message states UNSUPPORTED_PROVIDER" `
        -Condition ($errorMessage -match "UNSUPPORTED_PROVIDER") `
        -FailureMessage "Error did not contain UNSUPPORTED_PROVIDER: $errorMessage"

    Assert-TestCondition `
        -TestId "AC-AI-48-04-C" `
        -Description "Error message lists supported providers" `
        -Condition ($errorMessage -match "ao" -and $errorMessage -match "paseo") `
        -FailureMessage "Error did not list supported providers: $errorMessage"

} finally {
    $env:SHIPDE_EXECUTION_PROVIDER = $null
}

Write-Host ""

# AC-AI-48-02: Paseo selected and the ao binary is absent from PATH.
Write-Host "--- AC-AI-48-02: Paseo provider with ao absent from PATH ---"
$savedPath = $env:PATH
$env:SHIPDE_EXECUTION_PROVIDER = "paseo"
$env:PATH = ""
try {
    . $controlScript -Action Test 6>$null
    $aoResolved = Get-Command ao -ErrorAction SilentlyContinue

    Assert-TestCondition `
        -TestId "AC-AI-48-02-A" `
        -Description "Paseo provider initializes while ao is absent from PATH" `
        -Condition ($script:CurrentProvider -eq "paseo" -and $null -eq $aoResolved) `
        -FailureMessage "Expected provider 'paseo' with no ao command; provider='$script:CurrentProvider'"

    $paseoReadiness = Test-ShipDeProviderReadiness
    Assert-TestCondition `
        -TestId "AC-AI-48-02-B" `
        -Description "Absent ao is not consulted; readiness names the Paseo provider instead" `
        -Condition ($paseoReadiness.Ready -eq $false -and [string]$paseoReadiness.Reason -match "PROVIDER_UNAVAILABLE" -and [string]$paseoReadiness.Reason -notmatch "\bao\b") `
        -FailureMessage "Expected PROVIDER_UNAVAILABLE for paseo, got: $($paseoReadiness.Reason)"
} catch {
    Assert-TestCondition `
        -TestId "AC-AI-48-02-ERROR" `
        -Description "Selecting Paseo must not require the ao binary" `
        -Condition $false `
        -FailureMessage $_.Exception.Message
} finally {
    $env:PATH = $savedPath
    $env:SHIPDE_EXECUTION_PROVIDER = $null
}

Write-Host ""

# AC-AI-48-03: Paseo is selected but its daemon does not answer.
Write-Host "--- AC-AI-48-03: Paseo daemon unreachable ---"
$env:SHIPDE_EXECUTION_PROVIDER = "paseo"
try {
    . $controlScript -Action Test 6>$null
    $stoppedDaemon = { param($arguments) [PSCustomObject]@{ ExitCode = 1; Stdout = ""; Stderr = "connection refused: 127.0.0.1:6767" } }
    $unreachable = Test-ShipDeProviderReadiness -CommandRunner $stoppedDaemon

    Assert-TestCondition `
        -TestId "AC-AI-48-03-A" `
        -Description "A stopped Paseo daemon fails readiness" `
        -Condition ($unreachable.Ready -eq $false) `
        -FailureMessage "Readiness returned Ready=$($unreachable.Ready)"

    Assert-TestCondition `
        -TestId "AC-AI-48-03-B" `
        -Description "The failure names the provider and the unreachable daemon" `
        -Condition ([string]$unreachable.Reason -match "PROVIDER_UNREACHABLE" -and [string]$unreachable.Reason -match "6767") `
        -FailureMessage "Expected PROVIDER_UNREACHABLE naming the daemon, got: $($unreachable.Reason)"

    Assert-TestCondition `
        -TestId "AC-AI-48-03-C" `
        -Description "No silent fallback to AO occurs" `
        -Condition ($script:CurrentProvider -eq "paseo") `
        -FailureMessage "Provider changed to '$script:CurrentProvider' after the daemon failure"
} catch {
    Assert-TestCondition `
        -TestId "AC-AI-48-03-ERROR" `
        -Description "Unreachable daemon is reported, not thrown as an unhandled error" `
        -Condition $false `
        -FailureMessage $_.Exception.Message
} finally {
    $env:SHIPDE_EXECUTION_PROVIDER = $null
}

Write-Host ""

# AC-AI-48-05: doctor.ps1 reports the selected provider and does not execute the controller.
Write-Host "--- AC-AI-48-05: doctor reports the selected provider only ---"
$doctorScript = Join-Path $PSScriptRoot "doctor.ps1"
$doctorText = Get-Content -LiteralPath $doctorScript -Raw
Assert-TestCondition `
    -TestId "AC-AI-48-05-A" `
    -Description "doctor.ps1 no longer dot-sources control.ps1" `
    -Condition ($doctorText -notmatch '(?m)^\s*\.\s+\$controlPath\s*$') `
    -FailureMessage "doctor.ps1 still dot-sources the controller"

$env:SHIPDE_EXECUTION_PROVIDER = "paseo"
$doctorOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $doctorScript 2>&1 | Out-String
$doctorExit = $LASTEXITCODE
$env:SHIPDE_EXECUTION_PROVIDER = $null
Assert-TestCondition `
    -TestId "AC-AI-48-05-B" `
    -Description "doctor.ps1 reports the Paseo provider it inspected" `
    -Condition ($doctorOutput -match "Selected provider:\s+paseo") `
    -FailureMessage "Doctor output did not name the selected provider"
Assert-TestCondition `
    -TestId "AC-AI-48-05-C" `
    -Description "An absent AO installation is informational, not a doctor failure" `
    -Condition ($doctorOutput -match "AO installation:.*(informational|not required)" -and $doctorExit -eq 0) `
    -FailureMessage "Doctor exit $doctorExit; output: $doctorOutput"

Write-Host ""

# AC-AI-48-06: the merge preflight does not depend on the execution provider.
Write-Host "--- AC-AI-48-06: merge preflight is provider-independent ---"
$preflightText = (Get-Command Test-ShipDeMergePreflight).Definition
Assert-TestCondition `
    -TestId "AC-AI-48-06-A" `
    -Description "Test-ShipDeMergePreflight calls no provider session API" `
    -Condition ($preflightText -notmatch "ShipDe(Ao|Paseo)(Session|Message|Worker)") `
    -FailureMessage "Merge preflight references a provider session API"

$env:SHIPDE_EXECUTION_PROVIDER = "ao"
. $controlScript -Action Test 6>$null
$env:SHIPDE_EXECUTION_PROVIDER = "paseo"
. $controlScript -Action Test 6>$null
Assert-TestCondition `
    -TestId "AC-AI-48-06-B" `
    -Description "Switching provider does not change the preflight function" `
    -Condition ((Get-Command Test-ShipDeMergePreflight).Definition -eq $preflightText -and $script:CurrentProvider -eq "paseo") `
    -FailureMessage "Preflight definition changed when the provider changed to '$script:CurrentProvider'"
$env:SHIPDE_EXECUTION_PROVIDER = $null

Write-Host ""

# AC-AI-48-07: a session recorded under one provider is not adopted under the other.
Write-Host "--- AC-AI-48-07: foreign provider session is not adopted ---"
$env:SHIPDE_EXECUTION_PROVIDER = "paseo"
. $controlScript -Action Test 6>$null
$foreignCheckpoint = [PSCustomObject]@{
    PullRequestNumber = 48
    WorkItemId = "TASK-AI-48"
    Branch = "feat/task-ai-48-controller-without-ao"
    Author = "GEMINI"
    Provider = "ao"
    SessionId = "ao-session-1"
}
$foreignRejected = $false
$foreignMessage = ""
try {
    Assert-ShipDeRestoredCheckpointValidity `
        -Checkpoint $foreignCheckpoint `
        -ExpectedPullRequestNumber 48 `
        -ExpectedWorkItemId "TASK-AI-48" `
        -ExpectedBranch "feat/task-ai-48-controller-without-ao" `
        -ExpectedAuthor "GEMINI"
} catch {
    $foreignRejected = $true
    $foreignMessage = $_.Exception.Message
}
Assert-TestCondition `
    -TestId "AC-AI-48-07-A" `
    -Description "A checkpoint produced by AO is refused while Paseo is selected" `
    -Condition ($foreignRejected -and $foreignMessage -match "FOREIGN_PROVIDER_SESSION") `
    -FailureMessage "Expected FOREIGN_PROVIDER_SESSION, got: $foreignMessage"
Assert-TestCondition `
    -TestId "AC-AI-48-07-B" `
    -Description "The refusal names both providers" `
    -Condition ($foreignMessage -match "'ao'" -and $foreignMessage -match "'paseo'") `
    -FailureMessage "Refusal did not name both providers: $foreignMessage"
$env:SHIPDE_EXECUTION_PROVIDER = $null

Write-Host ""

# Summary
Write-Host "=== Test Summary ==="
Write-Host "Passed: $script:TestsPassed" -ForegroundColor Green
Write-Host "Failed: $script:TestsFailed" -ForegroundColor $(if ($script:TestsFailed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($script:TestsFailed -gt 0) {
    Write-Host "Failed tests:" -ForegroundColor Red
    $script:TestResults | Where-Object { $_.Result -eq "FAIL" } | ForEach-Object {
        Write-Host "  [$($_.TestId)] $($_.Description)" -ForegroundColor Yellow
        if ($_.Message) {
            Write-Host "    $($_.Message)" -ForegroundColor Gray
        }
    }
    exit 1
} else {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
}
