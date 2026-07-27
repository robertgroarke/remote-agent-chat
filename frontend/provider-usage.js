const STATUS_RANK = Object.freeze({
  unavailable: 6,
  auth_required: 5,
  rate_limited: 4,
  stale: 3,
  refreshing: 2,
  fresh: 1,
});

function finitePercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nullableCount(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function normalizeSourceLifecycle(value) {
  if (!value || typeof value !== 'object') return null;
  const status = ['loading', 'fresh', 'stale', 'auth_required', 'unavailable', 'error']
    .includes(value.status) ? value.status : 'unavailable';
  const diagnostic = value.diagnostic && typeof value.diagnostic === 'object'
    ? {
      configuredPorts: (Array.isArray(value.diagnostic.configured_ports)
        ? value.diagnostic.configured_ports : []).map(Number).filter(Number.isInteger),
      fallbackPorts: (Array.isArray(value.diagnostic.fallback_ports)
        ? value.diagnostic.fallback_ports : []).map(Number).filter(Number.isInteger),
      effectivePorts: (Array.isArray(value.diagnostic.effective_ports)
        ? value.diagnostic.effective_ports : []).map(Number).filter(Number.isInteger),
      fallbackPolicy: String(value.diagnostic.fallback_policy || ''),
      extractionSignature: String(value.diagnostic.extraction_signature || ''),
      attempts: (Array.isArray(value.diagnostic.attempts) ? value.diagnostic.attempts : []).map(attempt => ({
        port: nullableCount(attempt?.port),
        status: String(attempt?.status || ''),
        code: String(attempt?.code || ''),
        reachable: attempt?.reachable === true,
        elapsedMs: Math.max(0, Number(attempt?.elapsed_ms) || 0),
        ollamaOriginTargets: Math.max(0, Number(attempt?.ollama_origin_targets) || 0),
        usageTargets: Math.max(0, Number(attempt?.usage_targets) || 0),
      })),
      supervision: value.diagnostic.supervision && typeof value.diagnostic.supervision === 'object'
        ? {
          status: String(value.diagnostic.supervision.status || ''),
          code: String(value.diagnostic.supervision.code || ''),
          port: nullableCount(value.diagnostic.supervision.port),
          elapsedMs: Math.max(0, Number(value.diagnostic.supervision.elapsed_ms) || 0),
          visibleWindowsOpened: Math.max(
            0,
            Number(value.diagnostic.supervision.visible_windows_opened) || 0,
          ),
          protectedExistingTargetsMutated: Math.max(
            0,
            Number(value.diagnostic.supervision.protected_existing_targets_mutated) || 0,
          ),
        }
        : null,
      elapsedMs: Math.max(0, Number(value.diagnostic.elapsed_ms) || 0),
    }
    : null;
  return {
    status,
    capturedAt: String(value.captured_at || ''),
    lastGoodAt: String(value.last_good_at || ''),
    attemptedAt: String(value.attempted_at || ''),
    attemptId: String(value.attempt_id || ''),
    reason: value.reason && typeof value.reason === 'object' ? {
      code: String(value.reason.code || ''),
      message: String(value.reason.message || ''),
    } : null,
    nextAction: String(value.next_action || ''),
    diagnostic,
  };
}

function normalizedMoney(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.amount == null || value.amount === '') return null;
  const amount = finiteNumber(value.amount);
  if (amount == null) return null;
  return {
    amount,
    currency: String(value.currency || 'USD'),
    sourceField: String(value.source_field || ''),
    semantics: String(value.semantics || ''),
    directlyReported: value.directly_reported === true,
  };
}

