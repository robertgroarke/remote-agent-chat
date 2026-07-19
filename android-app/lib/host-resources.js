// Shared browser/React Native Host Resources normalization and chart math.
export const HOST_RESOURCE_HISTORY_LIMIT = 900;
export const HOST_RESOURCE_DETAIL_LIMIT = 180;
export const HOST_RESOURCE_COMPACT_HISTORY_LIMIT = 60;
export const HOST_RESOURCE_STRIP_STALE_MIN_MS = 2_500;
export const HOST_RESOURCE_PRESSURE_DURATION_MS = 15_000;
export const HOST_RESOURCE_CHART_RANGES = Object.freeze({
  live: 60_000,
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  since_open: Infinity,
});

export const HOST_RESOURCE_METRICS = Object.freeze({
  cpu_total_percent: ['cpu', 'totalPercent'],
  cpu_user_percent: ['cpu', 'userPercent'],
  cpu_privileged_percent: ['cpu', 'privilegedPercent'],
  memory_used_percent: ['memory', 'usedPercent'],
  memory_commit_percent: ['memory', 'commitPercent'],
  disk_read_bps: ['disk', 'readBps'],
  disk_write_bps: ['disk', 'writeBps'],
  disk_read_iops: ['disk', 'readIops'],
  disk_write_iops: ['disk', 'writeIops'],
  network_receive_bps: ['network', 'receiveBps'],
  network_send_bps: ['network', 'sendBps'],
  network_receive_pps: ['network', 'receivePps'],
  network_send_pps: ['network', 'sendPps'],
});

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function positiveNumber(value) {
  return Math.max(0, finiteNumber(value));
}

function percent(value) {
  return Math.max(0, Math.min(100, finiteNumber(value)));
}

function safeCounter(value) {
  const text = String(value ?? '0');
  return /^\d+$/.test(text) ? text : '0';
}

function capturedAtMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedProcess(process, index) {
  const pid = Math.max(0, Math.round(finiteNumber(process?.pid)));
  const startTime = process?.start_time ? String(process.start_time) : '';
  const stableKey = String(process?.stable_key || `${pid || 'process'}:${startTime || index}`);
  const attributionLevel = String(process?.attribution_level || (process?.attributed ? 'runtime' : 'unattributed'));
  return {
    key: stableKey,
    stableKey,
    parentKey: process?.parent_key ? String(process.parent_key) : '',
    pid,
    parentPid: Math.max(0, Math.round(finiteNumber(process?.parent_pid))),
    startTime,
    name: String(process?.name || 'Process'),
    status: String(process?.status || 'running'),
    attributed: process?.attributed === true,
    attributionLevel,
    attributionReason: String(process?.attribution_reason || 'No proved agent relationship'),
    ownedSessionId: process?.owned_session_id ? String(process.owned_session_id) : '',
    agentLabel: process?.agent_label ? String(process.agent_label) : '',
    agentTypes: Array.isArray(process?.agent_types) ? process.agent_types.map(String) : [],
    workspaceLabel: process?.workspace_label ? String(process.workspace_label) : '',
    sessionCount: Math.max(0, Math.round(finiteNumber(process?.session_count))),
    cpuPercent: percent(process?.cpu_host_percent ?? process?.cpu_percent),
    cpuHostPercent: percent(process?.cpu_host_percent ?? process?.cpu_percent),
    cpuCoreEquivalent: positiveNumber(process?.cpu_core_equivalent ?? process?.cpu_percent),
    memoryBytes: positiveNumber(process?.memory_bytes),
    privateBytes: positiveNumber(process?.private_bytes ?? process?.memory_bytes),
    commitBytes: positiveNumber(process?.commit_bytes ?? process?.private_bytes),
    ioReadBps: positiveNumber(process?.io_read_bps),
    ioWriteBps: positiveNumber(process?.io_write_bps),
    ioReadOps: positiveNumber(process?.io_read_ops),
    ioWriteOps: positiveNumber(process?.io_write_ops),
    threadCount: Math.max(0, Math.round(finiteNumber(process?.thread_count))),
    handleCount: Math.max(0, Math.round(finiteNumber(process?.handle_count))),
    uptimeSeconds: process?.uptime_seconds == null ? null : positiveNumber(process.uptime_seconds),
    childCount: Math.max(0, Math.round(finiteNumber(process?.child_count))),
    selectedAs: Array.isArray(process?.selected_as) ? process.selected_as.map(String) : [],
    selectedParentPresent: process?.selected_parent_present !== false,
    counterTotals: {
      ioReadBytes: safeCounter(process?.counter_totals?.io_read_bytes),
      ioWriteBytes: safeCounter(process?.counter_totals?.io_write_bytes),
      ioReadOperations: safeCounter(process?.counter_totals?.io_read_operations),
      ioWriteOperations: safeCounter(process?.counter_totals?.io_write_operations),
    },
  };
}

