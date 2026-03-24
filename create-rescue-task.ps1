$taskName = "rescue-proxy-task"
$batPath = "C:\Users\Robert\Documents\Remote Agent Chat\restart-rescue-proxy.bat"
$workDir = "C:\Users\Robert\Documents\Remote Agent Chat"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Action: run the bat file from the project directory
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`"" -WorkingDirectory $workDir

# Trigger: at logon for current user
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Settings: allow to run on battery, no time limit, restart on failure
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval ([TimeSpan]::FromMinutes(1))

# Register the task to run as current user (interactive)
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Description "Always-on rescue proxy for Remote Agent Chat. Auto-restarts on crash."

Write-Host "Task '$taskName' created successfully."
Write-Host "Starting task now..."

Start-ScheduledTask -TaskName $taskName

Start-Sleep -Seconds 3
$task = Get-ScheduledTask -TaskName $taskName
Write-Host "Task state: $($task.State)"
