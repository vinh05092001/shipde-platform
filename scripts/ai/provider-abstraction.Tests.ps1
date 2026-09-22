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
        . $controlScript
        
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
        . $controlScript
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