function normalizedDisk(raw, index) {
  return {
    id: String(raw?.id || `disk-${index}`), label: String(raw?.label || `Disk ${index + 1}`),
    kind: String(raw?.kind || 'unknown'), readBps: positiveNumber(raw?.read_bps),
    writeBps: positiveNumber(raw?.write_bps), readIops: positiveNumber(raw?.read_iops),
    writeIops: positiveNumber(raw?.write_iops), busyPercent: percent(raw?.busy_percent),
    readLatencyMs: positiveNumber(raw?.read_latency_ms), writeLatencyMs: positiveNumber(raw?.write_latency_ms),
    queueLength: positiveNumber(raw?.queue_length), capacityBytes: positiveNumber(raw?.capacity_bytes),
    freeBytes: positiveNumber(raw?.free_bytes), freePercent: percent(raw?.free_percent),
    available: raw?.available !== false,
  };
}

function normalizedAdapter(raw, index) {
  return {
    id: String(raw?.id || `adapter-${index}`), label: String(raw?.label || `Adapter ${index + 1}`),
    kind: String(raw?.kind || 'unknown'), physicalDefault: raw?.physical_default === true,
    receiveBps: positiveNumber(raw?.receive_bps), sendBps: positiveNumber(raw?.send_bps),
    receivePps: positiveNumber(raw?.receive_pps), sendPps: positiveNumber(raw?.send_pps),
    linkSpeedBps: positiveNumber(raw?.link_speed_bps), utilizationPercent: percent(raw?.utilization_percent),
    receiveErrors: positiveNumber(raw?.receive_errors), sendErrors: positiveNumber(raw?.send_errors),
    receiveDiscards: positiveNumber(raw?.receive_discards), sendDiscards: positiveNumber(raw?.send_discards),
    available: raw?.available !== false,
  };
}