function normalizeFinancials(value) {
  if (!value || typeof value !== 'object') return null;
  const pool = value.pool_classification && typeof value.pool_classification === 'object'
    ? {
      status: String(value.pool_classification.classification_status || ''),
      firstParty: normalizedMoney(value.pool_classification.first_party),
      thirdParty: normalizedMoney(value.pool_classification.third_party),
      unclassified: normalizedMoney(value.pool_classification.unclassified),
      warning: String(value.pool_classification.warning || ''),
    }
    : null;
  return {
    semanticsVersion: Number(value.semantics_version) || 0,
    source: String(value.source || ''),
    observedAt: String(value.observed_at || ''),
    accountScope: String(value.account_scope || ''),
    extraUsageEnabled: value.extra_usage_enabled === true,
    prepaidBalance: normalizedMoney(value.prepaid_balance),
    extraUsageSpend: normalizedMoney(value.extra_usage_spend),
    extraUsageCap: normalizedMoney(value.extra_usage_cap),
    reportedSpend: normalizedMoney(value.reported_spend),
    includedSpend: normalizedMoney(value.included_spend),
    bonusSpend: normalizedMoney(value.bonus_spend),
    planLimit: normalizedMoney(value.plan_limit),
    allowanceRemaining: normalizedMoney(value.allowance_remaining),
    reconciliationDelta: normalizedMoney(value.reconciliation_delta),
    poolClassification: pool,
    resetsAt: String(value.resets_at || ''),
    disclaimer: String(value.disclaimer || ''),
  };
}

function normalizeLocalRuntime(value) {
  if (!value || typeof value !== 'object') return null;
  const requestReceipts = (Array.isArray(value.request_receipts) ? value.request_receipts : []).map(receipt => ({
    receiptId: String(receipt?.receipt_id || ''),
    model: String(receipt?.model || ''),
    surface: String(receipt?.surface || ''),
    capturedAt: String(receipt?.captured_at || ''),
    promptTokens: finiteNumber(receipt?.prompt_tokens),
    responseTokens: finiteNumber(receipt?.response_tokens),
    tokensPerSecond: finiteNumber(receipt?.tokens_per_second),
    totalDurationNs: finiteNumber(receipt?.total_duration_ns),
    loadDurationNs: finiteNumber(receipt?.load_duration_ns),
    promptEvalDurationNs: finiteNumber(receipt?.prompt_eval_duration_ns),
    evalDurationNs: finiteNumber(receipt?.eval_duration_ns),
  })).filter(receipt => receipt.receiptId && receipt.model && receipt.surface);
  return {
    status: String(value.status || ''),
    endpointScope: String(value.endpoint_scope || ''),
    installedModelsCount: nullableCount(value.installed_models_count),
    loadedModelsCount: nullableCount(value.loaded_models_count),
    loadedModels: (Array.isArray(value.loaded_models) ? value.loaded_models : []).map(model => ({
      name: String(model?.name || 'Unnamed local model'),
      sizeBytes: Math.max(0, Number(model?.size_bytes) || 0),
      sizeVramBytes: Math.max(0, Number(model?.size_vram_bytes) || 0),
      contextLength: Math.max(0, Number(model?.context_length) || 0),
      expiresAt: String(model?.expires_at || ''),
    })),
    promptTokens: finiteNumber(value.prompt_tokens),
    responseTokens: finiteNumber(value.response_tokens),
    tokensPerSecond: finiteNumber(value.tokens_per_second),
    totalDurationNs: finiteNumber(value.total_duration_ns),
    loadDurationNs: finiteNumber(value.load_duration_ns),
    promptEvalDurationNs: finiteNumber(value.prompt_eval_duration_ns),
    evalDurationNs: finiteNumber(value.eval_duration_ns),
    observedRequestCount: Math.max(0, Number(value.observed_request_count) || 0),
    requestReceipts,
    latestRequest: requestReceipts.at(-1) || null,
    telemetryStatus: String(value.telemetry_status || ''),
    telemetryReason: String(value.telemetry_reason || ''),
    lifecycle: normalizeSourceLifecycle(value.lifecycle),
    observations: value.observations && typeof value.observations === 'object' ? {
      apiPs: normalizeSourceLifecycle(value.observations.api_ps),
      apiTags: normalizeSourceLifecycle(value.observations.api_tags),
      ownedReceipts: normalizeSourceLifecycle(value.observations.owned_receipts),
    } : null,
  };
}

function normalizeCloudUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const subscriptionState = ['active', 'none', 'unavailable'].includes(value.subscription_state)
    ? value.subscription_state : 'unavailable';
  return {
    subscriptionState,
    source: String(value.source || ''),
    capturedAt: String(value.captured_at || ''),
    autoReloadEnabled: typeof value.auto_reload_enabled === 'boolean' ? value.auto_reload_enabled : null,
    error: value.error && typeof value.error === 'object' ? {
      code: String(value.error.code || ''),
      message: String(value.error.message || ''),
    } : null,
    sourceReceipt: value.source_receipt && typeof value.source_receipt === 'object'
      ? { ...value.source_receipt } : null,
    lifecycle: normalizeSourceLifecycle(value.lifecycle),
  };
}

function normalizePace(value) {
  if (!value || typeof value !== 'object') return null;
  const category = ['slow', 'steady', 'racing', 'burning'].includes(value.category) ? value.category : '';
  const expectedUsedPercent = finitePercent(value.expected_used_percent);
  if (!category || expectedUsedPercent == null) return null;
  const budgets = value.budget_percent && typeof value.budget_percent === 'object'
    ? Object.fromEntries(['now', 'next_hour', 'next_five_hours', 'today'].map(key => [key, finitePercent(value.budget_percent[key]) ?? 0]))
    : null;
  return {
    stage: String(value.stage || ''), category, expectedUsedPercent,
    actualUsedPercent: finitePercent(value.actual_used_percent),
    deltaPercent: finiteNumber(value.delta_percent),
    projectedUsedPercent: finitePercent(value.projected_used_at_reset_percent),
    exhaustionAt: value.exhaustion_at ? String(value.exhaustion_at) : '',
    willLastToReset: value.will_last_to_reset === true,
    budgets,
  };
}

function normalizedWindow(window, index) {
  const usedPercent = finitePercent(window?.used_percent);
  const status = String(window?.status || (usedPercent == null ? 'unavailable' : 'available'));
  if (usedPercent == null && status !== 'unavailable') return null;
  const warningThreshold = finitePercent(window?.thresholds?.warning_percent) ?? 75;
  const criticalThreshold = Math.max(warningThreshold, finitePercent(window?.thresholds?.critical_percent) ?? 90);
  const normalized = {
    id: String(window?.id || `window-${index + 1}`),
    label: String(window?.label || 'Usage'),
    scope: window?.scope ? String(window.scope) : '',
    modelScope: window?.model_scope && typeof window.model_scope === 'object' ? {
      id: String(window.model_scope.id || ''), label: String(window.model_scope.label || ''),
    } : null,
    usedPercent,
    remainingPercent: finiteNumber(window?.remaining_percent) ?? (usedPercent == null ? null : 100 - usedPercent),
    visualPercent: finitePercent(window?.visual_percent) ?? (usedPercent == null ? null : Math.min(100, usedPercent)),
    durationMinutes: Number.isFinite(Number(window?.duration_minutes)) ? Number(window.duration_minutes) : null,
    startsAt: window?.starts_at ? String(window.starts_at) : '',
    resetsAt: window?.resets_at ? String(window.resets_at) : '',
    resetDescription: window?.reset_description ? String(window.reset_description) : '',
    windowKind: window?.window_kind ? String(window.window_kind) : '',
    source: window?.source ? String(window.source) : '',
    provenance: window?.provenance ? String(window.provenance) : '',
    freshnessStatus: window?.freshness_status ? String(window.freshness_status) : '',
    status,
    error: window?.error && typeof window.error === 'object' ? window.error : null,
    thresholds: { warningPercent: warningThreshold, criticalPercent: criticalThreshold },
    pace: normalizePace(window?.pace),
  };
  normalized.tone = usedPercent == null ? 'unavailable'
    : usedPercent >= criticalThreshold || usedPercent >= 100 ? 'critical'
      : usedPercent >= warningThreshold ? 'warning' : 'ok';
  return normalized;
}

