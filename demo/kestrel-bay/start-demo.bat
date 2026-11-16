@echo off
title Kestrel Bay invoice agent
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not on PATH. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules\express\package.json call npm install --no-audit --no-fund
set OPEN_BROWSER=1
node server.js
echo.
echo Server stopped. Read the message above.
pause
