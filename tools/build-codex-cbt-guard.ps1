[CmdletBinding()]
param(
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $OutputPath) {
  $OutputPath = Join-Path $PSScriptRoot 'native\rac-codex-cbt-guard-v3.dll'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'vswhere.exe is not installed' }
$install = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $install) { throw 'Visual C++ x64 tools are not installed' }
$devCmd = Join-Path $install 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $devCmd)) { throw "VsDevCmd.bat is missing: $devCmd" }

$source = Join-Path $PSScriptRoot 'native\rac-codex-cbt-guard.cpp'
$output = [IO.Path]::GetFullPath($OutputPath)
$buildDir = Join-Path $env:TEMP 'rac-codex-cbt-guard-build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($output)) | Out-Null
$object = Join-Path $buildDir 'rac-codex-cbt-guard.obj'
$importLibrary = Join-Path $buildDir 'rac-codex-cbt-guard.lib'
$pdb = Join-Path $buildDir 'rac-codex-cbt-guard.pdb'
$command = 'call "{0}" -arch=x64 -host_arch=x64 >nul && cl.exe /nologo /LD /O2 /guard:cf /DUNICODE /D_UNICODE "{1}" /Fo"{2}" /link /Brepro user32.lib shlwapi.lib /OUT:"{3}" /IMPLIB:"{4}" /PDB:"{5}"' -f $devCmd, $source, $object, $output, $importLibrary, $pdb
& cmd.exe /d /s /c $command
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $output)) {
  throw "CBT guard build failed with exit code $exitCode"
}
Get-Item -LiteralPath $output | Select-Object FullName, Length, LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath $output
