'use strict';

const LATENCY_TRACE_SCHEMA_VERSION = 2;
const LATENCY_TRACE_STAGES = Object.freeze([
  'webui_send',
  'relay_recv',
  'proxy_recv',
  'harness_delivered',
  'agent_first_output',
  'relay_broadcast',
  'webui_render',
]);
const LATENCY_TRACE_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const LATENCY_TRACE_LABEL_RE = /^[A-Za-z0-9._:-]{1,96}$/;
const LATENCY_TRACE_TERMINAL_REASONS = Object.freeze(new Set([
  'capacity_evicted',
  'causal_identity_ambiguous',
  'expired_before_delivery',
  'expired_native_user_unobserved',
  'expired_no_output',
  'native_turn_failed',
  'proxy_stopped',
  'send_failed',
  'session_removed',
  'trace_replaced',
]));
const LATENCY_TRACE_SOURCE_FIELDS = Object.freeze([
  'source',
  'source_at',
  'source_at_ms',
  'cdpToQueueMs',
  'bindingToProxyMs',
  'queueToDispatchMs',
  'native_event_at_ms',
  'native_timestamp_source',
  'proxy_read_at_ms',
  'proxy_normalized_at_ms',
  'proxy_sent_at_ms',
  'relay_received_at_ms',
  'relay_forwarded_at_ms',
  'browser_received_at_ms',
  'browser_paint_at_ms',
  'clock_adjustment_ms',
  'clock_domain',
  'clock_reference',
  'clock_status',
  'raw_at_ms',
  'adjusted_at_ms',
  'clock_offset_ms',
  'clock_rtt_ms',
  'clock_uncertainty_ms',
  'clock_sample_age_ms',
  'causal_match',
]);

function finiteEpochMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function boundedLabel(value, fallback = null) {
  const label = String(value || '');
  return LATENCY_TRACE_LABEL_RE.test(label) ? label : fallback;
}

function latencySurfaceClass(agentType) {
  const normalized = String(agentType || '').toLowerCase();
  if (normalized === 'codex_cli') return 'codex_cli';
  if (normalized === 'codex-desktop') return 'codex-desktop';
  return 'webview';
}

function sanitizeLatencyStageSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const sanitized = {};
  for (const key of LATENCY_TRACE_SOURCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === 'string' && value.length > 0 && value.length <= 96) {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function validateLatencyStageClock(stage, adjustedAtMs, rawAtMs, source) {
  const clockDomain = String(source?.clock_domain || '').trim().toLowerCase();
  if (!clockDomain) return { ok: true, legacy: true };
  const clockStatus = String(source?.clock_status || '').trim();
  if (!clockStatus) return { ok: false, code: `clock_status_missing:${stage}` };
  const declaredAdjustedAtMs = finiteEpochMs(source?.adjusted_at_ms);
  if (declaredAdjustedAtMs !== null && Math.abs(declaredAdjustedAtMs - adjustedAtMs) > 0.001) {
    return { ok: false, code: `clock_adjusted_timestamp_mismatch:${stage}` };
  }
  if (clockDomain === 'relay') {
    if (Math.abs(adjustedAtMs - rawAtMs) > 0.001) {
      return { ok: false, code: `relay_clock_timestamp_mismatch:${stage}` };
    }
    if (Number(source?.clock_offset_ms || 0) !== 0) {
      return { ok: false, code: `relay_clock_offset_nonzero:${stage}` };
    }
    return { ok: true, legacy: false };
  }
  const offsetMs = Number(source?.clock_offset_ms);
  if (Number.isFinite(offsetMs)) {
    if (Math.abs((rawAtMs + offsetMs) - adjustedAtMs) > 0.001) {
      return { ok: false, code: `clock_offset_timestamp_mismatch:${stage}` };
    }
  } else if (clockStatus === 'synchronized') {
    return { ok: false, code: `clock_offset_missing:${stage}` };
  } else if (Math.abs(adjustedAtMs - rawAtMs) > 0.001) {
    return { ok: false, code: `unsynchronized_clock_adjustment:${stage}` };
  }
  return { ok: true, legacy: false };
}

function normalizeLatencyTrace(raw, { requireComplete = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'trace_not_object' };
  }
  const traceId = String(raw.trace_id || '');
  if (!LATENCY_TRACE_ID_RE.test(traceId)) {
    return { ok: false, code: 'trace_id_invalid' };
  }
  const stages = {};
  const rawStages = {};
  const stageSources = {};
  let previousAtMs = 0;
  let sawGap = false;
  for (const stage of LATENCY_TRACE_STAGES) {
    const atMs = finiteEpochMs(raw.stages?.[stage]);
    if (atMs === null) {
      sawGap = true;
      if (requireComplete) return { ok: false, code: `stage_missing:${stage}` };
      continue;
    }
    if (sawGap) return { ok: false, code: `stage_out_of_order:${stage}` };
    if (atMs < previousAtMs) return { ok: false, code: `stage_regressed:${stage}` };
    const rawAtMs = finiteEpochMs(raw.raw_stages?.[stage])
      ?? finiteEpochMs(raw.stage_sources?.[stage]?.raw_at_ms)
      ?? finiteEpochMs(raw.stage_sources?.[stage]?.source_at_ms)
      ?? atMs;
    const source = sanitizeLatencyStageSource(raw.stage_sources?.[stage]);
    const clockValidation = validateLatencyStageClock(stage, atMs, rawAtMs, source);
    if (!clockValidation.ok) return clockValidation;
    stages[stage] = atMs;
    rawStages[stage] = rawAtMs;
    previousAtMs = atMs;
    if (source) stageSources[stage] = source;
  }
  const agentType = boundedLabel(raw.agent_type, 'unknown');
  const clientMessageId = boundedLabel(raw.client_message_id);
  return {
    ok: true,
    trace: {
      schema_version: LATENCY_TRACE_SCHEMA_VERSION,
      trace_id: traceId,
      ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      agent_type: agentType,
      surface_class: latencySurfaceClass(agentType),
      stages,
      raw_stages: rawStages,
      ...(Object.keys(stageSources).length > 0 ? { stage_sources: stageSources } : {}),
    },
  };
}

