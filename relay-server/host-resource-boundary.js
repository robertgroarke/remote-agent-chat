'use strict';

const MAX_HOST_RESOURCE_BYTES = 64 * 1024;
const MAX_HOST_RESOURCE_PROCESSES = 32;
const MAX_HOST_RESOURCE_SUMMARY_BYTES = 16 * 1024;
const MAX_HOST_RESOURCE_HISTORY_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 160;

const ALLOWED_KEYS = new Set([
  'schema_version', 'source', 'status', 'captured_at', 'monotonic_ms', 'sample_sequence',
  'sample_interval_ms', 'dropped_gap_count', 'machine_label', 'system',
  'cpu_percent', 'cpu', 'total_percent', 'user_percent', 'privileged_percent', 'idle_percent',
  'queue_length', 'interrupts_per_sec', 'dpcs_per_sec', 'context_switches_per_sec',
  'current_frequency_mhz', 'logical_core_count', 'physical_core_count', 'per_logical',
  'utilization_percent', 'frequency_mhz',
  'memory', 'total_bytes', 'used_bytes', 'available_bytes', 'used_percent', 'cache_bytes',
  'commit_bytes', 'commit_limit_bytes', 'commit_peak_bytes', 'commit_percent',
  'paged_pool_bytes', 'nonpaged_pool_bytes', 'pagefile_used_bytes', 'pages_per_sec', 'faults_per_sec',
  'disk', 'disks', 'read_bps', 'write_bps', 'busy_percent', 'read_iops', 'write_iops',
  'read_latency_ms', 'write_latency_ms', 'transfer_latency_ms', 'capacity_bytes', 'free_bytes',
  'free_percent', 'available',
  'network', 'network_adapters', 'receive_bps', 'send_bps', 'receive_pps', 'send_pps',
  'link_speed_bps', 'physical_default', 'output_queue_length', 'receive_errors', 'send_errors',
  'receive_discards', 'send_discards', 'tcp_segments_per_sec', 'tcp_retransmits_per_sec',
  'tcp_connection_failures', 'tcp_resets',
  'process_count', 'thread_count', 'handle_count', 'uptime_seconds',
  'processes', 'pid', 'parent_pid', 'start_time', 'stable_key', 'parent_key', 'name',
  'attributed', 'agent_label', 'agent_types', 'workspace_label', 'session_count',
  'attribution_level', 'attribution_reason', 'owned_session_id', 'cpu_host_percent',
  'cpu_core_equivalent', 'memory_bytes', 'private_bytes', 'io_read_bps', 'io_write_bps',
  'io_read_ops', 'io_write_ops', 'status', 'counter_totals', 'io_read_bytes', 'io_write_bytes',
  'io_read_operations', 'io_write_operations', 'child_count', 'selected_as',
  'selected_parent_present',
  'capabilities', 'schema_v2', 'per_logical_cpu', 'cpu_frequency', 'memory_commit',
  'disk_families', 'network_families', 'gpu', 'sensors', 'unavailable', 'metric', 'reason',
  'sampling', 'collection_duration_ms', 'min_interval_ms', 'process_total', 'process_included',
  'process_limit', 'truncated', 'selection_rule', 'system_interval_ms', 'detail_interval_ms',
  'windows_hide',
  'privacy', 'ephemeral', 'relay_cached', 'relay_persisted', 'command_lines_transmitted',
  'executable_paths_transmitted', 'aggregate_only', 'transient_fields',
  'error', 'code', 'message', 'last_good_captured_at', 'id', 'label', 'kind',
]);

const ARRAY_LIMITS = Object.freeze({
  processes: MAX_HOST_RESOURCE_PROCESSES,
  per_logical: 256,
  disks: 24,
  network_adapters: 24,
  agent_types: 8,
  selected_as: 5,
  transient_fields: 16,
  unavailable: 32,
});

const SYSTEM_POINT_KEYS = new Set([
  'schema_version', 'frame_kind', 'source', 'status', 'captured_at', 'monotonic_ms',
  'sample_sequence', 'sample_interval_ms', 'dropped_gap_count', 'cpu', 'memory', 'disk',
  'network', 'process_count', 'thread_count', 'handle_count', 'uptime_seconds',
  'collection_duration_ms',
]);
const SYSTEM_POINT_METRIC_KEYS = new Set([
  'total_percent', 'user_percent', 'privileged_percent', 'idle_percent', 'queue_length',
  'interrupts_per_sec', 'dpcs_per_sec', 'context_switches_per_sec', 'current_frequency_mhz',
  'logical_core_count', 'physical_core_count', 'total_bytes', 'used_bytes', 'available_bytes',
  'used_percent', 'cache_bytes', 'commit_bytes', 'commit_limit_bytes', 'commit_peak_bytes',
  'commit_percent', 'paged_pool_bytes', 'nonpaged_pool_bytes', 'pagefile_used_bytes',
  'pages_per_sec', 'faults_per_sec', 'read_bps', 'write_bps', 'busy_percent', 'read_iops',
  'write_iops', 'read_latency_ms', 'write_latency_ms', 'transfer_latency_ms', 'receive_bps',
  'send_bps', 'receive_pps', 'send_pps', 'utilization_percent', 'output_queue_length',
  'receive_errors', 'send_errors', 'receive_discards', 'send_discards', 'tcp_segments_per_sec',
  'tcp_retransmits_per_sec', 'tcp_connection_failures', 'tcp_resets',
]);

