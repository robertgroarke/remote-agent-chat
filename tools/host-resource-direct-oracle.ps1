$ErrorActionPreference = 'Stop'

$rows = [Collections.Generic.List[object]]::new()
$unavailable = [Collections.Generic.List[string]]::new()
$totalPhysicalBytes = [int64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory

function Add-Counter([string]$category, [string]$counter, [string]$instance = '') {
  try {
    $handle = if ($instance) {
      [Diagnostics.PerformanceCounter]::new($category, $counter, $instance, $true)
    } else {
      [Diagnostics.PerformanceCounter]::new($category, $counter, $true)
    }
    [void]$handle.NextValue()
    $rows.Add([pscustomobject]@{ category = $category; counter = $counter; instance = $instance; handle = $handle })
  } catch {
    $unavailable.Add("$category/$counter/$instance")
  }
}

function Read-Value([string]$category, [string]$counter, [string]$instance = '') {
  $row = $rows | Where-Object { $_.category -eq $category -and $_.counter -eq $counter -and $_.instance -eq $instance } | Select-Object -First 1
  if (-not $row) { return $null }
  try {
    $value = [double]$row.handle.NextValue()
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return $null }
    return $value
  } catch { return $null }
}

function Add-Instance-Counters([string]$category, [string[]]$counters) {
  try {
    foreach ($instance in @([Diagnostics.PerformanceCounterCategory]::new($category).GetInstanceNames())) {
      foreach ($counter in $counters) { Add-Counter $category $counter $instance }
    }
  } catch {
    $unavailable.Add("$category/*")
  }
}

Add-Counter 'Processor' '% Processor Time' '_Total'
Add-Instance-Counters 'Processor' @('% Processor Time')
Add-Counter 'Memory' 'Available Bytes'
Add-Counter 'System' 'Processes'
foreach ($counter in @(
  'Disk Read Bytes/sec', 'Disk Write Bytes/sec', 'Avg. Disk sec/Read',
  'Avg. Disk sec/Write', 'Avg. Disk sec/Transfer'
)) { Add-Counter 'PhysicalDisk' $counter '_Total' }
Add-Instance-Counters 'Network Interface' @('Bytes Received/sec', 'Bytes Sent/sec')

[Console]::Out.WriteLine(([ordered]@{
  type = 'ready'
  helper_pid = $PID
  total_physical_bytes = $totalPhysicalBytes
  counter_count = $rows.Count
  unavailable = @($unavailable)
} | ConvertTo-Json -Compress))
[Console]::Out.Flush()

try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $command = $line | ConvertFrom-Json
    if ($command.type -eq 'stop') { break }
    if ($command.type -ne 'sample') { continue }
    $adapters = @($rows | Where-Object category -eq 'Network Interface' | Select-Object -ExpandProperty instance -Unique)
    $physical = @($adapters | Where-Object { $_ -notmatch '(?i)loopback|isatap|teredo|tunnel|vpn|vethernet|virtual|hyper-v|bluetooth' })
    $receive = [double]0
    $send = [double]0
    foreach ($adapter in $physical) {
      $rx = Read-Value 'Network Interface' 'Bytes Received/sec' $adapter
      $tx = Read-Value 'Network Interface' 'Bytes Sent/sec' $adapter
      if ($null -ne $rx) { $receive += $rx }
      if ($null -ne $tx) { $send += $tx }
    }
    $perLogical = @($rows |
      Where-Object { $_.category -eq 'Processor' -and $_.counter -eq '% Processor Time' -and $_.instance -ne '_Total' } |
      Sort-Object { if ($_.instance -match '^\d+$') { [int]$_.instance } else { [int]::MaxValue } } |
      ForEach-Object { [ordered]@{ id = $_.instance; utilization_percent = Read-Value 'Processor' '% Processor Time' $_.instance } })
    [Console]::Out.WriteLine(([ordered]@{
      type = 'sample'
      request_id = [string]$command.request_id
      captured_at = [DateTime]::UtcNow.ToString('o')
      counter_paths = [ordered]@{
        cpu_total = '\\Processor(_Total)\\% Processor Time'
        memory_available = '\\Memory\\Available Bytes'
        process_total = '\\System\\Processes'
        disk_read = '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec'
        disk_write = '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec'
        disk_read_latency = '\\PhysicalDisk(_Total)\\Avg. Disk sec/Read'
        disk_write_latency = '\\PhysicalDisk(_Total)\\Avg. Disk sec/Write'
        network_receive = '\\Network Interface(*)\\Bytes Received/sec (physical-default sum)'
        network_send = '\\Network Interface(*)\\Bytes Sent/sec (physical-default sum)'
      }
      cpu_percent = Read-Value 'Processor' '% Processor Time' '_Total'
      cpu_per_logical = $perLogical
      memory_available_bytes = Read-Value 'Memory' 'Available Bytes'
      memory_total_bytes = $totalPhysicalBytes
      process_total = Read-Value 'System' 'Processes'
      disk_read_bps = Read-Value 'PhysicalDisk' 'Disk Read Bytes/sec' '_Total'
      disk_write_bps = Read-Value 'PhysicalDisk' 'Disk Write Bytes/sec' '_Total'
      disk_read_latency_ms = 1000 * (Read-Value 'PhysicalDisk' 'Avg. Disk sec/Read' '_Total')
      disk_write_latency_ms = 1000 * (Read-Value 'PhysicalDisk' 'Avg. Disk sec/Write' '_Total')
      network_receive_bps = $receive
      network_send_bps = $send
      physical_network_instances = $physical
    } | ConvertTo-Json -Depth 6 -Compress))
    [Console]::Out.Flush()
  }
} finally {
  foreach ($row in $rows) { try { $row.handle.Dispose() } catch {} }
}