export function normalizeHostResources(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      available: false, status: 'waiting', schemaVersion: 0, source: '', capturedAt: '', capturedAtMs: 0,
      sampleSequence: 0, sampleIntervalMs: 0, droppedGapCount: 0, machineLabel: '', system: null,
      processes: [], attributedProcesses: [], sampling: null, privacy: null, capabilities: null, error: null,
      lastGoodCapturedAt: '', lastGoodCapturedAtMs: 0,
    };
  }
  const rawSystem = snapshot.system && typeof snapshot.system === 'object' ? snapshot.system : null;
  const rawCpu = rawSystem?.cpu && typeof rawSystem.cpu === 'object' ? rawSystem.cpu : {};
  const rawMemory = rawSystem?.memory && typeof rawSystem.memory === 'object' ? rawSystem.memory : {};
  const rawDisk = rawSystem?.disk && typeof rawSystem.disk === 'object' ? rawSystem.disk : {};
  const rawNetwork = rawSystem?.network && typeof rawSystem.network === 'object' ? rawSystem.network : {};
  const system = rawSystem ? {
    cpuPercent: percent(rawCpu.total_percent ?? rawSystem.cpu_percent),
    cpu: {
      totalPercent: percent(rawCpu.total_percent ?? rawSystem.cpu_percent),
      userPercent: percent(rawCpu.user_percent), privilegedPercent: percent(rawCpu.privileged_percent),
      idlePercent: percent(rawCpu.idle_percent), queueLength: positiveNumber(rawCpu.queue_length),
      frequencyMhz: positiveNumber(rawCpu.current_frequency_mhz),
      logicalCoreCount: Math.max(0, Math.round(finiteNumber(rawCpu.logical_core_count))),
      physicalCoreCount: Math.max(0, Math.round(finiteNumber(rawCpu.physical_core_count))),
      perLogical: Array.isArray(rawCpu.per_logical) ? rawCpu.per_logical : [],
    },
    memory: {
      totalBytes: positiveNumber(rawMemory.total_bytes), usedBytes: positiveNumber(rawMemory.used_bytes),
      availableBytes: positiveNumber(rawMemory.available_bytes), usedPercent: percent(rawMemory.used_percent),
      cacheBytes: positiveNumber(rawMemory.cache_bytes), commitBytes: positiveNumber(rawMemory.commit_bytes),
      commitLimitBytes: positiveNumber(rawMemory.commit_limit_bytes), commitPeakBytes: positiveNumber(rawMemory.commit_peak_bytes),
      commitPercent: percent(rawMemory.commit_percent), pagedPoolBytes: positiveNumber(rawMemory.paged_pool_bytes),
      nonpagedPoolBytes: positiveNumber(rawMemory.nonpaged_pool_bytes), pagefileUsedBytes: positiveNumber(rawMemory.pagefile_used_bytes),
      pagesPerSec: positiveNumber(rawMemory.pages_per_sec), faultsPerSec: positiveNumber(rawMemory.faults_per_sec),
    },
    disk: {
      readBps: positiveNumber(rawDisk.read_bps), writeBps: positiveNumber(rawDisk.write_bps),
      busyPercent: percent(rawDisk.busy_percent), readIops: positiveNumber(rawDisk.read_iops),
      writeIops: positiveNumber(rawDisk.write_iops), readLatencyMs: positiveNumber(rawDisk.read_latency_ms),
      writeLatencyMs: positiveNumber(rawDisk.write_latency_ms), transferLatencyMs: positiveNumber(rawDisk.transfer_latency_ms),
      queueLength: positiveNumber(rawDisk.queue_length),
    },
    disks: (Array.isArray(rawSystem.disks) ? rawSystem.disks : []).map(normalizedDisk),
    network: {
      receiveBps: positiveNumber(rawNetwork.receive_bps), sendBps: positiveNumber(rawNetwork.send_bps),
      receivePps: positiveNumber(rawNetwork.receive_pps), sendPps: positiveNumber(rawNetwork.send_pps),
      utilizationPercent: percent(rawNetwork.utilization_percent), outputQueueLength: positiveNumber(rawNetwork.output_queue_length),
      receiveErrors: positiveNumber(rawNetwork.receive_errors), sendErrors: positiveNumber(rawNetwork.send_errors),
      receiveDiscards: positiveNumber(rawNetwork.receive_discards), sendDiscards: positiveNumber(rawNetwork.send_discards),
      tcpRetransmitsPerSec: positiveNumber(rawNetwork.tcp_retransmits_per_sec),
    },
    networkAdapters: (Array.isArray(rawSystem.network_adapters) ? rawSystem.network_adapters : []).map(normalizedAdapter),
    processCount: Math.max(0, Math.round(finiteNumber(rawSystem.process_count))),
    threadCount: Math.max(0, Math.round(finiteNumber(rawSystem.thread_count))),
    handleCount: Math.max(0, Math.round(finiteNumber(rawSystem.handle_count))),
    uptimeSeconds: positiveNumber(rawSystem.uptime_seconds),
  } : null;
  const processes = (Array.isArray(snapshot.processes) ? snapshot.processes : [])
    .map(normalizedProcess)
    .sort((left, right) => Number(right.attributed) - Number(left.attributed)
      || right.cpuHostPercent - left.cpuHostPercent || right.memoryBytes - left.memoryBytes || left.pid - right.pid);
  const capturedAt = snapshot.captured_at ? String(snapshot.captured_at) : '';
  const lastGoodCapturedAt = snapshot.last_good_captured_at ? String(snapshot.last_good_captured_at) : '';
  return {
    available: snapshot.status === 'fresh' && !!system,
    status: String(snapshot.status || 'unavailable'), schemaVersion: Math.max(0, Math.round(finiteNumber(snapshot.schema_version))),
    source: String(snapshot.source || ''), capturedAt, capturedAtMs: capturedAtMs(capturedAt),
    sampleSequence: Math.max(0, Math.round(finiteNumber(snapshot.sample_sequence))),
    sampleIntervalMs: Math.max(0, Math.round(finiteNumber(snapshot.sample_interval_ms))),
    droppedGapCount: Math.max(0, Math.round(finiteNumber(snapshot.dropped_gap_count))),
    machineLabel: snapshot.machine_label ? String(snapshot.machine_label) : '', system, processes,
    attributedProcesses: processes.filter(process => process.attributed),
    sampling: snapshot.sampling && typeof snapshot.sampling === 'object' ? snapshot.sampling : null,
    privacy: snapshot.privacy && typeof snapshot.privacy === 'object' ? snapshot.privacy : null,
    capabilities: snapshot.capabilities && typeof snapshot.capabilities === 'object' ? snapshot.capabilities : null,
    error: snapshot.error && typeof snapshot.error === 'object' ? snapshot.error : null,
    lastGoodCapturedAt,
    lastGoodCapturedAtMs: capturedAtMs(lastGoodCapturedAt),
  };
}

function median(values, fallback = 0) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return fallback;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function niceStep(value) {
  const positive = Math.max(Number.EPSILON, Number(value) || 0);
  const exponent = 10 ** Math.floor(Math.log10(positive));
  const fraction = positive / exponent;
  const factor = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return factor * exponent;
}