function advanceLatencyTrace(raw, stage, observedAtMs = Date.now(), source = null) {
  const stageIndex = LATENCY_TRACE_STAGES.indexOf(stage);
  if (stageIndex < 0) return { ok: false, code: 'stage_unknown' };
  const normalized = normalizeLatencyTrace(raw);
  if (!normalized.ok) return normalized;
  const trace = normalized.trace;
  if (Object.prototype.hasOwnProperty.call(trace.stages, stage)) {
    return { ok: true, trace, duplicate: true };
  }
  for (let index = 0; index < stageIndex; index += 1) {
    const predecessor = LATENCY_TRACE_STAGES[index];
    if (!Object.prototype.hasOwnProperty.call(trace.stages, predecessor)) {
      return { ok: false, code: `predecessor_missing:${predecessor}` };
    }
  }
  for (let index = stageIndex + 1; index < LATENCY_TRACE_STAGES.length; index += 1) {
    const successor = LATENCY_TRACE_STAGES[index];
    if (Object.prototype.hasOwnProperty.call(trace.stages, successor)) {
      return { ok: false, code: `successor_already_present:${successor}` };
    }
  }
  const observed = finiteEpochMs(observedAtMs);
  if (observed === null) return { ok: false, code: 'stage_timestamp_invalid' };
  const previousStage = stageIndex > 0 ? LATENCY_TRACE_STAGES[stageIndex - 1] : null;
  const previousAtMs = previousStage ? Number(trace.stages[previousStage]) : 0;
  const sourceAdjustedAtMs = finiteEpochMs(source?.adjusted_at_ms);
  const atMs = sourceAdjustedAtMs ?? observed;
  const clockValidation = validateLatencyStageClock(stage, atMs, observed, source);
  if (!clockValidation.ok) return clockValidation;
  if (atMs < previousAtMs) {
    return {
      ok: false,
      code: `stage_regressed:${stage}`,
      raw_observed_at_ms: observed,
      adjusted_at_ms: atMs,
      previous_at_ms: previousAtMs,
      regression_ms: previousAtMs - atMs,
    };
  }
  trace.stages = { ...trace.stages, [stage]: atMs };
  trace.raw_stages = { ...(trace.raw_stages || {}), [stage]: observed };
  const sanitizedSource = sanitizeLatencyStageSource({
    ...(source && typeof source === 'object' ? source : {}),
    raw_at_ms: observed,
    adjusted_at_ms: atMs,
  });
  if (sanitizedSource) {
    trace.stage_sources = { ...(trace.stage_sources || {}), [stage]: sanitizedSource };
  }
  return { ok: true, trace, duplicate: false };
}

