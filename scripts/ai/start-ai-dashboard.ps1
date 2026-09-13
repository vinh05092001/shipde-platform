<#
.SYNOPSIS
    Khởi chạy Bảng Điều Khiển AI Developer Cockpit dành riêng cho kỹ sư lập trình Ship Dễ.
#>
param(
    [int]$Port = 3333
)

$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
Set-Location $repoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 Đang khởi động Ship Dễ AI Developer Cockpit..." -ForegroundColor Green
Write-Host "📍 Cổng lắng nghe: http://localhost:$Port" -ForegroundColor Yellow
Write-Host "📦 Giám sát 148 đầu mục công việc & 4 AI Models" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Đưa shortcut ra Desktop
$desktop = [Environment]::GetFolderPath("Desktop")
if (-not $desktop) { $desktop = "$env:USERPROFILE\Desktop" }
if (Test-Path $desktop) {
    Copy-Item ".\DASHBOARD.html" "$desktop\Ship Dễ AI Dashboard.html" -Force -ErrorAction SilentlyContinue
    Write-Host "[✓] Đã tạo icon 'Ship Dễ AI Dashboard.html' ra ngoài Desktop!" -ForegroundColor Green
}


# 2. Khởi chạy server Node.js nền, chờ cổng sẵn sàng rồi mới mở trình duyệt
$env:PORT = $Port
$server = Start-Process -FilePath "node" -ArgumentList "tools/ai-dashboard/server.js" -WorkingDirectory $repoRoot -PassThru -NoNewWindow

$ready = $false
foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 250
    try {
        $probe = New-Object System.Net.Sockets.TcpClient
        $probe.Connect("127.0.0.1", $Port)
        $probe.Close()
        $ready = $true
        break
    } catch { }
}

# 3. Mở trình duyệt
if ($ready) {
    Write-Host "[✓] Server đã sẵn sàng sau $([math]::Round($i * 0.25, 1))s" -ForegroundColor Green
    Start-Process "http://localhost:$Port"
} else {
    Write-Host "[!] Server không phản hồi trên cổng $Port, mở bản tĩnh DASHBOARD.html thay thế." -ForegroundColor Yellow
    Start-Process ".\DASHBOARD.html"
}

# 4. Giữ cửa sổ — Ctrl+C để dừng server
Write-Host "Nhấn Ctrl+C để dừng server." -ForegroundColor DarkGray
try {
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