export function normalizeHostResourcePoint(frame) {
  if (!frame || typeof frame !== 'object') return null;
  const sequence = Number(frame.sample_sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  const source = frame.frame_kind === 'system' ? frame : (frame.system || {});
  const cpu = source.cpu || {};
  const memory = source.memory || {};
  const disk = source.disk || {};
  const network = source.network || {};
  return {
    sampleSequence: sequence,
    capturedAt: String(frame.captured_at || ''),
    capturedAtMs: capturedAtMs(frame.captured_at),
    monotonicMs: positiveNumber(frame.monotonic_ms),
    sampleIntervalMs: positiveNumber(frame.sample_interval_ms),
    droppedGapCount: Math.max(0, Math.round(finiteNumber(frame.dropped_gap_count))),
    status: String(frame.status || 'unavailable'),
    cpu: {
      totalPercent: nullableNumber(cpu.total_percent ?? source.cpu_percent),
      userPercent: nullableNumber(cpu.user_percent), privilegedPercent: nullableNumber(cpu.privileged_percent),
    },
    memory: { usedPercent: nullableNumber(memory.used_percent), commitPercent: nullableNumber(memory.commit_percent) },
    disk: {
      readBps: nullableNumber(disk.read_bps), writeBps: nullableNumber(disk.write_bps),
      readIops: nullableNumber(disk.read_iops), writeIops: nullableNumber(disk.write_iops),
    },
    network: {
      receiveBps: nullableNumber(network.receive_bps), sendBps: nullableNumber(network.send_bps),
      receivePps: nullableNumber(network.receive_pps), sendPps: nullableNumber(network.send_pps),
    },
  };
}

export function hostResourceTimeline(frames, options = {}) {
  const incoming = Array.isArray(frames) ? frames : [];
  const bySequence = new Map();
  let duplicateSequenceCount = 0;
  let outOfOrderSequenceCount = 0;
  let maximumSeenSequence = 0;
  for (const frame of incoming) {
    const sequence = Number(frame?.sample_sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) continue;
    if (sequence < maximumSeenSequence) outOfOrderSequenceCount += 1;
    maximumSeenSequence = Math.max(maximumSeenSequence, sequence);
    if (bySequence.has(sequence)) duplicateSequenceCount += 1;
    else bySequence.set(sequence, frame);
  }
  const ordered = [...bySequence.values()].sort((left, right) => left.sample_sequence - right.sample_sequence);
  const rawPoints = ordered.map(frame => ({ frame, point: normalizeHostResourcePoint(frame) })).filter(row => row.point);
  const anchor = rawPoints.find(row => row.point.capturedAtMs > 0 && row.point.monotonicMs > 0) || null;
  const candidateRows = rawPoints.map(row => {
    const monotonicTime = anchor && row.point.monotonicMs > 0
      ? anchor.point.capturedAtMs + row.point.monotonicMs - anchor.point.monotonicMs
      : 0;
    return {
      ...row,
      chartTimeMs: monotonicTime > 0 ? monotonicTime : row.point.capturedAtMs,
    };
  });
  const positiveIntervals = [];
  for (let index = 1; index < candidateRows.length; index += 1) {
    const delta = candidateRows[index].chartTimeMs - candidateRows[index - 1].chartTimeMs;
    if (delta > 0 && delta <= 10_000) positiveIntervals.push(delta);
  }
  const advertisedCadences = candidateRows.map(row => row.point.sampleIntervalMs).filter(value => value > 0);
  const cadenceMs = Math.max(1, Math.round(median(positiveIntervals, median(advertisedCadences, 1_000)) || 1_000));
  const gapThresholdMs = Math.max(2_500, cadenceMs * 2.5);
  const rows = [];
  const gaps = [];
  let invalidTimestampCount = 0;
  let duplicateTimestampCount = 0;
  let outOfOrderTimestampCount = 0;
  let clockDiscontinuityCount = 0;
  let monotonicResetCount = 0;
  let chartTimeOffsetMs = 0;
  for (const rawCandidate of candidateRows) {
    const candidate = { ...rawCandidate, chartTimeMs: rawCandidate.chartTimeMs + chartTimeOffsetMs };
    if (!(candidate.chartTimeMs > 0)) {
      invalidTimestampCount += 1;
      continue;
    }
    const previous = rows.at(-1);
    let monotonicReset = false;
    if (previous && candidate.point.monotonicMs > 0 && previous.point.monotonicMs > 0
      && candidate.point.monotonicMs < previous.point.monotonicMs) {
      const wallDelta = candidate.point.capturedAtMs - previous.point.capturedAtMs;
      const rebasedDelta = wallDelta > 0 && wallDelta <= 10_000 ? wallDelta : cadenceMs;
      const rebasedTime = previous.chartTimeMs + Math.max(1, rebasedDelta);
      chartTimeOffsetMs += rebasedTime - candidate.chartTimeMs;
      candidate.chartTimeMs = rebasedTime;
      monotonicReset = true;
      monotonicResetCount += 1;
    }
    if (previous && candidate.chartTimeMs <= previous.chartTimeMs) {
      if (candidate.chartTimeMs === previous.chartTimeMs) duplicateTimestampCount += 1;
      else outOfOrderTimestampCount += 1;
      continue;
    }
    let gapBefore = candidate.point.status !== 'fresh';
    let gapReason = gapBefore ? 'unavailable' : '';
    if (previous) {
      const timeDelta = candidate.chartTimeMs - previous.chartTimeMs;
      const sequenceDelta = candidate.point.sampleSequence - previous.point.sampleSequence;
      const droppedDelta = candidate.point.droppedGapCount - previous.point.droppedGapCount;
      if (sequenceDelta !== 1 || droppedDelta > 0 || timeDelta > gapThresholdMs) {
        gapBefore = true;
        gapReason = sequenceDelta !== 1 || droppedDelta > 0 ? 'dropped' : 'cadence';
      }
      if (monotonicReset) {
        clockDiscontinuityCount += 1;
        gapBefore = true;
        gapReason = 'clock_discontinuity';
      } else if (candidate.point.monotonicMs > 0 && previous.point.monotonicMs > 0
        && candidate.point.capturedAtMs > 0 && previous.point.capturedAtMs > 0) {
        const wallDelta = candidate.point.capturedAtMs - previous.point.capturedAtMs;
        const monotonicDelta = candidate.point.monotonicMs - previous.point.monotonicMs;
        if (Math.abs(wallDelta - monotonicDelta) > Math.max(5_000, cadenceMs * 2)) {
          clockDiscontinuityCount += 1;
          gapBefore = true;
          gapReason = 'clock_discontinuity';
        }
      }
      if (gapBefore) gaps.push({
        startMs: previous.chartTimeMs,
        endMs: candidate.chartTimeMs,
        reason: gapReason,
        previousSequence: previous.point.sampleSequence,
        nextSequence: candidate.point.sampleSequence,
      });
    }
    rows.push({ ...candidate, gapBefore, gapReason });
  }
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const latest = rows.at(-1) || null;
  const latestAgeMs = latest ? Math.max(0, nowMs - latest.chartTimeMs) : Infinity;
  const staleAfterMs = Math.max(HOST_RESOURCE_STRIP_STALE_MIN_MS, cadenceMs * 2);
  const delayedAfterMs = Math.max(staleAfterMs * 4, 10_000);
  let status = 'waiting';
  if (options.paused) status = 'paused';
  else if (options.connected === false || options.subscriptionStatus === 'reconnecting') status = 'reconnecting';
  else if (!latest) status = options.error ? 'unavailable' : 'waiting';
  else if (latest.point.status !== 'fresh') status = 'unavailable';
  else if (latestAgeMs > delayedAfterMs) status = 'stale';
  else if (latestAgeMs > staleAfterMs) status = 'delayed';
  else status = 'live';
  if (latest && latestAgeMs > staleAfterMs && !options.paused) gaps.push({
    startMs: latest.chartTimeMs,
    endMs: nowMs,
    reason: status,
    previousSequence: latest.point.sampleSequence,
    nextSequence: null,
  });
  const elapsedMs = rows.length > 1 ? rows.at(-1).chartTimeMs - rows[0].chartTimeMs : 0;
  const expectedEndMs = latest && !options.paused ? Math.max(latest.chartTimeMs, nowMs) : latest?.chartTimeMs || 0;
  const expectedElapsedMs = rows.length ? Math.max(0, expectedEndMs - rows[0].chartTimeMs) : 0;
  const expectedCount = rows.length ? Math.max(1, Math.floor(expectedElapsedMs / cadenceMs) + 1) : 0;
  const explicitDropped = rows.length
    ? Math.max(0, rows.at(-1).point.droppedGapCount - rows[0].point.droppedGapCount)
    : 0;
  const normalizedFrames = rows.map(row => ({
    ...row.frame,
    chart_time_ms: row.chartTimeMs,
    gap_before: row.gapBefore,
    gap_reason: row.gapReason,
  }));
  return {
    frames: normalizedFrames,
    points: rows.map(row => ({ ...row.point, chartTimeMs: row.chartTimeMs, gapBefore: row.gapBefore, gapReason: row.gapReason })),
    gaps,
    status,
    cadenceMs,
    staleAfterMs,
    latestAgeMs,
    nowMs,
    startMs: rows[0]?.chartTimeMs || 0,
    endMs: rows.at(-1)?.chartTimeMs || 0,
    elapsedMs,
    expectedCount,
    receivedCount: incoming.length,
    validCount: rows.filter(row => row.point.status === 'fresh').length,
    droppedCount: Math.max(explicitDropped, Math.max(0, expectedCount - rows.length)),
    gapCount: gaps.length,
    duplicateCount: duplicateSequenceCount + duplicateTimestampCount,
    outOfOrderCount: outOfOrderSequenceCount + outOfOrderTimestampCount,
    invalidTimestampCount,
    clockDiscontinuityCount,
    monotonicResetCount,
  };
}

function sustainedHostResourcePressure(points, metric, threshold) {
  const valid = points.map(point => ({
    capturedAtMs: point.capturedAtMs,
    value: metric === 'cpu' ? point.cpu.totalPercent : point.memory.usedPercent,
  })).filter(sample => sample.capturedAtMs > 0 && sample.value !== null);
  if (valid.length < 2 || valid.at(-1).capturedAtMs - valid[0].capturedAtMs < HOST_RESOURCE_PRESSURE_DURATION_MS) return false;
  return valid.every(sample => sample.value >= threshold);
}

function hostResourcePressureLevel(points, metric) {
  if (sustainedHostResourcePressure(points, metric, 95)) return 'critical';
  if (sustainedHostResourcePressure(points, metric, 85)) return 'warning';
  return 'normal';
}

export function projectHostResourceStrip(frames, options = {}) {
  const boundedFrames = mergeOrderedHostResourceFrames([], frames, HOST_RESOURCE_COMPACT_HISTORY_LIMIT);
  const points = boundedFrames.map(normalizeHostResourcePoint).filter(Boolean);
  const point = points.at(-1) || null;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const connected = options.connected !== false;
  const subscriptionStatus = String(options.subscriptionStatus || '');
  const cpuPercent = point?.cpu.totalPercent ?? null;
  const memoryPercent = point?.memory.usedPercent ?? null;
  const hasValues = point?.status === 'fresh' && cpuPercent !== null && memoryPercent !== null;
  const ageMs = point?.capturedAtMs > 0 ? Math.max(0, nowMs - point.capturedAtMs) : Infinity;
  const cadenceMs = Math.max(1_000, point?.sampleIntervalMs || 1_000);
  const staleAfterMs = Math.max(HOST_RESOURCE_STRIP_STALE_MIN_MS, cadenceMs * 2);
  let status = 'waiting';
  if (!connected || subscriptionStatus === 'reconnecting') status = 'reconnecting';
  else if (!hasValues) status = options.error ? 'unavailable' : 'waiting';
  else if (ageMs > staleAfterMs) status = 'stale';
  else status = 'live';
  const pressureStartMs = point?.capturedAtMs ? point.capturedAtMs - HOST_RESOURCE_PRESSURE_DURATION_MS : Infinity;
  const pressurePoints = points.filter(sample => sample.capturedAtMs >= pressureStartMs);
  const cpuLevel = hasValues ? hostResourcePressureLevel(pressurePoints, 'cpu') : 'normal';
  const memoryLevel = hasValues ? hostResourcePressureLevel(pressurePoints, 'memory') : 'normal';
  const attention = status === 'live' && (cpuLevel === 'critical' || memoryLevel === 'critical')
    ? 'critical'
    : status === 'live' && (cpuLevel === 'warning' || memoryLevel === 'warning')
      ? 'warning'
      : status;
  const rawLatest = boundedFrames.at(-1) || null;
  const rawSystem = rawLatest?.frame_kind === 'system' ? rawLatest : rawLatest?.system || null;
  return {
    status,
    attention,
    point,
    frames: boundedFrames,
    cpuPercent,
    memoryPercent,
    cpuLevel,
    memoryLevel,
    ageMs,
    ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1_000)) : null,
    staleAfterMs,
    sampleSequence: point?.sampleSequence || 0,
    capturedAt: point?.capturedAt || '',
    memoryUsedBytes: nullableNumber(rawSystem?.memory?.used_bytes),
    memoryTotalBytes: nullableNumber(rawSystem?.memory?.total_bytes),
  };
}