function containsSensitiveValue(value) {
  if (typeof value !== 'string') return false;
  return /\bbearer\s+[a-z0-9._~+\/-]+/i.test(value)
    || /\bsk-[a-z0-9_-]{8,}/i.test(value)
    || /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i.test(value)
    || /\b[a-z0-9.!#$%&'+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i.test(value)
    || /(?:[a-z]:\\|\/users\/|\/home\/)/i.test(value);
}

function validateNode(value, depth = 0, parentKey = '') {
  if (depth > 8) return false;
  if (value == null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  if (typeof value === 'string') return value.length <= MAX_STRING_LENGTH && !containsSensitiveValue(value);
  if (Array.isArray(value)) {
    const limit = ARRAY_LIMITS[parentKey] || 256;
    return value.length <= limit && value.every(item => validateNode(item, depth + 1, parentKey));
  }
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(([key, child]) => (
    ALLOWED_KEYS.has(key) && validateNode(child, depth + 1, key)
  ));
}

function validCounterTotals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = ['io_read_bytes', 'io_write_bytes', 'io_read_operations', 'io_write_operations'];
  return expected.every(key => typeof value[key] === 'string' && /^\d{1,30}$/.test(value[key]));
}

function validProcess(process) {
  if (!process || typeof process !== 'object' || Array.isArray(process)) return false;
  if (!Number.isSafeInteger(process.pid) || process.pid <= 0) return false;
  if (!Number.isSafeInteger(process.parent_pid) || process.parent_pid < 0) return false;
  if (process.start_time !== null && !Number.isFinite(Date.parse(process.start_time))) return false;
  if (typeof process.stable_key !== 'string' || !/^[a-f0-9]{20}$/.test(process.stable_key)) return false;
  if (process.parent_key !== null && !/^[a-f0-9]{20}$/.test(process.parent_key)) return false;
  if (typeof process.name !== 'string' || process.name.length === 0) return false;
  if (!Array.isArray(process.agent_types) || process.agent_types.length > 8
      || !process.agent_types.every(type => typeof type === 'string' && /^[a-z0-9_-]{1,40}$/i.test(type))) return false;
  if (!new Set(['owned', 'runtime', 'workspace-associated', 'unattributed']).has(process.attribution_level)) return false;
  if (process.attribution_level === 'owned') {
    if (process.owned_session_id !== null
        && (typeof process.owned_session_id !== 'string' || process.owned_session_id.length === 0)) return false;
  } else if (process.owned_session_id !== null) return false;
  return validCounterTotals(process.counter_totals);
}

function validSystemPointMetrics(value) {
  if (value === null) return true;
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, child]) => (
      SYSTEM_POINT_METRIC_KEYS.has(key) && typeof child === 'number' && Number.isFinite(child) && child >= 0
    ));
}

function sanitizeHostResourceSystemPoint(payload) {
  let encoded;
  try { encoded = JSON.stringify(payload); } catch { return null; }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_HOST_RESOURCE_SUMMARY_BYTES) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Object.keys(payload).some(key => !SYSTEM_POINT_KEYS.has(key))) return null;
  if (payload.schema_version !== 2 || payload.frame_kind !== 'system' || payload.source !== 'windows_proxy') return null;
  if (!new Set(['fresh', 'unavailable']).has(payload.status) || !Number.isFinite(Date.parse(payload.captured_at))) return null;
  for (const key of ['monotonic_ms', 'sample_sequence', 'sample_interval_ms', 'dropped_gap_count', 'collection_duration_ms']) {
    if (!Number.isSafeInteger(payload[key]) || payload[key] < (key === 'sample_sequence' ? 1 : 0)) return null;
  }
  for (const key of ['cpu', 'memory', 'disk', 'network']) if (!validSystemPointMetrics(payload[key])) return null;
  for (const key of ['process_count', 'thread_count', 'handle_count', 'uptime_seconds']) {
    if (payload[key] !== null && (!Number.isFinite(payload[key]) || payload[key] < 0)) return null;
  }
  if (payload.status === 'fresh' && (!payload.cpu || !payload.memory || !payload.disk || !payload.network)) return null;
  if (payload.status === 'unavailable' && [payload.cpu, payload.memory, payload.disk, payload.network].some(Boolean)) return null;
  if (containsSensitiveValue(encoded)) return null;
  return JSON.parse(encoded);
}

