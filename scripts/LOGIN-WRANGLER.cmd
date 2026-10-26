@echo off
cd /d "%~dp0\.."
echo.
echo === Cloudflare Wrangler login ===
echo This opens a browser. Sign in with the Cloudflare account that owns preeminentstore.com
echo Folder: %CD%
echo.
call npx --yes wrangler login
echo.
echo If login succeeded, verifying...
call npx --yes wrangler whoami
echo.
pause
