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
if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port"
}
Set-Location -LiteralPath $repoRoot
& node $server
