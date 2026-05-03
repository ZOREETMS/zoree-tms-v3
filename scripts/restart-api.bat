@echo off
REM Restart the API server. Targets only the process listening on port
REM 3001 so this does NOT also kill the Vite frontend (5173) or any
REM unrelated node.exe (editor language servers, etc.).
REM
REM Pair script for start-api.bat — use after editing api/services/* so
REM the new code actually loads (start-api.bat uses plain `node server.js`,
REM no nodemon, so a manual restart is required to pick up changes).

setlocal enabledelayedexpansion

echo Stopping API server on port 3001...
set "API_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  set "API_PID=%%a"
)
if defined API_PID (
  taskkill /F /PID !API_PID! > nul 2>&1
  if !ERRORLEVEL!==0 (
    echo   Killed PID !API_PID!.
  ) else (
    echo   Could not kill PID !API_PID! ^(may have already exited^).
  )
) else (
  echo   No process listening on port 3001 ^(already stopped^).
)

REM Brief pause so the OS releases the port before we relaunch.
timeout /t 2 /nobreak > nul

echo Starting API server...
cd /d "%~dp0\..\api"
start /MIN "" cmd /c "node server.js > ..\api_run2.log 2>&1"
echo   API restarted. Watch ..\api_run2.log for boot output.
echo.
echo Done. You can close this window.
timeout /t 3 /nobreak > nul

endlocal