export function mergeOrderedHostResourceFrames(previous, incoming, limit = HOST_RESOURCE_HISTORY_LIMIT) {
  const bySequence = new Map();
  [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [incoming])]
    .forEach(frame => {
      const sequence = Number(frame?.sample_sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1) return;
      if (!bySequence.has(sequence)) bySequence.set(sequence, frame);
    });
  const boundedLimit = Math.max(1, Math.min(HOST_RESOURCE_HISTORY_LIMIT, Number(limit) || HOST_RESOURCE_HISTORY_LIMIT));
  return [...bySequence.entries()].sort((left, right) => left[0] - right[0])
    .slice(-boundedLimit).map(([, frame]) => frame);
}

export function hostResourceMetricValue(frame, metric) {
  const point = frame?.sampleSequence ? frame : normalizeHostResourcePoint(frame);
  const path = HOST_RESOURCE_METRICS[metric];
  if (!point || !path) return null;
  return nullableNumber(path.reduce((value, key) => value?.[key], point));
}

export function hostResourceIntervalStats(points, metric) {
  const samples = (Array.isArray(points) ? points : []).map(frame => ({
    frame,
    point: frame?.sampleSequence ? frame : normalizeHostResourcePoint(frame),
    value: hostResourceMetricValue(frame, metric),
    timeMs: Number(frame?.chartTimeMs ?? frame?.chart_time_ms) || capturedAtMs(frame?.capturedAt ?? frame?.captured_at),
    gapBefore: frame?.gapBefore === true || frame?.gap_before === true,
  })).filter(sample => sample.point && sample.value !== null && sample.timeMs > 0)
    .sort((left, right) => left.timeMs - right.timeMs || left.point.sampleSequence - right.point.sampleSequence);
  if (!samples.length) return {
    current: null, min: null, average: null, sampleAverage: null, timeWeightedAverage: null,
    averageMethod: 'none', max: null, p95: null, provisionalP95: null, p95Ready: false,
    peakSequence: null, count: 0, elapsedMs: 0, cadenceMs: 0, gapCount: 0,
  };
  const values = samples.map(sample => sample.value);
  const ordered = [...values].sort((left, right) => left - right);
  const peak = samples.reduce((best, sample) => sample.value > best.value ? sample : best, samples[0]);
  const sampleAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
  const intervals = samples.slice(1).map((sample, index) => sample.timeMs - samples[index].timeMs).filter(delta => delta > 0);
  const cadenceMs = Math.max(0, Math.round(median(intervals, 0)));
  const gapThresholdMs = Math.max(2_500, cadenceMs * 2.5);
  let weightedTotal = 0;
  let weightedDuration = 0;
  let gapCount = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const interval = current.timeMs - previous.timeMs;
    if (current.gapBefore || interval > gapThresholdMs) {
      gapCount += 1;
      continue;
    }
    weightedTotal += ((previous.value + current.value) / 2) * interval;
    weightedDuration += interval;
  }
  const timeWeightedAverage = weightedDuration > 0 ? weightedTotal / weightedDuration : sampleAverage;
  const intervalMinimum = intervals.length ? Math.min(...intervals) : 0;
  const intervalMaximum = intervals.length ? Math.max(...intervals) : 0;
  const materiallyIrregular = intervalMinimum > 0 && intervalMaximum / intervalMinimum > 1.2;
  const nearestRankP95 = ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
  return {
    current: values.at(-1), min: Math.min(...values),
    average: materiallyIrregular ? timeWeightedAverage : sampleAverage,
    sampleAverage,
    timeWeightedAverage,
    averageMethod: materiallyIrregular ? 'time-weighted' : 'sample',
    max: Math.max(...values),
    p95: values.length >= 20 ? nearestRankP95 : null,
    provisionalP95: nearestRankP95,
    p95Ready: values.length >= 20,
    peakSequence: peak.point.sampleSequence,
    count: values.length,
    elapsedMs: samples.length > 1 ? samples.at(-1).timeMs - samples[0].timeMs : 0,
    cadenceMs,
    gapCount,
  };
}

