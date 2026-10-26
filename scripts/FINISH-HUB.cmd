@echo off
cd /d "%~dp0\.."
echo.
echo === PreEminent hub restore (from GitHub release, not OneDrive) ===
echo Folder: %CD%
echo.
git pull --ff-only origin main
if errorlevel 1 (
  echo git pull failed - check GitHub login as sunderlandivan
  pause
  exit /b 1
)
powershell -ExecutionPolicy Bypass -File "%~dp0restore-hub-from-release.ps1"
echo.
pause
