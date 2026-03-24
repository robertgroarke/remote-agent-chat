@echo off
setlocal

set "CDP_PORT=9225"
set "AUMID=OpenAI.Codex_2p2nqsd0c76g0!App"
set "TEMP_PS1=%TEMP%\launch-codex-cdp.ps1"

REM Kill the WindowsApps Codex instance only.
REM The Antigravity Codex extension also runs codex.exe from a different path.
powershell -NoProfile -Command "Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*WindowsApps*' } | Stop-Process -Force" 2>nul

timeout /t 2 /nobreak >nul

REM Launch via IApplicationActivationManager COM (required for MSIX apps to receive args)
(
echo Add-Type -TypeDefinition @'
echo using System;
echo using System.Runtime.InteropServices;
echo public static class MsixLauncher {
echo     [ComImport][Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
echo     [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
echo     private interface IApplicationActivationManager {
echo         int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string aumid,
echo                                 [MarshalAs(UnmanagedType.LPWStr)] string args,
echo                                 int options, out uint processId^);
echo         int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string a, IntPtr b,
echo                             [MarshalAs(UnmanagedType.LPWStr)] string c, out uint d^);
echo         int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string a, IntPtr b, out uint c^);
echo     }
echo     [ComImport][Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")]
echo     [ClassInterface(ClassInterfaceType.None)]
echo     private class AppActivationManagerCoClass {}
echo     public static uint Launch(string aumid, string args^) {
echo         var mgr = (IApplicationActivationManager^) new AppActivationManagerCoClass(^);
echo         uint launchPid;
echo         int hr = mgr.ActivateApplication(aumid, args, 0, out launchPid^);
echo         if (hr ^!= 0^) throw new Exception("HRESULT=0x" + hr.ToString("X"^)^);
echo         return launchPid;
echo     }
echo }
echo '@
echo [MsixLauncher]::Launch("%AUMID%", "--remote-debugging-port=%CDP_PORT% --remote-debugging-address=127.0.0.1 --remote-allow-origins=*"^) ^| Out-Null
) > "%TEMP_PS1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS1%"
del "%TEMP_PS1%" 2>nul

echo [codex-desktop] Waiting for CDP on port %CDP_PORT%...
timeout /t 8 /nobreak >nul

curl -s --max-time 3 http://localhost:%CDP_PORT%/json/list >nul 2>&1
if %errorlevel% equ 0 (
    echo [codex-desktop] CDP ready ^> http://localhost:%CDP_PORT%/json/list
) else (
    echo [codex-desktop] WARNING: CDP not yet responding on port %CDP_PORT%
    echo                 App may still be starting ^- check manually.
)