export function hostResourceHasGap(previous, current) {
  if (!current || current.status !== 'fresh') return true;
  if (!previous) return false;
  return current.sampleSequence !== previous.sampleSequence + 1
    || current.droppedGapCount > previous.droppedGapCount
    || current.sampleIntervalMs > Math.max(2_500, previous.sampleIntervalMs * 2.5);
}

export function downsampleHostResourceSeries(frames, metric, targetBuckets = 240) {
  const timeline = hostResourceTimeline(frames, { nowMs: Number.MAX_SAFE_INTEGER, paused: true });
  const points = timeline.points;
  if (!points.length) return [];
  const target = Math.max(1, Math.round(Number(targetBuckets) || 240));
  const width = points.length <= target ? 1 : Math.ceil(points.length / target);
  const output = [];
  for (let offset = 0; offset < points.length; offset += width) {
    const rows = points.slice(offset, offset + width);
    const stats = hostResourceIntervalStats(rows, metric);
    output.push({
      startSequence: rows[0].sampleSequence, endSequence: rows.at(-1).sampleSequence,
      capturedAtStartMs: rows[0].chartTimeMs, capturedAtEndMs: rows.at(-1).chartTimeMs,
      chartTimeMs: rows.at(-1).chartTimeMs,
      current: stats.current, min: stats.min, average: stats.average, max: stats.max,
      first: hostResourceMetricValue(rows[0], metric),
      last: hostResourceMetricValue(rows.at(-1), metric),
      p95: stats.p95, provisionalP95: stats.provisionalP95,
      peakSequence: stats.peakSequence, count: stats.count,
      gap: rows.some(row => row.gapBefore),
    });
  }
  return output;
}

