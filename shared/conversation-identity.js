'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NATIVE_ID_RE = /^[a-z0-9][a-z0-9:._-]{7,191}$/i;

const SURFACE_DEFINITIONS = Object.freeze({
  'codex-desktop': { family: 'codex', surface: 'codex_desktop', label: 'Codex Desktop', cli: false, priority: 40 },
  codex: { family: 'codex', surface: 'codex_vscode', label: 'Codex', cli: false, priority: 30 },
  codex_cli: { family: 'codex', surface: 'codex_cli', label: 'Codex CLI', cli: true, priority: 20 },
  claude: { family: 'claude', surface: 'claude_vscode', label: 'Claude Code', cli: false, priority: 30 },
  'claude-desktop': { family: 'claude', surface: 'claude_desktop', label: 'Claude Code', cli: false, priority: 40 },
  claude_cli: { family: 'claude', surface: 'claude_cli', label: 'Claude Code CLI', cli: true, priority: 20 },
  cursor: { family: 'cursor', surface: 'cursor_ide', label: 'Cursor', cli: false, priority: 40 },
  cursor_cli: { family: 'cursor', surface: 'cursor_cli', label: 'Cursor CLI', cli: true, priority: 20 },
  antigravity_panel: { family: 'antigravity', surface: 'antigravity_chat', label: 'Antigravity Chat', cli: false, priority: 40 },
  'antigravity-v2': { family: 'antigravity', surface: 'antigravity_v2', label: 'Antigravity v2', cli: false, priority: 30 },
  gemini: { family: 'antigravity', surface: 'gemini', label: 'Gemini', cli: false, priority: 20 },
  roo_code: { family: 'antigravity', surface: 'roo_code', label: 'Roo Code', cli: false, priority: 20 },
});

const VERIFIED_CLI_OWNER_KINDS = new Set([
  'interactive_tui',
  'proxy_app_server',
  'rotator_exec',
  'proxy_exec',
]);

function safeText(value, max = 192) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

function surfaceDefinition(agentType) {
  return SURFACE_DEFINITIONS[String(agentType || '').trim().toLowerCase()] || null;
}

