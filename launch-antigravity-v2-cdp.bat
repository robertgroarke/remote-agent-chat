@echo off
setlocal

REM Antigravity v2 Agent Manager launcher (standalone app, CDP port 9226).
REM Distinct from launch-antigravity-cdp.bat, which launches the v1 IDE on 9223.
if defined ANTIGRAVITY_V2_EXE (
    set "AGV2_EXE=%ANTIGRAVITY_V2_EXE%"
) else (
    set "AGV2_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
)
set "CDP_PORT=9226"
set "AGV2_USER_DATA=%USERPROFILE%\AntigravityV2\data"
set "AGV2_EXTENSIONS=%USERPROFILE%\AntigravityV2\extensions"
set ELECTRON_RUN_AS_NODE=

REM Kill only the v2 install path so v1 Antigravity IDE windows are left alone.
powershell -NoProfile -Command "Get-Process Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '%AGV2_EXE%' } | Stop-Process -Force" 2>nul
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul

start "" "%AGV2_EXE%" --user-data-dir="%AGV2_USER_DATA%" --extensions-dir="%AGV2_EXTENSIONS%" --remote-debugging-port=%CDP_PORT% --remote-debugging-address=127.0.0.1

echo [antigravity-v2] Waiting for CDP on port %CDP_PORT%...
powershell -NoProfile -Command "Start-Sleep -Seconds 5" >nul

curl -s --max-time 3 http://localhost:%CDP_PORT%/json/list >nul 2>&1
if %errorlevel% equ 0 (
    echo [antigravity-v2] CDP ready ^> http://localhost:%CDP_PORT%/json/list
) else (
    echo [antigravity-v2] WARNING: CDP not yet responding on port %CDP_PORT%
    echo                  App may still be starting ^- check manually.
)
