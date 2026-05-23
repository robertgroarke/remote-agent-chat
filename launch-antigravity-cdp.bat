@echo off
setlocal

REM Default Antigravity install path — override with ANTIGRAVITY_EXE env var
REM v1.23.2 IDE lives in the "Antigravity IDE" folder as Antigravity.exe
REM (the plain "Antigravity" folder holds the v2 "Agentic Desktop" app).
if defined ANTIGRAVITY_EXE (
    set "AG_EXE=%ANTIGRAVITY_EXE%"
) else (
    set "AG_EXE=%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity.exe"
)
set "CDP_PORT=9223"
set ELECTRON_RUN_AS_NODE=

REM Electron only honors --remote-debugging-port on process startup.
REM If Antigravity is already running, a plain "start" reuses the existing
REM instance and CDP never comes up. Force a clean relaunch instead.
powershell -NoProfile -Command "Get-Process Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '%AG_EXE%' } | Stop-Process -Force" 2>nul
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul

start "" "%AG_EXE%" --remote-debugging-port=%CDP_PORT% --remote-debugging-address=127.0.0.1
