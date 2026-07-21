[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RestartResultFile,
  [string]$OutputFile = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourcePath = [IO.Path]::GetFullPath($RestartResultFile)
$source = Get-Content -Raw -LiteralPath $sourcePath | ConvertFrom-Json
if ($source.kind -ne 'codex-desktop-invisible-restart') { throw 'Unexpected restart result kind' }
foreach ($property in @(
  'cbt_guard_started', 'event_guard_started', 'foreground_lock_acquired',
  'primary_guarded_before_show', 'primary_moved_after_offscreen_show',
  'foreground_lock_released_after_relocation', 'cbt_guard_released_after_relocation'
)) {
  if ($source.$property -ne $true) { throw "Restart result lacks passed safety stage: $property" }
}
if ($source.matching_window_became_foreground -ne $false) { throw 'Codex Desktop became foreground during restart' }
if ([long]$source.foreground_before -ne [long]$source.foreground_during_relocation) {
  throw 'Foreground changed during guarded relocation'
}
if ([int]$source.virtual_desktop_move_exit -ne [int]$source.target_desktop_index) {
  throw 'VirtualDesktop helper did not return the target desktop index'
}

$native = @'
using System;
using System.Runtime.InteropServices;
public sealed class RacPostRestartWindowState {
  public bool Current; public Guid DesktopId; public int Cloak;
  public int X; public int Y; public int Width; public int Height; public long ExStyle;
}
public static class RacPostRestartAuditNative {
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
  private interface IVDM {
    [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] out bool current);
    [PreserveSig] int GetWindowDesktopId(IntPtr hwnd, out Guid desktopId);
    [PreserveSig] int MoveWindowToDesktop(IntPtr hwnd, ref Guid desktopId);
  }
  [ComImport, Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")] private class VDM {}
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  public static RacPostRestartWindowState Probe(IntPtr hwnd) {
    IVDM manager = (IVDM)new VDM(); bool current; Guid desktopId; int cloak = 0; RECT rect;
    if (manager.IsWindowOnCurrentVirtualDesktop(hwnd, out current) != 0) throw new Exception("desktop current probe failed");
    if (manager.GetWindowDesktopId(hwnd, out desktopId) != 0) throw new Exception("desktop id probe failed");
    if (DwmGetWindowAttribute(hwnd, 14, out cloak, 4) != 0) throw new Exception("DWM cloak probe failed");
    if (!GetWindowRect(hwnd, out rect)) throw new Exception("window bounds probe failed");
    return new RacPostRestartWindowState { Current=current, DesktopId=desktopId, Cloak=cloak,
      X=rect.L, Y=rect.T, Width=rect.R-rect.L, Height=rect.B-rect.T, ExStyle=GetWindowLongPtr(hwnd,-20).ToInt64() };
  }
}
'@
Add-Type -TypeDefinition $native

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$source.cdp_port) -ErrorAction SilentlyContinue)
if ($listeners.Count -ne 1) { throw "Expected one restored CDP listener, found $($listeners.Count)" }
$listenerPid = [int]$listeners[0].OwningProcess
if ($listenerPid -eq [int]$source.old_listener_pid) { throw 'Codex Desktop listener PID did not change' }
$main = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($main.Count -ne 1) { throw "Expected one restored Codex Desktop main window, found $($main.Count)" }
$window = [RacPostRestartAuditNative]::Probe($main[0].MainWindowHandle)
if ($window.Current -or $window.DesktopId.ToString() -ne [string]$source.target_desktop_id -or $window.Cloak -eq 0) {
  throw 'Restored Codex Desktop window is not cloaked on the target virtual desktop'
}
if ($window.X -ne [int]$source.old_window_bounds.x -or $window.Y -ne [int]$source.old_window_bounds.y -or
    $window.Width -ne [int]$source.old_window_bounds.width -or $window.Height -ne [int]$source.old_window_bounds.height) {
  throw 'Restored Codex Desktop bounds differ from the pre-restart bounds'
}
$foreground = [RacPostRestartAuditNative]::GetForegroundWindow().ToInt64()
if ($foreground -ne [long]$source.foreground_before) { throw 'Foreground was not preserved after restart' }
$targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$($source.cdp_port)/json/list" -TimeoutSec 3)
$canonical = @($targets | Where-Object {
  $_.type -eq 'page' -and [string]$_.url -match '^app://-/index\.html(?:[?#]|$)'
})
if ($canonical.Count -ne 1) { throw "Expected one canonical Codex Desktop target, found $($canonical.Count)" }

$result = [ordered]@{
  schema_version = 1
  kind = 'codex-desktop-postrestart-audit'
  ok = $true
  reporting_error_recovered = $true
  source_result = $sourcePath
  source_error = 'stale result field after verified restart stages'
  app_restarted = $true
  old_listener_pid = [int]$source.old_listener_pid
  new_listener_pid = $listenerPid
  foreground_before = [long]$source.foreground_before
  foreground_after = $foreground
  focus_changed = $false
  primary_visible_before_native_guard = [bool]$source.primary_visible_before_native_guard
  matching_window_became_foreground = [bool]$source.matching_window_became_foreground
  target_desktop_id = $window.DesktopId.ToString()
  dwm_cloak = $window.Cloak
  window_bounds = [ordered]@{ x=$window.X; y=$window.Y; width=$window.Width; height=$window.Height }
  canonical_cdp_targets = $canonical.Count
  completed_at = [DateTimeOffset]::UtcNow.ToString('o')
}
$json = $result | ConvertTo-Json -Depth 6
if ($OutputFile) {
  $output = [IO.Path]::GetFullPath($OutputFile)
  New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)) | Out-Null
  Set-Content -LiteralPath $output -Value $json -Encoding utf8
}
$json
