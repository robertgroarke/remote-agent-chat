$ErrorActionPreference = 'Stop'

$startupStopwatch = [Diagnostics.Stopwatch]::StartNew()
$counterRows = [Collections.Generic.List[object]]::new()
$counterUnavailable = [Collections.Generic.List[string]]::new()
$processMetadata = @{}
$previousProcesses = @{}
$previousPidStarts = @{}
$processCategory = [Diagnostics.PerformanceCounterCategory]::new('Process')
$logicalDiskMetadata = @{}
$physicalCoreCount = 0
$pagefileAllocatedBytes = 0
$memoryCommitPeakBytes = 0

function Number-Or-Zero($value) {
  if ($null -eq $value) { return [double]0 }
  return [double]$value
}

function Add-Counter([string]$category, [string]$counter, [string]$instance = '') {
  try {
    $performanceCounter = if ($instance) {
      [Diagnostics.PerformanceCounter]::new($category, $counter, $instance, $true)
    } else {
      [Diagnostics.PerformanceCounter]::new($category, $counter, $true)
    }
    [void]$performanceCounter.NextValue()
    $counterRows.Add([pscustomobject]@{
      category = $category
      counter = $counter
      instance = $instance
      handle = $performanceCounter
    })
  } catch {
    $counterUnavailable.Add("$category/$counter/$instance")
  }
}

function Add-CategoryCounters([string]$category, [string[]]$counterNames) {
  try {
    $instances = @([Diagnostics.PerformanceCounterCategory]::new($category).GetInstanceNames())
    foreach ($instance in $instances) {
      foreach ($counter in $counterNames) { Add-Counter $category $counter $instance }
    }
  } catch {
    $counterUnavailable.Add("$category/*")
  }
}

