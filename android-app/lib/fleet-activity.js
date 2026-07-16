const FLEET_ACTIVE_KINDS = new Set([
  'thinking', 'generating', 'reading_files', 'running_command', 'applying_patch', 'working',
]);

const FLEET_ATTENTION_KINDS = new Set([
  'waiting_for_user', 'needs_attention', 'blocked', 'rate_limited',
  'usage_limited', 'budget_limited', 'failed', 'error',
]);

const FLEET_ATTENTION_GOAL_STATES = new Set([
  'blocked', 'usagelimited', 'budgetlimited', 'failed',
]);

const FLEET_TERMINAL_GOAL_STATES = new Set(['complete', 'completed', 'cancelled', 'canceled']);
export const DEFAULT_ACTIVITY_FRESHNESS_MS = 15_000;

function normalizedGoalState(activity) {
  return String(activity?.goal?.state || activity?.goal?.status || '')
    .trim().toLowerCase().replace(/[^a-z]/g, '');
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fleetActivityObservedAtMs(activity) {
  return Math.max(
    timestampMs(activity?.transport?.client_received_at_ms),
    timestampMs(activity?.transport?.relay_forwarded_at_ms),
    timestampMs(activity?.observed_at),
    timestampMs(activity?.updatedAt),
    timestampMs(activity?.updated_at),
  );
}

export function fleetActivityIsFresh(activity, options = {}) {
  if (options.connected === false || String(options.health || '').toLowerCase() === 'disconnected') return false;
  if (options.fresh === false) return false;
  if (options.requireFreshness !== true) return true;
  const observedAtMs = fleetActivityObservedAtMs(activity);
  if (!observedAtMs) return false;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const freshnessMs = Math.max(1_000, Number(options.freshnessMs) || DEFAULT_ACTIVITY_FRESHNESS_MS);
  return nowMs - observedAtMs <= freshnessMs;
}

export function classifyFleetActivity(activity, needsAttention = false, options = {}) {
  const kind = String(activity?.kind || '').trim().toLowerCase();
  const goalState = normalizedGoalState(activity);
  if (needsAttention || FLEET_ATTENTION_KINDS.has(kind) || FLEET_ATTENTION_GOAL_STATES.has(goalState)) {
    return 'needs_attention';
  }
  if (FLEET_TERMINAL_GOAL_STATES.has(goalState)) return 'idle';
  // Freshness gates claims of active work, not an explicit native idle state.
  // Otherwise every settled session flips to Stale and reappears when Fleet's
  // bounded freshness window expires.
  if (kind === 'idle' && goalState !== 'active') return 'idle';
  if (!fleetActivityIsFresh(activity, options)) return 'stale';
  const hasExecutionProof = activity?.generating === true || FLEET_ACTIVE_KINDS.has(kind);
  if (hasExecutionProof && goalState === 'active') return 'working_goal';
  if (hasExecutionProof) return 'working';
  if (goalState === 'active') return 'between_goal_turns';
  return 'idle';
}

export function fleetStateLabel(state) {
  if (state === 'working_goal') return 'Working on goal';
  if (state === 'working') return 'Working';
  if (state === 'between_goal_turns') return 'Between goal turns';
  if (state === 'needs_attention') return 'Needs attention';
  if (state === 'stale') return 'Stale';
  return 'Idle';
}

export function fleetStateIsWorking(state) {
  return state === 'working_goal' || state === 'working';
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeFleetActivityTrace(trace, clientReceivedAtMs = Date.now()) {
  if (!trace || typeof trace !== 'object') return null;
  const proxyEmittedAtMs = finiteTimestamp(trace.proxy_emitted_at_ms);
  const relayReceivedAtMs = finiteTimestamp(trace.relay_received_at_ms);
  const relayForwardedAtMs = finiteTimestamp(trace.relay_forwarded_at_ms);
  const clientAtMs = finiteTimestamp(clientReceivedAtMs) || Date.now();
  return {
    proxy_emitted_at_ms: proxyEmittedAtMs,
    relay_received_at_ms: relayReceivedAtMs,
    relay_forwarded_at_ms: relayForwardedAtMs,
    client_received_at_ms: clientAtMs,
    latency_ms: proxyEmittedAtMs == null ? null : Math.max(0, clientAtMs - proxyEmittedAtMs),
  };
}

export function fleetFreshnessLabel(activity) {
  const latency = Number(activity?.transport?.latency_ms);
  return Number.isFinite(latency) ? `${Math.round(latency)} ms` : 'Awaiting live update';
}
