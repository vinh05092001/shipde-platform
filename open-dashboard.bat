@echo off
chcp 65001 >nul
echo ======================================================
echo 🚀 Đang khởi động Ship Dễ AI Developer Cockpit...
echo ======================================================

REM 1. Kiểm tra môi trường Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [CẢNH BÁO] Không tìm thấy Node.js trong PATH!
    echo Đang mở giao diện tĩnh DASHBOARD.html...
    start "" "%~dp0DASHBOARD.html"
    pause
    exit /b 1
)

REM 2. Đưa bản dashboard ra Desktop làm lối tắt thuận tiện
set "TARGET_DESKTOP=%USERPROFILE%\Desktop"
if not exist "%TARGET_DESKTOP%" set "TARGET_DESKTOP=%HOMEDRIVE%%HOMEPATH%\Desktop"
if exist "%TARGET_DESKTOP%" (
    copy /y "%~dp0DASHBOARD.html" "%TARGET_DESKTOP%\Ship Dễ AI Dashboard.html" >nul 2>&1
)

REM 3. Khởi chạy server nền lắng nghe strictly tại loopback 127.0.0.1:3333 (AI15-R05)
start "ShipDe AI Dashboard Server" /min cmd /c "node "%~dp0tools\ai-dashboard\server.js""

REM 4. Mở trình duyệt kết nối tới server thời gian thực
timeout /t 1 >nul
start "" "http://127.0.0.1:3333"

echo [OK] Ship Dễ AI Cockpit đã sẵn sàng tại http://127.0.0.1:3333
timeout /t 2 >nul
