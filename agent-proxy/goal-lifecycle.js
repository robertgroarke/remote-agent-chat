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

const GOAL_STATE_ALIASES = Object.freeze({
  active: 'active',
  running: 'active',
  working: 'active',
  pursuing: 'active',
  in_progress: 'active',
  paused: 'paused',
  pause: 'paused',
  blocked: 'blocked',
  needs_attention: 'blocked',
  waiting_for_user: 'blocked',
  usagelimited: 'usageLimited',
  usage_limited: 'usageLimited',
  rate_limited: 'usageLimited',
  ratelimited: 'usageLimited',
  provider_limited: 'usageLimited',
  budgetlimited: 'budgetLimited',
  budget_limited: 'budgetLimited',
  token_budget_limited: 'budgetLimited',
  complete: 'complete',
  completed: 'complete',
  achieved: 'complete',
  done: 'complete',
  success: 'complete',
  succeeded: 'complete',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
  aborted: 'cancelled',
  failed: 'failed',
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
  const state = normalizeGoalState(rawState);
  const prior = previousGoal && typeof previousGoal === 'object' ? previousGoal : null;
  const objective = String(observed.objective || observed.text || prior?.objective || prior?.text || '').trim();
  const objectiveHash = observed.objective_hash || hashText(objective);
  const observedCreatedAt = normalizedIso(observed.created_at || observed.started_at);
  const priorCreatedAt = normalizedIso(prior?.created_at || prior?.started_at);
  const priorState = normalizeGoalState(prior?.state || prior?.status);
  const priorGeneration = Math.max(0, Number(prior?.generation) || 0);
  const startsNewGeneration = !!prior
    && TERMINAL_GOAL_STATES.has(priorState)
    && state === 'active';
  const createdAt = observedCreatedAt || (startsNewGeneration ? null : priorCreatedAt);
  const generation = startsNewGeneration ? priorGeneration + 1 : Math.max(1, priorGeneration || 1);
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
  GOAL_LABELS,
  canonicalGoalRecord,
  cursorSignature,
  hashText,
  normalizeGoalState,
};