export function providerUsageTone(entry) {
  if (entry?.status === 'auth_required' || entry?.status === 'unavailable') return 'unavailable';
  if (entry?.status === 'rate_limited') return 'stale';
  const tones = new Set((entry?.windows || []).map(window => window.tone));
  const maximum = Math.max(-1, ...(entry?.windows || []).map(window => window.usedPercent ?? -1));
  if (tones.has('critical')) return 'critical';
  if (tones.has('warning')) return 'warning';
  if (entry?.status === 'stale') return 'stale';
  if (entry?.status === 'fresh' && entry?.localRuntime?.status === 'running') return 'ok';
  return maximum >= 0 ? 'ok' : 'unknown';
}

function normalizeEntry(snapshot, index) {
  const windows = (Array.isArray(snapshot?.windows) ? snapshot.windows : [])
    .map(normalizedWindow)
    .filter(Boolean)
    .sort((left, right) => right.usedPercent - left.usedPercent || left.label.localeCompare(right.label));
  const entry = {
    key: `${snapshot?.provider_id || 'provider'}:${snapshot?.account_fingerprint || index}:${snapshot?.quota_domain || 'quota'}`,
    providerId: String(snapshot?.provider_id || 'unknown'),
    providerName: String(snapshot?.provider_name || 'Provider'),
    quotaDomain: String(snapshot?.quota_domain || ''),
    dashboardUrl: snapshot?.dashboard_url ? String(snapshot.dashboard_url) : '',
    accountFingerprint: String(snapshot?.account_fingerprint || ''),
    accountLabel: String(snapshot?.account_label || 'Local account'),
    plan: snapshot?.plan ? String(snapshot.plan) : '',
    source: snapshot?.source ? String(snapshot.source) : '',
    sourceHistory: Array.isArray(snapshot?.source_history) ? snapshot.source_history : [],
    status: String(snapshot?.status || 'unavailable'),
    capturedAt: snapshot?.captured_at ? String(snapshot.captured_at) : '',
    staleAfter: snapshot?.stale_after ? String(snapshot.stale_after) : '',
    nextRefreshAt: snapshot?.next_refresh_at ? String(snapshot.next_refresh_at) : '',
    cadenceClass: snapshot?.cadence_class ? String(snapshot.cadence_class) : '',
    refreshIntervalMs: Math.max(0, Number(snapshot?.refresh_interval_ms) || 0),
    fastRefreshIntervalMs: Math.max(0, Number(snapshot?.fast_refresh_interval_ms) || 0),
    idleRefreshIntervalMs: Math.max(0, Number(snapshot?.idle_refresh_interval_ms) || 0),
    watchBoostActive: snapshot?.watch_boost_active === true,
    lastAttemptAt: snapshot?.last_attempt_at ? String(snapshot.last_attempt_at) : '',
    lastSuccessAt: snapshot?.last_success_at ? String(snapshot.last_success_at) : '',
    consecutiveMisses: Math.max(0, Number(snapshot?.consecutive_misses) || 0),
    staleReason: snapshot?.stale_reason ? String(snapshot.stale_reason) : '',
    manualRefreshAllowedAt: snapshot?.manual_refresh_allowed_at ? String(snapshot.manual_refresh_allowed_at) : '',
    lastGoodCapturedAt: snapshot?.last_good_captured_at ? String(snapshot.last_good_captured_at) : '',
    windows,
    credits: snapshot?.credits && typeof snapshot.credits === 'object' ? snapshot.credits : null,
    financials: normalizeFinancials(snapshot?.financials),
    localRuntime: normalizeLocalRuntime(snapshot?.local_runtime),
    cloudUsage: normalizeCloudUsage(snapshot?.cloud_usage),
    resetCredits: snapshot?.reset_credits && typeof snapshot.reset_credits === 'object' ? snapshot.reset_credits : null,
    error: snapshot?.error && typeof snapshot.error === 'object' ? snapshot.error : null,
    requestCount: Math.max(0, Number(snapshot?.request_count) || 0),
    latencyMs: Number.isFinite(Number(snapshot?.latency_ms)) ? Number(snapshot.latency_ms) : null,
    sessionCount: Math.max(0, Number(snapshot?.session_count) || 0),
    harnessTypes: Array.isArray(snapshot?.mapped_harness_types)
      ? snapshot.mapped_harness_types.map(String).sort()
      : [],
  };
  entry.tone = providerUsageTone(entry);
  entry.maximumUsedPercent = windows.length > 0 ? Math.max(...windows.map(window => window.usedPercent)) : null;
  return entry;
}

