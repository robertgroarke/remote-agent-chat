@echo off
setlocal enabledelayedexpansion

set "WD=%~dp0agent-proxy"
set "LOG=%~dp0proxy.log"
set "ERRLOG=%~dp0proxy-err.log"

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

title Agent Proxy (auto-restart)
echo [%DATE% %TIME%] Agent proxy restart wrapper started. Close this window to stop.
echo.

:loop
echo [%DATE% %TIME%] Starting proxy...
echo [%DATE% %TIME%] [launcher] Starting proxy... >> "%LOG%"
cd /d "%WD%"
"!NODE_EXE!" index.js >> "%LOG%" 2>> "%ERRLOG%"
set EXIT_CODE=%ERRORLEVEL%
echo [%DATE% %TIME%] Proxy exited (code %EXIT_CODE%). Restarting in 5s... Press Ctrl+C to stop.
echo [%DATE% %TIME%] [launcher] Proxy exited (code %EXIT_CODE%), restarting in 5s... >> "%ERRLOG%"
timeout /t 5 /nobreak >nul
goto loop
