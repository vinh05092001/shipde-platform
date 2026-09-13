<#
.SYNOPSIS
    Tạo shortcut "Ship Dễ AI Dashboard" ngoài Desktop để mở cockpit bằng một cú nhấp.
#>
param(
    [int]$Port = 3333
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Join-Path $repoRoot "scripts\ai\start-ai-dashboard.ps1"

if (-not (Test-Path $launcher)) {
    throw "Không tìm thấy launcher: $launcher"
}

$desktop = [Environment]::GetFolderPath("Desktop")
if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE "Desktop" }
$linkPath = Join-Path $desktop "Ship De AI Dashboard.lnk"

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -Port $Port"
$link.WorkingDirectory = $repoRoot
$link.Description = "Mo Ship De AI Developer Cockpit tren cong $Port"
$link.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
$link.Save()

Write-Host "[OK] Da tao shortcut: $linkPath" -ForegroundColor Green
Write-Host "     Nhap doi de mo dashboard tren http://localhost:$Port" -ForegroundColor Cyan