export function normalizeProviderUsage(payload) {
  const candidates = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  const deduplicated = new Map();
  candidates.map(normalizeEntry).forEach(entry => {
    const previous = deduplicated.get(entry.key);
    const previousTime = Date.parse(previous?.capturedAt || '') || 0;
    const nextTime = Date.parse(entry.capturedAt || '') || 0;
    if (!previous || nextTime >= previousTime) deduplicated.set(entry.key, entry);
  });
  const entries = [...deduplicated.values()].sort((left, right) => (
    (STATUS_RANK[right.status] || 0) - (STATUS_RANK[left.status] || 0)
    || (right.maximumUsedPercent ?? -1) - (left.maximumUsedPercent ?? -1)
    || left.providerName.localeCompare(right.providerName)
    || left.accountLabel.localeCompare(right.accountLabel)
  ));
  const providerIds = new Set(entries.map(entry => entry.providerId));
  const reporting = entries.filter(entry => (
    entry.windows.length > 0 || entry.credits || entry.resetCredits || entry.financials || entry.localRuntime || entry.cloudUsage
  )).length;
  const nearLimit = entries.filter(entry => (
    ['warning', 'critical'].includes(entry.tone) && entry.maximumUsedPercent < 100
  )).length;
  const exhausted = entries.filter(entry => entry.maximumUsedPercent >= 100).length;
  const generation = Number(payload?.generation) || 0;
  const inFlight = payload?.in_flight === true;
  const freshEntries = entries.filter(entry => entry.status === 'fresh').length;
  const staleEntries = entries.filter(entry => entry.status === 'stale').length;
  const collectionState = inFlight
    ? 'refreshing'
    : generation === 0 && entries.length === 0
      ? 'not-started'
      : entries.length === 0
        ? 'ready'
        : freshEntries === entries.length
          ? 'ready'
          : freshEntries > 0
            ? 'partial'
            : staleEntries > 0
              ? 'stale'
              : 'unavailable';
  return {
    schemaVersion: Number(payload?.schema_version) || 0,
    generation,
    generatedAt: payload?.generated_at ? String(payload.generated_at) : '',
    pollIntervalMs: Math.max(0, Number(payload?.poll_interval_ms) || 0),
    cadenceMode: payload?.cadence_mode === 'watching' ? 'watching' : 'idle',
    inFlight,
    collectionState,
    summaryAuthoritative: generation > 0 || entries.length > 0,
    estimatedCost: normalizeEstimatedCost(payload?.estimated_cost),
    entries,
    summary: {
      providers: providerIds.size,
      accounts: entries.length,
      reporting,
      nearLimit,
      exhausted,
    },
  };
}

export function retainNewerProviderUsage(previous, incoming) {
  if (!incoming || typeof incoming !== 'object') return previous;
  if (!previous || typeof previous !== 'object') return incoming;
  const previousGeneration = Math.max(0, Number(previous.generation) || 0);
  const incomingGeneration = Math.max(0, Number(incoming.generation) || 0);
  if (incomingGeneration < previousGeneration) return previous;
  const previousSnapshots = Array.isArray(previous.snapshots) ? previous.snapshots : [];
  const incomingSnapshots = Array.isArray(incoming.snapshots) ? incoming.snapshots : [];
  if (incomingGeneration === previousGeneration && previousSnapshots.length > 0 && incomingSnapshots.length === 0) {
    return incoming.in_flight === true && previous.in_flight !== true
      ? { ...previous, in_flight: true }
      : previous;
  }
  return incoming;
}

function costRows(value) {
  return Array.isArray(value) ? value.filter(row => row && typeof row === 'object').map(row => ({ ...row })) : [];
}

