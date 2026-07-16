'use strict';

const crypto = require('crypto');

const RESUMABLE_GOAL_STATES = new Set(['active', 'paused', 'blocked', 'in_progress', 'running']);
const TERMINAL_GOAL_STATES = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed']);

function goalState(goal) {
  return String(goal?.state || goal?.status || '').trim().toLowerCase();
}

function goalObjective(goal) {
  return String(goal?.objective || goal?.text || '').trim();
}

function isResumableGoal(goal) {
  if (!goal || typeof goal !== 'object' || !goalObjective(goal)) return false;
  const state = goalState(goal);
  if (TERMINAL_GOAL_STATES.has(state)) return false;
  return !state || RESUMABLE_GOAL_STATES.has(state);
}

function goalFingerprint(goal) {
  const source = JSON.stringify({
    objective: goalObjective(goal),
    created_at: goal?.created_at || goal?.createdAt || null,
  });
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
}

function parseRelativeDuration(text) {
  const value = String(text || '').toLowerCase();
  let totalMs = 0;
  let matched = false;
  const pattern = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
  for (const match of value.matchAll(pattern)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith('d')) totalMs += amount * 86_400_000;
    else if (unit.startsWith('h')) totalMs += amount * 3_600_000;
    else if (unit.startsWith('m')) totalMs += amount * 60_000;
    else totalMs += amount * 1_000;
  }
  return matched && totalMs > 0 ? totalMs : null;
}

function parseResetAt(value, nowMs = Date.now()) {
  if (value == null || value === '' || value === 'unknown') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  }
  const text = String(value).trim();
  if (!text) return null;

  const durationMs = parseRelativeDuration(text);
  if (durationMs != null && (/\bin\b/i.test(text) || /^\d/.test(text))) {
    return new Date(nowMs + durationMs).toISOString();
  }

  const clock = text.match(/(?:^|\bat\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const hasCalendarDate = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
  if (clock && !hasCalendarDate) {
    let hour = Number(clock[1]) % 12;
    if (clock[3].toLowerCase() === 'pm') hour += 12;
    const candidate = new Date(nowMs);
    candidate.setHours(hour, Number(clock[2] || 0), 0, 0);
    if (candidate.getTime() <= nowMs) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

function resumeClientMessageId(sessionId, resetAt, fingerprint) {
  const digest = crypto.createHash('sha256')
    .update(`${sessionId}\n${resetAt}\n${fingerprint}`)
    .digest('hex')
    .slice(0, 24);
  return `usage-resume-${digest}`;
}

function retryDelayMs(attempt) {
  return Math.min(5 * 60_000, 15_000 * (2 ** Math.max(0, Number(attempt) - 1)));
}

module.exports = {
  RESUMABLE_GOAL_STATES,
  TERMINAL_GOAL_STATES,
  goalFingerprint,
  goalObjective,
  goalState,
  isResumableGoal,
  parseRelativeDuration,
  parseResetAt,
  resumeClientMessageId,
  retryDelayMs,
};
