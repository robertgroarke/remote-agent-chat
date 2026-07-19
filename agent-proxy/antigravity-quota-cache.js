'use strict';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_PREFERENCE_KEY = 'provider_usage.antigravity_quota.v1';
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;
const MAX_MODELS = 32;
const MAX_SOURCE_ATTEMPTS = 8;

function boundedText(value, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function isoTimestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function boundedPercent(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 100) / 100));
}

function normalizeSourceAttempt(value) {
  if (!value || typeof value !== 'object') return null;
  const source = boundedText(value.source, 60);
  const status = boundedText(value.status, 40);
  const capturedAt = isoTimestamp(value.captured_at);
  if (!source || !status || !capturedAt) return null;
  return {
    source,
    status,
    captured_at: capturedAt,
    ...(boundedText(value.code, 60) ? { code: boundedText(value.code, 60) } : {}),
  };
}

function boundedSourceHistory(values) {
  const normalized = (Array.isArray(values) ? values : [])
    .map(normalizeSourceAttempt)
    .filter(Boolean);
  let rehydrated = null;
  for (const attempt of normalized) {
    if (attempt.source === 'cached' && attempt.status === 'rehydrated') rehydrated = attempt;
  }
  const tail = normalized
    .filter(attempt => !(attempt.source === 'cached' && attempt.status === 'rehydrated'))
    .slice(-(MAX_SOURCE_ATTEMPTS - (rehydrated ? 1 : 0)));
  return rehydrated ? [rehydrated, ...tail] : tail;
}

function sourceAttempt(source, status, code = null, capturedAt = new Date().toISOString()) {
  return normalizeSourceAttempt({ source, status, code, captured_at: capturedAt });
}

function normalizeModel(value) {
  if (!value || typeof value !== 'object') return null;
  const model = boundedText(value.model, 180);
  const used = boundedPercent(value.percent_used);
  const remaining = boundedPercent(value.percent_remaining);
  if (!model || (used == null && remaining == null)) return null;
  return {
    model,
    quota_group: boundedText(value.quota_group, 100),
    quota_window: boundedText(value.quota_window, 80),
    window_kind: boundedText(value.window_kind, 40),
    refreshes_in: boundedText(value.refreshes_in, 120),
    resets_at: isoTimestamp(value.resets_at),
    percent_remaining: remaining,
    percent_used: used,
    color: boundedText(value.color, 80),
  };
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const fetchedAt = isoTimestamp(value.fetched_at);
  const models = (Array.isArray(value.models) ? value.models : [])
    .slice(0, MAX_MODELS)
    .map(normalizeModel)
    .filter(Boolean);
  if (!fetchedAt || models.length === 0) return null;
  const credits = value.available_ai_credits == null || value.available_ai_credits === ''
    ? null
    : Number(value.available_ai_credits);
  return {
    schema_variant: boundedText(value.schema_variant, 80) || 'unknown',
    percentage_semantics: boundedText(value.percentage_semantics, 80) || 'unknown',
    app_version: boundedText(value.app_version, 40),
    plan: boundedText(value.plan, 80),
    tier: boundedText(value.tier, 100),
    available_ai_credits: Number.isFinite(credits) ? Math.max(0, credits) : null,
    models,
    fetched_at: fetchedAt,
  };
}

function createCache(snapshot, options = {}) {
  const data = normalizeSnapshot(snapshot);
  if (!data) return null;
  const fetchedAt = Date.parse(data.fetched_at);
  const source = boundedText(options.source || snapshot.source, 60) || 'in_app_api';
  const sourceHistory = boundedSourceHistory(options.sourceHistory);
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    fetchedAt,
    nextRefreshAt: fetchedAt + REFRESH_INTERVAL_MS,
    source,
    sourceHistory,
    data,
  };
}

function persistedValue(cache) {
  if (!cache || cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  const normalized = createCache(cache.data, {
    source: cache.source,
    sourceHistory: cache.sourceHistory,
  });
  if (!normalized) return null;
  const requestedNextRefreshAt = Number(cache.nextRefreshAt);
  const nextRefreshAt = Number.isFinite(requestedNextRefreshAt) && requestedNextRefreshAt >= normalized.fetchedAt
    ? requestedNextRefreshAt
    : normalized.nextRefreshAt;
  return {
    schema_version: CACHE_SCHEMA_VERSION,
    fetched_at: normalized.data.fetched_at,
    next_refresh_at: new Date(nextRefreshAt).toISOString(),
    source: normalized.source,
    source_history: normalized.sourceHistory,
    snapshot: normalized.data,
  };
}

function persistCache(store, cache) {
  const value = persistedValue(cache);
  if (!value || !store) return false;
  if (typeof store.replacePreference === 'function') {
    store.replacePreference(CACHE_PREFERENCE_KEY, value);
    return true;
  }
  if (typeof store.updatePreference !== 'function') return false;
  store.updatePreference(CACHE_PREFERENCE_KEY, value);
  return true;
}

function hydrateCache(store, now = Date.now()) {
  if (!store || typeof store.getPreference !== 'function') return null;
  const persisted = store.getPreference(CACHE_PREFERENCE_KEY);
  if (!persisted || Number(persisted.schema_version) !== CACHE_SCHEMA_VERSION) return null;
  const cache = createCache(persisted.snapshot, {
    source: 'cached',
    sourceHistory: [
      ...(Array.isArray(persisted.source_history) ? persisted.source_history : []),
      sourceAttempt('cached', 'rehydrated', null, new Date(now).toISOString()),
    ],
  });
  if (!cache) return null;
  cache.nextRefreshAt = Math.max(now, Date.parse(persisted.next_refresh_at || '') || 0);
  return cache;
}

function cacheAfterFailure(cache, code, now = Date.now()) {
  if (!cache?.data) return cache;
  return {
    ...cache,
    source: 'cached',
    nextRefreshAt: now + REFRESH_INTERVAL_MS,
    sourceHistory: boundedSourceHistory([
      ...(cache.sourceHistory || []),
      sourceAttempt('in_app_api', 'unavailable', code || 'refresh_failed', new Date(now).toISOString()),
      sourceAttempt('hidden_surface_open', 'disabled', 'invisibility_unproven', new Date(now).toISOString()),
      sourceAttempt('cached', 'ok', null, new Date(now).toISOString()),
    ]),
  };
}

module.exports = {
  CACHE_PREFERENCE_KEY,
  CACHE_SCHEMA_VERSION,
  MAX_SOURCE_ATTEMPTS,
  REFRESH_INTERVAL_MS,
  STALE_AFTER_MS,
  boundedSourceHistory,
  cacheAfterFailure,
  createCache,
  hydrateCache,
  normalizeSnapshot,
  persistCache,
  persistedValue,
  sourceAttempt,
};