function sanitizeHostResourceHistoryChunk(payload) {
  let encoded;
  try { encoded = JSON.stringify(payload); } catch { return null; }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_HOST_RESOURCE_HISTORY_BYTES) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = new Set(['stream', 'points', 'after_sequence', 'next_sequence', 'done', 'retained_points', 'aggregate_only']);
  if (Object.keys(payload).some(key => !keys.has(key))) return null;
  if (!new Set(['system', 'detail']).has(payload.stream) || !Array.isArray(payload.points)) return null;
  if (payload.points.length > (payload.stream === 'system' ? 128 : 8)) return null;
  for (const key of ['after_sequence', 'next_sequence', 'retained_points']) {
    if (!Number.isSafeInteger(payload[key]) || payload[key] < 0) return null;
  }
  if (payload.next_sequence < payload.after_sequence || typeof payload.done !== 'boolean'
      || typeof payload.aggregate_only !== 'boolean') return null;
  const sanitizedPoints = payload.stream === 'system'
    ? payload.points.map(sanitizeHostResourceSystemPoint)
    : payload.points.map(sanitizeHostResourceSnapshot);
  if (sanitizedPoints.some(point => point === null)) return null;
  for (let index = 1; index < sanitizedPoints.length; index += 1) {
    if (sanitizedPoints[index].sample_sequence <= sanitizedPoints[index - 1].sample_sequence) return null;
  }
  if (sanitizedPoints.length && sanitizedPoints.at(-1).sample_sequence !== payload.next_sequence) return null;
  return { ...JSON.parse(encoded), points: sanitizedPoints };
}

function sanitizeHostResourceSnapshot(payload) {
  let encoded;
  try { encoded = JSON.stringify(payload); } catch { return null; }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_HOST_RESOURCE_BYTES) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.schema_version !== 2 || payload.source !== 'windows_proxy') return null;
  if (!new Set(['fresh', 'unavailable']).has(payload.status)) return null;
  if (!Number.isFinite(Date.parse(payload.captured_at))) return null;
  if (!Number.isSafeInteger(payload.monotonic_ms) || payload.monotonic_ms < 0
      || !Number.isSafeInteger(payload.sample_sequence) || payload.sample_sequence < 1
      || !Number.isSafeInteger(payload.sample_interval_ms) || payload.sample_interval_ms < 0
      || !Number.isSafeInteger(payload.dropped_gap_count) || payload.dropped_gap_count < 0) return null;
  if (!Array.isArray(payload.processes) || payload.processes.length > MAX_HOST_RESOURCE_PROCESSES) return null;
  if (!payload.processes.every(validProcess)) return null;
  if (payload.status === 'fresh' && (!payload.system || typeof payload.system !== 'object')) return null;
  if (payload.status === 'unavailable' && payload.system !== null) return null;
  if (payload.capabilities?.schema_v2 !== true) return null;
  if (payload.privacy?.ephemeral !== true
      || payload.privacy?.relay_cached !== false
      || payload.privacy?.relay_persisted !== false
      || payload.privacy?.command_lines_transmitted !== false
      || payload.privacy?.executable_paths_transmitted !== false
      || typeof payload.privacy?.aggregate_only !== 'boolean') return null;
  if (payload.privacy.aggregate_only === true
      && (payload.machine_label !== null || payload.processes.length !== 0)) return null;
  if (payload.sampling?.process_limit !== MAX_HOST_RESOURCE_PROCESSES
      || payload.sampling?.process_included !== payload.processes.length
      || payload.sampling?.system_interval_ms !== 1_000
      || payload.sampling?.detail_interval_ms !== 5_000
      || payload.sampling?.windows_hide !== true) return null;
  if (!validateNode(payload)) return null;
  return JSON.parse(encoded);
}

module.exports = {
  MAX_HOST_RESOURCE_BYTES,
  MAX_HOST_RESOURCE_HISTORY_BYTES,
  MAX_HOST_RESOURCE_PROCESSES,
  MAX_HOST_RESOURCE_SUMMARY_BYTES,
  containsSensitiveValue,
  sanitizeHostResourceHistoryChunk,
  sanitizeHostResourceSnapshot,
  sanitizeHostResourceSystemPoint,
};
