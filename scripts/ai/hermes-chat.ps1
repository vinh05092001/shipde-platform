[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$cliPath = Join-Path $repoRoot "tools\ai-brain\cli.js"

if (-not (Test-Path -LiteralPath $cliPath)) {
    throw "Ship De Brain CLI not found at '$cliPath'"
}

Set-Location -LiteralPath $repoRoot
& node $cliPath chat @RemainingArgs
exit $LASTEXITCODE
