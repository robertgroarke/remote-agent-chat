@echo off
setlocal enabledelayedexpansion

set "WD=%~dp0agent-proxy"
set "LOG=%~dp0rescue-proxy.log"
set "ERRLOG=%~dp0rescue-proxy-err.log"

REM Load local overrides (NODE_EXE, etc.) from proxy-env.bat if it exists
if exist "%~dp0proxy-env.bat" call "%~dp0proxy-env.bat"

REM Default to "node" on PATH if NODE_EXE not set or empty
if not defined NODE_EXE set "NODE_EXE=node"
if "!NODE_EXE!"=="" set "NODE_EXE=node"

REM Verify node executable exists before entering restart loop
"!NODE_EXE!" --version >nul 2>&1
if errorlevel 1 (
    echo [%DATE% %TIME%] ERROR: NODE_EXE="!NODE_EXE!" not found. Falling back to PATH node.
    echo [%DATE% %TIME%] ERROR: NODE_EXE="!NODE_EXE!" not found >> "%ERRLOG%"
    set "NODE_EXE=node"
    node --version >nul 2>&1
    if errorlevel 1 (
        echo [%DATE% %TIME%] FATAL: No node.exe found. Exiting.
        echo [%DATE% %TIME%] FATAL: No node.exe found >> "%ERRLOG%"
        exit /b 1
    )
)

title Rescue Proxy (auto-restart)
echo [%DATE% %TIME%] Rescue proxy restart wrapper started. Close this window to stop.
echo.

:loop
echo [%DATE% %TIME%] Starting rescue proxy...
echo [%DATE% %TIME%] [launcher] Starting rescue proxy... >> "%LOG%"
cd /d "%WD%"
"!NODE_EXE!" rescue-proxy.js >> "%LOG%" 2>> "%ERRLOG%"
set EXIT_CODE=%ERRORLEVEL%
echo [%DATE% %TIME%] Rescue proxy exited (code %EXIT_CODE%). Restarting in 10s... Press Ctrl+C to stop.
echo [%DATE% %TIME%] [launcher] Rescue proxy exited (code %EXIT_CODE%), restarting in 10s... >> "%ERRLOG%"
timeout /t 10 /nobreak >nul
goto loop
