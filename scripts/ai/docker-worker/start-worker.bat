@echo off
title Ship De - Antigravity Docker Worker (Account B)
cd /d "%~dp0"

echo ==========================================================
echo   SHIP DE - DOCKER WORKER (ISOLATED OAUTH - ACCOUNT B)
echo ==========================================================
echo.
echo Kiem tra Docker Desktop...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [CANH BAO] Docker Desktop chua duoc bat hoac chua khoi dong xong!
    echo Vui long mo Docker Desktop tu Start Menu roi bam phim bat ky de thu lai.
    pause
    exit /b 1
)

echo Dang khoi chay container Antigravity CLI...
docker compose run --rm -it gemini-worker
pause
