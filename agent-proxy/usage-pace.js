'use strict';

const DEFAULT_USAGE_THRESHOLDS = Object.freeze({ warning_percent: 75, critical_percent: 90 });

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isoTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeThresholdPair(value, fallback = DEFAULT_USAGE_THRESHOLDS) {
  const warning = finiteNumber(value?.warning_percent ?? value?.warning) ?? fallback.warning_percent;
  const critical = finiteNumber(value?.critical_percent ?? value?.critical) ?? fallback.critical_percent;
  const normalizedWarning = Math.max(0, round(warning));
  const normalizedCritical = Math.max(normalizedWarning, round(critical));
  return { warning_percent: normalizedWarning, critical_percent: normalizedCritical };
}

function parseThresholdConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function thresholdsForWindow(configValue, providerId, windowId) {
  const config = parseThresholdConfig(configValue);
  const defaults = normalizeThresholdPair(config.default || config.defaults || DEFAULT_USAGE_THRESHOLDS);
  const provider = config[providerId] || config.providers?.[providerId] || {};
  const providerPair = normalizeThresholdPair(provider, defaults);
  return normalizeThresholdPair(provider.windows?.[windowId], providerPair);
}

function paceStage(deltaPercent) {
  const absolute = Math.abs(deltaPercent);
  if (absolute <= 2) return 'on_track';
  if (absolute <= 6) return deltaPercent >= 0 ? 'slightly_ahead' : 'slightly_behind';
  if (absolute <= 12) return deltaPercent >= 0 ? 'ahead' : 'behind';
  return deltaPercent >= 0 ? 'far_ahead' : 'far_behind';
}

function paceCategory(stage, projectedUsedPercent, willLastToReset) {
  if (stage === 'far_ahead' || projectedUsedPercent >= 120) return 'burning';
  if (['slightly_ahead', 'ahead'].includes(stage) || !willLastToReset || projectedUsedPercent > 100) return 'racing';
  if (['behind', 'far_behind'].includes(stage)) return 'slow';
  return 'steady';
}

function budgetAt(targetMs, startMs, resetMs, actualUsedPercent) {
  const boundedTarget = Math.max(startMs, Math.min(resetMs, targetMs));
  const expected = ((boundedTarget - startMs) / (resetMs - startMs)) * 100;
  return round(Math.max(0, Math.min(100 - actualUsedPercent, expected - actualUsedPercent)));
}

function localMidnightAfter(timestampMs) {
  const date = new Date(timestampMs);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function calculateUsagePace(window, nowValue = Date.now()) {
  const nowMs = finiteNumber(nowValue) ?? Date.now();
  const resetIso = isoTimestamp(window?.resets_at);
  const resetMs = Date.parse(resetIso || '');
  const durationMinutes = finiteNumber(window?.duration_minutes);
  const explicitStartIso = isoTimestamp(window?.starts_at);
  const explicitStartMs = Date.parse(explicitStartIso || '');
  const usedPercent = finiteNumber(window?.used_percent);
  if (!Number.isFinite(resetMs) || resetMs <= nowMs || usedPercent == null || usedPercent < 0) return null;
  let startMs = Number.isFinite(explicitStartMs) ? explicitStartMs : null;
  if (startMs == null && durationMinutes != null && durationMinutes > 0) {
    startMs = resetMs - durationMinutes * 60 * 1000;
  }
  if (!Number.isFinite(startMs) || startMs >= resetMs || nowMs < startMs) return null;
  const durationMs = resetMs - startMs;
  const elapsedMs = nowMs - startMs;
  if (elapsedMs === 0 && usedPercent > 0) return null;
  const expectedUsedPercent = round(Math.max(0, Math.min(100, (elapsedMs / durationMs) * 100)));
  const deltaPercent = round(usedPercent - expectedUsedPercent);
  const stage = paceStage(deltaPercent);
  let projectedUsedPercent = usedPercent;
  let exhaustionAt = null;
  let willLastToReset = true;
  if (elapsedMs > 0 && usedPercent > 0) {
    projectedUsedPercent = round(usedPercent / (elapsedMs / durationMs));
    const exhaustionMs = startMs + elapsedMs * (100 / usedPercent);
    willLastToReset = exhaustionMs >= resetMs;
    if (!willLastToReset && Number.isFinite(exhaustionMs)) exhaustionAt = new Date(exhaustionMs).toISOString();
  }
  const remaining = Math.max(0, 100 - usedPercent);
  const budgets = {
    now: budgetAt(nowMs, startMs, resetMs, usedPercent),
    next_hour: budgetAt(nowMs + 60 * 60 * 1000, startMs, resetMs, usedPercent),
    next_five_hours: budgetAt(nowMs + 5 * 60 * 60 * 1000, startMs, resetMs, usedPercent),
    today: budgetAt(localMidnightAfter(nowMs), startMs, resetMs, usedPercent),
  };
  return {
    stage,
    category: paceCategory(stage, projectedUsedPercent, willLastToReset),
    expected_used_percent: expectedUsedPercent,
    actual_used_percent: round(usedPercent),
    delta_percent: deltaPercent,
    projected_used_at_reset_percent: projectedUsedPercent,
    exhaustion_at: exhaustionAt,
    will_last_to_reset: willLastToReset,
    remaining_percent: round(remaining),
    budget_percent: budgets,
  };
}

function enrichUsageWindow(window, options = {}) {
  if (!window || typeof window !== 'object') return window;
  const providerId = String(options.providerId || '');
  const thresholds = thresholdsForWindow(options.thresholds, providerId, String(window.id || ''));
  const usedPercent = finiteNumber(window.used_percent);
  const resetMs = Date.parse(window.resets_at || '');
  const durationMinutes = finiteNumber(window.duration_minutes);
  const derivedStart = !window.starts_at && Number.isFinite(resetMs) && durationMinutes > 0
    ? new Date(resetMs - durationMinutes * 60 * 1000).toISOString()
    : window.starts_at;
  const normalizedWindow = { ...window, starts_at: derivedStart || null };
  const pace = window.status === 'unavailable' ? null : calculateUsagePace(normalizedWindow, options.now ?? Date.now());
  return {
    ...normalizedWindow,
    thresholds,
    visual_percent: usedPercent == null ? null : Math.max(0, Math.min(100, round(usedPercent))),
    pace,
  };
}

module.exports = {
  DEFAULT_USAGE_THRESHOLDS,
  calculateUsagePace,
  enrichUsageWindow,
  normalizeThresholdPair,
  paceCategory,
  paceStage,
  thresholdsForWindow,
};
