param(
  [string]$ShortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Codex Desktop (CDP).lnk",
  [string]$LauncherPath = (Join-Path $PSScriptRoot "..\launch-codex-desktop-cdp.vbs")
)

$ErrorActionPreference = 'Stop'

function New-IcoFromPng {
  param(
    [Parameter(Mandatory = $true)][string]$PngPath,
    [Parameter(Mandatory = $true)][string]$IcoPath
  )

  $pngBytes = [System.IO.File]::ReadAllBytes($PngPath)

  $dir = Split-Path -Parent $IcoPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $fs = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
      # ICONDIR
      $bw.Write([UInt16]0)
      $bw.Write([UInt16]1)
      $bw.Write([UInt16]1)

      # ICONDIRENTRY
      $bw.Write([byte]0)     # width 256
      $bw.Write([byte]0)     # height 256
      $bw.Write([byte]0)     # palette
      $bw.Write([byte]0)     # reserved
      $bw.Write([UInt16]1)   # color planes
      $bw.Write([UInt16]32)  # bits per pixel
      $bw.Write([UInt32]$pngBytes.Length)
      $bw.Write([UInt32]22)  # header + dir entry size

      $bw.Write($pngBytes)
      $bw.Flush()
    } finally {
      $bw.Dispose()
    }
  } finally {
    $fs.Dispose()
  }
}

$launcherFull = [System.IO.Path]::GetFullPath($LauncherPath)
if (-not (Test-Path -LiteralPath $launcherFull)) {
  throw "Launcher not found: $launcherFull"
}

$pkg = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $pkg) {
  throw "OpenAI.Codex package is not installed."
}

$installLocation = $pkg.InstallLocation
$exePath = Join-Path $installLocation "app\Codex.exe"
$pngCandidates = @(
  (Join-Path $installLocation "assets\Square44x44Logo.targetsize-256_altform-unplated.png"),
  (Join-Path $installLocation "assets\Square44x44Logo.targetsize-256.png"),
  (Join-Path $installLocation "assets\Square150x150Logo.scale-200.png"),
  (Join-Path $installLocation "assets\icon.png")
)
$pngPath = $pngCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Codex executable not found: $exePath"
}
if (-not $pngPath) {
  throw "Could not locate a Codex icon asset under: $installLocation\assets"
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$iconDir = Join-Path $repoRoot "launcher-icons"
$iconPath = Join-Path $iconDir "codex-desktop-launcher.ico"
New-IcoFromPng -PngPath $pngPath -IcoPath $iconPath

$shortcutDir = Split-Path -Parent $ShortcutPath
if ($shortcutDir -and -not (Test-Path -LiteralPath $shortcutDir)) {
  New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$shortcut.Arguments = '"' + $launcherFull + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $launcherFull
$shortcut.IconLocation = $iconPath + ",0"
$shortcut.WindowStyle = 7
$shortcut.Description = "Launch Codex Desktop with CDP enabled on port 9225"
$shortcut.Save()

[pscustomobject]@{
  ShortcutPath = $ShortcutPath
  IconPath = $iconPath
  PackageVersion = [string]$pkg.Version
  PackageInstallLocation = $installLocation
  LauncherPath = $launcherFull
}
