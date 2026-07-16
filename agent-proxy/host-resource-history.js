'use strict';

const MAX_SYSTEM_POINTS = 900;
const MAX_DETAIL_POINTS = 180;
const MAX_SUMMARY_BYTES = 16 * 1024;
const MAX_HISTORY_CHUNK_BYTES = 60 * 1024;
const MAX_SUBSCRIBERS = 8;
const DETACHED_RETENTION_MS = 30_000;

const METRIC_PATHS = Object.freeze({
  cpu_total_percent: ['cpu', 'total_percent'],
  cpu_user_percent: ['cpu', 'user_percent'],
  cpu_privileged_percent: ['cpu', 'privileged_percent'],
  memory_used_percent: ['memory', 'used_percent'],
  memory_commit_percent: ['memory', 'commit_percent'],
  disk_read_bps: ['disk', 'read_bps'],
  disk_write_bps: ['disk', 'write_bps'],
  disk_read_iops: ['disk', 'read_iops'],
  disk_write_iops: ['disk', 'write_iops'],
  network_receive_bps: ['network', 'receive_bps'],
  network_send_bps: ['network', 'send_bps'],
  network_receive_pps: ['network', 'receive_pps'],
  network_send_pps: ['network', 'send_pps'],
});

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function compactObject(value, keys) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(keys.map(key => [key, safeNumber(value[key])]).filter(([, child]) => child !== null));
}

function systemPointFromSnapshot(snapshot) {
  const system = snapshot?.system;
  const fresh = snapshot?.status === 'fresh' && system && typeof system === 'object';
  const point = {
    schema_version: 2,
    frame_kind: 'system',
    source: snapshot?.source === 'windows_proxy' ? 'windows_proxy' : 'windows_proxy',
    status: fresh ? 'fresh' : 'unavailable',
    captured_at: snapshot?.captured_at || new Date().toISOString(),
    monotonic_ms: Math.max(0, Math.round(safeNumber(snapshot?.monotonic_ms, 0))),
    sample_sequence: Math.max(1, Math.round(safeNumber(snapshot?.sample_sequence, 1))),
    sample_interval_ms: Math.max(0, Math.round(safeNumber(snapshot?.sample_interval_ms, 0))),
    dropped_gap_count: Math.max(0, Math.round(safeNumber(snapshot?.dropped_gap_count, 0))),
    cpu: fresh ? compactObject(system.cpu, [
      'total_percent', 'user_percent', 'privileged_percent', 'idle_percent',
      'queue_length', 'interrupts_per_sec', 'dpcs_per_sec', 'context_switches_per_sec',
      'current_frequency_mhz', 'logical_core_count', 'physical_core_count',
    ]) : null,
    memory: fresh ? compactObject(system.memory, [
      'total_bytes', 'used_bytes', 'available_bytes', 'used_percent', 'cache_bytes',
      'commit_bytes', 'commit_limit_bytes', 'commit_peak_bytes', 'commit_percent',
      'paged_pool_bytes', 'nonpaged_pool_bytes', 'pagefile_used_bytes', 'pages_per_sec', 'faults_per_sec',
    ]) : null,
    disk: fresh ? compactObject(system.disk, [
      'read_bps', 'write_bps', 'busy_percent', 'read_iops', 'write_iops',
      'read_latency_ms', 'write_latency_ms', 'transfer_latency_ms', 'queue_length',
    ]) : null,
    network: fresh ? compactObject(system.network, [
      'receive_bps', 'send_bps', 'receive_pps', 'send_pps', 'utilization_percent',
      'output_queue_length', 'receive_errors', 'send_errors', 'receive_discards', 'send_discards',
      'tcp_segments_per_sec', 'tcp_retransmits_per_sec', 'tcp_connection_failures', 'tcp_resets',
    ]) : null,
    process_count: fresh ? Math.max(0, Math.round(safeNumber(system.process_count, 0))) : null,
    thread_count: fresh ? Math.max(0, Math.round(safeNumber(system.thread_count, 0))) : null,
    handle_count: fresh ? Math.max(0, Math.round(safeNumber(system.handle_count, 0))) : null,
    uptime_seconds: fresh ? Math.max(0, Math.round(safeNumber(system.uptime_seconds, 0))) : null,
    collection_duration_ms: Math.max(0, Math.round(safeNumber(snapshot?.sampling?.collection_duration_ms, 0))),
  };
  if (Buffer.byteLength(JSON.stringify(point), 'utf8') > MAX_SUMMARY_BYTES) {
    throw new Error('Host resource system point exceeds 16 KiB');
  }
  return point;
}

function aggregateOnlySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return {
    ...snapshot,
    machine_label: null,
    system: snapshot.system ? {
      ...snapshot.system,
      disks: [],
      network_adapters: [],
    } : null,
    processes: [],
    sampling: {
      ...snapshot.sampling,
      process_included: 0,
      truncated: false,
    },
    privacy: {
      ...snapshot.privacy,
      aggregate_only: true,
      transient_fields: [],
    },
  };
}

function metricValue(point, metric) {
  const path = METRIC_PATHS[metric];
  if (!path) return null;
  return safeNumber(path.reduce((value, key) => value?.[key], point), null);
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(ordered.length * percentile) - 1);
  return ordered[rank];
}

function intervalStats(points, metric) {
  const samples = Array.from(points || []).map(point => ({
    point,
    value: metricValue(point, metric),
  })).filter(sample => sample.value !== null);
  if (!samples.length) return { current: null, min: null, average: null, max: null, p95: null, peak_sequence: null, count: 0 };
  const values = samples.map(sample => sample.value);
  const peak = samples.reduce((best, sample) => sample.value > best.value ? sample : best, samples[0]);
  return {
    current: samples.at(-1).value,
    min: Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
    p95: quantile(values, 0.95),
    peak_sequence: peak.point.sample_sequence,
    count: values.length,
  };
}

function downsampleSystemPoints(points, targetBuckets = 300) {
  const input = Array.from(points || []);
  const target = Math.max(1, Math.round(Number(targetBuckets) || 300));
  if (input.length <= target) return input.map(point => ({ kind: 'point', point }));
  const width = Math.ceil(input.length / target);
  const buckets = [];
  for (let offset = 0; offset < input.length; offset += width) {
    const rows = input.slice(offset, offset + width);
    const metrics = {};
    for (const metric of Object.keys(METRIC_PATHS)) metrics[metric] = intervalStats(rows, metric);
    buckets.push({
      kind: 'bucket',
      start_sequence: rows[0].sample_sequence,
      end_sequence: rows.at(-1).sample_sequence,
      captured_at_start: rows[0].captured_at,
      captured_at_end: rows.at(-1).captured_at,
      count: rows.length,
      gap_count: rows.filter(row => row.status !== 'fresh').length
        + Math.max(0, rows.at(-1).dropped_gap_count - rows[0].dropped_gap_count),
      metrics,
    });
  }
  return buckets;
}

function appendOrdered(list, point, limit) {
  const sequence = Number(point?.sample_sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return false;
  const lastSequence = Number(list.at(-1)?.sample_sequence || 0);
  if (sequence <= lastSequence) return false;
  list.push(point);
  if (list.length > limit) list.splice(0, list.length - limit);
  return true;
}

function boundedChunk(points, afterSequence = 0, maxPoints = 64) {
  const candidates = Array.from(points || []).filter(point => point.sample_sequence > afterSequence);
  const selected = [];
  for (const point of candidates.slice(0, Math.max(1, Math.min(128, Number(maxPoints) || 64)))) {
    const candidate = [...selected, point];
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_HISTORY_CHUNK_BYTES) break;
    selected.push(point);
  }
  const nextSequence = selected.at(-1)?.sample_sequence || afterSequence;
  return {
    points: selected,
    after_sequence: afterSequence,
    next_sequence: nextSequence,
    done: !candidates.some(point => point.sample_sequence > nextSequence),
  };
}

