param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [switch]$Apply
)

. (Join-Path $PSScriptRoot "common.ps1")

$paths = Get-ShipDePaths -AiRoot $AiRoot
$controlScript = Join-Path $paths.Main "scripts\ai\control.ps1"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Ship De AI Control.lnk"
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoExit -ExecutionPolicy Bypass -File `"$controlScript`" -Action Menu"

Write-Host "=== SHIP DE CONTROL SHORTCUT ==="
Write-Host "Target   : $powerShellPath"
Write-Host "Arguments: $arguments"
Write-Host "Shortcut : $shortcutPath"

if (-not $Apply) {
    Write-Host "`nPREVIEW ONLY. Re-run with -Apply to create or replace this one shortcut."
    exit 0
}

Assert-ShipDeRepository -Path $paths.Main
if (-not (Test-Path $controlScript)) {
    throw "Controller is missing: $controlScript"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $paths.Main
$shortcut.IconLocation = "$powerShellPath,0"
$shortcut.Description = "Ship De human-gated semi-automatic AI controller"
$shortcut.Save()

Write-Host "`nCONTROL SHORTCUT READY"
Write-Host "Open '$shortcutPath', then choose Continue pipeline."