function Refresh-CapabilityMetadata {
  $script:processMetadata = @{}
  foreach ($process in @(Get-CimInstance Win32_Process)) {
    $script:processMetadata[[int]$process.ProcessId] = [string]$process.CommandLine
  }
  $script:logicalDiskMetadata = @{}
  foreach ($disk in @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $script:logicalDiskMetadata[[string]$disk.DeviceID] = [pscustomobject]@{
      capacity_bytes = [int64]$disk.Size
      free_bytes = [int64]$disk.FreeSpace
    }
  }
  $script:physicalCoreCount = [int](
    (Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum
  )
  $script:pagefileAllocatedBytes = [int64](
    ((Get-CimInstance Win32_PageFileUsage | Measure-Object AllocatedBaseSize -Sum).Sum) * 1MB
  )
}

function Initialize-Counters {
  foreach ($pair in @(
    @('System', 'Processor Queue Length'),
    @('System', 'Context Switches/sec'),
    @('System', 'Processes'),
    @('System', 'Threads'),
    @('System', 'System Up Time'),
    @('Memory', 'Cache Bytes'),
    @('Memory', 'Committed Bytes'),
    @('Memory', 'Commit Limit'),
    @('Memory', '% Committed Bytes In Use'),
    @('Memory', 'Pool Paged Bytes'),
    @('Memory', 'Pool Nonpaged Bytes'),
    @('Memory', 'Pages/sec'),
    @('Memory', 'Page Faults/sec')
  )) { Add-Counter $pair[0] $pair[1] }
  foreach ($counter in @('Interrupts/sec', 'DPC Rate')) { Add-Counter 'Processor' $counter '_Total' }
  Add-Counter 'Process' 'Handle Count' '_Total'
  Add-Counter 'Paging File' '% Usage' '_Total'
  foreach ($counter in @('Segments/sec', 'Segments Retransmitted/sec', 'Connection Failures', 'Connections Reset')) {
    Add-Counter 'TCPv4' $counter
  }
  Add-CategoryCounters 'PhysicalDisk' @(
    'Disk Read Bytes/sec', 'Disk Write Bytes/sec', 'Disk Reads/sec', 'Disk Writes/sec',
    '% Disk Time', 'Avg. Disk sec/Read', 'Avg. Disk sec/Write', 'Avg. Disk sec/Transfer',
    'Current Disk Queue Length'
  )
  Add-CategoryCounters 'LogicalDisk' @(
    'Disk Read Bytes/sec', 'Disk Write Bytes/sec', 'Disk Reads/sec', 'Disk Writes/sec',
    '% Disk Time', 'Avg. Disk sec/Read', 'Avg. Disk sec/Write', 'Avg. Disk sec/Transfer',
    'Current Disk Queue Length', '% Free Space'
  )
  Add-CategoryCounters 'Network Interface' @(
    'Bytes Received/sec', 'Bytes Sent/sec', 'Packets Received/sec', 'Packets Sent/sec',
    'Current Bandwidth', 'Output Queue Length', 'Packets Received Errors',
    'Packets Outbound Errors', 'Packets Received Discarded', 'Packets Outbound Discarded'
  )
}

function Counter-Key([string]$category, [string]$instance, [string]$counter) {
  return "$category|$instance|$counter"
}

function Read-Counters {
  $values = @{}
  foreach ($row in $counterRows) {
    try {
      $values[(Counter-Key $row.category $row.instance $row.counter)] = [double]$row.handle.NextValue()
    } catch {
      $values[(Counter-Key $row.category $row.instance $row.counter)] = 0
    }
  }
  return $values
}

function Counter-Value($values, [string]$category, [string]$counter, [string]$instance = '') {
  $value = $values[(Counter-Key $category $instance $counter)]
  if ($null -eq $value -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) { return [double]0 }
  return [double]$value
}

function Safe-Delta([string]$current, [string]$previous, [double]$seconds) {
  if ($seconds -le 0 -or -not $previous) { return [double]0 }
  $currentValue = [decimal]$current
  $previousValue = [decimal]$previous
  if ($currentValue -lt $previousValue) { return [double]0 }
  return [double](($currentValue - $previousValue) / [decimal]$seconds)
}

function Read-Processes {
  # ReadCategory materializes the native Process performance-counter snapshot in
  # one call. Once primed at startup it avoids a full CIM/WMI round trip every
  # five seconds while preserving the same raw counters and process identities.
  $snapshot = $processCategory.ReadCategory()
  $idProcesses = $snapshot['ID Process']
  $instances = @($idProcesses.Keys)
  $next = @{}
  $nextPidStarts = @{}
  $resetCount = 0
  $pidReuseCount = 0
  $processes = @($instances | ForEach-Object {
    $instance = [string]$_
    $processId = [int]$idProcesses[$instance].RawValue
    if ($processId -le 0) { return }
    $startCounter = [string]$snapshot['Elapsed Time'][$instance].RawValue
    $key = "$processId|$startCounter"
    $timestamp = [string]$snapshot['% Processor Time'][$instance].Sample.TimeStamp100nSec
    $previous = $previousProcesses[$key]
    if (-not $previous -and (
      $previousPidStarts.ContainsKey($processId) -and
      $previousPidStarts[$processId] -ne $startCounter
    )) { $pidReuseCount += 1 }
    $seconds = if ($previous) { ([double]([decimal]$timestamp - [decimal]$previous.timestamp)) / 10000000 } else { 0 }
    $cpuRaw = [string]$snapshot['% Processor Time'][$instance].RawValue
    $readBytesRaw = [string]$snapshot['IO Read Bytes/sec'][$instance].RawValue
    $writeBytesRaw = [string]$snapshot['IO Write Bytes/sec'][$instance].RawValue
    $readOpsRaw = [string]$snapshot['IO Read Operations/sec'][$instance].RawValue
    $writeOpsRaw = [string]$snapshot['IO Write Operations/sec'][$instance].RawValue
    # The Process category exposes % Processor Time as accumulated 100 ns CPU
    # ticks. Safe-Delta returns ticks per second, so divide by 100,000 to
    # convert 10,000,000 ticks/sec into 100 core-equivalent percentage points.
    $cpu = (Safe-Delta $cpuRaw $(if ($previous) { $previous.cpu } else { '' }) $seconds) / 100000
    $readBps = Safe-Delta $readBytesRaw $(if ($previous) { $previous.read_bytes } else { '' }) $seconds
    $writeBps = Safe-Delta $writeBytesRaw $(if ($previous) { $previous.write_bytes } else { '' }) $seconds
    $readOps = Safe-Delta $readOpsRaw $(if ($previous) { $previous.read_ops } else { '' }) $seconds
    $writeOps = Safe-Delta $writeOpsRaw $(if ($previous) { $previous.write_ops } else { '' }) $seconds
    if ($previous -and (
      [decimal]$cpuRaw -lt [decimal]$previous.cpu -or
      [decimal]$readBytesRaw -lt [decimal]$previous.read_bytes -or
      [decimal]$writeBytesRaw -lt [decimal]$previous.write_bytes
    )) { $resetCount += 1 }
    $next[$key] = [pscustomobject]@{
      timestamp = $timestamp
      cpu = $cpuRaw
      read_bytes = $readBytesRaw
      write_bytes = $writeBytesRaw
      read_ops = $readOpsRaw
      write_ops = $writeOpsRaw
    }
    $nextPidStarts[$processId] = $startCounter
    $startTime = try { [DateTime]::FromFileTimeUtc([int64]$startCounter).ToString('o') } catch { $null }
    [pscustomobject][ordered]@{
      pid = $processId
      parent_pid = [int]$snapshot['Creating Process ID'][$instance].RawValue
      start_time = $startTime
      name = ($instance -replace '#\d+$', '')
      command_line = [string]$processMetadata[$processId]
      cpu_percent = [math]::Max(0, $cpu)
      memory_bytes = [int64]$snapshot['Working Set'][$instance].RawValue
      private_bytes = [int64]$snapshot['Private Bytes'][$instance].RawValue
      commit_bytes = [int64]$snapshot['Page File Bytes'][$instance].RawValue
      io_read_bps = [math]::Max(0, $readBps)
      io_write_bps = [math]::Max(0, $writeBps)
      io_read_ops = [math]::Max(0, $readOps)
      io_write_ops = [math]::Max(0, $writeOps)
      io_read_bytes_total = $readBytesRaw
      io_write_bytes_total = $writeBytesRaw
      io_read_operations_total = $readOpsRaw
      io_write_operations_total = $writeOpsRaw
      thread_count = [int]$snapshot['Thread Count'][$instance].RawValue
      handle_count = [int]$snapshot['Handle Count'][$instance].RawValue
      status = 'running'
    }
  })
  $script:previousProcesses = $next
  $script:previousPidStarts = $nextPidStarts
  return [pscustomobject]@{ rows = $processes; reset_count = $resetCount; pid_reuse_count = $pidReuseCount }
}

function Read-DiskFamilies($values) {
  $families = @()
  foreach ($category in @('PhysicalDisk', 'LogicalDisk')) {
    $instances = @($counterRows | Where-Object category -eq $category | Select-Object -ExpandProperty instance -Unique)
    foreach ($instance in $instances) {
      if ($instance -eq '_Total') { continue }
      $metadata = if ($category -eq 'LogicalDisk') { $logicalDiskMetadata[$instance] } else { $null }
      $capacity = if ($metadata) { [int64]$metadata.capacity_bytes } else { 0 }
      $free = if ($metadata) { [int64]$metadata.free_bytes } else { 0 }
      $families += [pscustomobject][ordered]@{
        id = "${category}:$instance"
        label = $instance
        kind = if ($category -eq 'PhysicalDisk') { 'physical' } else { 'logical' }
        read_bps = Counter-Value $values $category 'Disk Read Bytes/sec' $instance
        write_bps = Counter-Value $values $category 'Disk Write Bytes/sec' $instance
        read_iops = Counter-Value $values $category 'Disk Reads/sec' $instance
        write_iops = Counter-Value $values $category 'Disk Writes/sec' $instance
        busy_percent = Counter-Value $values $category '% Disk Time' $instance
        read_latency_ms = (Counter-Value $values $category 'Avg. Disk sec/Read' $instance) * 1000
        write_latency_ms = (Counter-Value $values $category 'Avg. Disk sec/Write' $instance) * 1000
        transfer_latency_ms = (Counter-Value $values $category 'Avg. Disk sec/Transfer' $instance) * 1000
        queue_length = Counter-Value $values $category 'Current Disk Queue Length' $instance
        capacity_bytes = $capacity
        free_bytes = $free
        free_percent = if ($capacity -gt 0) { ($free / $capacity) * 100 } else { Counter-Value $values $category '% Free Space' $instance }
        available = $true
      }
    }
  }
  return @($families | Select-Object -First 24)
}

function Read-NetworkFamilies($values) {
  $instances = @($counterRows | Where-Object category -eq 'Network Interface' | Select-Object -ExpandProperty instance -Unique)
  return @($instances | Select-Object -First 24 | ForEach-Object {
    $instance = $_
    $physical = $instance -notmatch '(?i)loopback|isatap|teredo|tunnel|vpn|vethernet|virtual|hyper-v|bluetooth'
    $receive = Counter-Value $values 'Network Interface' 'Bytes Received/sec' $instance
    $send = Counter-Value $values 'Network Interface' 'Bytes Sent/sec' $instance
    $bandwidth = Counter-Value $values 'Network Interface' 'Current Bandwidth' $instance
    [pscustomobject][ordered]@{
      id = $instance
      label = $instance
      kind = if ($physical) { 'physical' } else { 'virtual' }
      physical_default = $physical
      receive_bps = $receive
      send_bps = $send
      receive_pps = Counter-Value $values 'Network Interface' 'Packets Received/sec' $instance
      send_pps = Counter-Value $values 'Network Interface' 'Packets Sent/sec' $instance
      link_speed_bps = $bandwidth
      utilization_percent = if ($bandwidth -gt 0) { [math]::Min(100, (($receive + $send) * 8 / $bandwidth) * 100) } else { 0 }
      output_queue_length = Counter-Value $values 'Network Interface' 'Output Queue Length' $instance
      receive_errors = Counter-Value $values 'Network Interface' 'Packets Received Errors' $instance
      send_errors = Counter-Value $values 'Network Interface' 'Packets Outbound Errors' $instance
      receive_discards = Counter-Value $values 'Network Interface' 'Packets Received Discarded' $instance
      send_discards = Counter-Value $values 'Network Interface' 'Packets Outbound Discarded' $instance
      available = $true
    }
  })
}

function Collect-Detail {
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $values = Read-Counters
  $processResult = Read-Processes
  $disks = Read-DiskFamilies $values
  $adapters = Read-NetworkFamilies $values
  $physical = @($adapters | Where-Object physical_default)
  $commitBytes = Counter-Value $values 'Memory' 'Committed Bytes'
  if ($commitBytes -gt $memoryCommitPeakBytes) { $script:memoryCommitPeakBytes = [int64]$commitBytes }
  $result = [ordered]@{
    processor_queue_length = Counter-Value $values 'System' 'Processor Queue Length'
    interrupts_per_sec = Counter-Value $values 'Processor' 'Interrupts/sec' '_Total'
    dpcs_per_sec = Counter-Value $values 'Processor' 'DPC Rate' '_Total'
    context_switches_per_sec = Counter-Value $values 'System' 'Context Switches/sec'
    memory_cache_bytes = Counter-Value $values 'Memory' 'Cache Bytes'
    physical_core_count = $physicalCoreCount
    memory_commit_bytes = $commitBytes
    memory_commit_limit_bytes = Counter-Value $values 'Memory' 'Commit Limit'
    memory_commit_peak_bytes = $memoryCommitPeakBytes
    memory_commit_percent = Counter-Value $values 'Memory' '% Committed Bytes In Use'
    memory_paged_pool_bytes = Counter-Value $values 'Memory' 'Pool Paged Bytes'
    memory_nonpaged_pool_bytes = Counter-Value $values 'Memory' 'Pool Nonpaged Bytes'
    pagefile_used_bytes = (Counter-Value $values 'Paging File' '% Usage' '_Total') * $pagefileAllocatedBytes / 100
    pages_per_sec = Counter-Value $values 'Memory' 'Pages/sec'
    faults_per_sec = Counter-Value $values 'Memory' 'Page Faults/sec'
    disk_read_bps = Counter-Value $values 'PhysicalDisk' 'Disk Read Bytes/sec' '_Total'
    disk_write_bps = Counter-Value $values 'PhysicalDisk' 'Disk Write Bytes/sec' '_Total'
    disk_busy_percent = Counter-Value $values 'PhysicalDisk' '% Disk Time' '_Total'
    disk_read_iops = Counter-Value $values 'PhysicalDisk' 'Disk Reads/sec' '_Total'
    disk_write_iops = Counter-Value $values 'PhysicalDisk' 'Disk Writes/sec' '_Total'
    disk_read_latency_ms = (Counter-Value $values 'PhysicalDisk' 'Avg. Disk sec/Read' '_Total') * 1000
    disk_write_latency_ms = (Counter-Value $values 'PhysicalDisk' 'Avg. Disk sec/Write' '_Total') * 1000
    disk_transfer_latency_ms = (Counter-Value $values 'PhysicalDisk' 'Avg. Disk sec/Transfer' '_Total') * 1000
    disk_queue_length = Counter-Value $values 'PhysicalDisk' 'Current Disk Queue Length' '_Total'
    disks = $disks
    network_receive_bps = [double](($physical | Measure-Object receive_bps -Sum).Sum)
    network_send_bps = [double](($physical | Measure-Object send_bps -Sum).Sum)
    network_receive_pps = [double](($physical | Measure-Object receive_pps -Sum).Sum)
    network_send_pps = [double](($physical | Measure-Object send_pps -Sum).Sum)
    network_utilization_percent = [double](($physical | Measure-Object utilization_percent -Sum).Sum)
    network_output_queue_length = [double](($physical | Measure-Object output_queue_length -Sum).Sum)
    network_receive_errors = [double](($physical | Measure-Object receive_errors -Sum).Sum)
    network_send_errors = [double](($physical | Measure-Object send_errors -Sum).Sum)
    network_receive_discards = [double](($physical | Measure-Object receive_discards -Sum).Sum)
    network_send_discards = [double](($physical | Measure-Object send_discards -Sum).Sum)
    network_adapters = $adapters
    tcp_segments_per_sec = Counter-Value $values 'TCPv4' 'Segments/sec'
    tcp_retransmits_per_sec = Counter-Value $values 'TCPv4' 'Segments Retransmitted/sec'
    tcp_connection_failures = Counter-Value $values 'TCPv4' 'Connection Failures'
    tcp_resets = Counter-Value $values 'TCPv4' 'Connections Reset'
    process_total = $processResult.rows.Count
    thread_total = Counter-Value $values 'System' 'Threads'
    handle_total = Counter-Value $values 'Process' 'Handle Count' '_Total'
    uptime_seconds = Counter-Value $values 'System' 'System Up Time'
    processes = $processResult.rows
    counter_reset_count = $processResult.reset_count
    pid_reuse_count = $processResult.pid_reuse_count
  }
  $stopwatch.Stop()
  return [pscustomobject]@{
    raw = $result
    collection_duration_ms = [math]::Round($stopwatch.Elapsed.TotalMilliseconds)
  }
}

try {
  Refresh-CapabilityMetadata
  Initialize-Counters
  # Pay the one-time category initialization before advertising readiness so
  # every timed detail collection uses the low-overhead native snapshot path.
  [void]$processCategory.ReadCategory()
  [Console]::Out.WriteLine(([ordered]@{
    type = 'ready'
    helper_pid = $PID
    startup_duration_ms = [math]::Round($startupStopwatch.Elapsed.TotalMilliseconds)
    counter_count = $counterRows.Count
    unavailable_counter_count = $counterUnavailable.Count
  } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()

  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    try {
      $command = $line | ConvertFrom-Json
      if ($command.type -eq 'stop') { break }
      if ($command.type -eq 'refresh_capabilities') {
        Refresh-CapabilityMetadata
        [Console]::Out.WriteLine(([ordered]@{ type = 'capabilities_refreshed'; request_id = $command.request_id } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
        continue
      }
      if ($command.type -ne 'detail') { continue }
      $detail = Collect-Detail
      [Console]::Out.WriteLine(([ordered]@{
        type = 'detail'
        request_id = [string]$command.request_id
        helper_pid = $PID
        captured_at = [DateTime]::UtcNow.ToString('o')
        collection_duration_ms = $detail.collection_duration_ms
        raw = $detail.raw
      } | ConvertTo-Json -Depth 8 -Compress))
      [Console]::Out.Flush()
    } catch {
      [Console]::Out.WriteLine(([ordered]@{
        type = 'error'
        request_id = [string]$command.request_id
        code = 'detail_failed'
        message = 'Warm host resource detail collection failed.'
      } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  }
} finally {
  foreach ($row in $counterRows) { try { $row.handle.Dispose() } catch {} }
}
