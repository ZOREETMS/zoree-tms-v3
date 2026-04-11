@echo off
cd /d "%~dp0"

:: Activate virtual environment
call venv\Scripts\activate.bat 2>nul

:: Start the app (using pythonw to avoid console window)
start "" pythonw app.py
