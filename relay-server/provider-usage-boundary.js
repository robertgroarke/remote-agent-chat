'use strict';

const MAX_PROVIDER_USAGE_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = 512;
const DEFAULT_ARRAY_LIMIT = 128;
const MAX_DAILY_BREAKDOWN_ROWS = 256;

// Collection bounds are deliberately path-specific. Provider quota windows and
// reset credits remain tightly capped while cost detail gets one bounded inline
// page. Larger cost result sets travel through the paginated detail protocol;
// they never require weakening the global credential-safe envelope.
const ARRAY_LIMITS = new Map([
  ['$.snapshots', 32],
  ['$.snapshots[].mapped_harness_types', 32],
  ['$.snapshots[].source_history', 8],
  ['$.snapshots[].windows', 64],
  ['$.snapshots[].local_runtime.loaded_models', 64],
  ['$.snapshots[].local_runtime.request_receipts', 32],
  ['$.snapshots[].reset_credits.details', 10],
  ['$.estimated_cost.by_provider', 32],
  ['$.estimated_cost.by_model', 512],
  ['$.estimated_cost.by_project', 512],
  ['$.estimated_cost.by_day', 365],
  ['$.estimated_cost.by_speed', 32],
  ['$.estimated_cost.daily_breakdown', MAX_DAILY_BREAKDOWN_ROWS],
  ['$.estimated_cost.unknown_models', 512],
  ['$.estimated_cost.detail.collections', 16],
  ['$.summary.by_model', 512],
  ['$.summary.by_day', 365],
  ['$.rows', MAX_DAILY_BREAKDOWN_ROWS],
]);

const ALLOWED_KEYS = new Set([
  'schema_version', 'generation', 'generated_at', 'poll_interval_ms', 'in_flight', 'snapshots',
  'estimated_cost', 'catalog_version', 'range', 'days', 'since', 'until', 'tokens',
  'input', 'cached', 'output', 'cost_usd', 'records', 'by_provider', 'by_model',
  'by_project', 'by_day', 'by_speed', 'daily_breakdown', 'unknown_models', 'scan',
  'files_total', 'files_complete', 'bytes_read', 'malformed_lines', 'checkpoint_hash',
  'project', 'model', 'speed', 'fallback', 'day',
  'provider_id', 'provider_name', 'quota_domain', 'dashboard_url',
  'account_fingerprint', 'account_label', 'plan', 'account_metadata',
  'source', 'source_history', 'status', 'captured_at', 'stale_after', 'next_refresh_at',
  'windows', 'credits', 'financials', 'local_runtime', 'cloud_usage', 'reset_credits', 'error', 'request_count', 'latency_ms',
  'session_count', 'mapped_harness_types', 'last_good_captured_at',
  'id', 'label', 'scope', 'used_percent', 'remaining_percent', 'duration_minutes',
  'starts_at', 'resets_at', 'reset_description', 'window_kind', 'model_scope',
  'visual_percent', 'thresholds', 'warning_percent', 'critical_percent',
  'provenance', 'freshness_status', 'pace', 'stage', 'category',
  'expected_used_percent', 'actual_used_percent', 'delta_percent',
  'projected_used_at_reset_percent', 'exhaustion_at', 'will_last_to_reset',
  'budget_percent', 'now', 'next_hour', 'next_five_hours', 'today',
  'code', 'message', 'retry_after_ms',
  'enabled', 'unlimited', 'balance', 'currency', 'used', 'limit', 'included', 'bonus',
  'utilization_percent', 'period', 'unit', 'available_count', 'details',
  'title', 'description', 'granted_at', 'expires_at', 'subscription_status',
  'detail', 'total_rows', 'inline_rows', 'page_size', 'next_cursor', 'truncated',
  'collections', 'name', 'returned_rows', 'reason_code', 'reason_path',
  'last_good_generated_at', 'last_good_age_ms', 'next_retry_at', 'refresh_request_id',
  'semantics_version', 'observed_at', 'account_scope', 'amount', 'source_field', 'semantics',
  'directly_reported', 'extra_usage_enabled', 'prepaid_balance', 'extra_usage_spend',
  'extra_usage_cap', 'allowance_remaining', 'reported_spend', 'included_spend',
  'bonus_spend', 'plan_limit', 'reconciliation_delta', 'pool_classification',
  'classification_status', 'first_party', 'third_party', 'unclassified', 'warning',
  'disclaimer',
  'endpoint_scope', 'installed_models_count', 'loaded_models_count', 'loaded_models',
  'size_bytes', 'size_vram_bytes', 'context_length', 'prompt_tokens', 'response_tokens',
  'total_duration_ns', 'load_duration_ns', 'prompt_eval_duration_ns', 'eval_duration_ns',
  'tokens_per_second', 'observed_request_count', 'request_receipts', 'receipt_id', 'surface',
  'telemetry_status', 'telemetry_reason',
  'subscription_state', 'auto_reload_enabled', 'source_receipt',
  'ready_state', 'visibility_state', 'active_element_tag', 'page_path', 'page_state_unchanged',
  'dom_mutation_records', 'navigation_actions', 'click_actions', 'focus_actions',
  'existing_target_id_preserved', 'target_inventory_stable', 'targets_created',
]);

