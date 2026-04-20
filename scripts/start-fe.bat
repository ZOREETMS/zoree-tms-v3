@echo off
cd /d "%~dp0\..\frontend"
start /MIN "" cmd /c "npm run dev > ..\frontend_run2.log 2>&1"
