$ErrorActionPreference = 'Stop'

function Number-Or-Zero($value) {
  if ($null -eq $value) { return [double]0 }
  return [double]$value
}

$cpuRows = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor)
$cpu = $cpuRows | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
$cpuPerLogical = @($cpuRows | Where-Object { $_.Name -ne '_Total' } | ForEach-Object {
  [pscustomobject][ordered]@{
    id = [string]$_.Name
    utilization_percent = Number-Or-Zero $_.PercentProcessorTime
    user_percent = Number-Or-Zero $_.PercentUserTime
    privileged_percent = Number-Or-Zero $_.PercentPrivilegedTime
    idle_percent = Number-Or-Zero $_.PercentIdleTime
    frequency_mhz = 0
  }
})
$system = Get-CimInstance Win32_PerfFormattedData_PerfOS_System | Select-Object -First 1
$objects = Get-CimInstance Win32_PerfFormattedData_PerfOS_Objects | Select-Object -First 1
$memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
$processorInventory = @(Get-CimInstance Win32_Processor)
$currentFrequency = [double](($processorInventory | Measure-Object -Property CurrentClockSpeed -Average).Average)

$diskRows = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk)
$disk = $diskRows | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
$disks = @($diskRows | Where-Object { $_.Name -ne '_Total' } | Select-Object -First 24 | ForEach-Object {
  [pscustomobject][ordered]@{
    id = [string]$_.Name
    label = [string]$_.Name
    kind = 'physical'
    read_bps = Number-Or-Zero $_.DiskReadBytesPersec
    write_bps = Number-Or-Zero $_.DiskWriteBytesPersec
    read_iops = Number-Or-Zero $_.DiskReadsPersec
    write_iops = Number-Or-Zero $_.DiskWritesPersec
    busy_percent = Number-Or-Zero $_.PercentDiskTime
    read_latency_ms = (Number-Or-Zero $_.AvgDisksecPerRead) * 1000
    write_latency_ms = (Number-Or-Zero $_.AvgDisksecPerWrite) * 1000
    transfer_latency_ms = (Number-Or-Zero $_.AvgDisksecPerTransfer) * 1000
    queue_length = Number-Or-Zero $_.CurrentDiskQueueLength
    capacity_bytes = 0
    free_bytes = 0
    free_percent = 0
    available = $true
  }
})

$networkRows = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)
$networkAdapters = @($networkRows | Select-Object -First 24 | ForEach-Object {
  $name = [string]$_.Name
  $physicalDefault = $name -notmatch '(?i)loopback|isatap|teredo|tunnel|vpn|vethernet|virtual|hyper-v|bluetooth'
  $bandwidth = Number-Or-Zero $_.CurrentBandwidth
  $receive = Number-Or-Zero $_.BytesReceivedPersec
  $send = Number-Or-Zero $_.BytesSentPersec
  [pscustomobject][ordered]@{
    id = $name
    label = $name
    kind = if ($physicalDefault) { 'physical' } else { 'virtual' }
    physical_default = $physicalDefault
    receive_bps = $receive
    send_bps = $send
    receive_pps = Number-Or-Zero $_.PacketsReceivedPersec
    send_pps = Number-Or-Zero $_.PacketsSentPersec
    link_speed_bps = $bandwidth
    utilization_percent = if ($bandwidth -gt 0) { [Math]::Min(100, (($receive + $send) * 8 / $bandwidth) * 100) } else { 0 }
    output_queue_length = Number-Or-Zero $_.OutputQueueLength
    receive_errors = Number-Or-Zero $_.PacketsReceivedErrors
    send_errors = Number-Or-Zero $_.PacketsOutboundErrors
    receive_discards = Number-Or-Zero $_.PacketsReceivedDiscarded
    send_discards = Number-Or-Zero $_.PacketsOutboundDiscarded
    available = $true
  }
})
$physicalAdapters = @($networkAdapters | Where-Object { $_.physical_default })
if ($physicalAdapters.Count -eq 0) { $physicalAdapters = $networkAdapters }
$networkReceive = [double](($physicalAdapters | Measure-Object -Property receive_bps -Sum).Sum)
$networkSend = [double](($physicalAdapters | Measure-Object -Property send_bps -Sum).Sum)
$networkBandwidth = [double](($physicalAdapters | Measure-Object -Property link_speed_bps -Sum).Sum)
$tcp = Get-CimInstance Win32_PerfFormattedData_Tcpip_TCPv4 | Select-Object -First 1

