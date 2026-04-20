@echo off
cd /d "%~dp0\..\api"
start /MIN "" cmd /c "node server.js > ..\api_run2.log 2>&1"
