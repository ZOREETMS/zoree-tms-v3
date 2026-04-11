@echo off
echo ========================================
echo  Zoree Meeting Recorder - Setup
echo ========================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Create virtual environment
echo [1/4] Creating virtual environment...
python -m venv venv
call venv\Scripts\activate.bat

:: Install dependencies
echo [2/4] Installing Python dependencies...
pip install -r requirements.txt

:: Check Ollama
echo.
echo [3/4] Checking Ollama...
ollama --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARNING] Ollama is not installed.
    echo Download from: https://ollama.com/download
    echo After installing, run: ollama pull llama3.2
    echo.
) else (
    echo Ollama found. Pulling llama3.2 model...
    ollama pull llama3.2
)

:: Done
echo.
echo [4/4] Setup complete!
echo.
echo ========================================
echo  To run the app:
echo    1. Make sure Ollama is running (ollama serve)
echo    2. Run: venv\Scripts\python app.py
echo  Or just double-click: run.bat
echo ========================================
pause