$processMetadata = @{}
Get-CimInstance Win32_Process | ForEach-Object {
  $startTime = $null
  if ($_.CreationDate) { $startTime = $_.CreationDate.ToUniversalTime().ToString('o') }
  $processMetadata[[int64]$_.ProcessId] = @{
    Name = [string]$_.Name
    CommandLine = [string]$_.CommandLine
    ParentPid = [int64]$_.ParentProcessId
    StartTime = $startTime
  }
}
$rawProcessCounters = @{}
Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { [int64]$_.IDProcess -gt 0 } | ForEach-Object {
  $rawProcessCounters[[int64]$_.IDProcess] = $_
}
$processes = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { [int64]$_.IDProcess -gt 0 } |
  ForEach-Object {
    $pidValue = [int64]$_.IDProcess
    $metadata = $processMetadata[$pidValue]
    $rawCounters = $rawProcessCounters[$pidValue]
    [pscustomobject][ordered]@{
      pid = $pidValue
      parent_pid = if ($metadata) { [int64]$metadata.ParentPid } else { 0 }
      start_time = if ($metadata) { $metadata.StartTime } else { $null }
      name = if ($metadata -and $metadata.Name) { $metadata.Name } else { [string]$_.Name }
      command_line = if ($metadata -and $metadata.CommandLine) { $metadata.CommandLine } else { '' }
      cpu_percent = Number-Or-Zero $_.PercentProcessorTime
      memory_bytes = [int64]$_.WorkingSetPrivate
      private_bytes = [int64]$_.PrivateBytes
      commit_bytes = [int64]$_.PrivateBytes
      io_read_bps = Number-Or-Zero $_.IOReadBytesPersec
      io_write_bps = Number-Or-Zero $_.IOWriteBytesPersec
      io_read_ops = Number-Or-Zero $_.IOReadOperationsPersec
      io_write_ops = Number-Or-Zero $_.IOWriteOperationsPersec
      io_read_bytes_total = if ($rawCounters) { [string]$rawCounters.IOReadBytesPersec } else { '0' }
      io_write_bytes_total = if ($rawCounters) { [string]$rawCounters.IOWriteBytesPersec } else { '0' }
      io_read_operations_total = if ($rawCounters) { [string]$rawCounters.IOReadOperationsPersec } else { '0' }
      io_write_operations_total = if ($rawCounters) { [string]$rawCounters.IOWriteOperationsPersec } else { '0' }
      thread_count = [int64]$_.ThreadCount
      handle_count = [int64]$_.HandleCount
      status = 'running'
    }
  })

$result = [ordered]@{
  cpu_percent = Number-Or-Zero $cpu.PercentProcessorTime
  cpu_user_percent = Number-Or-Zero $cpu.PercentUserTime
  cpu_privileged_percent = Number-Or-Zero $cpu.PercentPrivilegedTime
  cpu_idle_percent = Number-Or-Zero $cpu.PercentIdleTime
  cpu_per_logical = $cpuPerLogical
  current_frequency_mhz = $currentFrequency
  physical_core_count = [int64](($processorInventory | Measure-Object -Property NumberOfCores -Sum).Sum)
  processor_queue_length = Number-Or-Zero $system.ProcessorQueueLength
  interrupts_per_sec = Number-Or-Zero $cpu.InterruptsPersec
  dpcs_per_sec = Number-Or-Zero $cpu.DPCsQueuedPersec
  context_switches_per_sec = Number-Or-Zero $system.ContextSwitchesPersec
  uptime_seconds = Number-Or-Zero $system.SystemUpTime
  thread_total = Number-Or-Zero $system.Threads
  handle_total = Number-Or-Zero $objects.Handles
  memory_available_bytes = [int64]$memory.AvailableMBytes * 1MB
  memory_cache_bytes = [int64]$memory.CacheBytes
  memory_commit_bytes = [int64]$memory.CommittedBytes
  memory_commit_limit_bytes = [int64]$memory.CommitLimit
  memory_commit_peak_bytes = [int64]$memory.CommitPeak
  memory_commit_percent = if ([double]$memory.CommitLimit -gt 0) { ([double]$memory.CommittedBytes / [double]$memory.CommitLimit) * 100 } else { 0 }
  memory_paged_pool_bytes = [int64]$memory.PoolPagedBytes
  memory_nonpaged_pool_bytes = [int64]$memory.PoolNonpagedBytes
  pagefile_used_bytes = 0
  pages_per_sec = Number-Or-Zero $memory.PagesPersec
  faults_per_sec = Number-Or-Zero $memory.PageFaultsPersec
  disk_read_bps = Number-Or-Zero $disk.DiskReadBytesPersec
  disk_write_bps = Number-Or-Zero $disk.DiskWriteBytesPersec
  disk_busy_percent = Number-Or-Zero $disk.PercentDiskTime
  disk_read_iops = Number-Or-Zero $disk.DiskReadsPersec
  disk_write_iops = Number-Or-Zero $disk.DiskWritesPersec
  disk_read_latency_ms = (Number-Or-Zero $disk.AvgDisksecPerRead) * 1000
  disk_write_latency_ms = (Number-Or-Zero $disk.AvgDisksecPerWrite) * 1000
  disk_transfer_latency_ms = (Number-Or-Zero $disk.AvgDisksecPerTransfer) * 1000
  disk_queue_length = Number-Or-Zero $disk.CurrentDiskQueueLength
  disks = $disks
  network_receive_bps = $networkReceive
  network_send_bps = $networkSend
  network_receive_pps = [double](($physicalAdapters | Measure-Object -Property receive_pps -Sum).Sum)
  network_send_pps = [double](($physicalAdapters | Measure-Object -Property send_pps -Sum).Sum)
  network_utilization_percent = if ($networkBandwidth -gt 0) { [Math]::Min(100, (($networkReceive + $networkSend) * 8 / $networkBandwidth) * 100) } else { 0 }
  network_output_queue_length = [double](($physicalAdapters | Measure-Object -Property output_queue_length -Sum).Sum)
  network_receive_errors = [double](($physicalAdapters | Measure-Object -Property receive_errors -Sum).Sum)
  network_send_errors = [double](($physicalAdapters | Measure-Object -Property send_errors -Sum).Sum)
  network_receive_discards = [double](($physicalAdapters | Measure-Object -Property receive_discards -Sum).Sum)
  network_send_discards = [double](($physicalAdapters | Measure-Object -Property send_discards -Sum).Sum)
  network_adapters = $networkAdapters
  tcp_segments_per_sec = Number-Or-Zero $tcp.SegmentsPersec
  tcp_retransmits_per_sec = Number-Or-Zero $tcp.SegmentsRetransmittedPersec
  tcp_connection_failures = Number-Or-Zero $tcp.ConnectionFailures
  tcp_resets = Number-Or-Zero $tcp.ConnectionsReset
  process_total = $processes.Count
  processes = $processes
}

$result | ConvertTo-Json -Depth 8 -Compress
