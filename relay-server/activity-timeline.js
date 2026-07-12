'use strict';

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

function normalizeActivityTimeline(activity, previousActivity, now = new Date().toISOString()) {
  if (!activity || typeof activity !== 'object') return activity;

  const normalizedNow = validTimestamp(now) || new Date().toISOString();
  const updatedAt = validTimestamp(activity.updated_at || activity.updatedAt) || normalizedNow;
  const next = { ...activity, updated_at: updatedAt };

  if (!isActiveActivity(next)) {
    return { ...next, started_at: null };
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
  };
}

module.exports = {
  isActiveActivity,
  normalizeActivityTimeline,
};
