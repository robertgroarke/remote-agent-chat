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
const FLEET_WORKING_GOAL_RUN_STATES = new Set([
  'starting', 'running_turn', 'checkpoint_pending_continuation', 'verifying',
]);
const FLEET_ATTENTION_GOAL_RUN_STATES = new Set(['waiting_for_user', 'blocked_limited']);
const FLEET_TERMINAL_GOAL_RUN_STATES = new Set([
  'paused', 'completed_cancelled_failed', 'unknown_disconnected',
]);
export const DEFAULT_ACTIVITY_FRESHNESS_MS = 15_000;

function normalizedGoalState(activity) {
  return String(activity?.goal?.state || activity?.goal?.status || '')
    .trim().toLowerCase().replace(/[^a-z]/g, '');
}

function canonicalGoalRun(activity) {
  const goal = activity?.goal;
  const run = activity?.goal_run;
  if (!goal || !run || run.schema_version !== 1) return null;
  if (!run.run_id || !run.goal_fingerprint || !Number.isFinite(Number(run.goal_generation))) return null;
  if (String(run.goal_fingerprint) !== String(goal.fingerprint || '')) return null;
  if (Number(run.goal_generation) !== Math.max(1, Number(goal.generation) || 1)) return null;
  return run;
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
  const goalRun = canonicalGoalRun(activity);
  const runLifecycle = String(goalRun?.lifecycle || '').trim().toLowerCase();
  if (needsAttention || FLEET_ATTENTION_KINDS.has(kind) || FLEET_ATTENTION_GOAL_STATES.has(goalState)
      || FLEET_ATTENTION_GOAL_RUN_STATES.has(runLifecycle)) {
    return 'needs_attention';
  }
  if (goalRun && runLifecycle === 'unknown_disconnected') return 'stale';
  if (goalRun && FLEET_TERMINAL_GOAL_RUN_STATES.has(runLifecycle)) return 'idle';
  if (FLEET_TERMINAL_GOAL_STATES.has(goalState)) return 'idle';
  // A producer-owned lease is stronger than generic activity freshness. It is
  // intentionally sticky across native turn checkpoints and relay reconnects.
  if (goalRun?.lease_active === true && FLEET_WORKING_GOAL_RUN_STATES.has(runLifecycle)) {
    return 'working_goal';
  }
  // Once a producer emits the canonical contract, an unleased active archive
  // cannot fall through to legacy generating heuristics and resurrect itself.
  if (goalRun && goalState === 'active') {
    return fleetActivityIsFresh(activity, options) ? 'between_goal_turns' : 'stale';
  }
  if (goalState === 'active') {
    return fleetActivityIsFresh(activity, options) ? 'between_goal_turns' : 'stale';
  }
  // Freshness gates claims of active work, not an explicit native idle state.
  // Otherwise every settled session flips to Stale and reappears when Fleet's
  // bounded freshness window expires.
  if (kind === 'idle' && goalState !== 'active') return 'idle';
  if (!fleetActivityIsFresh(activity, options)) return 'stale';
  const hasExecutionProof = activity?.generating === true || FLEET_ACTIVE_KINDS.has(kind);
  if (hasExecutionProof) return 'working';
  return 'idle';
}

export function fleetGoalSubstateLabel(activity, options = {}) {
  const run = canonicalGoalRun(activity);
  const lifecycle = String(run?.lifecycle || '').trim().toLowerCase();
  if (!run || run.lease_active !== true) return '';
  if (lifecycle === 'checkpoint_pending_continuation') return 'Waiting for next goal turn';
  if (lifecycle === 'verifying' || options.connected === false
      || String(options.health || '').toLowerCase() === 'disconnected') return 'Reconnecting';
  if (lifecycle === 'starting') return 'Starting goal';
  if (lifecycle === 'running_turn') return 'Working';
  return 'Goal loop active';
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

export function fleetGoalElapsedSeconds(goal, goalRun = null, nowMs = Date.now()) {
  if (!goal || typeof goal !== 'object') return 0;
  const base = Math.max(0, Number(goal.time_used_seconds ?? goal.timeUsedSeconds ?? 0) || 0);
  const updatedMs = timestampMs(goal.updated_at || goal.updatedAt);
  const active = String(goal.state || goal.status || '').toLowerCase() === 'active';
  const evidenceCutoff = goalRun && goalRun.lease_active !== true
    ? timestampMs(goalRun.lease_observed_at || goalRun.observed_at)
    : Number(nowMs);
  const effectiveNow = evidenceCutoff > 0 ? Math.min(Number(nowMs) || evidenceCutoff, evidenceCutoff) : updatedMs;
  const liveDelta = active && updatedMs > 0
    ? Math.max(0, Math.floor((effectiveNow - updatedMs) / 1000))
    : 0;
  return Math.floor(base + liveDelta);
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

export function fleetFreshnessLabel(activity, nowMs = Date.now()) {
  const latency = Number(activity?.transport?.latency_ms);
  if (Number.isFinite(latency)) return `${Math.round(latency)} ms`;
  const observedAtMs = fleetActivityObservedAtMs(activity);
  if (!observedAtMs) return 'Awaiting live update';
  const ageMs = Math.max(0, Number(nowMs) - observedAtMs);
  if (ageMs < 1_000) return 'Observed just now';
  if (ageMs < 60_000) return `Observed ${Math.floor(ageMs / 1_000)}s ago`;
  if (ageMs < 3_600_000) return `Observed ${Math.floor(ageMs / 60_000)}m ago`;
  return `Observed ${Math.floor(ageMs / 3_600_000)}h ago`;
}
