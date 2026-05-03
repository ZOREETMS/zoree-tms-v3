@echo off
REM Restart the Vite frontend dev server. Targets only the process
REM listening on port 5173 so this does NOT also kill the API (3001) or
REM any unrelated node.exe (editor language servers, etc.).
REM
REM NOTE: Most frontend changes (.jsx / .js / .css under frontend/src)
REM are picked up automatically by Vite's hot module reload — just
REM refresh the browser tab. You usually only need this script when:
REM   - vite.config.js changed
REM   - dependencies changed (package.json)
REM   - HMR got stuck and the browser is showing stale code
REM   - the dev server crashed
REM
REM Pair script for start-fe.bat.

setlocal enabledelayedexpansion

echo Stopping Vite frontend on port 5173...
set "FE_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
  set "FE_PID=%%a"
)
if defined FE_PID (
  taskkill /F /PID !FE_PID! /T > nul 2>&1
  if !ERRORLEVEL!==0 (
    echo   Killed PID !FE_PID! ^(and child processes^).
  ) else (
    echo   Could not kill PID !FE_PID! ^(may have already exited^).
  )
) else (
  echo   No process listening on port 5173 ^(already stopped^).
)

REM Brief pause so the OS releases the port before we relaunch.
timeout /t 2 /nobreak > nul

echo Starting Vite frontend...
cd /d "%~dp0\..\frontend"
start /MIN "" cmd /c "npm run dev > ..\frontend_run2.log 2>&1"
echo   Frontend restarted. Watch ..\frontend_run2.log for boot output.
echo   Then refresh your browser tab once the log shows "Local: http://localhost:5173".
echo.
echo Done. You can close this window.
timeout /t 3 /nobreak > nul

endlocal
