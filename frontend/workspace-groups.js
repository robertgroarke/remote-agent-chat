import { classifyFleetActivity, fleetStateIsWorking } from './fleet-activity.js';

const GROUP_ALIAS_STORAGE_KEY = 'remote-agent-chat:group-aliases:v1';
const DEFAULT_GROUP_ALIASES = Object.freeze({
  '^remoteagent': 'Remote Agent Chat',
});
const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working',
]);
const VALIDATOR_SESSION_KINDS = new Set(['validator', 'test', 'fixture', 'probe', 'e2e', 'throwaway']);
const TEST_SESSION_PATH_PATTERNS = [
  /(?:^|\/)cursor-test(?:\/|$)/i,
  /(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
  /(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,
  /(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i,
];

function sessionIdOf(session) {
  return typeof session === 'string' ? session : (session?.session_id || session?.id || '');
}

function sessionIsTestSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.is_test_session === false) return false;
  if (session.is_test_session === true || session.is_test_session === 1 || session.is_test_session === 'true' || session.validator_session === true) return true;
  if (VALIDATOR_SESSION_KINDS.has(String(session.session_kind || session.session_class || '').trim().toLowerCase())) return true;
  const pathProbe = String(session.workspace_path || session.project_root || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
  if (TEST_SESSION_PATH_PATTERNS.some(pattern => pattern.test(pathProbe))) return true;
  const identityProbe = [session.workspace_name, session.display_name, session.window_title, session.chat_title]
    .filter(Boolean).join('/').toLowerCase();
  return /(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.test(identityProbe);
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestMessageTimestamp(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((latest, message) => Math.max(
    latest,
    timestampMs(message?.ts ?? message?.timestamp ?? message?.created_at ?? message?.updated_at),
  ), 0);
}

function sidebarSessionState(session, options = {}) {
  const id = sessionIdOf(session);
  const sourceActivity = options.activities?.[id]
    || (typeof session === 'object' ? session.activity : null)
    || { kind: 'idle' };
  const thinking = !!options.thinking?.[id];
  const activity = thinking && !sourceActivity.generating
    ? { ...sourceActivity, kind: ACTIVE_ACTIVITY_KINDS.has(String(sourceActivity.kind || '').toLowerCase()) ? sourceActivity.kind : 'thinking', generating: true }
    : sourceActivity;
  const needsAttention = !!options.pendingPrompts?.[id]
    || !!options.errorPrompts?.[id]
    || (typeof session === 'object' && session.rate_limit_active === true);
  return classifyFleetActivity(activity, needsAttention, {
    connected: options.connected,
    health: options.health?.[id] || options.healthMap?.[id],
    nowMs: options.nowMs,
    freshnessMs: options.freshnessMs,
    requireFreshness: options.requireFreshness === true,
  });
}

function partitionSidebarSessionsByWorking(sessions, options = {}) {
  const working = [];
  const nonWorking = [];
  const states = {};
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const id = sessionIdOf(session);
    if (!id) continue;
    const state = sidebarSessionState(session, options);
    states[id] = state;
    (fleetStateIsWorking(state) ? working : nonWorking).push(session);
  }
  return { working, nonWorking, states };
}

function createSidebarWorkingLedger(workingSessions, options = {}) {
  const sessions = Array.isArray(workingSessions) ? workingSessions : [];
  const sessionOrder = sessions.map(sessionIdOf).filter(Boolean);
  return {
    version: 1,
    revision: Number(options.revision || 0),
    sessionOrder,
    fallbackSessionById: Object.fromEntries(sessions
      .map(session => [sessionIdOf(session), session])
      .filter(([id]) => id)),
  };
}

function reconcileSidebarWorkingLedger(ledger, workingSessions, options = {}) {
  const sessions = Array.isArray(workingSessions) ? workingSessions : [];
  const sourceById = Object.fromEntries(sessions
    .map(session => [sessionIdOf(session), session])
    .filter(([id]) => id));
  const desiredIds = Object.keys(sourceById);
  const current = ledger?.version === 1 ? ledger : createSidebarWorkingLedger(sessions, options);
  const currentIds = Array.isArray(current.sessionOrder) ? current.sessionOrder : [];
  const membershipChanged = desiredIds.length !== currentIds.length
    || desiredIds.some(id => !currentIds.includes(id));

  if (!membershipChanged) {
    return {
      ledger: current,
      sessions: currentIds.map(id => sourceById[id] || current.fallbackSessionById?.[id]).filter(Boolean),
      structuralChanged: false,
      deferred: false,
    };
  }

  if (options.freezeStructure) {
    return {
      ledger: current,
      sessions: currentIds.map(id => sourceById[id] || current.fallbackSessionById?.[id]).filter(Boolean),
      structuralChanged: true,
      deferred: true,
    };
  }

  const desiredSet = new Set(desiredIds);
  const sessionOrder = currentIds.filter(id => desiredSet.has(id));
  for (const id of desiredIds) {
    if (!sessionOrder.includes(id)) sessionOrder.push(id);
  }
  const next = {
    version: 1,
    revision: Number(current.revision || 0) + 1,
    sessionOrder,
    fallbackSessionById: Object.fromEntries(sessionOrder.map(id => [
      id,
      sourceById[id] || current.fallbackSessionById?.[id],
    ]).filter(([, session]) => !!session)),
  };
  return {
    ledger: next,
    sessions: sessionOrder.map(id => sourceById[id] || next.fallbackSessionById[id]).filter(Boolean),
    structuralChanged: true,
    deferred: false,
  };
}

function sidebarSessionRank(session, options = {}) {
  const id = sessionIdOf(session);
  const activity = options.activities?.[id] || (typeof session === 'object' ? session.activity : null) || null;
  const state = sidebarSessionState(session, options);
  const hasPrompt = state === 'needs_attention';
  const active = fleetStateIsWorking(state);
  const messageTimestamp = Math.max(
    timestampMs(options.lastMessageAt?.[id]),
    latestMessageTimestamp(options.messages?.[id]),
  );
  const fallbackTimestamp = Math.max(
    timestampMs(activity?.updatedAt ?? activity?.updated_at),
    timestampMs(activity?.startedAt ?? activity?.started_at),
    timestampMs(typeof session === 'object' ? session.last_message_at : null),
    timestampMs(typeof session === 'object' ? session.last_seen_at : null),
    timestampMs(typeof session === 'object' ? session.created_at : null),
  );
  return {
    id,
    tier: hasPrompt ? 2 : (active && options.rankWorking !== false) ? 1 : 0,
    recency: messageTimestamp || fallbackTimestamp,
  };
}

function orderSidebarGroups(groups, options = {}) {
  const previousGroups = new Map((options.previousGroupOrder || []).map((key, index) => [key, index]));
  const previousSessions = new Map((options.previousSessionOrder || []).map((id, index) => [id, index]));
  const stableGroupPosition = (key, fallback) => previousGroups.has(key) ? previousGroups.get(key) : previousGroups.size + fallback;
  const stableSessionPosition = (id, fallback) => previousSessions.has(id) ? previousSessions.get(id) : previousSessions.size + fallback;
  const ranked = (Array.isArray(groups) ? groups : []).map((group, groupIndex) => {
    const sessions = (group.sessions || []).map((session, sessionIndex) => ({
      session,
      sessionIndex,
      ...sidebarSessionRank(session, options),
    })).sort((left, right) => (
      right.tier - left.tier
      || right.recency - left.recency
      || stableSessionPosition(left.id, left.sessionIndex) - stableSessionPosition(right.id, right.sessionIndex)
      || left.id.localeCompare(right.id)
    ));
    return {
      group: { ...group, sessions: sessions.map(row => row.session) },
      groupIndex,
      tier: sessions.reduce((highest, row) => Math.max(highest, row.tier), 0),
      recency: sessions.reduce((latest, row) => Math.max(latest, row.recency), 0),
    };
  });
  ranked.sort((left, right) => (
    right.tier - left.tier
    || right.recency - left.recency
    || stableGroupPosition(left.group.key, left.groupIndex) - stableGroupPosition(right.group.key, right.groupIndex)
    || left.group.key.localeCompare(right.group.key)
  ));
  return ranked.map(row => row.group);
}

function sidebarOrderSnapshot(groups) {
  return {
    groupOrder: (groups || []).map(group => group.key),
    sessionOrder: (groups || []).flatMap(group => (group.sessions || []).map(sessionIdOf)),
  };
}

function sidebarMembershipSignature(groups) {
  return (groups || []).flatMap(group => (group.sessions || []).map(session => `${group.key}:${sessionIdOf(session)}`)).sort().join('|');
}

function sidebarGroupKey(group) {
  return String(group?.key || 'unscoped');
}

function sidebarSourceIndex(groups) {
  const sessionById = {};
  const groupBySession = {};
  const groupMeta = {};
  for (const group of groups || []) {
    const key = sidebarGroupKey(group);
    groupMeta[key] = { ...group, sessions: [] };
    for (const session of group.sessions || []) {
      const id = sessionIdOf(session);
      if (!id) continue;
      sessionById[id] = session;
      groupBySession[id] = key;
    }
  }
  return { sessionById, groupBySession, groupMeta };
}

function sidebarAppliedSnapshot(ledger) {
  return {
    groupOrder: [...(ledger?.groupOrder || [])],
    sessionOrder: [...(ledger?.sessionOrder || [])],
  };
}

function sidebarOrderKeysMatch(left, right) {
  return (left?.groupOrder || []).join('|') === (right?.groupOrder || []).join('|')
    && (left?.sessionOrder || []).join('|') === (right?.sessionOrder || []).join('|');
}

function preferredSidebarSnapshot(groups, options = {}, ledger = null) {
  return sidebarOrderSnapshot(orderSidebarGroups(groups, {
    ...options,
    previousGroupOrder: ledger?.groupOrder || options.previousGroupOrder,
    previousSessionOrder: ledger?.sessionOrder || options.previousSessionOrder,
  }));
}

function createSidebarOrderLedger(groups, options = {}) {
  const ordered = orderSidebarGroups(groups, options);
  const source = sidebarSourceIndex(ordered);
  const snapshot = sidebarOrderSnapshot(ordered);
  return {
    version: 1,
    revision: Number(options.revision || 0),
    groupOrder: snapshot.groupOrder,
    sessionOrder: snapshot.sessionOrder,
    groupBySession: source.groupBySession,
    groupMeta: source.groupMeta,
    fallbackSessionById: source.sessionById,
    sourceMembership: sidebarMembershipSignature(groups),
  };
}

function projectSidebarOrderLedger(ledger, groups) {
  const source = sidebarSourceIndex(groups);
  const grouped = new Map((ledger?.groupOrder || []).map(key => [key, []]));
  for (const id of ledger?.sessionOrder || []) {
    const key = ledger.groupBySession?.[id];
    if (!key || !grouped.has(key)) continue;
    const session = source.sessionById[id] || ledger.fallbackSessionById?.[id];
    if (session) grouped.get(key).push(session);
  }
  return (ledger?.groupOrder || []).map(key => ({
    ...(source.groupMeta[key] || ledger.groupMeta?.[key] || { key }),
    key,
    sessions: grouped.get(key) || [],
  })).filter(group => group.sessions.length > 0);
}

function sidebarPreferredOrderChanged(ledger, groups, options = {}) {
  const preferred = preferredSidebarSnapshot(groups, options, ledger);
  if (!sidebarOrderKeysMatch(sidebarAppliedSnapshot(ledger), preferred)) return true;
  const source = sidebarSourceIndex(groups);
  return Object.entries(source.groupBySession).some(([id, key]) => ledger.groupBySession?.[id] !== key);
}

function reconcileSidebarOrderLedger(ledger, groups, options = {}) {
  const current = ledger?.version === 1 ? ledger : createSidebarOrderLedger(groups, options);
  const sourceMembership = sidebarMembershipSignature(groups);
  if ((current.sessionOrder || []).length === 0 && sourceMembership) {
    const cold = createSidebarOrderLedger(groups, {
      ...options,
      revision: Number(current.revision || 0) + 1,
    });
    return {
      ledger: cold,
      groups: projectSidebarOrderLedger(cold, groups),
      orderChanged: false,
      structuralChanged: true,
      deferred: false,
    };
  }
  if (sourceMembership === current.sourceMembership) {
    return {
      ledger: current,
      groups: projectSidebarOrderLedger(current, groups),
      orderChanged: sidebarPreferredOrderChanged(current, groups, options),
      structuralChanged: false,
      deferred: false,
    };
  }
  if (options.freezeStructure) {
    return {
      ledger: current,
      groups: projectSidebarOrderLedger(current, groups),
      orderChanged: true,
      structuralChanged: true,
      deferred: true,
    };
  }

  const source = sidebarSourceIndex(groups);
  const presentIds = new Set(Object.keys(source.sessionById));
  const groupBySession = {};
  const sessionOrder = [];
  const groupOrder = [];
  const groupMeta = { ...(current.groupMeta || {}) };
  const fallbackSessionById = {};

  for (const id of current.sessionOrder || []) {
    if (!presentIds.has(id)) continue;
    sessionOrder.push(id);
    groupBySession[id] = current.groupBySession?.[id] || source.groupBySession[id];
    fallbackSessionById[id] = source.sessionById[id];
  }
  for (const group of groups || []) {
    const key = sidebarGroupKey(group);
    for (const session of group.sessions || []) {
      const id = sessionIdOf(session);
      if (!id || groupBySession[id]) continue;
      sessionOrder.push(id);
      groupBySession[id] = key;
      fallbackSessionById[id] = session;
      groupMeta[key] = { ...group, sessions: [] };
    }
  }
  for (const key of current.groupOrder || []) {
    if (sessionOrder.some(id => groupBySession[id] === key)) groupOrder.push(key);
  }
  for (const id of sessionOrder) {
    const key = groupBySession[id];
    if (!groupOrder.includes(key)) groupOrder.push(key);
  }

  const next = {
    version: 1,
    revision: Number(current.revision || 0) + 1,
    groupOrder,
    sessionOrder,
    groupBySession,
    groupMeta,
    fallbackSessionById,
    sourceMembership,
  };
  return {
    ledger: next,
    groups: projectSidebarOrderLedger(next, groups),
    orderChanged: sidebarPreferredOrderChanged(next, groups, options),
    structuralChanged: true,
    deferred: false,
  };
}

function sortSidebarOrderLedger(ledger, groups, options = {}) {
  return createSidebarOrderLedger(groups, {
    ...options,
    previousGroupOrder: ledger?.groupOrder,
    previousSessionOrder: ledger?.sessionOrder,
    revision: Number(ledger?.revision || 0) + 1,
  });
}

function normalizedDirectory(value) {
  const text = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!text || text.toLowerCase() === 'unknown') return null;
  if (!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(text)) return null;
  return { key: text.toLowerCase(), path: text };
}

function directoryLabel(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || 'Unscoped';
}

function isSameOrChildPath(pathKey, rootKey) {
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
}

function normalizedAliasProbe(value) {
  return directoryLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function canonicalAliasKey(value) {
  return `alias:${String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function normalizeGroupAliases(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries({ ...DEFAULT_GROUP_ALIASES, ...input })
    .filter(([pattern, title]) => String(pattern).trim() && String(title).trim())
    .map(([pattern, title]) => [String(pattern).trim(), String(title).trim()]));
}

function matchingGroupAlias(directory, session, groupAliases) {
  const explicit = session && typeof session === 'object'
    ? (session.group_alias || session.project_group || null)
    : null;
  if (typeof explicit === 'string' && explicit.trim()) {
    const title = explicit.trim();
    return { key: canonicalAliasKey(title), title };
  }
  if (!directory) return null;
  const probe = normalizedAliasProbe(directory.path);
  for (const [pattern, title] of Object.entries(normalizeGroupAliases(groupAliases))) {
    try {
      if (new RegExp(pattern, 'i').test(probe)) {
        return { key: canonicalAliasKey(title), title };
      }
    } catch {}
  }
  return null;
}

export function groupSessionsByDirectory(sessionList, agentConfigs = {}, groupAliases = DEFAULT_GROUP_ALIASES) {
  const sessions = Array.isArray(sessionList) ? sessionList : [];
  const explicitRoots = sessions
    .map(session => normalizedDirectory(session && typeof session === 'object' ? session.project_root : null))
    .filter(Boolean)
    .sort((left, right) => right.key.length - left.key.length);
  const groups = [];
  const byKey = new Map();

  for (const session of sessions) {
    const id = typeof session === 'string' ? session : (session?.session_id || session?.id);
    const config = id ? agentConfigs[id] : null;
    const explicitRoot = normalizedDirectory(session && typeof session === 'object' ? session.project_root : null);
    const workspace = normalizedDirectory(session && typeof session === 'object' ? session.workspace_path : null)
      || normalizedDirectory(config?.file_access_scope);
    const inheritedRoot = !explicitRoot && workspace
      ? explicitRoots.find(root => isSameOrChildPath(workspace.key, root.key))
      : null;
    const directory = explicitRoot || inheritedRoot || workspace;
    const alias = matchingGroupAlias(directory, session, groupAliases);
    const key = alias?.key || directory?.key || 'unscoped';
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: alias?.title || (directory ? directoryLabel(directory.path) : 'Unscoped'),
        path: directory?.path || null,
        sessions: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }

  return groups;
}

export {
  ACTIVE_ACTIVITY_KINDS,
  DEFAULT_GROUP_ALIASES,
  GROUP_ALIAS_STORAGE_KEY,
  createSidebarWorkingLedger,
  createSidebarOrderLedger,
  directoryLabel,
  normalizeGroupAliases,
  normalizedDirectory,
  orderSidebarGroups,
  projectSidebarOrderLedger,
  partitionSidebarSessionsByWorking,
  reconcileSidebarOrderLedger,
  reconcileSidebarWorkingLedger,
  sidebarMembershipSignature,
  sidebarOrderSnapshot,
  sidebarSessionRank,
  sidebarSessionState,
  sessionIsTestSession,
  sortSidebarOrderLedger,
};
