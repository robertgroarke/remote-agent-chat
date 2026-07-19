'use strict';

const WARNING_THRESHOLD = 75;
const CRITICAL_THRESHOLD = 90;
const EXHAUSTED_THRESHOLD = 100;
function normalizePercentUsed(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric);
}

function normalizedThresholds(value = {}) {
  const warning = normalizePercentUsed(value.warning_percent ?? value.warning) ?? WARNING_THRESHOLD;
  const critical = Math.max(warning,
    normalizePercentUsed(value.critical_percent ?? value.critical) ?? CRITICAL_THRESHOLD);
  return [warning, critical, EXHAUSTED_THRESHOLD];
}

function usageThreshold(percentUsed, hardLimited = false, thresholds = null) {
  if (hardLimited) return EXHAUSTED_THRESHOLD;
  const percent = normalizePercentUsed(percentUsed);
  if (percent == null) return null;
  const [warning, critical] = normalizedThresholds(thresholds || {});
  if (percent >= critical) return critical;
  if (percent >= warning) return warning;
  return null;
}

class UsageThresholdTracker {
  constructor({ maxEntries = 2048 } = {}) {
    this.sessions = new Map();
    this.maxEntries = Math.max(16, Number(maxEntries) || 2048);
  }

  observe(sessionId, { percentUsed = null, hardLimited = false, thresholds = null } = {}) {
    if (!sessionId) return null;
    const threshold = usageThreshold(percentUsed, hardLimited, thresholds);
    const current = this.sessions.get(sessionId) || { notified: new Set(), hardLimited: false };
    current.hardLimited = hardLimited === true;
    if (this.sessions.has(sessionId)) this.sessions.delete(sessionId);
    this.sessions.set(sessionId, current);
    while (this.sessions.size > this.maxEntries) this.sessions.delete(this.sessions.keys().next().value);
    if (threshold == null || current.notified.has(threshold)) return null;

    // A first observation can jump straight to critical/exhausted. Mark lower
    // thresholds consumed so a descending or stale sample cannot spam later.
    for (const value of normalizedThresholds(thresholds || {})) {
      if (value <= threshold) current.notified.add(value);
    }
    return threshold;
  }

  clear(sessionId) {
    const previous = this.sessions.get(sessionId) || null;
    this.sessions.delete(sessionId);
    return previous;
  }
}

function buildUsageThresholdNotification(sessionName, threshold, percentUsed, resetHint) {
  const name = String(sessionName || 'Agent session');
  const percent = normalizePercentUsed(percentUsed);
  const reset = String(resetHint || '').trim();
  const resetSuffix = reset ? ` Resets ${reset}.` : '';
  if (threshold === EXHAUSTED_THRESHOLD) {
    return {
      title: `${name} usage exhausted`,
      body: `The agent cannot continue until its usage limit resets.${resetSuffix}`,
    };
  }
  const used = percent == null ? threshold : Math.max(threshold, Math.round(percent));
  const remaining = Math.max(0, 100 - used);
  return {
    title: `${name} has ${remaining}% usage left`,
    body: `${used}% of the current usage window is consumed.${resetSuffix}`,
  };
}

module.exports = {
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  EXHAUSTED_THRESHOLD,
  UsageThresholdTracker,
  buildUsageThresholdNotification,
  normalizePercentUsed,
  normalizedThresholds,
  usageThreshold,
};
