@echo off
chcp 65001 >nul
echo ======================================================
echo 🚀 Đang mở Ship Dễ AI Developer Cockpit Dashboard...
echo ======================================================

REM 1. Đưa bản mới nhất ra Desktop
set "TARGET_DESKTOP=%USERPROFILE%\Desktop"
if not exist "%TARGET_DESKTOP%" set "TARGET_DESKTOP=%HOMEDRIVE%%HOMEPATH%\Desktop"
if exist "%TARGET_DESKTOP%" (
    copy /y "%~dp0DASHBOARD.html" "%TARGET_DESKTOP%\Ship Dễ AI Dashboard.html" >nul 2>&1
)

REM 2. Mở trực tiếp Dashboard trên trình duyệt ngay lập tức (148 Tasks hiển thị 0ms)
start "" "%~dp0DASHBOARD.html"

REM 3. Khởi động server nền cổng 3333 để hỗ trợ API telemetry
start "ShipDe AI Dashboard Server" /min cmd /c "node "%~dp0tools\ai-dashboard\server.js""

echo [OK] Đã mở Dashboard thành công!
timeout /t 2 >nul
