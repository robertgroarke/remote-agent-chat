Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:PolicyPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared\windows-automation-launch-policy.json'
$script:Policy = Get-Content -LiteralPath $script:PolicyPath -Raw | ConvertFrom-Json

function Test-RacAutomationContext {
    if ($env:NODE_ENV -eq 'test') { return 'NODE_ENV' }
    foreach ($name in $script:Policy.automation_environment_keys) {
        $value = [Environment]::GetEnvironmentVariable([string]$name)
        if ($value -match '^(1|true|yes|on|test|e2e|validator|synthetic)$') { return [string]$name }
    }
    return $null
}

function Assert-RacWindowlessLaunchSpec {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Modality,
        [bool]$Visible = $false,
        [bool]$Headless = $true,
        [bool]$CreateNoWindow = $true,
        [string]$WindowStyle = 'Hidden',
        [bool]$UseShellExecute = $false
    )
    if ($Visible -or -not $Headless -or -not $CreateNoWindow -or
        $WindowStyle -ne 'Hidden' -or $UseShellExecute) {
        throw "Visible or unproven $Modality launch denied by $($script:Policy.policy_id)"
    }
    [pscustomobject]@{
        ok = $true
        modality = $Modality
        classification = 'windowless-at-creation'
    }
}

function New-RacHiddenProcessStartInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $PSScriptRoot
    )
    $null = Assert-RacWindowlessLaunchSpec -Modality 'powershell'
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) { $null = $info.ArgumentList.Add($argument) }
    return $info
}

Export-ModuleMember -Function Test-RacAutomationContext, Assert-RacWindowlessLaunchSpec, New-RacHiddenProcessStartInfo