function firstUuid(value) {
  return String(value || '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]?.toLowerCase() || null;
}

function normalizeNativeConversationId(family, value) {
  const normalizedFamily = String(family || '').trim().toLowerCase();
  const text = safeText(value);
  if (!normalizedFamily || !text) return null;
  if (normalizedFamily === 'codex') return firstUuid(text);
  const normalized = text.toLowerCase();
  return NATIVE_ID_RE.test(normalized) ? normalized : null;
}

function canonicalConversationId(family, nativeId) {
  const normalizedFamily = String(family || '').trim().toLowerCase();
  const normalizedId = normalizeNativeConversationId(normalizedFamily, nativeId);
  return normalizedFamily && normalizedId ? `${normalizedFamily}:${normalizedId}` : null;
}

function nativeConversationIdFrom(value) {
  const definition = surfaceDefinition(value?.agent_type || value?.agentType);
  if (!definition) return null;
  const candidates = [
    value?.native_conversation_id,
    value?.native_id,
    value?.canonical_native_id,
    value?.cli_session_id,
    value?.cliSessionId,
    value?.codex_desktop_active_thread_key,
    value?.codexDesktopActiveThreadKey,
    value?._activeThreadKey,
    value?.cursor_agent_id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeNativeConversationId(definition.family, candidate);
    if (normalized) return normalized;
  }
  return null;
}

function numericGeneration(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const number = Number(value);
  if (Number.isSafeInteger(number) && number >= 0) return number;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function claimClock(claim) {
  return [
    numericGeneration(claim?.owner_generation || claim?.process_epoch || claim?.generation),
    numericGeneration(claim?.native_sequence || claim?.source_sequence || claim?.sequence),
    numericGeneration(claim?.observed_at || claim?.updated_at || claim?.last_seen_at),
  ];
}

function compareClocks(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = Number(left?.[index] || 0) - Number(right?.[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function normalizedOwnerEvidence(value) {
  const owner = value && typeof value === 'object' ? value : {};
  const kind = safeText(owner.kind || owner.owner_kind, 80);
  const state = safeText(owner.state || owner.owner_state, 40);
  const verified = owner.verified === true
    || (VERIFIED_CLI_OWNER_KINDS.has(kind) && ['confirmed', 'active', 'transferring'].includes(state));
  return {
    verified,
    kind,
    state,
    generation: safeText(owner.generation || owner.process_epoch || owner.owner_generation, 160),
    proof: safeText(owner.proof, 160),
  };
}

function normalizeConversationClaim(value) {
  const definition = surfaceDefinition(value?.agent_type || value?.agentType);
  const sessionId = safeText(value?.session_id || value?.sessionId, 192);
  if (!definition || !sessionId) return null;
  const nativeId = normalizeNativeConversationId(
    definition.family,
    value?.native_conversation_id || value?.nativeConversationId || nativeConversationIdFrom(value),
  );
  const canonicalId = canonicalConversationId(definition.family, nativeId);
  if (!canonicalId) return null;
  const ownerEvidence = normalizedOwnerEvidence(value?.owner_evidence || value?.ownerEvidence);
  const nativeActive = value?.native_active === true || value?.nativeActive === true;
  const connected = value?.connected === true || value?.status === 'healthy';
  const positiveOwner = definition.cli
    ? ownerEvidence.verified
    : nativeActive && connected;
  return {
    session_id: sessionId,
    canonical_id: canonicalId,
    family: definition.family,
    native_id: nativeId,
    agent_type: String(value?.agent_type || value?.agentType),
    surface: definition.surface,
    surface_label: definition.label,
    surface_priority: definition.priority,
    cli: definition.cli,
    archive_only: value?.archive_only === true || value?.archiveOnly === true,
    connected,
    native_active: nativeActive,
    positive_owner: positiveOwner,
    owner_evidence: ownerEvidence,
    provenance: {
      originator: safeText(value?.provenance?.originator, 80),
      source: safeText(value?.provenance?.source, 80),
      thread_source: safeText(value?.provenance?.thread_source, 80),
    },
    clock: claimClock(value),
  };
}

function compareClaims(left, right) {
  const clock = compareClocks(right.clock, left.clock);
  if (clock !== 0) return clock;
  if (left.positive_owner !== right.positive_owner) return left.positive_owner ? -1 : 1;
  if (left.native_active !== right.native_active) return left.native_active ? -1 : 1;
  if (left.connected !== right.connected) return left.connected ? -1 : 1;
  if (left.archive_only !== right.archive_only) return left.archive_only ? 1 : -1;
  if (left.surface_priority !== right.surface_priority) return right.surface_priority - left.surface_priority;
  return left.session_id.localeCompare(right.session_id);
}

function reconcileConversationClaims(values, previous = null) {
  const claims = (Array.isArray(values) ? values : [])
    .map(normalizeConversationClaim)
    .filter(Boolean);
  if (claims.length === 0) return null;
  const canonicalId = claims[0].canonical_id;
  if (claims.some(claim => claim.canonical_id !== canonicalId)) {
    throw new Error('Conversation claims must share one canonical identity');
  }
  const newestBySession = new Map();
  for (const claim of claims) {
    const existing = newestBySession.get(claim.session_id);
    if (!existing || compareClocks(claim.clock, existing.clock) >= 0) newestBySession.set(claim.session_id, claim);
  }
  const latestClaims = [...newestBySession.values()].sort(compareClaims);
  const liveSurfaces = latestClaims.filter(claim => claim.positive_owner || claim.native_active);
  const visibleCandidates = liveSurfaces.length
    ? liveSurfaces
    : latestClaims.filter(claim => claim.connected && !claim.archive_only);
  const visibleClaim = (visibleCandidates.length ? visibleCandidates : latestClaims)[0];
  const priorCanonicalSessionId = safeText(previous?.canonical_session_id || previous?.canonicalSessionId, 192);
  const priorCanonicalStillClaimed = priorCanonicalSessionId
    && latestClaims.some(claim => claim.session_id === priorCanonicalSessionId);
  const canonicalSessionId = priorCanonicalStillClaimed ? priorCanonicalSessionId : visibleClaim.session_id;
  const currentOwnerClock = previous?.current_owner_clock || previous?.currentOwnerClock || [0, 0, 0];
  const newestPositiveOwner = latestClaims.find(claim => claim.positive_owner) || null;
  const ownerRegressed = newestPositiveOwner
    && previous?.current_surface
    && compareClocks(newestPositiveOwner.clock, currentOwnerClock) < 0;
  const currentSurfaceClaim = ownerRegressed
    ? latestClaims.find(claim => claim.surface === previous.current_surface) || visibleClaim
    : newestPositiveOwner || visibleClaim;
  const surfaceRows = liveSurfaces.length ? liveSurfaces : [visibleClaim];
  const surfaces = [...new Map(surfaceRows.map(claim => [claim.surface, {
    surface: claim.surface,
    label: claim.surface_label,
    session_id: claim.session_id,
    owner_verified: claim.positive_owner,
    owner_kind: claim.owner_evidence.kind,
    owner_state: claim.owner_evidence.state,
  }])).values()];
  const aliases = latestClaims.map(claim => ({
    session_id: claim.session_id,
    surface: claim.surface,
    visible: claim.session_id === visibleClaim.session_id,
    suppressed: claim.session_id !== visibleClaim.session_id,
    suppression_reason: claim.session_id === visibleClaim.session_id
      ? null
      : claim.positive_owner
        ? 'canonical_multi_surface_attachment'
        : claim.archive_only
          ? 'shared_archive_without_current_owner'
          : 'canonical_surface_preferred',
    provenance: claim.provenance,
    owner_evidence: claim.owner_evidence,
    clock: claim.clock,
  }));
  return {
    canonical_id: canonicalId,
    family: visibleClaim.family,
    native_id: visibleClaim.native_id,
    canonical_session_id: canonicalSessionId,
    visible_session_id: visibleClaim.session_id,
    current_surface: currentSurfaceClaim.surface,
    current_surface_label: currentSurfaceClaim.surface_label,
    current_owner_clock: currentSurfaceClaim.clock,
    multi_surface: surfaces.length > 1,
    live_surfaces: surfaces,
    aliases,
    worker_count: 1,
  };
}

class CanonicalConversationRegistry {
  constructor() {
    this._claims = new Map();
    this._resolutions = new Map();
  }

  apply(value) {
    const claim = normalizeConversationClaim(value);
    if (!claim) return { accepted: false, reason: 'identity_unavailable', resolution: null };
    const key = `${claim.canonical_id}\u0000${claim.session_id}`;
    const previousClaim = this._claims.get(key);
    if (previousClaim && compareClocks(claim.clock, previousClaim.clock) < 0) {
      return {
        accepted: false,
        reason: 'stale_generation',
        resolution: this._resolutions.get(claim.canonical_id) || null,
      };
    }
    this._claims.set(key, claim);
    const previousResolution = this._resolutions.get(claim.canonical_id) || null;
    const resolution = reconcileConversationClaims(
      [...this._claims.values()].filter(item => item.canonical_id === claim.canonical_id),
      previousResolution,
    );
    this._resolutions.set(claim.canonical_id, resolution);
    return { accepted: true, reason: 'applied', resolution };
  }

  replace(values) {
    const nextClaims = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      const claim = normalizeConversationClaim(value);
      if (!claim) continue;
      const key = `${claim.canonical_id}\u0000${claim.session_id}`;
      const existing = nextClaims.get(key);
      if (!existing || compareClocks(claim.clock, existing.clock) >= 0) nextClaims.set(key, claim);
    }
    this._claims = nextClaims;
    const grouped = new Map();
    for (const claim of nextClaims.values()) {
      if (!grouped.has(claim.canonical_id)) grouped.set(claim.canonical_id, []);
      grouped.get(claim.canonical_id).push(claim);
    }
    const nextResolutions = new Map();
    for (const [canonicalId, claims] of grouped) {
      nextResolutions.set(canonicalId, reconcileConversationClaims(claims, this._resolutions.get(canonicalId)));
    }
    this._resolutions = nextResolutions;
    return this.snapshot();
  }

  get(canonicalId) {
    return this._resolutions.get(String(canonicalId || '')) || null;
  }

  snapshot() {
    return [...this._resolutions.values()].sort((left, right) => left.canonical_id.localeCompare(right.canonical_id));
  }
}

module.exports = {
  CanonicalConversationRegistry,
  SURFACE_DEFINITIONS,
  UUID_RE,
  VERIFIED_CLI_OWNER_KINDS,
  canonicalConversationId,
  compareClocks,
  firstUuid,
  nativeConversationIdFrom,
  normalizeConversationClaim,
  normalizeNativeConversationId,
  reconcileConversationClaims,
  surfaceDefinition,
};