export function selectHostResourceRange(frames, range = 'live', options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const timeline = hostResourceTimeline(frames, { ...options, nowMs });
  const ordered = timeline.frames;
  const duration = HOST_RESOURCE_CHART_RANGES[range] ?? HOST_RESOURCE_CHART_RANGES.live;
  if (!ordered.length || duration === Infinity) return ordered;
  return ordered.filter(frame => Number(frame.chart_time_ms) >= nowMs - duration && Number(frame.chart_time_ms) <= nowMs);
}

export function hostResourceNiceScale(maximumValue, previousMaximum = 0, options = {}) {
  if (options.percent) return { maximum: 100, minimum: 0, step: 25, ticks: [0, 25, 50, 75, 100] };
  const peak = Math.max(0, Number(maximumValue) || 0);
  const previous = Math.max(0, Number(previousMaximum) || 0);
  if (previous > 0 && peak <= previous * 0.95 && peak >= previous * 0.65) {
    const step = niceStep(previous / 4);
    const count = Math.max(2, Math.round(previous / step) + 1);
    return {
      maximum: previous,
      minimum: 0,
      step,
      ticks: Array.from({ length: count }, (_, index) => Math.min(previous, step * index)),
    };
  }
  const withHeadroom = Math.max(1, peak * 1.1);
  let step = niceStep(withHeadroom / 4);
  let maximum = Math.ceil(withHeadroom / step) * step;
  let count = Math.round(maximum / step) + 1;
  if (count < 4) {
    step = niceStep(withHeadroom / 3);
    maximum = Math.ceil(withHeadroom / step) * step;
    count = Math.round(maximum / step) + 1;
  }
  if (count > 6) {
    step = niceStep(withHeadroom / 5);
    maximum = Math.ceil(withHeadroom / step) * step;
    count = Math.round(maximum / step) + 1;
  }
  return {
    maximum,
    minimum: 0,
    step,
    ticks: Array.from({ length: Math.max(2, count) }, (_, index) => Math.min(maximum, step * index)),
  };
}

