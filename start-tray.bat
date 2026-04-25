@echo off
title Agent Proxy — System Tray
cd /d "%~dp0"

:: Install dependencies if not already present
python -c "import pystray, PIL" 2>nul
if errorlevel 1 (
    echo Installing tray dependencies...
    python -m pip install -r requirements-tray.txt --quiet
)

echo Starting Agent Proxy tray icon...
pythonw proxy_tray.py
