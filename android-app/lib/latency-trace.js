import { relayClockStageObservation } from './latency-clock';

const LATENCY_TRACE_STAGES = Object.freeze([
  'webui_send',
  'relay_recv',
  'proxy_recv',
  'harness_delivered',
  'agent_first_output',
  'relay_broadcast',
  'webui_render',
]);
const MAX_DIAGNOSTIC_ROWS = 200;

function safeTraceId(clientMessageId) {
  const label = String(clientMessageId || '')
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 140);
  return `android:${label || Date.now()}`;
}

function retainDiagnostic(row) {
  const scope = typeof globalThis === 'object' ? globalThis : {};
  const rows = Array.isArray(scope.__RAC_LATENCY_TRACES__)
    ? scope.__RAC_LATENCY_TRACES__
    : [];
  rows.push(row);
  if (rows.length > MAX_DIAGNOSTIC_ROWS) {
    rows.splice(0, rows.length - MAX_DIAGNOSTIC_ROWS);
  }
  scope.__RAC_LATENCY_TRACES__ = rows;
  return row;
}

export function createAndroidLatencyTrace(
  clientMessageId,
  agentType,
  atMs = Date.now(),
  relayClockEstimate = null,
) {
  const observedAtMs = Number(atMs);
  const observed = relayClockStageObservation(
    observedAtMs,
    'android',
    relayClockEstimate,
    { nowMs: observedAtMs },
  );
  return {
    schema_version: 2,
    trace_id: safeTraceId(clientMessageId),
    client_message_id: String(clientMessageId || ''),
    agent_type: String(agentType || 'unknown'),
    stages: { webui_send: observed.adjustedAtMs },
    raw_stages: { webui_send: observedAtMs },
    stage_sources: {
      webui_send: {
        source: 'android_composer_action',
        source_at: observedAtMs,
        ...observed.source,
      },
    },
  };
}

export function completeAndroidLatencyTrace(
  trace,
  atMs = Date.now(),
  relayClockEstimate = null,
) {
  if (!trace || typeof trace !== 'object' || trace.stages?.webui_render) return null;
  const observedAtMs = Number(atMs);
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(Number(trace.stages?.relay_broadcast))) return null;
  const observed = relayClockStageObservation(
    observedAtMs,
    'android',
    relayClockEstimate,
    { nowMs: observedAtMs },
  );
  return {
    ...trace,
    schema_version: 2,
    stages: { ...trace.stages, webui_render: observed.adjustedAtMs },
    raw_stages: { ...(trace.raw_stages || {}), webui_render: observedAtMs },
    stage_sources: {
      ...(trace.stage_sources || {}),
      webui_render: {
        source: 'android_react_native_post_paint',
        browser_paint_at_ms: observedAtMs,
        ...observed.source,
      },
    },
  };
}

export function retainAndroidLatencyCompletion(trace) {
  if (!trace?.trace_id || !trace?.stages?.webui_render) return null;
  return retainDiagnostic({
    ...trace,
    client_surface: 'android',
    measurement_status: 'measured',
  });
}

export function retainAndroidLatencyTerminal(raw) {
  if (!raw || typeof raw !== 'object' || !raw.trace_id || !raw.reason) return null;
  return retainDiagnostic({
    schema_version: 1,
    trace_id: String(raw.trace_id),
    ...(raw.client_message_id ? { client_message_id: String(raw.client_message_id) } : {}),
    agent_type: String(raw.agent_type || 'unknown'),
    surface_class: String(raw.surface_class || 'unknown'),
    reason: String(raw.reason),
    terminal_at_ms: Number(raw.terminal_at_ms) || Date.now(),
    stages_completed: Array.isArray(raw.stages_completed)
      ? raw.stages_completed.filter(stage => LATENCY_TRACE_STAGES.includes(stage))
      : [],
    client_surface: 'android',
    measurement_status: 'unmeasured',
  });
}