export function hostResourceTimeTicks(startMs, endMs, count = 5) {
  const start = Number(startMs);
  const end = Number(endMs);
  const total = Math.max(2, Math.min(6, Math.round(Number(count) || 5)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return Array.from({ length: total }, (_, index) => {
    const timeMs = start + ((end - start) * index) / (total - 1);
    const date = new Date(timeMs);
    const crossedDay = new Date(start).toDateString() !== new Date(end).toDateString();
    return {
      timeMs,
      fraction: index / (total - 1),
      label: date.toLocaleString([], crossedDay
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      accessibleLabel: date.toLocaleString([], {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
        second: '2-digit', timeZoneName: 'short',
      }),
    };
  });
}

export function hostResourceTimeFraction(frame, startMs, endMs) {
  const timeMs = Number(frame?.chartTimeMs ?? frame?.chart_time_ms)
    || capturedAtMs(frame?.capturedAt ?? frame?.captured_at);
  const start = Number(startMs);
  const end = Number(endMs);
  if (!(timeMs > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, Math.min(1, (timeMs - start) / (end - start)));
}

export function appendHostResourceHistory(history, snapshot, limit = HOST_RESOURCE_HISTORY_LIMIT) {
  const normalized = normalizeHostResources(snapshot);
  if (!normalized.available) return Array.isArray(history) ? history : [];
  const point = {
    sample_sequence: normalized.sampleSequence || Math.max(1, (history?.at(-1)?.sample_sequence || 0) + 1),
    captured_at: normalized.capturedAt,
    monotonic_ms: snapshot.monotonic_ms,
    sample_interval_ms: normalized.sampleIntervalMs,
    dropped_gap_count: normalized.droppedGapCount,
    status: normalized.status,
    system: snapshot.system,
  };
  return mergeOrderedHostResourceFrames(history, point, limit);
}

export function formatHostResourceBytes(value) {
  const bytes = positiveNumber(value);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let scaled = bytes / 1024;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) { scaled /= 1024; unitIndex += 1; }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatHostResourceRate(value) {
  return `${formatHostResourceBytes(value)}/s`;
}

export function formatHostResourcePercent(value) {
  return value == null ? '—' : `${finiteNumber(value).toFixed(finiteNumber(value) >= 10 ? 1 : 2)}%`;
}

export function formatHostResourceAge(capturedAt, nowMs = Date.now()) {
  const captured = Date.parse(capturedAt || '');
  if (!Number.isFinite(captured)) return 'Waiting for local sample';
  const ageSeconds = Math.max(0, Math.round((nowMs - captured) / 1000));
  if (ageSeconds < 2) return 'Updated now';
  if (ageSeconds < 60) return `Updated ${ageSeconds}s ago`;
  return `Updated ${Math.floor(ageSeconds / 60)}m ago`;
}

export function formatHostResourceTimestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'Unknown time';
  return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatHostResourceTimestampFull(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'Unknown date and time';
  return new Date(parsed).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    second: '2-digit', timeZoneName: 'short',
  });
}
