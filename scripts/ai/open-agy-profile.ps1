param(
    [Parameter(Mandatory = $true)][ValidatePattern('^agy-[1-4]$')][string]$ProfileId,
    [Parameter(Mandatory = $true)][string]$ProfileHome,
    [Parameter(Mandatory = $true)][string]$Workspace,
    [ValidateSet('Login', 'Chat')][string]$Mode = 'Chat'
)

$ErrorActionPreference = 'Stop'
$agy = Get-Command agy -ErrorAction Stop
New-Item -ItemType Directory -Path $ProfileHome -Force | Out-Null
$appDataDir = Join-Path $ProfileHome '.gemini\antigravity-cli'
New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null

$env:HOME = $ProfileHome
$env:USERPROFILE = $ProfileHome
$env:JETSKI_APP_DATA_DIR = $appDataDir
$Host.UI.RawUI.WindowTitle = "Ship De - $ProfileId - $Mode"
Set-Location -LiteralPath $Workspace

Write-Host "Ship De Agy Worker: $ProfileId" -ForegroundColor Cyan
Write-Host "Profile home: $ProfileHome" -ForegroundColor DarkGray
if ($Mode -eq 'Login') {
    Write-Host "Complete the official Agy sign-in flow in this isolated profile." -ForegroundColor Yellow
}
& $agy.Source
