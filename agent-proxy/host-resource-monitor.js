'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const {
  HostResourceHistoryStore,
  aggregateOnlySnapshot,
} = require('./host-resource-history');
const { WarmHostResourceCollector } = require('./host-resource-warm-collector');

const SCHEMA_VERSION = 2;
const DEFAULT_MIN_INTERVAL_MS = 2_000;
const COLLECTOR_TIMEOUT_MS = 8_000;
const COLLECTOR_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_PROCESSES = 32;
const MAX_ATTRIBUTED_PROCESSES = 16;
const MAX_DEVICE_FAMILIES = 24;
const DETAIL_INTERVAL_MS = 5_000;
const IDLE_SHUTDOWN_MS = 30_000;

class HostSystemSampler {
  constructor(options = {}) {
    this.cpuProvider = options.cpuProvider || os.cpus;
    this.memoryProvider = options.memoryProvider || (() => ({
      total: os.totalmem(),
      available: os.freemem(),
    }));
    this.uptimeProvider = options.uptimeProvider || os.uptime;
    this.previous = this._readCpuRows();
  }

  _readCpuRows() {
    return Array.from(this.cpuProvider() || []).map((cpu, index) => ({
      id: String(index),
      speed: Math.max(0, Math.round(safeNumber(cpu?.speed))),
      user: Math.max(0, safeNumber(cpu?.times?.user)),
      nice: Math.max(0, safeNumber(cpu?.times?.nice)),
      sys: Math.max(0, safeNumber(cpu?.times?.sys)),
      idle: Math.max(0, safeNumber(cpu?.times?.idle)),
      irq: Math.max(0, safeNumber(cpu?.times?.irq)),
    }));
  }

  capture() {
    const current = this._readCpuRows();
    const previousById = new Map(this.previous.map(row => [row.id, row]));
    const deltas = current.map(row => {
      const previous = previousById.get(row.id) || {};
      const user = Math.max(0, row.user - safeNumber(previous.user));
      const nice = Math.max(0, row.nice - safeNumber(previous.nice));
      const sys = Math.max(0, row.sys - safeNumber(previous.sys));
      const idle = Math.max(0, row.idle - safeNumber(previous.idle));
      const irq = Math.max(0, row.irq - safeNumber(previous.irq));
      const total = user + nice + sys + idle + irq;
      const percent = value => total > 0 ? value / total * 100 : 0;
      return {
        id: row.id,
        utilization_percent: percent(user + nice + sys + irq),
        user_percent: percent(user + nice),
        privileged_percent: percent(sys + irq),
        idle_percent: percent(idle),
        frequency_mhz: row.speed,
        total,
        user,
        nice,
        sys,
        idle,
        irq,
      };
    });
    this.previous = current;
    const totals = deltas.reduce((sum, row) => ({
      total: sum.total + row.total,
      user: sum.user + row.user + row.nice,
      privileged: sum.privileged + row.sys + row.irq,
      idle: sum.idle + row.idle,
    }), { total: 0, user: 0, privileged: 0, idle: 0 });
    const percent = value => totals.total > 0 ? value / totals.total * 100 : 0;
    const memory = this.memoryProvider() || {};
    return {
      cpu_percent: percent(totals.user + totals.privileged),
      cpu_user_percent: percent(totals.user),
      cpu_privileged_percent: percent(totals.privileged),
      cpu_idle_percent: percent(totals.idle),
      current_frequency_mhz: current.length
        ? current.reduce((sum, row) => sum + row.speed, 0) / current.length : 0,
      cpu_per_logical: deltas,
      memory_available_bytes: Math.max(0, safeNumber(memory.available)),
      uptime_seconds: Math.max(0, safeNumber(this.uptimeProvider())),
    };
  }
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, safeNumber(value)));
}

function safeText(value, maxLength = 80) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function publicCollectorFailure(error) {
  const code = safeText(error?.code, 48) || 'collector_failure';
  const messages = {
    detail_timeout: 'The Windows detail collector timed out; aggregate CPU/RAM fallback is active.',
    startup_timeout: 'The Windows detail collector did not become ready; aggregate CPU/RAM fallback is active.',
    invalid_json_threshold: 'The Windows detail collector lost output framing; aggregate CPU/RAM fallback is active.',
    line_limit: 'The Windows detail collector exceeded its output limit; aggregate CPU/RAM fallback is active.',
    unexpected_exit: 'The Windows detail collector exited; aggregate CPU/RAM fallback is active.',
  };
  return {
    code: messages[code] ? code : 'collector_failure',
    message: messages[code] || 'The Windows detail collector failed; aggregate CPU/RAM fallback is active.',
  };
}

function safeCounterString(value) {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : '0';
  const text = String(value == null ? '' : value).trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : '0';
}

