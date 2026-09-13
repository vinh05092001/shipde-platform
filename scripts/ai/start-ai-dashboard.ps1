<#
.SYNOPSIS
    Khởi chạy Bảng Điều Khiển AI Developer Cockpit dành riêng cho kỹ sư lập trình Ship Dễ.
    TASK-AI-15: AI15-R05 (Loopback only), AI15-AC07
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 3333,

    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 Đang khởi động Ship Dễ AI Developer Cockpit..." -ForegroundColor Green
Write-Host "📍 Cổng lắng nghe (Loopback): http://127.0.0.1:$Port" -ForegroundColor Yellow
Write-Host "📦 Giám sát 150 đầu mục công việc & các mô hình AI" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Kiểm tra môi trường Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "Không tìm thấy Node.js trong môi trường PATH. Vui lòng cài đặt Node.js >= 24."
    exit 1
}

# 2. Tạo shortcut ra Desktop làm lối tắt offline
$desktop = [Environment]::GetFolderPath("Desktop")
if (-not $desktop) { $desktop = "$env:USERPROFILE\Desktop" }
if (Test-Path $desktop) {
    if (Test-Path ".\DASHBOARD.html") {
        Copy-Item ".\DASHBOARD.html" "$desktop\Ship Dễ AI Dashboard.html" -Force -ErrorAction SilentlyContinue
        Write-Host "[✓] Đã đồng bộ 'Ship Dễ AI Dashboard.html' ra ngoài Desktop!" -ForegroundColor Green
    }
}

# 3. Mở trình duyệt kết nối tới server loopback
if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port"
}

# 4. Khởi chạy server Node.js strictly loopback 127.0.0.1
$env:PORT = $Port
& node tools/ai-dashboard/server.js