const DETAIL_ALLOWED_KEYS = new Set([
  ...ALLOWED_KEYS,
  'query', 'summary', 'rows', 'pagination', 'cursor',
]);

const ALLOWED_PROVIDER_IDS = new Set([
  'openai-codex',
  'anthropic-claude',
  'google-antigravity',
  'cursor',
  'ollama-local',
]);

const ALLOWED_STATUSES = new Set([
  'fresh',
  'stale',
  'refreshing',
  'auth_required',
  'rate_limited',
  'unavailable',
]);

function containsCredentialShapedValue(value) {
  if (typeof value !== 'string') return false;
  return /\bbearer\s+[a-z0-9._~+\/-]+/i.test(value)
    || /\bsk-[a-z0-9_-]{8,}/i.test(value)
    || /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i.test(value)
    || /\b[a-z0-9.!#$%&'+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i.test(value);
}

function canonicalArrayPath(pointer) {
  return String(pointer || '$').replace(/\[\d+\]/g, '[]');
}

function arrayLimit(pointer) {
  return ARRAY_LIMITS.get(canonicalArrayPath(pointer)) ?? DEFAULT_ARRAY_LIMIT;
}

function validateNode(value, depth = 0, pointer = '$') {
  if (depth > 9) return false;
  if (value == null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return value.length <= MAX_STRING_LENGTH && !containsCredentialShapedValue(value);
  }
  if (Array.isArray(value)) {
    return value.length <= arrayLimit(pointer)
      && value.every((item, index) => validateNode(item, depth + 1, `${pointer}[${index}]`));
  }
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(([key, child]) => (
    ALLOWED_KEYS.has(key) && validateNode(child, depth + 1, `${pointer}.${key}`)
  ));
}

function validOptionalArray(value, maxLength) {
  return value == null || (Array.isArray(value) && value.length <= maxLength);
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  if (![1, 2, 3, 4].includes(snapshot.schema_version)) return false;
  if (!ALLOWED_PROVIDER_IDS.has(snapshot.provider_id)) return false;
  if (!ALLOWED_STATUSES.has(snapshot.status)) return false;
  if (typeof snapshot.account_fingerprint !== 'string'
      || !/^(acct_[a-f0-9]{20}|unavailable_[a-z0-9-]+)$/.test(snapshot.account_fingerprint)) return false;
  if (!Array.isArray(snapshot.windows) || snapshot.windows.length > 64) return false;
  if (!Array.isArray(snapshot.mapped_harness_types) || snapshot.mapped_harness_types.length > 32) return false;
  if (!validOptionalArray(snapshot.source_history, 8)) return false;
  if (snapshot.reset_credits?.details && !validOptionalArray(snapshot.reset_credits.details, 10)) return false;
  if (snapshot.dashboard_url != null) {
    let parsed;
    try { parsed = new URL(snapshot.dashboard_url); } catch { return false; }
    if (parsed.protocol !== 'https:' || !new Set(['chatgpt.com', 'claude.ai', 'cursor.com', 'ollama.com']).has(parsed.hostname)) return false;
  }
  return true;
}

function invalidNodePath(value, depth = 0, pointer = '$', allowedKeys = ALLOWED_KEYS) {
  if (depth > 9) return `${pointer}:depth`;
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${pointer}:number`;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) return `${pointer}:string_length`;
    return containsCredentialShapedValue(value) ? `${pointer}:credential_shape` : null;
  }
  if (Array.isArray(value)) {
    if (value.length > arrayLimit(pointer)) return `${pointer}:array_length`;
    for (let index = 0; index < value.length; index += 1) {
      const failure = invalidNodePath(value[index], depth + 1, `${pointer}[${index}]`, allowedKeys);
      if (failure) return failure;
    }
    return null;
  }
  if (typeof value !== 'object') return `${pointer}:type`;
  for (const [key, child] of Object.entries(value)) {
    if (!allowedKeys.has(key)) return `${pointer}.${key}:key`;
    const failure = invalidNodePath(child, depth + 1, `${pointer}.${key}`, allowedKeys);
    if (failure) return failure;
  }
  return null;
}

function encodedBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return null; }
}

function quotaEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const quota = { ...payload };
  delete quota.estimated_cost;
  return quota;
}

function quotaBoundaryViolation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '$:payload';
  if (![1, 2, 3, 4].includes(payload.schema_version)) return '$.schema_version';
  if (!Array.isArray(payload.snapshots) || payload.snapshots.length > 32) return '$.snapshots';
  const invalidSnapshot = payload.snapshots.findIndex(snapshot => !validateSnapshot(snapshot));
  if (invalidSnapshot >= 0) return `$.snapshots[${invalidSnapshot}]:snapshot`;
  const quota = quotaEnvelope(payload);
  const bytes = encodedBytes(quota);
  if (bytes == null) return '$:json';
  if (bytes > MAX_PROVIDER_USAGE_BYTES) return '$:bytes';
  return invalidNodePath(quota);
}

function costBoundaryViolation(cost) {
  if (cost == null) return null;
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return '$.estimated_cost:type';
  return invalidNodePath(cost, 1, '$.estimated_cost');
}

function providerUsagePayloadStats(payload) {
  const cost = payload?.estimated_cost;
  return {
    bytes: encodedBytes(payload),
    quota_bytes: encodedBytes(quotaEnvelope(payload)),
    snapshots: Array.isArray(payload?.snapshots) ? payload.snapshots.length : null,
    windows: Array.isArray(payload?.snapshots)
      ? payload.snapshots.reduce((sum, snapshot) => sum + (Array.isArray(snapshot?.windows) ? snapshot.windows.length : 0), 0)
      : null,
    cost_daily_rows: Array.isArray(cost?.daily_breakdown) ? cost.daily_breakdown.length : null,
    cost_model_rows: Array.isArray(cost?.by_model) ? cost.by_model.length : null,
    cost_project_rows: Array.isArray(cost?.by_project) ? cost.by_project.length : null,
  };
}

function providerUsageBoundaryAssessment(payload) {
  const quotaViolation = quotaBoundaryViolation(payload);
  let costViolation = quotaViolation ? null : costBoundaryViolation(payload?.estimated_cost);
  const stats = providerUsagePayloadStats(payload);
  if (!quotaViolation && !costViolation && stats.bytes != null && stats.bytes > MAX_PROVIDER_USAGE_BYTES) {
    costViolation = payload?.estimated_cost == null ? '$:bytes' : '$.estimated_cost:bytes';
  }
  return {
    ok: !quotaViolation && !costViolation,
    quota_violation: quotaViolation,
    cost_violation: costViolation,
    violation: quotaViolation || costViolation,
    stats,
  };
}

function providerUsageBoundaryViolation(payload) {
  return providerUsageBoundaryAssessment(payload).violation;
}

function compactEstimatedCost(cost, pageSize = MAX_DAILY_BREAKDOWN_ROWS) {
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return cost ?? null;
  const requested = Math.max(1, Math.min(MAX_DAILY_BREAKDOWN_ROWS, Number(pageSize) || MAX_DAILY_BREAKDOWN_ROWS));
  const collectionNames = ['by_provider', 'by_model', 'by_project', 'by_day', 'by_speed', 'daily_breakdown', 'unknown_models'];
  const collections = [];
  const compact = { ...cost };
  for (const name of collectionNames) {
    const rows = Array.isArray(cost[name]) ? cost[name] : [];
    const limit = name === 'daily_breakdown'
      ? requested : arrayLimit(`$.estimated_cost.${name}`);
    compact[name] = rows.slice(0, limit);
    collections.push({
      name,
      total_rows: rows.length,
      returned_rows: compact[name].length,
      truncated: rows.length > compact[name].length,
    });
  }
  const totalRows = Array.isArray(cost.daily_breakdown) ? cost.daily_breakdown.length : 0;
  compact.detail = {
    total_rows: totalRows,
    inline_rows: compact.daily_breakdown.length,
    page_size: requested,
    next_cursor: totalRows > compact.daily_breakdown.length ? String(compact.daily_breakdown.length) : null,
    truncated: totalRows > compact.daily_breakdown.length,
    collections,
  };
  return compact;
}

function compactProviderUsageSnapshot(payload, pageSize = MAX_DAILY_BREAKDOWN_ROWS) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return {
    ...payload,
    estimated_cost: compactEstimatedCost(payload.estimated_cost, pageSize),
  };
}

function degradedEstimatedCost(cost, violation) {
  const safePath = String(violation || '$.estimated_cost:invalid').slice(0, MAX_STRING_LENGTH);
  const rangeDays = Number(cost?.range?.days);
  const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
  const safeCount = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  return {
    schema_version: Number(cost?.schema_version) || 2,
    catalog_version: String(cost?.catalog_version || '').slice(0, MAX_STRING_LENGTH),
    label: 'Local estimated API-equivalent cost',
    status: 'error',
    generated_at: cost?.generated_at || null,
    range: {
      days: Number.isFinite(rangeDays) ? Math.max(1, Math.min(365, rangeDays)) : 365,
      since: safeDate(cost?.range?.since),
      until: safeDate(cost?.range?.until),
    },
    tokens: { input: null, cached: null, output: null },
    cost_usd: null,
    records: null,
    by_provider: [], by_model: [], by_project: [], by_day: [], by_speed: [],
    daily_breakdown: [], unknown_models: [],
    scan: {
      files_total: safeCount(cost?.scan?.files_total),
      files_complete: safeCount(cost?.scan?.files_complete),
      bytes_read: safeCount(cost?.scan?.bytes_read),
      malformed_lines: safeCount(cost?.scan?.malformed_lines),
      checkpoint_hash: null,
    },
    reason_code: safePath.endsWith(':bytes') ? 'cost_payload_oversized' : 'cost_payload_invalid',
    reason_path: safePath,
    detail: { total_rows: 0, inline_rows: 0, page_size: MAX_DAILY_BREAKDOWN_ROWS, next_cursor: null, truncated: false, collections: [] },
  };
}

function sanitizeProviderUsageSnapshot(payload, options = {}) {
  const assessment = providerUsageBoundaryAssessment(payload);
  if (assessment.quota_violation) return null;
  const clonedQuota = JSON.parse(JSON.stringify(quotaEnvelope(payload)));
  if (assessment.cost_violation) {
    clonedQuota.estimated_cost = options.degradeCost === false
      ? null : degradedEstimatedCost(payload?.estimated_cost, assessment.cost_violation);
    return clonedQuota;
  }
  return JSON.parse(JSON.stringify(payload));
}

function providerUsageCostDetailViolation(payload) {
  const bytes = encodedBytes(payload);
  if (bytes == null) return '$:json';
  if (bytes > MAX_PROVIDER_USAGE_BYTES) return '$:bytes';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '$:payload';
  if (payload.schema_version !== 1) return '$.schema_version';
  if (!['ready', 'partial', 'stale'].includes(payload.status)) return '$.status';
  if (typeof payload.generated_at !== 'string' || !Number.isFinite(Date.parse(payload.generated_at))) {
    return '$.generated_at';
  }
  const query = payload.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) return '$.query';
  if (!Number.isInteger(query.days) || query.days < 1 || query.days > 365) return '$.query.days';
  if (query.provider_id != null && !['openai-codex', 'anthropic-claude'].includes(query.provider_id)) {
    return '$.query.provider_id';
  }
  if (query.project != null && (typeof query.project !== 'string'
      || query.project.length < 1 || query.project.length > 100)) {
    return '$.query.project';
  }
  if (!payload.summary || typeof payload.summary !== 'object' || Array.isArray(payload.summary)) return '$.summary';
  const validTotals = value => value && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.input) && value.input >= 0
    && Number.isInteger(value.cached) && value.cached >= 0
    && Number.isInteger(value.output) && value.output >= 0
    && Number.isFinite(value.cost_usd) && value.cost_usd >= 0
    && Number.isInteger(value.records) && value.records >= 0 && value.records <= 250000;
  const summary = payload.summary;
  if (!summary.range || summary.range.days !== query.days
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(summary.range.since || ''))
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(summary.range.until || ''))
      || summary.range.since > summary.range.until) return '$.summary.range';
  if (!summary.tokens || !validTotals({ ...summary.tokens, cost_usd: summary.cost_usd, records: summary.records })) {
    return '$.summary.tokens';
  }
  if (!Array.isArray(summary.by_model) || summary.by_model.length > 512
      || summary.by_model.some(row => !validTotals(row)
        || !['openai-codex', 'anthropic-claude'].includes(row.provider_id)
        || typeof row.model !== 'string' || row.model.length < 1)) return '$.summary.by_model';
  if (!Array.isArray(summary.by_day) || summary.by_day.length > 365
      || summary.by_day.some(row => !validTotals(row)
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.day || '')))) return '$.summary.by_day';
  if (!Array.isArray(payload.rows) || payload.rows.length > MAX_DAILY_BREAKDOWN_ROWS) return '$.rows';
  if (payload.rows.some(row => !validTotals(row)
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.day || ''))
      || !['openai-codex', 'anthropic-claude'].includes(row.provider_id)
      || typeof row.model !== 'string' || row.model.length < 1
      || typeof row.project !== 'string'
      || typeof row.speed !== 'string' || row.speed.length < 1)) return '$.rows';
  const pagination = payload.pagination;
  if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) return '$.pagination';
  if (!/^\d{1,9}$/.test(String(pagination.cursor ?? ''))) return '$.pagination.cursor';
  if (pagination.next_cursor != null && !/^\d{1,9}$/.test(String(pagination.next_cursor))) return '$.pagination.next_cursor';
  if (!Number.isInteger(pagination.page_size) || pagination.page_size < 1
      || pagination.page_size > MAX_DAILY_BREAKDOWN_ROWS) return '$.pagination.page_size';
  if (pagination.returned_rows !== payload.rows.length) return '$.pagination.returned_rows';
  if (!Number.isInteger(pagination.total_rows) || pagination.total_rows < payload.rows.length
      || pagination.total_rows > 250000) {
    return '$.pagination.total_rows';
  }
  const offset = Number(pagination.cursor);
  if (offset > pagination.total_rows || offset + pagination.returned_rows > pagination.total_rows) {
    return '$.pagination.cursor';
  }
  const expectedNextCursor = offset + pagination.returned_rows < pagination.total_rows
    ? String(offset + pagination.returned_rows) : null;
  if (pagination.next_cursor !== expectedNextCursor) return '$.pagination.next_cursor';
  return invalidNodePath(payload, 0, '$', DETAIL_ALLOWED_KEYS);
}

function sanitizeProviderUsageCostDetail(payload) {
  return providerUsageCostDetailViolation(payload) ? null : JSON.parse(JSON.stringify(payload));
}

module.exports = {
  MAX_PROVIDER_USAGE_BYTES,
  MAX_DAILY_BREAKDOWN_ROWS,
  arrayLimit,
  compactEstimatedCost,
  compactProviderUsageSnapshot,
  containsCredentialShapedValue,
  costBoundaryViolation,
  degradedEstimatedCost,
  providerUsageBoundaryAssessment,
  providerUsageBoundaryViolation,
  providerUsageCostDetailViolation,
  providerUsagePayloadStats,
  quotaBoundaryViolation,
  sanitizeProviderUsageSnapshot,
  sanitizeProviderUsageCostDetail,
};
