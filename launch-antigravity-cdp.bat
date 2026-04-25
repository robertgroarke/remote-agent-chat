@echo off
setlocal

REM Default Antigravity install path — override with ANTIGRAVITY_EXE env var
if defined ANTIGRAVITY_EXE (
    set "AG_EXE=%ANTIGRAVITY_EXE%"
) else (
    set "AG_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
)
set "CDP_PORT=9223"

REM Electron only honors --remote-debugging-port on process startup.
REM If Antigravity is already running, a plain "start" reuses the existing
REM instance and CDP never comes up. Force a clean relaunch instead.
taskkill /IM Antigravity.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

start "" "%AG_EXE%" --remote-debugging-port=%CDP_PORT% --remote-debugging-address=127.0.0.1