class HostResourceHistoryStore {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.detachedRetentionMs = Math.max(1_000, Number(options.detachedRetentionMs) || DETACHED_RETENTION_MS);
    this.maxSubscribers = Math.max(1, Number(options.maxSubscribers) || MAX_SUBSCRIBERS);
    this.subscribers = new Map();
  }

  subscribe(id, options = {}) {
    const subscriberId = String(id || '').slice(0, 120);
    if (!subscriberId) throw new Error('Host resource subscriber ID is required');
    this.prune();
    let state = this.subscribers.get(subscriberId);
    if (!state) {
      if (this.subscribers.size >= this.maxSubscribers) throw new Error('Host resource subscriber limit reached');
      state = { id: subscriberId, aggregateOnly: options.aggregateOnly === true, system: [], detail: [], detachedAt: null };
      this.subscribers.set(subscriberId, state);
    } else if (state.aggregateOnly !== (options.aggregateOnly === true)) {
      state.system = [];
      state.detail = [];
      state.aggregateOnly = options.aggregateOnly === true;
    }
    state.detachedAt = null;
    return state;
  }

  detach(id) {
    const state = this.subscribers.get(String(id || ''));
    if (!state) return false;
    state.detachedAt = this.now();
    return true;
  }

  unsubscribe(id) {
    return this.subscribers.delete(String(id || ''));
  }

  prune() {
    const cutoff = this.now() - this.detachedRetentionMs;
    for (const [id, state] of this.subscribers) {
      if (state.detachedAt !== null && state.detachedAt <= cutoff) this.subscribers.delete(id);
    }
  }

  activeCount() {
    this.prune();
    return [...this.subscribers.values()].filter(state => state.detachedAt === null).length;
  }

  retainedCount() {
    this.prune();
    return this.subscribers.size;
  }

  appendSystem(snapshot) {
    const point = systemPointFromSnapshot(snapshot);
    let appended = 0;
    this.prune();
    for (const state of this.subscribers.values()) {
      if (appendOrdered(state.system, point, MAX_SYSTEM_POINTS)) appended += 1;
    }
    return { point, appended };
  }

  appendDetail(snapshot) {
    let appended = 0;
    this.prune();
    for (const state of this.subscribers.values()) {
      const detail = state.aggregateOnly ? aggregateOnlySnapshot(snapshot) : snapshot;
      if (appendOrdered(state.detail, detail, MAX_DETAIL_POINTS)) appended += 1;
    }
    return appended;
  }

  chunk(id, stream, options = {}) {
    this.prune();
    const state = this.subscribers.get(String(id || ''));
    if (!state) return null;
    const source = stream === 'detail' ? state.detail : state.system;
    const maxPoints = stream === 'detail'
      ? Math.min(8, Number(options.maxPoints) || 8)
      : Math.min(128, Number(options.maxPoints) || 64);
    return {
      stream: stream === 'detail' ? 'detail' : 'system',
      ...boundedChunk(source, Math.max(0, Math.round(Number(options.afterSequence) || 0)), maxPoints),
      retained_points: source.length,
      aggregate_only: state.aggregateOnly,
    };
  }

  clear() {
    this.subscribers.clear();
  }

  memoryBytes() {
    return Buffer.byteLength(JSON.stringify([...this.subscribers.values()].map(state => ({
      id: state.id,
      aggregateOnly: state.aggregateOnly,
      system: state.system,
      detail: state.detail,
    }))), 'utf8');
  }
}

module.exports = {
  DETACHED_RETENTION_MS,
  HostResourceHistoryStore,
  MAX_DETAIL_POINTS,
  MAX_HISTORY_CHUNK_BYTES,
  MAX_SUBSCRIBERS,
  MAX_SUMMARY_BYTES,
  MAX_SYSTEM_POINTS,
  METRIC_PATHS,
  aggregateOnlySnapshot,
  appendOrdered,
  boundedChunk,
  downsampleSystemPoints,
  intervalStats,
  metricValue,
  quantile,
  systemPointFromSnapshot,
};