function nullableNonnegative(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

export function normalizeEstimatedCost(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    schemaVersion: Number(value.schema_version) || 0,
    catalogVersion: String(value.catalog_version || ''),
    label: String(value.label || 'Local estimated API-equivalent cost'),
    status: String(value.status || 'unavailable'),
    generatedAt: value.generated_at ? String(value.generated_at) : '',
    range: value.range && typeof value.range === 'object' ? value.range : { days: 365, since: '', until: '' },
    tokens: {
      input: nullableNonnegative(value.tokens?.input),
      cached: nullableNonnegative(value.tokens?.cached),
      output: nullableNonnegative(value.tokens?.output),
    },
    costUsd: nullableNonnegative(value.cost_usd),
    records: nullableNonnegative(value.records),
    byProvider: costRows(value.by_provider),
    byModel: costRows(value.by_model),
    byProject: costRows(value.by_project),
    byDay: costRows(value.by_day),
    bySpeed: costRows(value.by_speed),
    dailyBreakdown: costRows(value.daily_breakdown),
    unknownModels: costRows(value.unknown_models),
    scan: value.scan && typeof value.scan === 'object' ? value.scan : {},
    reasonCode: String(value.reason_code || ''),
    reasonPath: String(value.reason_path || ''),
    lastGoodGeneratedAt: value.last_good_generated_at ? String(value.last_good_generated_at) : '',
    detail: value.detail && typeof value.detail === 'object' ? {
      totalRows: Math.max(0, Number(value.detail.total_rows) || 0),
      inlineRows: Math.max(0, Number(value.detail.inline_rows) || 0),
      pageSize: Math.max(0, Number(value.detail.page_size) || 0),
      nextCursor: value.detail.next_cursor == null ? '' : String(value.detail.next_cursor),
      truncated: value.detail.truncated === true,
      collections: costRows(value.detail.collections),
    } : null,
  };
}

function addCostRow(map, key, row, labelFields) {
  if (!map.has(key)) map.set(key, Object.fromEntries(labelFields.map(field => [field, row[field]])));
  const target = map.get(key);
  target.input = (Number(target.input) || 0) + (Number(row.input) || 0);
  target.cached = (Number(target.cached) || 0) + (Number(row.cached) || 0);
  target.output = (Number(target.output) || 0) + (Number(row.output) || 0);
  target.cost_usd = (Number(target.cost_usd) || 0) + (Number(row.cost_usd) || 0);
  target.records = (Number(target.records) || 0) + (Number(row.records) || 0);
}

