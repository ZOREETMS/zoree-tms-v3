@echo off
REM One-click restart for ZoreeTMS dev servers (API :3010 + frontend :5173)
cd /d "%~dp0"
echo Killing existing node processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Starting API + frontend...
start "ZoreeTMS dev" cmd /k npm run dev
echo Done. API: http://localhost:3010  Frontend: http://localhost:5173
