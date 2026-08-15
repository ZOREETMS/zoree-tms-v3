@echo off
cd /d C:\Zoree\zoree-tms-v3\zoree-tms-v3\api
node scripts\create-teams-bot-user.js > ..\bot-user-setup.log 2>&1
echo Done. Result in bot-user-setup.log
timeout /t 3 >nul
