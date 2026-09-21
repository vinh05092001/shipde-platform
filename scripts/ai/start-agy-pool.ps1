param(
    [int]$Port = 3344,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repoRoot 'tools\agy-pool\server.js'
if (-not (Test-Path -LiteralPath $server)) { throw "Agy pool server not found: $server" }

$env:AGY_POOL_PORT = $Port
$env:SHIPDE_WORKSPACE = $repoRoot
$poolUrl = "http://127.0.0.1:$Port"
$stateUrl = "$poolUrl/api/state"

$isReady = $false
try {
    $null = Invoke-RestMethod -Uri $stateUrl -TimeoutSec 1
    $isReady = $true
} catch {
    $isReady = $false
}

if (-not $isReady) {
    $nodeProcess = Start-Process -FilePath 'node' -ArgumentList @($server) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        if ($nodeProcess.HasExited) {
            throw "Agy pool server exited before becoming ready (exit code $($nodeProcess.ExitCode))."
        }

        try {
            $null = Invoke-RestMethod -Uri $stateUrl -TimeoutSec 1
            $isReady = $true
            break
        } catch {
            # Keep polling until the bounded startup deadline expires.
        }
    }
}

if (-not $isReady) {
    throw "Agy pool server did not become ready at $poolUrl."
}

Write-Host "Ship De Agy Worker Pool: $poolUrl"
if (-not $NoBrowser) {
    Start-Process $poolUrl
}
