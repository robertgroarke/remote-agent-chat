'use strict';

const crypto = require('crypto');

const CANONICAL_GOAL_STATES = Object.freeze([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete',
  'cancelled',
  'failed',
]);

const TERMINAL_GOAL_STATES = new Set(['complete', 'cancelled', 'failed']);

const GOAL_RUN_LIFECYCLES = Object.freeze([
  'starting',
  'running_turn',
  'checkpoint_pending_continuation',
  'waiting_for_user',
  'blocked_limited',
  'paused',
  'completed_cancelled_failed',
  'verifying',
  'unknown_disconnected',
]);

const WORKING_GOAL_RUN_LIFECYCLES = new Set([
  'starting',
  'running_turn',
  'checkpoint_pending_continuation',
  'verifying',
]);

const TERMINAL_GOAL_RUN_LIFECYCLES = new Set([
  'paused',
  'completed_cancelled_failed',
  'unknown_disconnected',
]);

const ATTENTION_ACTIVITY_KINDS = new Set([
  'waiting_for_user',
  'needs_attention',
  'blocked',
  'rate_limited',
  'usage_limited',
  'budget_limited',
]);

const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking',
  'generating',
  'reading_files',
  'running_command',
  'applying_patch',
  'working',
  'tool',
]);

const GOAL_STATE_ALIASES = Object.freeze({
  active: 'active',
  running: 'active',
  working: 'active',
  pursuing: 'active',
  pursuing_goal: 'active',
  in_progress: 'active',
  paused: 'paused',
  pause: 'paused',
  paused_goal: 'paused',
  blocked: 'blocked',
  goal_blocked: 'blocked',
  needs_attention: 'blocked',
  waiting_for_user: 'blocked',
  usagelimited: 'usageLimited',
  usage_limited: 'usageLimited',
  goal_usage_limited: 'usageLimited',
  goal_rate_limited: 'usageLimited',
  rate_limited: 'usageLimited',
  ratelimited: 'usageLimited',
  provider_limited: 'usageLimited',
  budgetlimited: 'budgetLimited',
  budget_limited: 'budgetLimited',
  goal_limited: 'budgetLimited',
  goal_budget_limited: 'budgetLimited',
  token_budget_limited: 'budgetLimited',
  complete: 'complete',
  completed: 'complete',
  achieved: 'complete',
  goal_achieved: 'complete',
  done: 'complete',
  success: 'complete',
  succeeded: 'complete',
  cancelled: 'cancelled',
  goal_cancelled: 'cancelled',
  canceled: 'cancelled',
  goal_canceled: 'cancelled',
  stopped: 'cancelled',
  goal_stopped: 'cancelled',
  aborted: 'cancelled',
  failed: 'failed',
  goal_failed: 'failed',
  failure: 'failed',
  error: 'failed',
});

const GOAL_LABELS = Object.freeze({
  active: 'Pursuing goal',
  paused: 'Goal paused',
  blocked: 'Goal blocked',
  usageLimited: 'Goal usage limited',
  budgetLimited: 'Goal budget limited',
  complete: 'Goal achieved',
  cancelled: 'Goal stopped',
  failed: 'Goal failed',
  unknown: 'Goal state unknown',
});

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeGoalState(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  const compact = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return GOAL_STATE_ALIASES[compact] || GOAL_STATE_ALIASES[compact.replace(/_/g, '')] || 'unknown';
}