function safeIso(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stableProcessKey(pid, startTime) {
  return crypto.createHash('sha256').update(`${pid}|${startTime || 'unknown'}`).digest('hex').slice(0, 20);
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
}

function workspaceDescriptors(sessions) {
  const byPath = new Map();
  for (const session of Array.from(sessions || [])) {
    const workspacePath = safeText(session?.workspace_path || session?.project_root, 512);
    const normalized = normalizePath(workspacePath);
    if (!normalized) continue;
    const existing = byPath.get(normalized) || {
      normalized,
      label: safeText(session?.workspace_name || path.basename(workspacePath), 80) || 'Workspace',
      sessionIds: new Set(),
      agentTypes: new Set(),
    };
    if (session?.session_id) existing.sessionIds.add(String(session.session_id));
    if (session?.agent_type || session?.agentType) existing.agentTypes.add(String(session.agent_type || session.agentType));
    byPath.set(normalized, existing);
  }
  return [...byPath.values()].sort((left, right) => right.normalized.length - left.normalized.length);
}

function sessionAgentTypes(sessions) {
  return new Set(Array.from(sessions || []).map(session => (
    session?.agent_type || session?.agentType || ''
  )).filter(Boolean).map(String));
}

function processAttribution(processSample, descriptors, activeAgentTypes, ownedProcesses = new Map()) {
  const pid = Math.round(safeNumber(processSample?.pid, -1));
  const name = safeText(processSample?.name, 80);
  const nameProbe = name.toLowerCase().replace(/\.exe$/i, '');
  const commandProbe = normalizePath(processSample?.command_line);
  const owned = ownedProcesses.get(pid);
  let agentLabel = '';
  let agentTypes = [];
  let attributionLevel = 'unattributed';
  let attributionReason = 'No proved agent relationship';
  let ownedSessionId = null;

  if (owned) {
    agentLabel = safeText(owned.agentLabel || owned.label, 80) || 'Owned agent process';
    agentTypes = [owned.agentType].filter(Boolean);
    attributionLevel = 'owned';
    attributionReason = safeText(owned.reason, 120) || 'PID is explicitly owned by the local proxy runtime';
    ownedSessionId = safeText(owned.sessionId, 120) || null;
  } else if (nameProbe === 'chatgpt' || /(?:^|\\)chatgpt(?:\.exe)?(?:\s|$)/i.test(commandProbe)) {
    agentLabel = 'Codex Desktop';
    agentTypes = ['codex-desktop'];
    attributionLevel = 'runtime';
    attributionReason = 'Executable signature matches the Codex Desktop runtime';
  } else if (nameProbe.includes('cursor-agent') || /cursor(?:-|_)agent|cursor[\\/]agent/i.test(commandProbe)) {
    agentLabel = 'Cursor Agent';
    agentTypes = ['cursor_cli'];
    attributionLevel = 'runtime';
    attributionReason = 'Executable signature matches Cursor Agent';
  } else if (nameProbe === 'cursor' || nameProbe.startsWith('cursor')) {
    agentLabel = 'Cursor';
    agentTypes = ['cursor'];
    attributionLevel = 'runtime';
    attributionReason = 'Executable signature matches the Cursor runtime';
  } else if (nameProbe === 'code') {
    agentLabel = /extensionhost|openai\.chatgpt|anthropic|continue/i.test(commandProbe)
      ? 'VS Code extension host'
      : 'VS Code';
    agentTypes = ['codex', 'claude', 'continue', 'gemini'].filter(type => activeAgentTypes.has(type));
    attributionLevel = 'runtime';
    attributionReason = 'Shared VS Code runtime; no exact session ownership is implied';
  } else if (nameProbe === 'claude' || /(?:^|[\\\s])claude(?:\.exe|\.js|\s|$)/i.test(commandProbe)) {
    agentLabel = 'Claude Code';
    agentTypes = ['claude_cli'];
    attributionLevel = 'runtime';
    attributionReason = 'Executable signature matches Claude Code';
  } else if (nameProbe === 'codex' || /(?:^|[\\\s])codex(?:\.exe|\.js|\s|$)/i.test(commandProbe)) {
    agentLabel = 'Codex CLI';
    agentTypes = ['codex_cli'];
    attributionLevel = 'runtime';
    attributionReason = 'Executable signature matches Codex CLI';
  } else if (nameProbe === 'node' && /remote agent chat[\\/]agent-proxy|agent-proxy[\\/]index\.js/i.test(commandProbe)) {
    agentLabel = 'Remote Agent proxy';
    agentTypes = ['agent-proxy'];
    attributionLevel = 'runtime';
    attributionReason = 'Command signature matches the Remote Agent proxy runtime';
  }

  const workspace = descriptors.find(item => commandProbe.includes(item.normalized));
  if (workspace && !agentLabel) {
    agentLabel = 'Agent workspace process';
    agentTypes = [...workspace.agentTypes].slice(0, 8);
    attributionLevel = 'workspace-associated';
    attributionReason = 'Local command metadata references an active workspace; ownership is not proved';
  }
  return {
    attributed: !!agentLabel,
    agent_label: agentLabel || null,
    agent_types: [...new Set(agentTypes)].slice(0, 8),
    workspace_label: workspace?.label || null,
    session_count: workspace?.sessionIds.size || 0,
    attribution_level: attributionLevel,
    attribution_reason: attributionReason,
    owned_session_id: attributionLevel === 'owned' ? ownedSessionId : null,
  };
}

function normalizeProcess(processSample, context) {
  const pid = Math.round(safeNumber(processSample?.pid, -1));
  if (pid <= 0) return null;
  const parentPid = Math.max(0, Math.round(safeNumber(processSample?.parent_pid)));
  const startTime = safeIso(processSample?.start_time);
  const coreEquivalent = clamp(
    safeNumber(processSample?.cpu_percent),
    0,
    Math.max(1, context.logicalCpuCount) * 100,
  );
  const attribution = processAttribution(
    processSample,
    context.descriptors,
    context.activeAgentTypes,
    context.ownedProcesses,
  );
  return {
    pid,
    parent_pid: parentPid,
    start_time: startTime,
    stable_key: stableProcessKey(pid, startTime),
    name: safeText(processSample?.name, 80) || `PID ${pid}`,
    ...attribution,
    cpu_percent: Math.round(clamp(coreEquivalent / context.logicalCpuCount, 0, 100) * 10) / 10,
    cpu_host_percent: Math.round(clamp(coreEquivalent / context.logicalCpuCount, 0, 100) * 10) / 10,
    cpu_core_equivalent: Math.round(coreEquivalent * 10) / 10,
    memory_bytes: Math.max(0, Math.round(safeNumber(processSample?.memory_bytes))),
    private_bytes: Math.max(0, Math.round(safeNumber(processSample?.private_bytes, processSample?.memory_bytes))),
    commit_bytes: Math.max(0, Math.round(safeNumber(processSample?.commit_bytes, processSample?.private_bytes))),
    io_read_bps: Math.max(0, Math.round(safeNumber(processSample?.io_read_bps))),
    io_write_bps: Math.max(0, Math.round(safeNumber(processSample?.io_write_bps))),
    io_read_ops: Math.max(0, Math.round(safeNumber(processSample?.io_read_ops))),
    io_write_ops: Math.max(0, Math.round(safeNumber(processSample?.io_write_ops))),
    thread_count: Math.max(0, Math.round(safeNumber(processSample?.thread_count))),
    handle_count: Math.max(0, Math.round(safeNumber(processSample?.handle_count))),
    status: safeText(processSample?.status, 40) || 'running',
    uptime_seconds: startTime ? Math.max(0, Math.round((context.capturedAtMs - Date.parse(startTime)) / 1000)) : null,
    counter_totals: {
      io_read_bytes: safeCounterString(processSample?.io_read_bytes_total),
      io_write_bytes: safeCounterString(processSample?.io_write_bytes_total),
      io_read_operations: safeCounterString(processSample?.io_read_operations_total),
      io_write_operations: safeCounterString(processSample?.io_write_operations_total),
    },
  };
}

function selectProcesses(processes) {
  const selected = new Map();
  const include = process => {
    if (process && selected.size < MAX_PROCESSES) selected.set(process.stable_key, process);
  };
  const by = field => [...processes].sort((left, right) => (
    safeNumber(right[field]) - safeNumber(left[field]) || left.pid - right.pid
  ));
  by('cpu_host_percent').filter(item => item.attribution_level === 'owned')
    .slice(0, MAX_ATTRIBUTED_PROCESSES).forEach(include);
  for (const field of ['cpu_host_percent', 'memory_bytes', 'io_read_bps', 'io_write_bps']) {
    by(field).slice(0, 6).forEach(include);
  }
  const combined = [...processes].sort((left, right) => (
    Number(right.attributed) - Number(left.attributed)
    || right.cpu_host_percent - left.cpu_host_percent
    || right.memory_bytes - left.memory_bytes
    || right.io_read_bps + right.io_write_bps - left.io_read_bps - left.io_write_bps
    || left.pid - right.pid
  ));
  combined.forEach(include);
  const chosen = [...selected.values()];
  const chosenKeys = new Set(chosen.map(item => item.stable_key));
  return chosen.map(item => ({
    ...item,
    parent_key: chosen.find(parent => parent.pid === item.parent_pid)?.stable_key || null,
    child_count: processes.filter(child => child.parent_pid === item.pid).length,
    selected_as: [
      by('cpu_host_percent').slice(0, 6).some(row => row.stable_key === item.stable_key) ? 'cpu' : null,
      by('memory_bytes').slice(0, 6).some(row => row.stable_key === item.stable_key) ? 'memory' : null,
      by('io_read_bps').slice(0, 6).some(row => row.stable_key === item.stable_key) ? 'read' : null,
      by('io_write_bps').slice(0, 6).some(row => row.stable_key === item.stable_key) ? 'write' : null,
      item.attribution_level === 'owned' ? 'owned' : null,
    ].filter(Boolean),
    selected_parent_present: item.parent_pid <= 0 || chosen.some(parent => parent.pid === item.parent_pid),
  }));
}

function normalizeDiskFamily(raw, index) {
  return {
    id: safeText(raw?.id || raw?.name || `disk-${index}`, 80),
    label: safeText(raw?.label || raw?.name || `Disk ${index + 1}`, 80),
    kind: safeText(raw?.kind || 'unknown', 32),
    read_bps: Math.max(0, Math.round(safeNumber(raw?.read_bps))),
    write_bps: Math.max(0, Math.round(safeNumber(raw?.write_bps))),
    read_iops: Math.max(0, Math.round(safeNumber(raw?.read_iops))),
    write_iops: Math.max(0, Math.round(safeNumber(raw?.write_iops))),
    busy_percent: Math.round(clamp(raw?.busy_percent, 0, 100) * 10) / 10,
    read_latency_ms: Math.max(0, Math.round(safeNumber(raw?.read_latency_ms) * 1000) / 1000),
    write_latency_ms: Math.max(0, Math.round(safeNumber(raw?.write_latency_ms) * 1000) / 1000),
    transfer_latency_ms: Math.max(0, Math.round(safeNumber(raw?.transfer_latency_ms) * 1000) / 1000),
    queue_length: Math.max(0, Math.round(safeNumber(raw?.queue_length) * 100) / 100),
    capacity_bytes: Math.max(0, Math.round(safeNumber(raw?.capacity_bytes))),
    free_bytes: Math.max(0, Math.round(safeNumber(raw?.free_bytes))),
    free_percent: Math.round(clamp(raw?.free_percent, 0, 100) * 10) / 10,
    available: raw?.available !== false,
  };
}

function normalizeNetworkFamily(raw, index) {
  return {
    id: safeText(raw?.id || raw?.name || `adapter-${index}`, 80),
    label: safeText(raw?.label || raw?.name || `Adapter ${index + 1}`, 80),
    kind: safeText(raw?.kind || 'unknown', 32),
    physical_default: raw?.physical_default === true,
    receive_bps: Math.max(0, Math.round(safeNumber(raw?.receive_bps))),
    send_bps: Math.max(0, Math.round(safeNumber(raw?.send_bps))),
    receive_pps: Math.max(0, Math.round(safeNumber(raw?.receive_pps))),
    send_pps: Math.max(0, Math.round(safeNumber(raw?.send_pps))),
    link_speed_bps: Math.max(0, Math.round(safeNumber(raw?.link_speed_bps))),
    utilization_percent: Math.round(clamp(raw?.utilization_percent, 0, 100) * 10) / 10,
    output_queue_length: Math.max(0, Math.round(safeNumber(raw?.output_queue_length) * 100) / 100),
    receive_errors: Math.max(0, Math.round(safeNumber(raw?.receive_errors))),
    send_errors: Math.max(0, Math.round(safeNumber(raw?.send_errors))),
    receive_discards: Math.max(0, Math.round(safeNumber(raw?.receive_discards))),
    send_discards: Math.max(0, Math.round(safeNumber(raw?.send_discards))),
    available: raw?.available !== false,
  };
}

function normalizeHostResourceSnapshot(raw, options = {}) {
  const sessions = Array.from(options.sessions || []);
  const totalMemoryBytes = Math.max(1, Math.round(safeNumber(options.totalMemoryBytes, os.totalmem())));
  const availableMemoryBytes = clamp(raw?.memory_available_bytes, 0, totalMemoryBytes);
  const usedMemoryBytes = totalMemoryBytes - availableMemoryBytes;
  const logicalCpuCount = Math.max(1, Math.round(safeNumber(options.logicalCpuCount, os.cpus().length)));
  const context = {
    descriptors: workspaceDescriptors(sessions),
    activeAgentTypes: sessionAgentTypes(sessions),
    logicalCpuCount,
    ownedProcesses: options.ownedProcesses instanceof Map ? options.ownedProcesses : new Map(),
    capturedAtMs: safeNumber(options.capturedAtMs, Date.now()),
  };
  const rawProcesses = Array.isArray(raw?.processes) ? raw.processes : [];
  const normalizedProcesses = rawProcesses.map(process => normalizeProcess(process, context)).filter(Boolean);
  const aggregateOnly = options.aggregateOnly === true;
  const processes = aggregateOnly ? [] : selectProcesses(normalizedProcesses);
  const capturedAtMs = safeNumber(options.capturedAtMs, Date.now());
  const collectionDurationMs = Math.max(0, Math.round(safeNumber(options.collectionDurationMs)));
  const disks = aggregateOnly ? [] : (Array.isArray(raw?.disks) ? raw.disks : [])
    .slice(0, MAX_DEVICE_FAMILIES).map(normalizeDiskFamily);
  const adapters = aggregateOnly ? [] : (Array.isArray(raw?.network_adapters) ? raw.network_adapters : [])
    .slice(0, MAX_DEVICE_FAMILIES).map(normalizeNetworkFamily);
  const cpuPerLogical = (Array.isArray(raw?.cpu_per_logical) ? raw.cpu_per_logical : [])
    .slice(0, 256).map((cpu, index) => ({
      id: safeText(cpu?.id || cpu?.name || String(index), 40),
      utilization_percent: Math.round(clamp(cpu?.utilization_percent ?? cpu?.cpu_percent, 0, 100) * 10) / 10,
      user_percent: Math.round(clamp(cpu?.user_percent, 0, 100) * 10) / 10,
      privileged_percent: Math.round(clamp(cpu?.privileged_percent, 0, 100) * 10) / 10,
      idle_percent: Math.round(clamp(cpu?.idle_percent, 0, 100) * 10) / 10,
      frequency_mhz: Math.max(0, Math.round(safeNumber(cpu?.frequency_mhz))),
    }));
  return {
    schema_version: SCHEMA_VERSION,
    source: 'windows_proxy',
    status: 'fresh',
    captured_at: new Date(capturedAtMs).toISOString(),
    monotonic_ms: Math.max(0, Math.round(safeNumber(options.monotonicMs, capturedAtMs))),
    sample_sequence: Math.max(1, Math.round(safeNumber(options.sampleSequence, 1))),
    sample_interval_ms: Math.max(0, Math.round(safeNumber(options.sampleIntervalMs))),
    dropped_gap_count: Math.max(0, Math.round(safeNumber(options.droppedGapCount))),
    machine_label: aggregateOnly ? null : (safeText(options.machineLabel || os.hostname(), 80) || 'Windows host'),
    system: {
      cpu_percent: Math.round(clamp(raw?.cpu_percent, 0, 100) * 10) / 10,
      cpu: {
        total_percent: Math.round(clamp(raw?.cpu_percent, 0, 100) * 10) / 10,
        user_percent: Math.round(clamp(raw?.cpu_user_percent, 0, 100) * 10) / 10,
        privileged_percent: Math.round(clamp(raw?.cpu_privileged_percent, 0, 100) * 10) / 10,
        idle_percent: Math.round(clamp(raw?.cpu_idle_percent, 0, 100) * 10) / 10,
        queue_length: Math.max(0, Math.round(safeNumber(raw?.processor_queue_length) * 100) / 100),
        interrupts_per_sec: Math.max(0, Math.round(safeNumber(raw?.interrupts_per_sec))),
        dpcs_per_sec: Math.max(0, Math.round(safeNumber(raw?.dpcs_per_sec))),
        context_switches_per_sec: Math.max(0, Math.round(safeNumber(raw?.context_switches_per_sec))),
        current_frequency_mhz: Math.max(0, Math.round(safeNumber(raw?.current_frequency_mhz))),
        logical_core_count: logicalCpuCount,
        physical_core_count: Math.max(1, Math.round(safeNumber(raw?.physical_core_count, logicalCpuCount))),
        per_logical: cpuPerLogical,
      },
      memory: {
        total_bytes: totalMemoryBytes,
        used_bytes: usedMemoryBytes,
        available_bytes: availableMemoryBytes,
        used_percent: Math.round((usedMemoryBytes / totalMemoryBytes) * 1000) / 10,
        cache_bytes: Math.max(0, Math.round(safeNumber(raw?.memory_cache_bytes))),
        commit_bytes: Math.max(0, Math.round(safeNumber(raw?.memory_commit_bytes))),
        commit_limit_bytes: Math.max(0, Math.round(safeNumber(raw?.memory_commit_limit_bytes))),
        commit_peak_bytes: Math.max(0, Math.round(safeNumber(raw?.memory_commit_peak_bytes))),
        commit_percent: Math.round(clamp(raw?.memory_commit_percent, 0, 100) * 10) / 10,
        paged_pool_bytes: Math.max(0, Math.round(safeNumber(raw?.memory_paged_pool_bytes))),
        nonpaged_pool_bytes: Math.max(0, Math.round(safeNumber(raw?.memory_nonpaged_pool_bytes))),
        pagefile_used_bytes: Math.max(0, Math.round(safeNumber(raw?.pagefile_used_bytes))),
        pages_per_sec: Math.max(0, Math.round(safeNumber(raw?.pages_per_sec))),
        faults_per_sec: Math.max(0, Math.round(safeNumber(raw?.faults_per_sec))),
      },
      disk: {
        read_bps: Math.max(0, Math.round(safeNumber(raw?.disk_read_bps))),
        write_bps: Math.max(0, Math.round(safeNumber(raw?.disk_write_bps))),
        busy_percent: Math.round(clamp(raw?.disk_busy_percent, 0, 100) * 10) / 10,
        read_iops: Math.max(0, Math.round(safeNumber(raw?.disk_read_iops))),
        write_iops: Math.max(0, Math.round(safeNumber(raw?.disk_write_iops))),
        read_latency_ms: Math.max(0, Math.round(safeNumber(raw?.disk_read_latency_ms) * 1000) / 1000),
        write_latency_ms: Math.max(0, Math.round(safeNumber(raw?.disk_write_latency_ms) * 1000) / 1000),
        transfer_latency_ms: Math.max(0, Math.round(safeNumber(raw?.disk_transfer_latency_ms) * 1000) / 1000),
        queue_length: Math.max(0, Math.round(safeNumber(raw?.disk_queue_length) * 100) / 100),
      },
      disks,
      network: {
        receive_bps: Math.max(0, Math.round(safeNumber(raw?.network_receive_bps))),
        send_bps: Math.max(0, Math.round(safeNumber(raw?.network_send_bps))),
        receive_pps: Math.max(0, Math.round(safeNumber(raw?.network_receive_pps))),
        send_pps: Math.max(0, Math.round(safeNumber(raw?.network_send_pps))),
        utilization_percent: Math.round(clamp(raw?.network_utilization_percent, 0, 100) * 10) / 10,
        output_queue_length: Math.max(0, Math.round(safeNumber(raw?.network_output_queue_length) * 100) / 100),
        receive_errors: Math.max(0, Math.round(safeNumber(raw?.network_receive_errors))),
        send_errors: Math.max(0, Math.round(safeNumber(raw?.network_send_errors))),
        receive_discards: Math.max(0, Math.round(safeNumber(raw?.network_receive_discards))),
        send_discards: Math.max(0, Math.round(safeNumber(raw?.network_send_discards))),
        tcp_segments_per_sec: Math.max(0, Math.round(safeNumber(raw?.tcp_segments_per_sec))),
        tcp_retransmits_per_sec: Math.max(0, Math.round(safeNumber(raw?.tcp_retransmits_per_sec))),
        tcp_connection_failures: Math.max(0, Math.round(safeNumber(raw?.tcp_connection_failures))),
        tcp_resets: Math.max(0, Math.round(safeNumber(raw?.tcp_resets))),
      },
      network_adapters: adapters,
      process_count: Math.max(0, Math.round(safeNumber(raw?.process_total, rawProcesses.length))),
      thread_count: Math.max(0, Math.round(safeNumber(raw?.thread_total))),
      handle_count: Math.max(0, Math.round(safeNumber(raw?.handle_total))),
      uptime_seconds: Math.max(0, Math.round(safeNumber(raw?.uptime_seconds))),
    },
    processes,
    capabilities: {
      schema_v2: true,
      per_logical_cpu: cpuPerLogical.length > 0,
      cpu_frequency: safeNumber(raw?.current_frequency_mhz) > 0,
      memory_commit: safeNumber(raw?.memory_commit_limit_bytes) > 0,
      disk_families: disks.length > 0,
      network_families: adapters.length > 0,
      gpu: false,
      sensors: false,
      unavailable: [
        ...(safeNumber(raw?.current_frequency_mhz) > 0 ? [] : [{ metric: 'cpu_frequency', reason: 'Windows counter unavailable' }]),
        { metric: 'gpu', reason: 'Capability not collected by the core sampler' },
        { metric: 'sensors', reason: 'Capability not collected by the core sampler' },
      ],
    },
    sampling: {
      collection_duration_ms: collectionDurationMs,
      min_interval_ms: Math.max(250, Math.round(safeNumber(options.minIntervalMs, DEFAULT_MIN_INTERVAL_MS))),
      process_total: Math.max(rawProcesses.length, Math.round(safeNumber(raw?.process_total))),
      process_included: processes.length,
      process_limit: MAX_PROCESSES,
      truncated: !aggregateOnly && rawProcesses.length > processes.length,
      selection_rule: 'union: owned + top cpu + top memory + top read + top write',
      system_interval_ms: 1_000,
      detail_interval_ms: 5_000,
      windows_hide: true,
    },
    privacy: {
      ephemeral: true,
      relay_cached: false,
      relay_persisted: false,
      command_lines_transmitted: false,
      executable_paths_transmitted: false,
      aggregate_only: aggregateOnly,
      transient_fields: aggregateOnly ? [] : ['pid', 'process_name', 'machine_label', 'workspace_label', 'metrics'],
    },
    error: null,
  };
}

function unavailableSnapshot(options = {}) {
  const aggregateOnly = options.aggregateOnly === true;
  return {
    schema_version: SCHEMA_VERSION,
    source: 'windows_proxy',
    status: 'unavailable',
    captured_at: new Date(options.capturedAtMs || Date.now()).toISOString(),
    monotonic_ms: Math.max(0, Math.round(safeNumber(options.monotonicMs, options.capturedAtMs || Date.now()))),
    sample_sequence: Math.max(1, Math.round(safeNumber(options.sampleSequence, 1))),
    sample_interval_ms: Math.max(0, Math.round(safeNumber(options.sampleIntervalMs))),
    dropped_gap_count: Math.max(0, Math.round(safeNumber(options.droppedGapCount))),
    machine_label: aggregateOnly ? null : (safeText(options.machineLabel || os.hostname(), 80) || 'Windows host'),
    system: null,
    processes: [],
    capabilities: { schema_v2: true, unavailable: [{ metric: 'system', reason: 'Collector unavailable' }] },
    sampling: {
      collection_duration_ms: Math.max(0, Math.round(safeNumber(options.collectionDurationMs))),
      min_interval_ms: Math.max(250, Math.round(safeNumber(options.minIntervalMs, DEFAULT_MIN_INTERVAL_MS))),
      process_total: 0,
      process_included: 0,
      process_limit: MAX_PROCESSES,
      truncated: false,
      selection_rule: 'union: owned + top cpu + top memory + top read + top write',
      system_interval_ms: 1_000,
      detail_interval_ms: 5_000,
      windows_hide: true,
    },
    privacy: {
      ephemeral: true,
      relay_cached: false,
      relay_persisted: false,
      command_lines_transmitted: false,
      executable_paths_transmitted: false,
      aggregate_only: aggregateOnly,
      transient_fields: [],
    },
    error: { code: 'collector_unavailable', message: 'Windows host metrics are temporarily unavailable.' },
  };
}

function collectWindowsHostResources(options = {}) {
  const scriptPath = options.scriptPath || path.join(__dirname, 'collect-host-resources.ps1');
  const powershell = options.powershell || path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  return new Promise((resolve, reject) => {
    execFile(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], {
      windowsHide: true,
      timeout: COLLECTOR_TIMEOUT_MS,
      maxBuffer: COLLECTOR_MAX_BUFFER_BYTES,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const parsed = JSON.parse(String(stdout || '').trim());
        if (!parsed || typeof parsed !== 'object') throw new Error('collector returned no object');
        resolve(parsed);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

class HostResourceMonitor {
  constructor(options = {}) {
    this.getSessions = options.getSessions || (() => []);
    this.warmCollector = options.warmCollector || (options.collectRaw ? null : new WarmHostResourceCollector({
      log: options.log,
    }));
    this.collectRaw = options.collectRaw || (async () => {
      const detail = await this.warmCollector.collect();
      return { ...detail.raw, collection_duration_ms: detail.collection_duration_ms };
    });
    this.onSnapshot = options.onSnapshot || (() => {});
    this.onLivePoint = options.onLivePoint || (() => {});
    this.onDetailSnapshot = options.onDetailSnapshot || (() => {});
    this.log = options.log || (() => {});
    this.now = options.now || Date.now;
    this.machineLabel = options.machineLabel || os.hostname();
    this.totalMemoryBytes = options.totalMemoryBytes || os.totalmem();
    this.logicalCpuCount = options.logicalCpuCount || os.cpus().length;
    this.minIntervalMs = Math.max(250, Number(options.minIntervalMs) || DEFAULT_MIN_INTERVAL_MS);
    this.ownedProcesses = options.ownedProcesses || (() => new Map());
    this.monotonicNow = options.monotonicNow || (() => Math.round(Number(process.hrtime.bigint() / 1_000_000n)));
    this.systemSampler = options.systemSampler || new HostSystemSampler(options);
    this.detailIntervalMs = Math.max(1_000, Number(options.detailIntervalMs) || DETAIL_INTERVAL_MS);
    this.idleShutdownMs = Math.max(1_000, Number(options.idleShutdownMs) || IDLE_SHUTDOWN_MS);
    this.history = options.historyStore || new HostResourceHistoryStore({
      now: this.now,
      detachedRetentionMs: this.idleShutdownMs,
    });
    this.lastSnapshot = null;
    this.lastCollectedAt = 0;
    this.lastCapturedAt = 0;
    this.lastDetailAt = 0;
    this.lastGoodDetailAt = 0;
    this.lastDetailFailure = null;
    this.lastDetailRaw = null;
    this.lastFastRaw = null;
    this.sampleSequence = 0;
    this.droppedGapCount = 0;
    this.lastHistorySequence = 0;
    this.inFlight = null;
    this.systemTimer = null;
    this.idleTimer = null;
    this.stopped = false;
  }

  _captureFast() {
    this.lastFastRaw = this.systemSampler.capture();
    return this.lastFastRaw;
  }

  _startSystemLane() {
    if (this.systemTimer || this.stopped) return false;
    this._captureFast();
    this.systemTimer = setInterval(() => { void this._systemTick(); }, 1_000);
    this.systemTimer.unref?.();
    return true;
  }

  async _systemTick(options = {}) {
    if (this.stopped || this.history.retainedCount() === 0) return;
    try {
      const sampled = await this._sample(options);
      this._recordHistory(sampled.snapshot, sampled.detailCollected);
    } catch (error) {
      this.log('warn', `[resources] Lightweight system sample failed: ${error?.message || 'unknown error'}`);
    } finally {
      // An explicit unsubscribe may close the final ring while this tick is in
      // flight. Re-clear transient state so the completed promise cannot
      // resurrect a stopped sampler or its last snapshot.
      if (!this.stopped && this.history.retainedCount() === 0) this._shutdownInactiveSampler();
    }
  }

  _recordHistory(snapshot, detailCollected) {
    if (!snapshot || snapshot.sample_sequence <= this.lastHistorySequence) return false;
    const { point, appended } = this.history.appendSystem(snapshot);
    if (appended === 0) return false;
    if (detailCollected) this.history.appendDetail(snapshot);
    this.lastHistorySequence = snapshot.sample_sequence;
    for (const state of this.history.subscribers.values()) {
      if (state.detachedAt !== null) continue;
      this.onLivePoint(point, state.id);
      if (detailCollected && !state.aggregateOnly) this.onDetailSnapshot(state.detail.at(-1), state.id);
    }
    return true;
  }

  _scheduleIdleShutdown() {
    clearTimeout(this.idleTimer);
    if (this.history.retainedCount() > 0) {
      this.idleTimer = setTimeout(() => {
        this.history.prune();
        if (this.history.retainedCount() > 0) return this._scheduleIdleShutdown();
        this._shutdownInactiveSampler();
      }, this.idleShutdownMs);
      this.idleTimer.unref?.();
      return;
    }
    this.idleTimer = setTimeout(() => this._shutdownInactiveSampler(), this.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  _shutdownInactiveSampler() {
    clearInterval(this.systemTimer);
    this.systemTimer = null;
    this.lastSnapshot = null;
    this.lastDetailRaw = null;
    this.lastFastRaw = null;
    this.lastCollectedAt = 0;
    this.lastDetailAt = 0;
    this.lastGoodDetailAt = 0;
    this.lastDetailFailure = null;
    this.history.clear();
    void this.warmCollector?.stop();
  }

  _touchLease() {
    this._startSystemLane();
    if (this.history.retainedCount() === 0) this._scheduleIdleShutdown();
  }

  subscribe(options = {}) {
    const state = this.history.subscribe(options.subscriberId, {
      aggregateOnly: options.aggregateOnly === true,
    });
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const startedSystemLane = this._startSystemLane();
    // _startSystemLane primes the CPU delta immediately. Reuse that exact
    // capture for the first emitted point so startup never performs two fast
    // counter reads less than one second apart. An additional subscriber joins
    // the existing shared cadence and waits for its next tick; it must not
    // create an extra native read between global one-second boundaries.
    if (startedSystemLane) void this._systemTick({ useCachedFast: true });
    return {
      subscriber_id: state.id,
      aggregate_only: state.aggregateOnly,
      resumed: state.system.length > 0,
      system_points: state.system.length,
      detail_points: state.detail.length,
    };
  }

  detach(subscriberId) {
    const detached = this.history.detach(subscriberId);
    if (detached && this.history.activeCount() === 0) this._scheduleIdleShutdown();
    return detached;
  }

  detachAll() {
    let detached = 0;
    for (const state of this.history.subscribers.values()) {
      if (state.detachedAt !== null) continue;
      if (this.history.detach(state.id)) detached += 1;
    }
    if (detached > 0) this._scheduleIdleShutdown();
    return detached;
  }

  unsubscribe(subscriberId) {
    const removed = this.history.unsubscribe(subscriberId);
    if (removed && this.history.activeCount() === 0) {
      // An explicit close has no reconnect contract to preserve. Stop immediately
      // when no detached subscription remains; detach still retains its 30s grace.
      if (this.history.retainedCount() === 0) this._shutdownInactiveSampler();
      else this._scheduleIdleShutdown();
    }
    return removed;
  }

  historyChunk(subscriberId, stream, options = {}) {
    return this.history.chunk(subscriberId, stream, options);
  }

  async _sample(options = {}) {
    const now = this.now();
    if (!this.inFlight) {
      const startedAt = this.now();
      const monotonicStartedAt = this.monotonicNow();
      const sampleSequence = this.sampleSequence + 1;
      const previousCapturedAt = this.lastCapturedAt;
      let detailCollected = false;
      this.inFlight = Promise.resolve()
        .then(async () => {
          // Capture the lightweight lane at tick start. A slow detail read may
          // delay delivery, but must not move the system sample to collection
          // completion and create a sub-second catch-up read on the next tick.
          const fastRaw = options.useCachedFast === true && this.lastFastRaw
            ? this.lastFastRaw : this._captureFast();
          const needsDetail = options.forceDetail === true || !this.lastDetailRaw
            || now - this.lastDetailAt >= this.detailIntervalMs;
          let detailFailure = this.lastDetailFailure;
          if (needsDetail) {
            // Keep the detail lane anchored to collection start. Anchoring at
            // completion adds the collector's own duration to every nominal
            // five-second interval and steadily slows a live subscription.
            this.lastDetailAt = now;
            try {
              this.lastDetailRaw = await this.collectRaw();
              this.lastGoodDetailAt = now;
              this.lastDetailFailure = null;
              detailFailure = null;
              detailCollected = true;
            } catch (error) {
              this.lastDetailFailure = error;
              detailFailure = error;
              this.log('warn', `[resources] Hidden Windows collector failed: ${error?.message || 'unknown error'}`);
            }
          }
          return {
            raw: detailFailure ? { ...(fastRaw || {}) } : { ...(this.lastDetailRaw || {}), ...(fastRaw || {}) },
            detailFailure,
          };
        })
        .then(({ raw, detailFailure }) => {
          const capturedAtMs = startedAt;
          const sampleIntervalMs = previousCapturedAt > 0 ? Math.max(0, capturedAtMs - previousCapturedAt) : 0;
          if (sampleIntervalMs > 1_500) {
            this.droppedGapCount += Math.max(0, Math.floor(sampleIntervalMs / 1_000) - 1);
          }
          const snapshot = normalizeHostResourceSnapshot(raw, {
            sessions: this.getSessions(),
            ownedProcesses: this.ownedProcesses(),
            totalMemoryBytes: this.totalMemoryBytes,
            logicalCpuCount: this.logicalCpuCount,
            machineLabel: this.machineLabel,
            minIntervalMs: this.minIntervalMs,
            capturedAtMs,
            monotonicMs: monotonicStartedAt,
            sampleSequence,
            sampleIntervalMs,
            droppedGapCount: this.droppedGapCount,
            collectionDurationMs: safeNumber(raw?.collection_duration_ms, this.now() - startedAt),
            aggregateOnly: !!detailFailure,
          });
          if (detailFailure) {
            snapshot.error = publicCollectorFailure(detailFailure);
            snapshot.last_good_captured_at = this.lastGoodDetailAt > 0
              ? new Date(this.lastGoodDetailAt).toISOString() : null;
            snapshot.capabilities.unavailable = [
              ...(snapshot.capabilities.unavailable || []),
              { metric: 'detail', reason: snapshot.error.message },
            ];
          }
          this.sampleSequence = sampleSequence;
          this.lastSnapshot = snapshot;
          this.lastCollectedAt = this.now();
          this.lastCapturedAt = Date.parse(snapshot.captured_at) || this.lastCollectedAt;
          return { snapshot, detailCollected };
        })
        .catch(error => {
          this.log('warn', `[resources] Hidden Windows collector failed: ${error?.message || 'unknown error'}`);
          const capturedAtMs = startedAt;
          const sampleIntervalMs = previousCapturedAt > 0 ? Math.max(0, capturedAtMs - previousCapturedAt) : 0;
          const snapshot = unavailableSnapshot({
            machineLabel: this.machineLabel,
            minIntervalMs: this.minIntervalMs,
            capturedAtMs,
            monotonicMs: monotonicStartedAt,
            sampleSequence,
            sampleIntervalMs,
            droppedGapCount: this.droppedGapCount,
            collectionDurationMs: this.now() - startedAt,
          });
          this.sampleSequence = sampleSequence;
          this.lastSnapshot = snapshot;
          this.lastCollectedAt = this.now();
          this.lastCapturedAt = Date.parse(snapshot.captured_at) || this.lastCollectedAt;
          return { snapshot, detailCollected: false };
        })
        .finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  async refresh(options = {}) {
    const requestId = safeText(options.requestId, 80) || null;
    const now = this.now();
    this._touchLease();
    if (!options.force && this.lastSnapshot && now - this.lastCollectedAt < this.minIntervalMs) {
      const cached = options.aggregateOnly === true ? aggregateOnlySnapshot(this.lastSnapshot) : this.lastSnapshot;
      this.onSnapshot(cached, requestId);
      return cached;
    }
    const sampled = await this._sample({
      forceDetail: options.force === true,
      useCachedFast: !this.lastSnapshot && !!this.lastFastRaw,
    });
    const snapshot = options.aggregateOnly === true ? aggregateOnlySnapshot(sampled.snapshot) : sampled.snapshot;
    if (this.history.retainedCount() > 0) this._recordHistory(sampled.snapshot, sampled.detailCollected);
    if (!this.stopped) this.onSnapshot(snapshot, requestId);
    return snapshot;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.systemTimer);
    clearTimeout(this.idleTimer);
    this.systemTimer = null;
    this.idleTimer = null;
    const stopPromise = this.warmCollector?.stop();
    this.lastSnapshot = null;
    this.lastDetailRaw = null;
    this.lastFastRaw = null;
    this.lastGoodDetailAt = 0;
    this.lastDetailFailure = null;
    this.history.clear();
    return stopPromise || Promise.resolve();
  }

  helperPid() {
    return this.warmCollector?.helperPid() || null;
  }
}

module.exports = {
  COLLECTOR_TIMEOUT_MS,
  DEFAULT_MIN_INTERVAL_MS,
  DETAIL_INTERVAL_MS,
  HostResourceMonitor,
  HostSystemSampler,
  IDLE_SHUTDOWN_MS,
  MAX_PROCESSES,
  collectWindowsHostResources,
  normalizeHostResourceSnapshot,
  processAttribution,
  publicCollectorFailure,
  unavailableSnapshot,
};
