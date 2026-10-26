@echo off
title The PreEminent Store - Portal
cd /d "%~dp0"

REM The portal normally runs in the background (started at Windows logon). If it is already up, just open it.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  start "" "http://localhost:5173/inventory-stock.html"
  exit /b
)

REM Not running: start the background service (it keeps the portal alive), then open the browser.
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\portal-service.ps1"
echo Starting portal on http://localhost:5173 ...
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173/inventory-stock.html"