function normalizedIso(value) {
  const ms = value == null ? NaN : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function goalRunSourceSequence(observation, goal) {
  const cursors = [
    observation?.source_cursor,
    goal?.native_cursor,
    goal?.source_cursor,
  ].filter(cursor => cursor && typeof cursor === 'object');
  const cursorSequence = cursors.reduce((max, cursor) => Math.max(
    max,
    positiveInteger(cursor.end_offset ?? cursor.endOffset ?? cursor.file_size ?? cursor.fileSize),
  ), 0);
  return Math.max(cursorSequence, positiveInteger(observation?.source_sequence));
}

function goalRunIdentity(goal, sessionKey) {
  if (!goal || typeof goal !== 'object') return null;
  const fingerprint = String(goal.fingerprint || goal.goal_fingerprint || '').trim();
  const generation = Math.max(1, Number(goal.generation) || 1);
  if (!fingerprint) return null;
  return {
    fingerprint,
    generation,
    objective_hash: String(goal.objective_hash || hashText(goal.objective || goal.text || '')),
    run_id: `goal-run:${hashText([sessionKey, fingerprint, generation].join('\u0000')).slice(0, 40)}`,
  };
}

function sameGoalRun(previous, identity) {
  return !!previous && !!identity
    && String(previous.goal_fingerprint || '') === identity.fingerprint
    && Number(previous.goal_generation) === identity.generation
    && String(previous.run_id || '') === identity.run_id;
}

function goalRunSemantic(record) {
  if (!record) return '';
  return JSON.stringify({
    lifecycle: record.lifecycle,
    lease_active: record.lease_active === true,
    owner_state: record.owner_state,
    run_id: record.run_id,
  });
}

function immutableReplay(previous) {
  return previous && typeof previous === 'object' ? { ...previous } : previous;
}

/**
 * Reduce one producer observation into a canonical goal-run lease record.
 *
 * A bare active goal is intentionally insufficient to acquire a lease. The
 * caller must provide live_lease_proof for a current native generation event,
 * goal-controller receipt, owned turn, or live DOM observation. Once acquired,
 * a lease survives turn-terminal checkpoints and ambiguous reconnect windows;
 * only authoritative goal/attention/owner evidence releases it.
 */
function reduceGoalRunLifecycle(previousRun, observation = {}) {
  const goal = observation.goal && typeof observation.goal === 'object' ? observation.goal : null;
  const sessionKey = String(observation.session_key || observation.sessionKey || '').trim();
  const identity = goalRunIdentity(goal, sessionKey);
  const previous = previousRun && typeof previousRun === 'object' ? previousRun : null;
  const sameRun = sameGoalRun(previous, identity);
  const sourceSequence = goalRunSourceSequence(observation, goal);
  const previousSequence = positiveInteger(previous?.source_sequence);
  const incomingGeneration = Number(identity?.generation || 0);
  const previousGeneration = Number(previous?.goal_generation || 0);

  if (previous && identity && incomingGeneration < previousGeneration) return immutableReplay(previous);
  if (sameRun && sourceSequence > 0 && previousSequence > 0 && sourceSequence < previousSequence) {
    return immutableReplay(previous);
  }

  const rawKind = String(observation.activity_kind || observation.kind || '').trim().toLowerCase();
  const goalState = normalizeGoalState(goal?.state || goal?.status || goal?.raw_state);
  const ownerState = String(observation.owner_state || 'ambiguous').trim().toLowerCase();
  const liveLeaseProof = observation.live_lease_proof === true;
  const explicitStop = observation.explicit_stop === true;
  const controllerGoalAbsent = observation.controller_goal_absent === true;
  const confirmedDisconnect = observation.confirmed_disconnect === true || ownerState === 'gone';
  const failed = rawKind === 'failed' || rawKind === 'error' || goalState === 'failed';
  const question = rawKind === 'waiting_for_user' || rawKind === 'needs_attention';
  const limited = ['blocked', 'usagelimited', 'budgetlimited'].includes(
    String(goalState || '').toLowerCase(),
  ) || ['blocked', 'rate_limited', 'usage_limited', 'budget_limited'].includes(rawKind);
  const terminalGoal = TERMINAL_GOAL_STATES.has(goalState);
  const previousReleased = sameRun && previous?.lease_active !== true && (
    ['paused', 'completed_cancelled_failed'].includes(previous?.lifecycle)
    || (previous?.lifecycle === 'unknown_disconnected' && previous?.owner_state === 'gone')
    || (previous?.lifecycle === 'unknown_disconnected' && previous?.evidence_type === 'goal_controller_absent')
  );

  // A released generation can never be resurrected by replayed active frames.
  // A genuine restart must carry a new canonical goal generation/run identity.
  if (previousReleased && goalState === 'active') return immutableReplay(previous);

  let lifecycle = 'unknown_disconnected';
  let leaseActive = false;
  let resolvedOwnerState = confirmedDisconnect ? 'gone' : ownerState;
  let reason = String(observation.evidence_type || 'unproven_goal_state');

  if (explicitStop) {
    lifecycle = 'completed_cancelled_failed';
    resolvedOwnerState = 'released';
    reason = reason || 'explicit_stop';
  } else if (controllerGoalAbsent) {
    lifecycle = 'unknown_disconnected';
    resolvedOwnerState = ownerState === 'confirmed' ? 'confirmed' : ownerState;
    reason = 'goal_controller_absent';
  } else if (confirmedDisconnect) {
    lifecycle = 'unknown_disconnected';
    resolvedOwnerState = 'gone';
    reason = reason || 'confirmed_owner_gone';
  } else if (question) {
    lifecycle = 'waiting_for_user';
    resolvedOwnerState = ownerState === 'confirmed' ? 'confirmed' : ownerState;
  } else if (limited) {
    lifecycle = 'blocked_limited';
    resolvedOwnerState = ownerState === 'confirmed' ? 'confirmed' : ownerState;
  } else if (goalState === 'paused') {
    lifecycle = 'paused';
    resolvedOwnerState = 'released';
  } else if (terminalGoal || failed) {
    lifecycle = 'completed_cancelled_failed';
    resolvedOwnerState = 'released';
  } else if (goalState === 'active' && identity) {
    const inheritedLease = sameRun && previous?.lease_active === true;
    leaseActive = liveLeaseProof || inheritedLease;
    if (!leaseActive) {
      lifecycle = 'unknown_disconnected';
      resolvedOwnerState = ownerState === 'confirmed' ? 'unproven' : ownerState;
      reason = 'active_goal_without_live_lease_proof';
    } else if (ownerState === 'ambiguous' && inheritedLease && !liveLeaseProof) {
      lifecycle = 'verifying';
      resolvedOwnerState = 'verifying';
      reason = reason || 'owner_reconnect_audit';
    } else {
      resolvedOwnerState = 'confirmed';
      const startedTurnId = String(observation.task_started_turn_id || '').trim();
      const completedTurnId = String(observation.task_completed_turn_id || '').trim();
      const checkpoint = !!completedTurnId && (!startedTurnId || completedTurnId === startedTurnId);
      if (checkpoint) {
        lifecycle = 'checkpoint_pending_continuation';
      } else if (ACTIVE_ACTIVITY_KINDS.has(rawKind) || (startedTurnId && startedTurnId !== completedTurnId)) {
        lifecycle = 'running_turn';
      } else if (sameRun && previous?.lifecycle === 'verifying') {
        lifecycle = previous.last_working_lifecycle || 'checkpoint_pending_continuation';
      } else if (sameRun && WORKING_GOAL_RUN_LIFECYCLES.has(previous?.lifecycle)) {
        lifecycle = previous.lifecycle;
      } else {
        lifecycle = 'starting';
      }
    }
  }

  const nowIso = normalizedIso(observation.observed_at) || new Date().toISOString();
  const nativeEventAt = normalizedIso(
    observation.native_event_at || goal?.native_updated_at || goal?.updated_at,
  );
  const sourceCursor = observation.source_cursor || goal?.native_cursor || goal?.source_cursor || null;
  const priorTransitionSeq = sameRun ? Math.max(1, Number(previous?.transition_seq) || 1) : 0;
  const semantic = { lifecycle, lease_active: leaseActive, owner_state: resolvedOwnerState, run_id: identity?.run_id || previous?.run_id || '' };
  const priorSemantic = goalRunSemantic(previous);
  const nextSemantic = JSON.stringify(semantic);
  const transitionSeq = priorTransitionSeq + (priorSemantic === nextSemantic ? 0 : 1);
  const leaseStartedAt = leaseActive
    ? (sameRun && previous?.lease_started_at ? previous.lease_started_at : nowIso)
    : (sameRun ? previous?.lease_started_at || null : null);
  const lastWorkingLifecycle = WORKING_GOAL_RUN_LIFECYCLES.has(lifecycle) && lifecycle !== 'verifying'
    ? lifecycle
    : (sameRun ? previous?.last_working_lifecycle || null : null);
  const verificationStartedAt = lifecycle === 'verifying'
    ? (sameRun && previous?.lifecycle === 'verifying' ? previous.verification_started_at || nowIso : nowIso)
    : null;
  const runId = identity?.run_id || previous?.run_id || null;

  return {
    schema_version: 1,
    run_id: runId,
    goal_fingerprint: identity?.fingerprint || previous?.goal_fingerprint || null,
    goal_generation: identity?.generation || previous?.goal_generation || null,
    objective_hash: identity?.objective_hash || previous?.objective_hash || null,
    lifecycle,
    lease_active: leaseActive,
    owner_state: resolvedOwnerState,
    evidence_type: reason,
    transition_seq: Math.max(1, transitionSeq || 1),
    transition_id: `goal-run-transition:${hashText([
      runId || '',
      lifecycle,
      Math.max(1, transitionSeq || 1),
      sourceSequence,
    ].join('\u0000')).slice(0, 40)}`,
    source: String(observation.source || goal?.source || previous?.source || 'unknown'),
    source_cursor: sourceCursor,
    source_sequence: Math.max(previousSequence, sourceSequence),
    native_event_at: nativeEventAt || (sameRun ? previous?.native_event_at || null : null),
    observed_at: nowIso,
    lease_started_at: leaseStartedAt,
    lease_observed_at: leaseActive ? nowIso : (sameRun ? previous?.lease_observed_at || null : null),
    verification_started_at: verificationStartedAt,
    last_working_lifecycle: lastWorkingLifecycle,
  };
}

function cursorSignature(cursor) {
  if (!cursor || typeof cursor !== 'object') return '';
  const stable = {
    kind: cursor.kind || cursor.source || '',
    file_id: cursor.file_id || cursor.fileId || '',
    start_offset: Number(cursor.start_offset ?? cursor.startOffset) || 0,
    end_offset: Number(cursor.end_offset ?? cursor.endOffset) || 0,
    signature: cursor.signature || '',
  };
  return hashText(JSON.stringify(stable)).slice(0, 32);
}

function canonicalGoalRecord(observed, {
  previousGoal = null,
  sessionKey = '',
  source = 'unknown',
  sourceCursor = null,
  nativeUpdatedAt = undefined,
  observedAt = new Date().toISOString(),
} = {}) {
  if (!observed || typeof observed !== 'object') return null;
  const rawState = String(
    observed.raw_state
      || observed.native_state
      || observed.state
      || observed.status
      || '',
  ).trim();
  const explicitState = normalizeGoalState(observed.state || observed.status);
  const state = explicitState === 'unknown' ? normalizeGoalState(rawState) : explicitState;
  const prior = previousGoal && typeof previousGoal === 'object' ? previousGoal : null;
  const objective = String(observed.objective || observed.text || prior?.objective || prior?.text || '').trim();
  const objectiveHash = observed.objective_hash || hashText(objective);
  const observedCreatedAt = normalizedIso(observed.created_at || observed.started_at);
  const priorCreatedAt = normalizedIso(prior?.created_at || prior?.started_at);
  const priorState = normalizeGoalState(prior?.state || prior?.status);
  const priorGeneration = Math.max(0, Number(prior?.generation) || 0);
  const explicitGeneration = Math.max(0, Number(observed.generation || observed.goal_generation) || 0);
  const startsNewGeneration = !!prior
    && TERMINAL_GOAL_STATES.has(priorState)
    && state === 'active';
  const createdAt = observedCreatedAt || (startsNewGeneration ? null : priorCreatedAt);
  const generation = explicitGeneration > 0
    ? Math.max(1, explicitGeneration)
    : startsNewGeneration ? priorGeneration + 1 : Math.max(1, priorGeneration || 1);
  const sameObjective = !!prior && String(prior.objective_hash || hashText(prior.objective || prior.text || '')) === objectiveHash;
  const explicitFingerprint = String(observed.fingerprint || observed.goal_fingerprint || '').trim();
  const canReusePriorFingerprint = !!prior?.fingerprint && sameObjective && !startsNewGeneration;
  const fingerprint = explicitFingerprint
    || (canReusePriorFingerprint ? prior.fingerprint : `goal:${hashText([
      sessionKey,
      objectiveHash,
      createdAt || `generation:${generation}`,
    ].join('\u0000')).slice(0, 40)}`);
  const sameFingerprint = !!prior && prior.fingerprint === fingerprint;
  const stateChanged = !sameFingerprint || priorState !== state;
  const transitionSeq = sameFingerprint
    ? Math.max(1, Number(prior.transition_seq) || 1) + (stateChanged ? 1 : 0)
    : 1;
  const nativeTime = normalizedIso(
    nativeUpdatedAt === undefined
      ? (observed.native_updated_at || observed.provenance?.native_updated_at)
      : nativeUpdatedAt,
  );
  const cursor = sourceCursor || observed.native_cursor || observed.source_cursor || observed.provenance?.source_cursor || null;
  const transitionBasis = nativeTime
    ? `native:${nativeTime}`
    : `surface:${cursorSignature(cursor) || hashText(`${rawState}\u0000${objective}`).slice(0, 32)}`;
  const transitionId = `goal-transition:${hashText([
    fingerprint,
    state,
    transitionBasis,
  ].join('\u0000')).slice(0, 40)}`;
  const seenAt = normalizedIso(observedAt) || new Date().toISOString();
  const timeUsedSeconds = Math.max(0, Number(
    observed.time_used_seconds ?? observed.timeUsedSeconds ?? prior?.time_used_seconds ?? prior?.timeUsedSeconds,
  ) || 0);
  const tokensUsed = Math.max(0, Number(
    observed.tokens_used ?? observed.tokensUsed ?? prior?.tokens_used ?? prior?.tokensUsed,
  ) || 0);

  return {
    label: observed.label || GOAL_LABELS[state] || GOAL_LABELS.unknown,
    text: objective,
    objective,
    objective_hash: objectiveHash,
    fingerprint,
    generation,
    state,
    status: state,
    raw_state: rawState || 'unknown',
    native_state: rawState || 'unknown',
    terminal: TERMINAL_GOAL_STATES.has(state),
    transition_seq: transitionSeq,
    transition_id: transitionId,
    source: observed.source || source,
    native_updated_at: nativeTime,
    native_cursor: cursor,
    observed_at: seenAt,
    updated_at: nativeTime || seenAt,
    started_at: createdAt,
    created_at: createdAt,
    time_used_seconds: timeUsedSeconds,
    tokens_used: tokensUsed,
  };
}

module.exports = {
  CANONICAL_GOAL_STATES,
  TERMINAL_GOAL_STATES,
  GOAL_RUN_LIFECYCLES,
  WORKING_GOAL_RUN_LIFECYCLES,
  TERMINAL_GOAL_RUN_LIFECYCLES,
  GOAL_LABELS,
  canonicalGoalRecord,
  cursorSignature,
  reduceGoalRunLifecycle,
  hashText,
  normalizeGoalState,
};