function latencyStageDurations(trace) {
  const normalized = normalizeLatencyTrace(trace, { requireComplete: true });
  if (!normalized.ok) return normalized;
  const durations = {};
  const rawDurations = {};
  for (let index = 1; index < LATENCY_TRACE_STAGES.length; index += 1) {
    const from = LATENCY_TRACE_STAGES[index - 1];
    const to = LATENCY_TRACE_STAGES[index];
    durations[`${from}_to_${to}_ms`] = normalized.trace.stages[to] - normalized.trace.stages[from];
    rawDurations[`${from}_to_${to}_ms`] =
      normalized.trace.raw_stages[to] - normalized.trace.raw_stages[from];
  }
  durations.total_ms = normalized.trace.stages.webui_render - normalized.trace.stages.webui_send;
  rawDurations.total_ms =
    normalized.trace.raw_stages.webui_render - normalized.trace.raw_stages.webui_send;
  return { ok: true, trace: normalized.trace, durations, raw_durations: rawDurations };
}

function normalizeLatencyTraceTerminal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'terminal_not_object' };
  }
  const traceId = String(raw.trace_id || '');
  if (!LATENCY_TRACE_ID_RE.test(traceId)) {
    return { ok: false, code: 'trace_id_invalid' };
  }
  const reason = String(raw.reason || '');
  if (!LATENCY_TRACE_TERMINAL_REASONS.has(reason)) {
    return { ok: false, code: 'terminal_reason_invalid' };
  }
  const terminalAtMs = finiteEpochMs(raw.terminal_at_ms);
  if (terminalAtMs === null) {
    return { ok: false, code: 'terminal_timestamp_invalid' };
  }
  const stagesCompleted = [];
  for (const stage of Array.isArray(raw.stages_completed) ? raw.stages_completed : []) {
    if (LATENCY_TRACE_STAGES.includes(stage) && !stagesCompleted.includes(stage)) {
      stagesCompleted.push(stage);
    }
  }
  const clientMessageId = boundedLabel(raw.client_message_id);
  const agentType = boundedLabel(raw.agent_type, 'unknown');
  return {
    ok: true,
    terminal: {
      schema_version: LATENCY_TRACE_SCHEMA_VERSION,
      trace_id: traceId,
      ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      agent_type: agentType,
      surface_class: latencySurfaceClass(agentType),
      reason,
      terminal_at_ms: terminalAtMs,
      stages_completed: stagesCompleted,
    },
  };
}

function percentile(values, quantile) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function summarizeLatencyRows(rows) {
  const byAgentType = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const measured = latencyStageDurations(row);
    if (!measured.ok) continue;
    const key = measured.trace.agent_type;
    if (!byAgentType.has(key)) byAgentType.set(key, []);
    byAgentType.get(key).push(measured);
  }
  const summaries = [];
  for (const [agentType, measurements] of [...byAgentType.entries()].sort()) {
    const stageMetrics = {};
    for (let index = 1; index < LATENCY_TRACE_STAGES.length; index += 1) {
      const from = LATENCY_TRACE_STAGES[index - 1];
      const to = LATENCY_TRACE_STAGES[index];
      const key = `${from}_to_${to}_ms`;
      const values = measurements.map(measurement => measurement.durations[key]);
      stageMetrics[key] = {
        samples: values.length,
        p50_ms: percentile(values, 0.50),
        p95_ms: percentile(values, 0.95),
      };
    }
    const dominant = Object.entries(stageMetrics)
      .sort((left, right) => (right[1].p95_ms || 0) - (left[1].p95_ms || 0))[0] || null;
    const totals = measurements.map(measurement => measurement.durations.total_ms);
    summaries.push({
      agent_type: agentType,
      surface_class: latencySurfaceClass(agentType),
      samples: measurements.length,
      dominant_stage: dominant?.[0] || null,
      dominant_stage_p95_ms: dominant?.[1]?.p95_ms ?? null,
      total: {
        p50_ms: percentile(totals, 0.50),
        p95_ms: percentile(totals, 0.95),
      },
      stages: stageMetrics,
    });
  }
  return summaries;
}

module.exports = {
  LATENCY_TRACE_SCHEMA_VERSION,
  LATENCY_TRACE_STAGES,
  LATENCY_TRACE_TERMINAL_REASONS,
  advanceLatencyTrace,
  latencyStageDurations,
  latencySurfaceClass,
  normalizeLatencyTrace,
  normalizeLatencyTraceTerminal,
  percentile,
  sanitizeLatencyStageSource,
  summarizeLatencyRows,
};
