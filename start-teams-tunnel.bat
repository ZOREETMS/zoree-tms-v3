@echo off
REM Teams bot tunnel — exposes the API (POST /api/teams/messages) publicly.
REM Quick tunnel = new URL each run; update the Azure Bot messaging
REM endpoint if you restart this. Keep this window open while using the bot.
cd /d C:\Zoree\zoree-tms-v3\zoree-tms-v3
del teams_tunnel.log 2>nul
cloudflared tunnel --url http://localhost:3010 --logfile teams_tunnel.log
