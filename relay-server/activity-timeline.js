'use strict';

const { loadSharedRuntimeContract } = require('./shared-runtime-contract');
const { reduceProviderConnection } = loadSharedRuntimeContract('provider-connection-lifecycle.js');
const { reduceNativeInterruption } = loadSharedRuntimeContract('native-interruption.js');

const INACTIVE_KINDS = new Set([
  '',
  'idle',
  'waiting_for_user',
  'completed',
  'done',
  'failed',
  'error',
  'interrupted',
]);

function isActiveActivity(activity) {
  if (!activity || typeof activity !== 'object') return false;
  if (activity.generating === true || activity.tool_use === true) return true;
  const kind = String(activity.kind || '').trim().toLowerCase();
  return !!kind && !INACTIVE_KINDS.has(kind);
}

function validTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeGoal(goal, previousGoal, updatedAt) {
  if (!goal || typeof goal !== 'object') return goal || null;
  const text = String(goal.text || goal.objective || '').trim();
  const previousText = String(previousGoal?.text || previousGoal?.objective || '').trim();
  const sameGoal = !!text && text === previousText;
  const startedAt = validTimestamp(goal.started_at || goal.startedAt || goal.created_at || goal.createdAt)
    || (sameGoal ? validTimestamp(previousGoal?.started_at || previousGoal?.startedAt || previousGoal?.created_at || previousGoal?.createdAt) : null)
    || updatedAt;
  return { ...goal, started_at: startedAt };
}

function normalizeThinking(thinking, previousThinking, updatedAt) {
  if (!thinking || typeof thinking !== 'object') return null;
  return {
    ...thinking,
    text: String(thinking.text || ''),
    since: validTimestamp(thinking.since)
      || validTimestamp(previousThinking?.since)
      || updatedAt,
  };
}

function normalizeCurrent(current, previousCurrent, updatedAt) {
  if (!current || typeof current !== 'object') return null;
  const kind = String(current.kind || 'answer');
  const label = String(current.label || '');
  const sameOutput = kind === String(previousCurrent?.kind || '')
    && label === String(previousCurrent?.label || '');
  return {
    ...current,
    kind,
    label,
    partial: String(current.partial || ''),
    since: validTimestamp(current.since)
      || (sameOutput ? validTimestamp(previousCurrent?.since) : null)
      || updatedAt,
  };
}

function normalizeActivityTimeline(activity, previousActivity, now = new Date().toISOString()) {
  if (!activity || typeof activity !== 'object') return activity;

  const normalizedNow = validTimestamp(now) || new Date().toISOString();
  const updatedAt = validTimestamp(activity.updated_at || activity.updatedAt) || normalizedNow;
  const next = {
    ...activity,
    updated_at: updatedAt,
  };
  // Goal lifecycle is tri-state. Omission means this activity update has no
  // opinion, an object is a projection, and explicit null is a clear. Never
  // manufacture null for an omitted field: doing so makes ordinary status
  // frames look like authoritative tombstones downstream.
  if (Object.prototype.hasOwnProperty.call(activity, 'goal')) {
    next.goal = normalizeGoal(activity.goal, previousActivity?.goal, updatedAt);
  }
  const previousConnection = previousActivity?.connection_tombstone || previousActivity?.connection || null;
  if (activity.connection && typeof activity.connection === 'object') {
    const reduced = reduceProviderConnection(previousConnection, activity.connection, activity.connection);
    const wasVisible = !!previousActivity?.connection;
    next.connection_tombstone = reduced.connection || previousConnection;
    next.connection = reduced.code === 'connection_duplicate_suppressed' && !wasVisible
      ? null
      : reduced.visible || null;
    next.connection_reduction_code = reduced.code;
  } else {
    next.connection_tombstone = previousConnection;
    next.connection = null;
    delete next.connection_reduction_code;
  }
  const previousInterruption = previousActivity?.interruption_tombstone
    || previousActivity?.interruption
    || null;
  const incomingInterruption = activity.interruption && typeof activity.interruption === 'object'
    ? activity.interruption
    : activity.interruption_tombstone && typeof activity.interruption_tombstone === 'object'
      ? activity.interruption_tombstone
      : null;
  if (incomingInterruption) {
    const reduced = reduceNativeInterruption(previousInterruption, incomingInterruption);
    next.interruption_tombstone = reduced.value || previousInterruption;
    next.interruption = reduced.value?.resolution_state === 'unresolved'
      && reduced.value?.blocking === true
      ? reduced.value
      : null;
    next.interruption_reduction_code = reduced.code;
  } else if (previousInterruption) {
    next.interruption_tombstone = previousInterruption;
    next.interruption = previousInterruption.resolution_state === 'unresolved'
      && previousInterruption.blocking === true
      ? previousInterruption
      : null;
    next.interruption_reduction_code = 'retained_missing_update';
  } else {
    next.interruption_tombstone = null;
    next.interruption = null;
    delete next.interruption_reduction_code;
  }

  if (!isActiveActivity(next)) {
    return { ...next, started_at: null, thinking: null, current: null };
  }

  const explicitStart = validTimestamp(activity.started_at || activity.startedAt);
  const previousStart = isActiveActivity(previousActivity)
    ? validTimestamp(
        previousActivity.started_at
        || previousActivity.startedAt
        || previousActivity.updated_at
        || previousActivity.updatedAt,
      )
    : null;

  return {
    ...next,
    started_at: explicitStart || previousStart || updatedAt,
    thinking: normalizeThinking(activity.thinking, previousActivity?.thinking, updatedAt),
    current: normalizeCurrent(activity.current, previousActivity?.current, updatedAt),
  };
}

module.exports = {
  isActiveActivity,
  normalizeActivityTimeline,
};
