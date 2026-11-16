@echo off
REM Double-click (or run) to start the ZoreeTMS MCP server + Cloudflare tunnel.
REM Keep this window open while Claude is using the connector.
cd /d "%~dp0"
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-with-tunnel.ps1"