export function selectEstimatedCost(cost, options = {}) {
  if (!cost) return null;
  const days = Math.max(1, Math.min(365, Number(options.days) || 1));
  const untilMs = Date.parse(`${cost.range?.until || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const sinceMs = untilMs - (days - 1) * 24 * 60 * 60 * 1000;
  const rows = cost.dailyBreakdown.filter(row => {
    const dayMs = Date.parse(`${row.day}T00:00:00.000Z`);
    return Number.isFinite(dayMs) && dayMs >= sinceMs && dayMs <= untilMs
      && (!options.project || row.project === options.project)
      && (!options.providerId || row.provider_id === options.providerId);
  });
  const groups = { provider: new Map(), model: new Map(), project: new Map(), day: new Map(), speed: new Map() };
  const total = { input: 0, cached: 0, output: 0, cost_usd: 0, records: 0 };
  rows.forEach(row => {
    addCostRow(new Map([['total', total]]), 'total', row, []);
    addCostRow(groups.provider, row.provider_id, row, ['provider_id']);
    addCostRow(groups.model, `${row.provider_id}|${row.model}`, row, ['provider_id', 'model']);
    addCostRow(groups.project, `${row.provider_id}|${row.project}`, row, ['provider_id', 'project']);
    addCostRow(groups.day, row.day, row, ['day']);
    addCostRow(groups.speed, row.speed, row, ['speed']);
  });
  const values = map => [...map.values()].map(row => ({ ...row, cost_usd: Number((row.cost_usd || 0).toFixed(8)) }));
  return {
    days,
    tokens: { input: total.input, cached: total.cached, output: total.output },
    costUsd: Number(total.cost_usd.toFixed(8)), records: total.records,
    byProvider: values(groups.provider), byModel: values(groups.model),
    byProject: values(groups.project), byDay: values(groups.day), bySpeed: values(groups.speed),
  };
}

export function formatProviderPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unavailable';
  return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function formatOllamaDuration(value) {
  const nanoseconds = Number(value);
  if (!Number.isFinite(nanoseconds) || nanoseconds < 0) return 'Unavailable';
  if (nanoseconds < 1e6) return `${Math.round(nanoseconds / 1e3)} us`;
  if (nanoseconds < 1e9) return `${(nanoseconds / 1e6).toFixed(1).replace(/\.0$/, '')} ms`;
  return `${(nanoseconds / 1e9).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} s`;
}

export function formatOllamaTokenRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return 'Unavailable';
  return `${rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} tokens/s`;
}

export function formatProviderUsageAge(value, nowMs = Date.now()) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'Not yet refreshed';
  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

export function formatProviderUsageReset(value, nowMs = Date.now()) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return value ? String(value) : '';
  const deltaSeconds = Math.max(0, Math.floor((timestamp - nowMs) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const countdown = deltaSeconds < 60
    ? `${deltaSeconds}s`
    : minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const absolute = new Date(timestamp).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `in ${countdown} (${absolute})`;
}

export function formatProviderCredits(credits) {
  if (!credits || typeof credits !== 'object') return '';
  if (credits.unlimited === true) return 'Unlimited credits';
  const hasBalance = credits.balance != null && credits.balance !== '' && Number.isFinite(Number(credits.balance));
  if (credits.unit && hasBalance) return `${credits.balance} ${credits.unit}`;
  const currency = credits.currency === 'USD' ? '$' : credits.currency ? `${credits.currency} ` : '';
  if (hasBalance) return `${currency}${Number(credits.balance).toFixed(2)} balance`;
  return '';
}

function formatMoney(value) {
  if (!value || value.amount == null || value.amount === '' || !Number.isFinite(Number(value.amount))) return 'Not reported';
  const prefix = value.currency === 'USD' ? '$' : value.currency ? `${value.currency} ` : '';
  return `${prefix}${Number(value.amount).toFixed(2)}`;
}

export function providerFinancialRows(financials) {
  if (!financials) return [];
  const rows = [];
  if (financials.prepaidBalance) rows.push({ id: 'prepaid-balance', label: 'Available prepaid balance', value: formatMoney(financials.prepaidBalance) });
  if (financials.extraUsageSpend) rows.push({ id: 'extra-spend', label: 'Extra-usage spend', value: formatMoney(financials.extraUsageSpend) });
  if (financials.extraUsageCap) rows.push({ id: 'extra-cap', label: 'Extra-usage cap', value: formatMoney(financials.extraUsageCap) });
  if (!financials.extraUsageEnabled && (financials.extraUsageSpend || financials.extraUsageCap)) {
    rows.push({ id: 'extra-status', label: 'Extra usage', value: 'Disabled' });
  }
  if (financials.reportedSpend) rows.push({ id: 'reported-spend', label: 'Provider-reported spend', value: formatMoney(financials.reportedSpend) });
  if (financials.includedSpend) rows.push({ id: 'included-spend', label: 'Included spend bucket', value: formatMoney(financials.includedSpend) });
  if (financials.bonusSpend) rows.push({ id: 'bonus-spend', label: 'Bonus spend bucket', value: formatMoney(financials.bonusSpend) });
  if (financials.planLimit) rows.push({ id: 'plan-limit', label: 'Reported plan limit', value: formatMoney(financials.planLimit) });
  if (financials.reportedSpend && !financials.allowanceRemaining) {
    rows.push({ id: 'allowance-remaining', label: 'Available allowance', value: 'Not reported by provider' });
  }
  if (financials.poolClassification?.status === 'unavailable') {
    rows.push({
      id: 'pool-classification',
      label: 'First/third-party pools',
      value: financials.poolClassification.warning || 'Not reported by provider',
    });
  }
  return rows;
}
