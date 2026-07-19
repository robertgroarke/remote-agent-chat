const SURFACE_PROVIDER = Object.freeze({
  codex: 'openai-codex',
  'codex-desktop': 'openai-codex',
  codex_cli: 'openai-codex',
  codex_vscode: 'openai-codex',
  claude: 'anthropic-claude',
  'claude-desktop': 'anthropic-claude',
  claude_cli: 'anthropic-claude',
  claude_code: 'anthropic-claude',
  cursor: 'cursor',
  cursor_cli: 'cursor',
  antigravity: 'google-antigravity',
  antigravity_panel: 'google-antigravity',
  'antigravity-v2': 'google-antigravity',
  gemini: 'google-antigravity',
  ollama: 'ollama-local',
});

const PROVIDER_NAMES = Object.freeze({
  'openai-codex': 'OpenAI Codex',
  'anthropic-claude': 'Anthropic Claude',
  cursor: 'Cursor',
  'google-antigravity': 'Google Antigravity',
  'ollama-local': 'Ollama',
});

function clean(value, maximum = 160) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizedToken(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sessionType(session, config) {
  return clean(session?.agent_type || session?.agentType || config?.agent_type || config?.agentType, 80);
}

function explicitProviderId(session, config) {
  return clean(
    session?.usage_billing_provider_id
      || session?.billing_provider_id
      || session?.provider_usage?.provider_id
      || config?.usage_billing_provider_id
      || config?.billing_provider_id,
    80,
  );
}

function explicitAccountFingerprint(session, config) {
  return clean(
    session?.usage_account_fingerprint
      || session?.provider_account_fingerprint
      || session?.provider_usage?.account_fingerprint
      || config?.usage_account_fingerprint,
    96,
  );
}

function explicitQuotaDomain(session, config) {
  return clean(
    session?.usage_quota_domain
      || session?.provider_quota_domain
      || session?.provider_usage?.quota_domain
      || config?.usage_quota_domain,
    120,
  );
}

function currentModel(session, config) {
  const id = clean(
    config?.observed_model_id
      || config?.model_id
      || config?.selected_model_id
      || config?.model
      || session?.observed_model_id
      || session?.model_id
      || session?.selected_model_id
      || session?.model,
    160,
  );
  const label = clean(config?.observed_model_label || config?.model_label || session?.model_label || id, 160);
  return { id, label };
}

function inferredModelVendor(model, session, config) {
  const explicit = clean(config?.model_vendor || session?.model_vendor, 80);
  if (explicit) return explicit;
  const value = `${model.id} ${model.label}`.toLowerCase();
  if (/claude|anthropic/.test(value)) return 'Anthropic';
  if (/gemini|google/.test(value)) return 'Google';
  if (/gpt|codex|openai|\bo[1345](?:\b|-)/.test(value)) return 'OpenAI';
  if (/ollama|qwen|gemma|llama|mistral/.test(value)) return 'Ollama/runtime-defined';
  return model.id ? 'Unknown model vendor' : 'Not reported';
}

function trustedOllamaRuntime(session, config) {
  const value = clean(
    session?.usage_runtime_kind
      || session?.ollama_runtime_kind
      || session?.model_runtime_kind
      || config?.usage_runtime_kind
      || config?.ollama_runtime_kind
      || config?.model_runtime_kind,
    32,
  ).toLowerCase();
  return value === 'local' || value === 'cloud' ? value : '';
}

function modelMatchesScope(model, scope) {
  if (!model.id || !scope) return false;
  const modelTokens = [normalizedToken(model.id), normalizedToken(model.label)].filter(Boolean);
  const scopeTokens = [normalizedToken(scope.id), normalizedToken(scope.label)].filter(Boolean);
  if (scopeTokens.length === 0) return false;
  return scopeTokens.some(scopeToken => modelTokens.some(modelToken => (
    modelToken === scopeToken || modelToken.includes(scopeToken) || scopeToken.includes(modelToken)
  )));
}

function remaining(window) {
  const reported = finite(window?.remainingPercent);
  if (reported != null) return reported;
  const used = finite(window?.usedPercent);
  return used == null ? null : 100 - used;
}

function constraintSort(left, right) {
  const leftRemaining = remaining(left);
  const rightRemaining = remaining(right);
  if (leftRemaining != null && rightRemaining != null && leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
  if (leftRemaining != null) return -1;
  if (rightRemaining != null) return 1;
  const leftDuration = finite(left?.durationMinutes);
  const rightDuration = finite(right?.durationMinutes);
  if (leftDuration != null && rightDuration != null && leftDuration !== rightDuration) return leftDuration - rightDuration;
  return clean(left?.label).localeCompare(clean(right?.label));
}

function projectionBase(session, config, providerUsage) {
  const type = sessionType(session, config);
  const model = currentModel(session, config);
  const providerId = explicitProviderId(session, config) || SURFACE_PROVIDER[type] || '';
  return {
    supported: !!providerId,
    state: providerId ? 'unavailable' : 'unsupported',
    tone: 'unavailable',
    message: providerId ? 'Usage account unavailable' : 'No provider usage mapping',
    billingProviderId: providerId,
    billingProviderName: PROVIDER_NAMES[providerId] || providerId || 'Provider',
    providerMarkId: providerId,
    harnessSurface: type,
    modelId: model.id,
    modelLabel: model.label,
    modelVendor: inferredModelVendor(model, session, config),
    accountFingerprint: '',
    accountLabel: '',
    quotaDomain: '',
    plan: '',
    mappingConfidence: 'unavailable',
    generation: Number(providerUsage?.generation) || 0,
    capturedAt: '',
    staleAfter: '',
    freshness: clean(providerUsage?.collectionState || 'unavailable', 40),
    source: '',
    error: null,
    applicableWindows: [],
    headerWindows: [],
    credits: null,
    financials: null,
    cloudUsage: null,
    localRuntime: null,
    runtimeKind: providerId === 'ollama-local' ? trustedOllamaRuntime(session, config) : '',
  };
}

function matchedEntry(base, session, config, providerUsage) {
  const entries = Array.isArray(providerUsage?.entries) ? providerUsage.entries : [];
  const fingerprint = explicitAccountFingerprint(session, config);
  const quotaDomain = explicitQuotaDomain(session, config);
  let candidates = base.billingProviderId
    ? entries.filter(entry => entry?.providerId === base.billingProviderId)
    : entries.filter(entry => Array.isArray(entry?.harnessTypes) && entry.harnessTypes.includes(base.harnessSurface));
  if (fingerprint) candidates = candidates.filter(entry => entry?.accountFingerprint === fingerprint);
  if (quotaDomain) candidates = candidates.filter(entry => entry?.quotaDomain === quotaDomain);
  if (candidates.length === 1) {
    return {
      entry: candidates[0],
      confidence: fingerprint || quotaDomain ? 'explicit_account' : explicitProviderId(session, config) ? 'explicit_provider' : 'unique_provider_account',
    };
  }
  if (candidates.length > 1) return { entry: null, confidence: 'ambiguous', candidates };
  return { entry: null, confidence: fingerprint || quotaDomain ? 'linked_account_unavailable' : 'unavailable', candidates };
}

export function sessionUsageProjection(session, config, providerUsage, nowMs = Date.now()) {
  const base = projectionBase(session, config, providerUsage);
  if (!base.supported) return base;
  const match = matchedEntry(base, session, config, providerUsage);
  if (!match.entry) {
    return {
      ...base,
      state: match.confidence === 'ambiguous' ? 'ambiguous' : 'unavailable',
      message: match.confidence === 'ambiguous' ? 'Usage account ambiguous' : 'Usage account unavailable',
      mappingConfidence: match.confidence,
    };
  }

  const entry = match.entry;
  const staleAt = Date.parse(entry.staleAfter || '');
  const staleByClock = Number.isFinite(staleAt) && staleAt <= nowMs;
  const freshness = staleByClock && entry.status === 'fresh' ? 'stale' : clean(entry.status || 'unavailable', 40);
  const model = { id: base.modelId, label: base.modelLabel };
  const windows = Array.isArray(entry.windows) ? entry.windows.filter(window => window && window.usedPercent != null) : [];
  const scoped = windows.filter(window => window.modelScope && modelMatchesScope(model, window.modelScope)).sort(constraintSort);
  const shared = windows.filter(window => !window.modelScope).sort(constraintSort);
  const applicableWindows = [...scoped, ...shared];
  const headerWindows = scoped.length > 0
    ? [scoped[0], shared[0]].filter(Boolean)
    : shared.slice(0, 2);
  const runtimeKind = base.runtimeKind;

  if (base.billingProviderId === 'ollama-local') {
    if (!runtimeKind) {
      return {
        ...base,
        billingProviderName: entry.providerName || base.billingProviderName,
        accountFingerprint: entry.accountFingerprint,
        accountLabel: entry.accountLabel,
        quotaDomain: entry.quotaDomain,
        plan: entry.plan,
        mappingConfidence: match.confidence,
        capturedAt: entry.capturedAt,
        staleAfter: entry.staleAfter,
        freshness,
        source: entry.source,
        state: 'ambiguous',
        message: 'Ollama runtime unavailable',
        cloudUsage: entry.cloudUsage,
        localRuntime: entry.localRuntime,
      };
    }
    if (runtimeKind === 'local') {
      return {
        ...base,
        billingProviderName: entry.providerName || base.billingProviderName,
        accountFingerprint: entry.accountFingerprint,
        accountLabel: entry.accountLabel,
        quotaDomain: entry.quotaDomain,
        plan: entry.plan,
        mappingConfidence: match.confidence,
        capturedAt: entry.capturedAt,
        staleAfter: entry.staleAfter,
        freshness,
        source: entry.source,
        state: entry.localRuntime ? 'local' : 'unavailable',
        tone: entry.localRuntime ? 'local' : 'unavailable',
        message: entry.localRuntime ? 'Local · no plan limit' : 'Local runtime telemetry unavailable',
        localRuntime: entry.localRuntime,
        cloudUsage: entry.cloudUsage,
      };
    }
  }

  const headerTones = new Set(headerWindows.map(window => window.tone));
  const tone = headerTones.has('critical') ? 'critical'
    : headerTones.has('warning') ? 'warning'
      : freshness === 'stale' ? 'stale'
        : headerWindows.length > 0 ? 'ok' : 'unavailable';
  const state = freshness === 'auth_required' || freshness === 'unavailable'
    ? 'unavailable'
    : freshness === 'stale' || freshness === 'rate_limited'
      ? 'stale'
      : headerWindows.some(window => Number(window.usedPercent) >= 100)
        ? 'exhausted'
        : headerWindows.length > 0 ? 'ready' : 'unavailable';

  return {
    ...base,
    state,
    tone: state === 'exhausted' ? 'critical' : tone,
    message: headerWindows.length > 0 ? '' : 'Applicable usage windows unavailable',
    billingProviderName: entry.providerName || base.billingProviderName,
    accountFingerprint: entry.accountFingerprint,
    accountLabel: entry.accountLabel,
    quotaDomain: entry.quotaDomain,
    plan: entry.plan,
    mappingConfidence: match.confidence,
    capturedAt: entry.capturedAt,
    staleAfter: entry.staleAfter,
    freshness,
    source: entry.source,
    error: entry.error,
    applicableWindows,
    headerWindows,
    credits: entry.credits,
    financials: entry.financials,
    cloudUsage: entry.cloudUsage,
    localRuntime: entry.localRuntime,
  };
}

export function sessionUsageWindowLabel(window) {
  const label = clean(window?.label || 'Usage', 60);
  const remainingPercent = remaining(window);
  return {
    label,
    usedPercent: finite(window?.usedPercent),
    remainingPercent,
    compactValue: remainingPercent == null ? 'Unavailable' : `${Math.max(0, Math.round(remainingPercent))}% left`,
    reset: clean(window?.resetDescription || window?.resetsAt, 120),
    tone: clean(window?.tone || 'unavailable', 24),
  };
}

export const SESSION_USAGE_SURFACE_PROVIDER = SURFACE_PROVIDER;
