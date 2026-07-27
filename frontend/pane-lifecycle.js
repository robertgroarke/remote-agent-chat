export const PANE_CLOSED = 'closed';
export const PANE_OPEN = 'open';
export const PANE_MINIMIZED = 'minimized';
export const PANE_LIFECYCLE_STATES = Object.freeze([
  PANE_CLOSED,
  PANE_OPEN,
  PANE_MINIMIZED,
]);

export const GLOBAL_PANE_SESSION = '__global__';

export const PANE_DEFINITIONS = Object.freeze([
  { id: 'sidebar', label: 'Sessions', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android uses a navigation-stack session list, not a chat-overlapping sidebar.' },
  { id: 'agent-settings', label: 'Agent settings', classification: 'chat-adjacent', capability: 'agent_config', web: true, android: true },
  { id: 'composer-settings', label: 'Composer settings', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android exposes the coordinated Agent settings sheet instead of an independent composer popover.' },
  { id: 'chat-list', label: 'Chats', classification: 'chat-adjacent', capability: 'chat_list', web: true, android: true },
  { id: 'thread-list', label: 'Threads', classification: 'chat-adjacent', capability: 'thread_list', web: true, android: true },
  { id: 'terminal', label: 'Terminal', classification: 'chat-adjacent', capability: 'terminal_output|terminal_input', web: true, android: true },
  { id: 'diff-viewer', label: 'Changes', classification: 'chat-adjacent', capability: 'file_changes', web: true, android: true },
  { id: 'branch-selector', label: 'Branches', classification: 'chat-adjacent', capability: 'branch_list', web: true, android: true },
  { id: 'file-browser', label: 'Files', classification: 'chat-adjacent', capability: 'file_browser', web: true, android: true },
  { id: 'scheduled-send', label: 'Scheduled send', classification: 'chat-adjacent', capability: 'broadcast_send', web: true, android: true },
  { id: 'session-usage', label: 'Session usage', classification: 'chat-adjacent', capability: 'always', web: false, android: true, web_na: 'Web exposes usage as a full route rather than an inline session sheet.' },
  { id: 'native-action', label: 'Action needed', classification: 'blocking-native-action', capability: 'permission_dialogs|question_prompts', web: true, android: true },
  { id: 'rate-limit', label: 'Rate limit', classification: 'transient-status', capability: 'always', web: true, android: true },
  { id: 'live-activity', label: 'Live activity', classification: 'transient-status', capability: 'always', web: true, android: true },
  { id: 'task-list', label: 'Task list', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android renders task rows inside the bounded, minimizable Live activity pane.' },
  { id: 'automation-context', label: 'Automation', classification: 'chat-adjacent', capability: 'automation_view', web: true, android: false, android_na: 'Android automation management is a navigation route, not a chat-adjacent overlay.' },
  { id: 'antigravity-navigator', label: 'Conversations', classification: 'chat-adjacent', capability: 'agent:antigravity-v2', web: true, android: false, android_na: 'Android uses the shared coordinated Chats sheet for Antigravity v2 conversations.' },
  { id: 'new-session', label: 'New session', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android launches sessions from the separate session-list route, never over Chat.', global: true },
  { id: 'notification-settings', label: 'Notifications', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android notification settings are a separate navigation route, never a Chat overlay.', global: true },
  { id: 'session-management', label: 'Manage sessions', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android session management belongs to the separate session-list route.', global: true },
  { id: 'quick-switcher', label: 'Quick switcher', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android switches sessions through its navigation-stack session list.', global: true },
  { id: 'shortcut-help', label: 'Keyboard shortcuts', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android has no keyboard-shortcut overlay.', global: true },
  { id: 'revalidation-ledger', label: 'Validation ledger', classification: 'chat-adjacent', capability: 'always', web: true, android: false, android_na: 'Android validation health is a session-list modal, never a Chat overlay.', global: true },
  { id: 'route-automations', label: 'Automations', classification: 'full-route', capability: 'automation_view', web: true, android: false, android_na: 'Android Automations is launched from Session list and does not replace an active Chat route.' },
  { id: 'route-skills', label: 'Skills', classification: 'full-route', capability: 'skill_list', web: true, android: false, android_na: 'Android Skills is launched from Session list and does not replace an active Chat route.' },
  { id: 'route-usage', label: 'Usage', classification: 'full-route', capability: 'always', web: true, android: true },
  { id: 'route-host-resources', label: 'Host resources', classification: 'full-route', capability: 'always', web: true, android: false, android_na: 'Android Host resources is owned by Session list and does not replace an active Chat route.' },
  { id: 'route-fleet', label: 'Fleet', classification: 'full-route', capability: 'always', web: true, android: false, android_na: 'Android Fleet is owned by Session list and does not replace an active Chat route.' },
  { id: 'route-search', label: 'Transcript search', classification: 'full-route', capability: 'always', web: true, android: false, android_na: 'Android transcript search is owned by Session list and returns to Chat only after result selection.' },
]);

const DEFINITION_BY_ID = new Map(PANE_DEFINITIONS.map(definition => [definition.id, definition]));

function cleanKey(value, fallback) {
  const key = String(value || '').trim();
  return key || fallback;
}

function normalizeAttentionCount(value) {
  const count = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(999, count));
}

function emptyRecord(paneId) {
  return {
    pane_id: paneId,
    state: PANE_CLOSED,
    source_key: '',
    attention_count: 0,
    revision: 0,
    payload: null,
  };
}

function normalizedRecord(paneId, value) {
  const source = value && typeof value === 'object' ? value : {};
  const state = PANE_LIFECYCLE_STATES.includes(source.state) ? source.state : PANE_CLOSED;
  return {
    pane_id: paneId,
    state,
    source_key: String(source.source_key || ''),
    attention_count: normalizeAttentionCount(source.attention_count),
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    payload: source.payload && typeof source.payload === 'object' ? source.payload : null,
  };
}

function normalizedSession(value) {
  const source = value && typeof value === 'object' ? value : {};
  const panes = {};
  for (const [paneId, record] of Object.entries(source.panes || {})) {
    if (!DEFINITION_BY_ID.has(paneId)) continue;
    panes[paneId] = normalizedRecord(paneId, record);
  }
  return { panes };
}

export function createPaneLifecycleLedger(value = null) {
  const source = value && typeof value === 'object' ? value : {};
  const sessions = {};
  for (const [sessionId, session] of Object.entries(source.sessions || {})) {
    sessions[cleanKey(sessionId, GLOBAL_PANE_SESSION)] = normalizedSession(session);
  }
  return { schema_version: 1, sessions };
}

export function paneDefinition(paneId) {
  return DEFINITION_BY_ID.get(String(paneId || '')) || null;
}

export function paneSessionKey(sessionId, paneId = '') {
  const definition = paneDefinition(paneId);
  return definition?.global ? GLOBAL_PANE_SESSION : cleanKey(sessionId, GLOBAL_PANE_SESSION);
}

export function paneRecord(ledger, sessionId, paneId) {
  const id = cleanKey(paneId, '');
  if (!DEFINITION_BY_ID.has(id)) return emptyRecord(id);
  const key = paneSessionKey(sessionId, id);
  return normalizedRecord(id, ledger?.sessions?.[key]?.panes?.[id]);
}

export function paneState(ledger, sessionId, paneId) {
  return paneRecord(ledger, sessionId, paneId).state;
}

export function paneIsMounted(ledger, sessionId, paneId) {
  return paneState(ledger, sessionId, paneId) !== PANE_CLOSED;
}

export function paneIsOpen(ledger, sessionId, paneId) {
  return paneState(ledger, sessionId, paneId) === PANE_OPEN;
}

export function paneRestoreRail(ledger, sessionId) {
  const sessionKeys = [...new Set([
    cleanKey(sessionId, GLOBAL_PANE_SESSION),
    GLOBAL_PANE_SESSION,
  ])];
  return sessionKeys.flatMap(key => Object.values(ledger?.sessions?.[key]?.panes || {}))
    .map(record => normalizedRecord(record.pane_id, record))
    .filter(record => record.state === PANE_MINIMIZED)
    .sort((left, right) => {
      const leftDefinition = paneDefinition(left.pane_id);
      const rightDefinition = paneDefinition(right.pane_id);
      const leftIndex = PANE_DEFINITIONS.indexOf(leftDefinition);
      const rightIndex = PANE_DEFINITIONS.indexOf(rightDefinition);
      return leftIndex - rightIndex || left.pane_id.localeCompare(right.pane_id);
    });
}

function samePayload(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => samePayload(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && samePayload(left[key], right[key]));
}

function sameRecord(left, right) {
  return left.state === right.state
    && left.source_key === right.source_key
    && left.attention_count === right.attention_count
    && samePayload(left.payload, right.payload);
}

function setRecord(ledger, sessionKey, paneId, nextRecord) {
  const previousSession = normalizedSession(ledger?.sessions?.[sessionKey]);
  const previousRecord = normalizedRecord(paneId, previousSession.panes[paneId]);
  const normalizedNext = normalizedRecord(paneId, nextRecord);
  if (sameRecord(previousRecord, normalizedNext)) return ledger;
  const record = {
    ...normalizedNext,
    revision: previousRecord.revision + 1,
  };
  return {
    schema_version: 1,
    sessions: {
      ...(ledger?.sessions || {}),
      [sessionKey]: {
        panes: {
          ...previousSession.panes,
          [paneId]: record,
        },
      },
    },
  };
}

function minimizeCompetingOpenPanes(ledger, sessionKey, exceptPaneId) {
  let next = ledger;
  const panes = ledger?.sessions?.[sessionKey]?.panes || {};
  for (const [paneId, recordValue] of Object.entries(panes)) {
    if (paneId === exceptPaneId) continue;
    const definition = paneDefinition(paneId);
    if (!definition || definition.classification === 'full-route') continue;
    const record = normalizedRecord(paneId, recordValue);
    if (record.state !== PANE_OPEN) continue;
    next = setRecord(next, sessionKey, paneId, { ...record, state: PANE_MINIMIZED });
  }
  return next;
}

export function transitionPaneLifecycle(ledgerValue, transition) {
  const ledger = createPaneLifecycleLedger(ledgerValue);
  const paneId = cleanKey(transition?.pane_id, '');
  const definition = paneDefinition(paneId);
  if (!definition || definition.classification === 'full-route') return ledgerValue || ledger;
  const sessionKey = paneSessionKey(transition?.session_id, paneId);
  const previous = paneRecord(ledger, sessionKey, paneId);
  const action = String(transition?.action || '').toLowerCase();
  const compact = transition?.compact === true;
  let next = ledger;

  if (action === 'open' || action === 'restore') {
    if (compact) next = minimizeCompetingOpenPanes(next, sessionKey, paneId);
    const current = paneRecord(next, sessionKey, paneId);
    return setRecord(next, sessionKey, paneId, {
      ...current,
      state: PANE_OPEN,
      source_key: transition?.source_key == null ? current.source_key : String(transition.source_key),
      attention_count: transition?.attention_count == null
        ? current.attention_count
        : normalizeAttentionCount(transition.attention_count),
      payload: transition?.payload === undefined ? current.payload : transition.payload,
    });
  }
  if (action === 'minimize') {
    if (previous.state === PANE_CLOSED) return ledgerValue || ledger;
    return setRecord(next, sessionKey, paneId, { ...previous, state: PANE_MINIMIZED });
  }
  if (action === 'close' || action === 'resolve') {
    if (previous.state === PANE_CLOSED && !previous.source_key && !previous.payload) return ledgerValue || ledger;
    return setRecord(next, sessionKey, paneId, emptyRecord(paneId));
  }
  if (action === 'update') {
    return setRecord(next, sessionKey, paneId, {
      ...previous,
      source_key: transition?.source_key == null ? previous.source_key : String(transition.source_key),
      attention_count: transition?.attention_count == null
        ? previous.attention_count
        : normalizeAttentionCount(transition.attention_count),
      payload: transition?.payload === undefined ? previous.payload : transition.payload,
    });
  }
  return ledgerValue || ledger;
}

export function synchronizeAuthoritativePane(ledgerValue, update) {
  const paneId = cleanKey(update?.pane_id, '');
  if (!paneDefinition(paneId)) return createPaneLifecycleLedger(ledgerValue);
  const sourceKey = String(update?.source_key || '');
  const previous = paneRecord(ledgerValue, update?.session_id, paneId);
  if (!sourceKey) {
    return transitionPaneLifecycle(ledgerValue, {
      session_id: update?.session_id,
      pane_id: paneId,
      action: 'resolve',
    });
  }
  if (previous.source_key === sourceKey && previous.state !== PANE_CLOSED) {
    return transitionPaneLifecycle(ledgerValue, {
      session_id: update?.session_id,
      pane_id: paneId,
      action: 'update',
      source_key: sourceKey,
      attention_count: update?.attention_count,
      payload: update?.payload,
    });
  }
  return transitionPaneLifecycle(ledgerValue, {
    session_id: update?.session_id,
    pane_id: paneId,
    action: 'open',
    compact: update?.compact === true,
    source_key: sourceKey,
    attention_count: update?.attention_count,
    payload: update?.payload,
  });
}

export function removePaneLifecycleSession(ledgerValue, sessionId) {
  const ledger = createPaneLifecycleLedger(ledgerValue);
  const key = cleanKey(sessionId, '');
  if (!key || !ledger.sessions[key]) return ledgerValue || ledger;
  const sessions = { ...ledger.sessions };
  delete sessions[key];
  return { schema_version: 1, sessions };
}
