Set WshShell = CreateObject("WScript.Shell")

' Kill existing Codex Desktop (WindowsApps only)
WshShell.Run "powershell -NoProfile -Command ""Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*WindowsApps*' } | Stop-Process -Force""", 0, True

WScript.Sleep 2000

' Write the PowerShell launcher script to temp
Dim fso, tempFile, ps1Path
Set fso = CreateObject("Scripting.FileSystemObject")
ps1Path = WshShell.ExpandEnvironmentStrings("%TEMP%") & "\launch-codex-cdp.ps1"

Set tempFile = fso.CreateTextFile(ps1Path, True)
tempFile.WriteLine "Add-Type -TypeDefinition @'"
tempFile.WriteLine "using System;"
tempFile.WriteLine "using System.Runtime.InteropServices;"
tempFile.WriteLine "public static class MsixLauncher {"
tempFile.WriteLine "    [ComImport][Guid(""2e941141-7f97-4756-ba1d-9decde894a3d"")]"
tempFile.WriteLine "    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]"
tempFile.WriteLine "    private interface IApplicationActivationManager {"
tempFile.WriteLine "        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string aumid,"
tempFile.WriteLine "                                [MarshalAs(UnmanagedType.LPWStr)] string args,"
tempFile.WriteLine "                                int options, out uint processId);"
tempFile.WriteLine "        int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string a, IntPtr b,"
tempFile.WriteLine "                            [MarshalAs(UnmanagedType.LPWStr)] string c, out uint d);"
tempFile.WriteLine "        int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string a, IntPtr b, out uint c);"
tempFile.WriteLine "    }"
tempFile.WriteLine "    [ComImport][Guid(""45ba127d-10a8-46ea-8ab7-56ea9078943c"")]"
tempFile.WriteLine "    [ClassInterface(ClassInterfaceType.None)]"
tempFile.WriteLine "    private class AppActivationManagerCoClass {}"
tempFile.WriteLine "    public static uint Launch(string aumid, string args) {"
tempFile.WriteLine "        var mgr = (IApplicationActivationManager) new AppActivationManagerCoClass();"
tempFile.WriteLine "        uint launchPid;"
tempFile.WriteLine "        int hr = mgr.ActivateApplication(aumid, args, 0, out launchPid);"
tempFile.WriteLine "        if (hr != 0) throw new Exception(""HRESULT=0x"" + hr.ToString(""X""));"
tempFile.WriteLine "        return launchPid;"
tempFile.WriteLine "    }"
tempFile.WriteLine "}"
tempFile.WriteLine "'@"
tempFile.WriteLine "[MsixLauncher]::Launch('OpenAI.Codex_2p2nqsd0c76g0!App', '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1 --remote-allow-origins=*') | Out-Null"
tempFile.Close

' Run the PowerShell script hidden
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & ps1Path & """", 0, True

' Clean up
fso.DeleteFile ps1Path, True
