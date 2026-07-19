// hooks.jsx — Transport/WebSocket hook (useRelay)
// Loaded via <script type="text/babel"> between markdown.js and app.jsx.
// Owns all wire-protocol logic. Agent 5 UI redesign work should not touch this file.
//
// Handles both protocol v1 messages (session metadata objects, proxy_message, etc.)
// and the legacy wire format so the frontend works with both relay versions.

import { createProvisionalStream, reduceMessageDeltaStream, shouldClearEmptyProvisionalOnTerminal } from './message-delta.js';
import { messageInstant, normalizeMessageTimestamp } from './message-time.js';
import { createStateSequenceGate } from './state-sequence.js';
import {
  createSessionRegistry,
  patchSessionRegistry,
  reconcileSessionRegistry,
  sessionRegistryValueEqual,
} from './session-registry.js';
import {
  getCachedTranscript,
  transcriptStoreView,
  updateTranscriptStore,
} from './transcript-cache.js';
import { normalizeFleetActivityTrace } from './fleet-activity.js';
import { mergeSemanticNotifications } from './semantic-notifications.js';
import { resolveDeliverySession, updateDeliveryMessage } from './delivery-tracking.js';
import { sessionChatTitleMetadataPatch } from './session-title.js';
import { createNavigationEpochGate } from './navigation-epoch.js';
import { latestVisibleMessageSessionPatch } from './recent-chats.js';
import {
  HOST_RESOURCE_COMPACT_HISTORY_LIMIT,
  HOST_RESOURCE_DETAIL_LIMIT,
  HOST_RESOURCE_HISTORY_LIMIT,
  mergeOrderedHostResourceFrames,
} from './host-resources.js';
import { retainNewerProviderUsage } from './provider-usage.js';

const { useState, useEffect, useRef, useCallback } = React;

const DEFAULT_HISTORY_TAIL_LIMIT = 120;
const CODEX_CLI_HISTORY_CHUNK_BYTES = 1024 * 1024;
const HISTORY_CHUNK_TIMEOUT_MS = 15000;
const MAX_HISTORY_CHUNK_RETRIES = 1;
export const CONFIG_CONTROL_TIMEOUT_MS = 15000;
export const DELIVERY_STAGE_TIMEOUT_MS = Object.freeze({
  queued: 10000,
  accepted: 30000,
  launch_accepted: 30000,
  delivered: 30000,
  steered: 30000,
});
export const RELAY_RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 3000];
export const CLIENT_RUNTIME_RECORD_LIMIT = 512;
const STARTUP_DEFERRED_RELAY_TYPES = new Set([
  'history',
  'history_snapshot',
  'history_chunk',
  'transcript_resync_required',
  'chat_list',
]);

export function boundedRecordWith(previous, key, value, limit = CLIENT_RUNTIME_RECORD_LIMIT) {
  const next = { ...(previous || {}) };
  if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
  next[key] = value;
  const keys = Object.keys(next);
  const overflow = keys.length - Math.max(1, Number(limit) || CLIENT_RUNTIME_RECORD_LIMIT);
  for (let index = 0; index < overflow; index += 1) delete next[keys[index]];
  return next;
}

export function hostResourceConsumerDemand(consumers) {
  const entries = consumers instanceof Map ? [...consumers.values()] : Object.values(consumers || {});
  const activeEntries = entries.filter(entry => entry && typeof entry === 'object');
  const detailConsumerCount = activeEntries.filter(entry => entry.aggregateOnly !== true).length;
  return {
    active: activeEntries.length > 0,
    aggregateOnly: detailConsumerCount === 0,
    consumerCount: activeEntries.length,
    detailConsumerCount,
  };
}

function shallowMapMerge(prev, next) {
  const entries = Object.entries(next || {});
  if (!entries.length) return prev;
  let changed = false;
  const merged = { ...prev };
  entries.forEach(([key, value]) => {
    if (Object.is(prev[key], value)) return;
    if (sessionRegistryValueEqual(prev[key] ?? null, value ?? null)) return;
    merged[key] = value;
    changed = true;
  });
  return changed ? merged : prev;
}

export function shouldMergeHistorySnapshot(type, msg, priorHistoryMeta) {
  // Proxy history_snapshot events are authoritative mirrors of the current
  // native transcript. They must replace any optimistic/live deltas already
  // rendered in the browser, even when the session previously loaded a
  // chunked SQLite tail. Inheriting that old chunked mode turns a replacement
  // snapshot into an append and duplicates the just-sent user turn.
  const authoritativeFullSnapshot = (type === 'history_snapshot' || type === 'history')
    && !msg?.partial
    && (!msg?.mode || msg.mode === 'full');
  if (authoritativeFullSnapshot) return false;
  return !!(
    msg?.partial
    || msg?.mode === 'tail'
    || priorHistoryMeta?.mode === 'chunked'
    || priorHistoryMeta?.partial
  );
}

function stableHistoryMessageId(msg) {
  if (!msg) return '';
  if (msg.source_message_id) return `source\u0001${msg.source_message_id}`;
  if (msg.native_source_id) return `native\u0001${msg.native_source_id}`;
  if (msg.id != null) return `id\u0001${msg.id}`;
  if (msg.server_message_id != null) return `server\u0001${msg.server_message_id}`;
  if (msg.sequence != null && msg.ts != null) return `seq\u0001${msg.sequence}\u0001${msg.ts}\u0001${msg.role || ''}`;
  if (msg.client_message_id) return `client\u0001${msg.client_message_id}`;
  if (msg.client_msg_id) return `client\u0001${msg.client_msg_id}`;
  return '';
}

export function historyMessagesOverlapMatch(left, right) {
  if (!left || !right) return false;
  const leftId = stableHistoryMessageId(left);
  const rightId = stableHistoryMessageId(right);
  if (leftId && rightId) return leftId === rightId;
  return left.role === right.role && String(left.content || '') === String(right.content || '');
}

export function preserveOptimisticMessagesAcrossHistory(authoritativeMessages, previousMessages) {
  const source = Array.isArray(authoritativeMessages) ? authoritativeMessages : [];
  const pending = (Array.isArray(previousMessages) ? previousMessages : [])
    .filter(message => message?._optimistic && message?._cid);
  if (pending.length === 0) return source;
  const authoritative = [...source];

  pending.forEach(optimistic => {
    const matchIndex = authoritative.findIndex(message => (
      message?.role === 'user'
      && (
        message.client_message_id === optimistic._cid
        || message.client_msg_id === optimistic._cid
        || String(message.content || '') === String(optimistic.content || '')
      )
    ));
    if (matchIndex >= 0) {
      const authoritativeStatus = authoritative[matchIndex]?.status;
      authoritative[matchIndex] = {
        ...authoritative[matchIndex],
        _cid: optimistic._cid,
        _optimistic: true,
        _delivered: optimistic._delivered || authoritative[matchIndex]._delivered
          || authoritativeStatus === 'delivered' || authoritativeStatus === 'agent_started',
        _agentStarted: optimistic._agentStarted || authoritative[matchIndex]._agentStarted
          || authoritativeStatus === 'agent_started',
        _sendError: authoritativeStatus === 'failed'
          ? (authoritative[matchIndex].failure_code || optimistic._sendError || 'Send failed')
          : (optimistic._sendError || null),
      };
    } else {
      authoritative.push(optimistic);
    }
  });
  return authoritative;
}

export function mergeHistoryTailByOverlap(existing, incoming) {
  const current = Array.isArray(existing) ? existing : [];
  const nextIncoming = Array.isArray(incoming) ? incoming : [];
  if (!current.length) return nextIncoming;
  if (!nextIncoming.length) return current;

  const maxOverlap = Math.min(current.length, nextIncoming.length);
  for (let overlap = maxOverlap; overlap >= 1; overlap--) {
    let matches = true;
    for (let index = 0; index < overlap; index++) {
      if (!historyMessagesOverlapMatch(current[current.length - overlap + index], nextIncoming[index])) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (overlap === nextIncoming.length) return current;
    return [...current, ...nextIncoming.slice(overlap)];
  }
  return null;
}

export function removeSupersededCliTranscriptPlaceholders(messages) {
  const current = Array.isArray(messages) ? messages : [];
  const isPendingPlaceholder = message => {
    const content = String(message?.content || '');
    return /\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.test(content)
      && /placeholder will be replaced with the real CLI chat history/i.test(content);
  };
  if (!current.some(isPendingPlaceholder) || !current.some(message => !isPendingPlaceholder(message))) {
    return current;
  }
  return current.filter(message => !isPendingPlaceholder(message));
}

export function shouldRefreshNativeCliPlaceholder(session, messages) {
  const agentType = session?.agent_type || session?.agentType || '';
  if (agentType !== 'codex_cli' && agentType !== 'cursor_cli') return false;
  if (!Array.isArray(messages) || messages.length !== 1) return false;
  const only = messages[0];
  if (only?.role !== 'assistant') return false;
  return /\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.test(String(only.content || ''));
}

export function sessionMetadataActivityMaps(sessionList, previousActivities = {}) {
  const activities = {};
  const thinkingContent = {};
  const thinking = {};
  (sessionList || []).forEach(session => {
    if (!session || typeof session !== 'object' || !session.session_id || !session.activity) return;
    const kind = session.activity.kind || 'working';
    const label = session.activity.label || (kind === 'idle' ? '' : 'Working');
    activities[session.session_id] = {
      kind,
      label,
      updatedAt: session.activity.updated_at || null,
      observed_at: session.activity.observed_at || previousActivities[session.session_id]?.observed_at || null,
      startedAt: session.activity.started_at || null,
      interruptHint: session.activity.interrupt_hint || '',
      goal: session.activity.goal || null,
      goal_run: session.activity.goal_run || null,
      thinking: session.activity.thinking || null,
      current: session.activity.current || null,
      step: session.activity.step || null,
      usage: session.activity.usage || null,
      task_list: session.activity.task_list || null,
      context_card: session.activity.context_card || null,
      thinkingContent: session.activity.thinking?.text || session.activity.thinkingContent || '',
      transport: session.activity.transport || previousActivities[session.session_id]?.transport || null,
    };
    thinkingContent[session.session_id] = session.activity.thinking?.text || session.activity.thinkingContent || '';
    thinking[session.session_id] = ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(kind)
      ? label
      : false;
  });
  return { activities, thinkingContent, thinking };
}

export function useRelay() {
    const [sessionRegistry, setSessionRegistry] = useState(() => createSessionRegistry());
    const sessions = sessionRegistry.list; // stable structural-sharing projection for existing consumers
    const setSessions = useCallback(updater => {
      setSessionRegistry(previous => {
        const next = typeof updater === 'function' ? updater(previous.list) : updater;
        return reconcileSessionRegistry(previous, next);
      });
    }, []);
    const messages = transcriptStoreView; // external per-session LRU; not a top-level React state map
    const setMessages = updateTranscriptStore;
    const [historyMeta,     setHistoryMeta]     = useState({});   // sessionId -> { partial, loaded, total, limit, mode }
    const [historyLoading,  setHistoryLoading]  = useState({});   // sessionId -> { mode, requestedAt, requestId }
    const [connected,       setConnected]       = useState(false);
    const [connectionHealth, setConnectionHealth] = useState({ state: 'connecting', rttMs: null, lastAckAt: null });
    const [unread,          setUnread]          = useState({});   // sessionId -> count
    const [thinking,        setThinking]        = useState({});   // sessionId -> label string | false
    const [thinkingContent, setThinkingContent] = useState({});   // sessionId -> string (Claude Code thinking text) | ''
    const [activities,      setActivities]      = useState({});   // sessionId -> { kind, label, updatedAt } | false
    const [health,          setHealth]          = useState({});   // sessionId -> 'healthy'|'degraded'|'disconnected'
    const [deliveryStates,  setDeliveryStates]  = useState({});   // includes offline_queued plus relay/native lifecycle states
    const [queuedMessages,  setQueuedMessages]  = useState({});   // sessionId -> [{ cid, content, queuedAt }]
    const [scheduledSends,  setScheduledSends]  = useState([]);   // durable relay jobs owned by this operator
    const [launchStates,      setLaunchStates]      = useState({});   // requestId -> { status:'launching'|'failed', agentType, error? }
    const [justLaunched,      setJustLaunched]      = useState(null); // session_id of most recently launched session (for auto-select)
    const [permissionPrompts, setPermissionPrompts] = useState({});   // session_id -> prompt object (one active prompt per session)
    const [errorPrompts,      setErrorPrompts]      = useState({});   // session_id -> error prompt object
    const [agentConfigs,      setAgentConfigs]      = useState({});   // session_id -> agent_config object { model_id, permission_mode, file_access_scope, capabilities, ... }
    const [workspaces,        setWorkspaces]        = useState([]);   // [{title, path}] — open Antigravity windows for the launch dropdown
    const [chatLists,         setChatLists]         = useState({});   // sessionId -> [{ id, title, active }] — Codex chat/conversation lists
    const [threadLists,       setThreadLists]       = useState({});   // sessionId -> [{ id, title, active }] — Codex Desktop thread lists
    const [terminalOutputs,   setTerminalOutputs]   = useState({});   // sessionId -> [{ command?, output, turnId? }] — Codex terminal output
    const [fileChanges,       setFileChanges]       = useState({});   // sessionId -> [{ file?, content, type }] — Codex file changes/diff
    const [branchLists,       setBranchLists]       = useState({});   // sessionId -> { branches: string[], current: string }
    const [skillLists,        setSkillLists]        = useState({});   // sessionId -> { installed: [...], recommended: [...] }
    const [automationViews,   setAutomationViews]   = useState({});   // sessionId -> Codex Desktop native automation pane snapshot
    const [controlResults,    setControlResults]    = useState({});   // requestId -> latest agent_control_result
    const [configControlStates, setConfigControlStates] = useState({}); // sessionId:field -> pending/ok/failed transaction
    const [directoryListings, setDirectoryListings] = useState({});  // sessionId -> { path, entries }
    const [fileContents,      setFileContents]      = useState({});  // sessionId:path -> { path, content, truncated }
    const [duplicateProxyAlarms, setDuplicateProxyAlarms] = useState([]);
    const [nightlyValidationFailures, setNightlyValidationFailures] = useState([]);
    const [latestAppUpdateValidation, setLatestAppUpdateValidation] = useState(null);
    const [revalidationProgramHealth, setRevalidationProgramHealth] = useState(null);
    const [providerUsage, setProviderUsage] = useState(null);
    const [providerUsageRefreshReceipt, setProviderUsageRefreshReceipt] = useState(null);
    const [providerUsageResetReceipt, setProviderUsageResetReceipt] = useState(null);
    const [providerUsageCostDetail, setProviderUsageCostDetail] = useState(null);
    const [hostResources, setHostResources] = useState(null);
    const [hostResourceError, setHostResourceError] = useState(null);
    const [hostResourceHistory, setHostResourceHistory] = useState([]);
    const [hostResourceDetails, setHostResourceDetails] = useState([]);
    const [hostResourceSubscription, setHostResourceSubscription] = useState({
      id: '', status: 'idle', aggregateOnly: true, resumed: false,
      consumerCount: 0, detailConsumerCount: 0,
    });
    const [provisionalStreams, setProvisionalStreams] = useState({}); // sessionId -> ephemeral assistant stream
    const [semanticNotifications, setSemanticNotifications] = useState([]);

    const thinkingTimers   = useRef({});
    const deliveryTimers   = useRef({});
    const deliveryStatesRef = useRef({});
    const deliverySessionsRef = useRef({});
    const permissionPromptsRef = useRef({});
    const configControlStatesRef = useRef({});
    const configControlTimers = useRef({});
    const agentConfigsRef = useRef({});
    const wsRef            = useRef(null);
    const controlConnectionIdRef = useRef('');
    const sessionSubscriptionsRef = useRef([]);
    const sessionSubscriptionSerial = useRef(0);
    const reconnectAttempt = useRef(0);
    const reconnectTimer   = useRef(null);
    const heartbeatTimer = useRef(null);
    const heartbeatTimeoutTimer = useRef(null);
    const heartbeatPending = useRef(null);
    const heartbeatSequence = useRef(0);
    const heartbeatIntervalMs = useRef(10000);
    const heartbeatTimeoutMs = useRef(30000);
    const offlineSendQueue = useRef([]);
    const activeSessionRef = useRef(null);
    const handleRelayMessageRef = useRef(null);
    const stateSequenceGate = useRef(createStateSequenceGate());
    const navigationEpochGate = useRef(createNavigationEpochGate());
    const historyRequestSerial = useRef(0);
    const latestHistoryRequest = useRef({});
    const historyChunkSerial = useRef(0);
    const latestHistoryChunkRequest = useRef({});
    const historyChunkTimers = useRef({});
    const historyChunkState = useRef({});
    const activeCursorThreadIdentity = useRef({});
    const pendingCursorThreadHistoryReset = useRef({});
    const startupReady = useRef(false);
    const startupDeferredMessages = useRef(new Map());
    const startupDrainHandle = useRef(null);
    const provisionalStreamsRef = useRef({});
    const provisionalFlushHandle = useRef(null);
    const provisionalPendingFlush = useRef(new Map());
    // Host resource resume tokens are requester-scoped and deliberately kept
    // only in memory. They are never written to storage, logs, or transcripts.
    const hostResourceConsumersRef = useRef(new Map());
    const hostResourceDesiredRef = useRef({
      active: false, aggregateOnly: true, consumerCount: 0, detailConsumerCount: 0,
    });
    const hostResourceSubscriptionRef = useRef('');
    const hostResourceActiveModeRef = useRef(true);
    const hostResourceSubscribeRequestRef = useRef('');
    const hostResourceRequestSerial = useRef(0);
    const hostResourceHistoryRequestRef = useRef({ system: '', detail: '' });
    const hostResourceHistoryCursorRef = useRef({ system: 0, detail: 0 });
    const hostResourceLastLiveSequenceRef = useRef({ system: 0, detail: 0 });

    function restoreCachedTranscript(sessionId) {
      const cached = getCachedTranscript(sessionId);
      if (!cached) return false;
      return true;
    }

    function publishProvisionalStream(sessionId, stream, streamTrace = null) {
      provisionalStreamsRef.current = { ...provisionalStreamsRef.current, [sessionId]: stream };
      provisionalPendingFlush.current.set(sessionId, { stream, streamTrace });
      if (provisionalFlushHandle.current != null) return;
      const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : callback => setTimeout(callback, 16);
      provisionalFlushHandle.current = raf(() => {
        provisionalFlushHandle.current = null;
        const pending = [...provisionalPendingFlush.current.entries()];
        provisionalPendingFlush.current.clear();
        if (!pending.length) return;
        setProvisionalStreams(prev => {
          const next = { ...prev };
          pending.forEach(([id, item]) => { next[id] = item.stream; });
          return next;
        });
        pending.forEach(([id, item]) => {
          if (item.streamTrace) recordStreamTraceAfterPaint({ stream_trace: item.streamTrace }, id);
        });
      });
    }

    function openProvisionalStream(sessionId, clientMessageId = null) {
      if (!sessionId) return;
      const existing = provisionalStreamsRef.current[sessionId];
      if (existing?.open) return;
      const stream = createProvisionalStream(sessionId, clientMessageId);
      provisionalStreamsRef.current = { ...provisionalStreamsRef.current, [sessionId]: stream };
      setProvisionalStreams(prev => ({ ...prev, [sessionId]: stream }));
    }

    function clearProvisionalStream(sessionId) {
      if (!sessionId || !provisionalStreamsRef.current[sessionId]) return;
      const nextRef = { ...provisionalStreamsRef.current };
      delete nextRef[sessionId];
      provisionalStreamsRef.current = nextRef;
      provisionalPendingFlush.current.delete(sessionId);
      setProvisionalStreams(prev => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }

    function clearAllProvisionalStreams() {
      provisionalStreamsRef.current = {};
      provisionalPendingFlush.current.clear();
      setProvisionalStreams({});
    }

    function cancelStartupDrain() {
      const pending = startupDrainHandle.current;
      startupDrainHandle.current = null;
      if (!pending) return;
      if (pending.kind === 'idle' && typeof cancelIdleCallback === 'function') cancelIdleCallback(pending.id);
      else clearTimeout(pending.id);
    }

    function scheduleStartupDrain() {
      if (startupDrainHandle.current || startupDeferredMessages.current.size === 0) return;
      const drainOne = () => {
        startupDrainHandle.current = null;
        const iterator = startupDeferredMessages.current.entries().next();
        if (iterator.done) return;
        const [key, deferred] = iterator.value;
        startupDeferredMessages.current.delete(key);
        handleRelayMessageRef.current?.(deferred);
        scheduleStartupDrain();
      };
      if (typeof requestIdleCallback === 'function') {
        startupDrainHandle.current = { kind: 'idle', id: requestIdleCallback(drainOne, { timeout: 250 }) };
      } else {
        startupDrainHandle.current = { kind: 'timer', id: setTimeout(drainOne, 32) };
      }
    }

    function markStartupReadyAfterPaint() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        startupReady.current = true;
        scheduleStartupDrain();
      }));
    }

    const send = useCallback((msg) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    }, []);

    const requestProviderUsageRefresh = useCallback((force = false, providerId = null) => {
      const requestId = `provider-usage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setProviderUsageRefreshReceipt({ requestId, status: 'requested', provider_id: providerId || null });
      send({
        type: 'provider_usage_refresh',
        protocol_version: 1,
        force: force === true,
        ...(providerId ? { provider_id: providerId } : {}),
        request_id: requestId,
      });
      return requestId;
    }, [send]);

    const setProviderUsageWatching = useCallback((active) => {
      send({
        type: 'provider_usage_watch',
        protocol_version: 1,
        active: active === true,
      });
    }, [send]);

    const consumeProviderUsageResetCredit = useCallback(() => {
      const requestId = `provider-reset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setProviderUsageResetReceipt({ requestId, status: 'requested' });
      send({
        type: 'provider_usage_reset_credit_consume',
        protocol_version: 1,
        request_id: requestId,
        approved: true,
      });
      return requestId;
    }, [send]);

    const requestProviderUsageCostDetail = useCallback((options = {}) => {
      const requestId = `provider-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const query = {
        days: Math.max(1, Math.min(365, Number(options.days) || 365)),
        providerId: options.providerId ? String(options.providerId) : '',
        project: options.project ? String(options.project) : '',
        cursor: /^\d+$/.test(String(options.cursor ?? '0')) ? String(options.cursor ?? '0') : '0',
        pageSize: Math.max(1, Math.min(256, Number(options.pageSize) || 256)),
      };
      setProviderUsageCostDetail({ requestId, status: 'loading', query, detail: null, error: null });
      send({
        type: 'provider_usage_cost_detail_request',
        protocol_version: 1,
        request_id: requestId,
        days: query.days,
        provider_id: query.providerId || null,
        project: query.project || null,
        cursor: query.cursor,
        page_size: query.pageSize,
      });
      return requestId;
    }, [send]);

    const requestHostResourceRefresh = useCallback((force = false) => {
      const requestId = `host-resource-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setHostResourceError(null);
      send({
        type: 'host_resource_refresh',
        protocol_version: 1,
        force: force === true,
        aggregate_only: hostResourceDesiredRef.current.aggregateOnly === true,
        request_id: requestId,
      });
      return requestId;
    }, [send]);

    const clearHostResources = useCallback(() => {
      setHostResources(null);
      setHostResourceError(null);
      setHostResourceHistory([]);
      setHostResourceDetails([]);
      hostResourceHistoryCursorRef.current = { system: 0, detail: 0 };
      hostResourceLastLiveSequenceRef.current = { system: 0, detail: 0 };
    }, []);

    const sendHostResourceSubscribe = useCallback((aggregateOnly, resumeSubscriptionId = '') => {
      const requestId = `host-resource-subscribe-${Date.now()}-${++hostResourceRequestSerial.current}`;
      hostResourceSubscribeRequestRef.current = requestId;
      setHostResourceError(null);
      setHostResourceSubscription(previous => ({
        ...previous,
        status: resumeSubscriptionId ? 'reconnecting' : 'subscribing',
        aggregateOnly: aggregateOnly === true,
      }));
      send({
        type: 'host_resource_subscribe',
        protocol_version: 1,
        request_id: requestId,
        ...(resumeSubscriptionId ? { resume_subscription_id: resumeSubscriptionId } : {}),
        aggregate_only: aggregateOnly === true,
      });
      return requestId;
    }, [send]);

    const requestHostResourceHistory = useCallback((stream, afterSequence = 0) => {
      const normalizedStream = stream === 'detail' ? 'detail' : 'system';
      const subscriptionId = hostResourceSubscriptionRef.current;
      if (!subscriptionId) return null;
      const requestId = `host-resource-history-${normalizedStream}-${Date.now()}-${++hostResourceRequestSerial.current}`;
      hostResourceHistoryRequestRef.current[normalizedStream] = requestId;
      send({
        type: 'host_resource_history_request',
        protocol_version: 1,
        request_id: requestId,
        subscription_id: subscriptionId,
        stream: normalizedStream,
        after_sequence: Math.max(0, Math.round(Number(afterSequence) || 0)),
        max_points: normalizedStream === 'detail' ? 8 : 64,
      });
      return requestId;
    }, [send]);

    const reconcileHostResourceConsumers = useCallback(() => {
      const previous = hostResourceDesiredRef.current;
      const next = hostResourceConsumerDemand(hostResourceConsumersRef.current);
      hostResourceDesiredRef.current = next;
      const subscriptionId = hostResourceSubscriptionRef.current;
      if (!next.active) {
        hostResourceSubscriptionRef.current = '';
        hostResourceSubscribeRequestRef.current = '';
        hostResourceHistoryRequestRef.current = { system: '', detail: '' };
        hostResourceActiveModeRef.current = true;
        if (subscriptionId) send({
          type: 'host_resource_unsubscribe', protocol_version: 1,
          request_id: `host-resource-unsubscribe-${Date.now()}-${++hostResourceRequestSerial.current}`,
          subscription_id: subscriptionId,
        });
        clearHostResources();
        setHostResourceSubscription({
          id: '', status: 'idle', aggregateOnly: true, resumed: false,
          consumerCount: 0, detailConsumerCount: 0,
        });
        return null;
      }
      setHostResourceSubscription(current => ({
        ...current,
        aggregateOnly: next.aggregateOnly,
        consumerCount: next.consumerCount,
        detailConsumerCount: next.detailConsumerCount,
      }));
      if (!previous.active) {
        clearHostResources();
        sendHostResourceSubscribe(next.aggregateOnly, '');
        return null;
      }
      if (previous.aggregateOnly === next.aggregateOnly) return subscriptionId || null;
      if (next.aggregateOnly) {
        setHostResourceHistory(current => mergeOrderedHostResourceFrames(
          [], current, HOST_RESOURCE_COMPACT_HISTORY_LIMIT,
        ));
        setHostResourceDetails([]);
        setHostResources(null);
        hostResourceHistoryRequestRef.current.detail = '';
        hostResourceHistoryCursorRef.current.detail = 0;
        hostResourceLastLiveSequenceRef.current.detail = 0;
      }
      // If the first subscribe is still awaiting acknowledgement, the ack
      // handler observes the new desired mode and reconfigures once using the
      // newly assigned subscription ID. This avoids parallel subscriptions.
      if (subscriptionId) sendHostResourceSubscribe(next.aggregateOnly, subscriptionId);
      return subscriptionId || null;
    }, [clearHostResources, send, sendHostResourceSubscribe]);

    const subscribeHostResources = useCallback((aggregateOnly = false, consumerId = 'dashboard') => {
      const normalizedId = String(consumerId || 'dashboard').trim().slice(0, 64) || 'dashboard';
      const normalizedAggregateOnly = aggregateOnly === true;
      const existing = hostResourceConsumersRef.current.get(normalizedId);
      if (existing?.aggregateOnly === normalizedAggregateOnly) return hostResourceSubscriptionRef.current || null;
      hostResourceConsumersRef.current.set(normalizedId, { aggregateOnly: normalizedAggregateOnly });
      return reconcileHostResourceConsumers();
    }, [reconcileHostResourceConsumers]);

    const unsubscribeHostResources = useCallback((consumerId = 'dashboard') => {
      const normalizedId = String(consumerId || 'dashboard').trim().slice(0, 64) || 'dashboard';
      if (!hostResourceConsumersRef.current.delete(normalizedId)) return hostResourceSubscriptionRef.current || null;
      return reconcileHostResourceConsumers();
    }, [reconcileHostResourceConsumers]);

    const setSessionSubscriptions = useCallback((sessionIds) => {
      const normalized = [...new Set((Array.isArray(sessionIds) ? sessionIds : [])
        .filter(id => typeof id === 'string' && id.length > 0))]
        .sort()
        .slice(0, 128);
      if (normalized.length === sessionSubscriptionsRef.current.length
        && normalized.every((id, index) => id === sessionSubscriptionsRef.current[index])) return;
      sessionSubscriptionsRef.current = normalized;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'subscribe',
          protocol_version: 1,
          request_id: `web-sub-${Date.now()}-${++sessionSubscriptionSerial.current}`,
          sessions: normalized,
        }));
      }
    }, []);

    function clearRelayHeartbeat() {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (heartbeatTimeoutTimer.current) clearTimeout(heartbeatTimeoutTimer.current);
      heartbeatTimer.current = null;
      heartbeatTimeoutTimer.current = null;
      heartbeatPending.current = null;
    }

    function sendRelayHeartbeat(ws = wsRef.current) {
      if (!ws || ws.readyState !== WebSocket.OPEN || heartbeatPending.current) return;
      const requestId = `web-hb-${Date.now()}-${++heartbeatSequence.current}`;
      const sentAt = Date.now();
      heartbeatPending.current = { requestId, sentAt };
      ws.send(JSON.stringify({
        type: 'heartbeat', protocol_version: 1, request_id: requestId,
        client_ts: new Date(sentAt).toISOString(),
      }));
      heartbeatTimeoutTimer.current = setTimeout(() => {
        if (heartbeatPending.current?.requestId !== requestId) return;
        heartbeatPending.current = null;
        heartbeatTimeoutTimer.current = null;
        setConnectionHealth({ state: 'stale', rttMs: null, lastAckAt: null });
        try { ws.close(); } catch {}
      }, heartbeatTimeoutMs.current);
    }

    function startRelayHeartbeat(msg, ws = wsRef.current) {
      clearRelayHeartbeat();
      heartbeatIntervalMs.current = Math.max(1000, Number(msg?.heartbeat_interval_ms) || 10000);
      heartbeatTimeoutMs.current = Math.max(
        heartbeatIntervalMs.current * 2,
        Number(msg?.heartbeat_timeout_ms) || 30000,
      );
      sendRelayHeartbeat(ws);
      heartbeatTimer.current = setInterval(() => sendRelayHeartbeat(ws), heartbeatIntervalMs.current);
    }

    function handleHeartbeatAck(msg) {
      const pending = heartbeatPending.current;
      if (!pending || pending.requestId !== msg.request_id) return;
      if (heartbeatTimeoutTimer.current) clearTimeout(heartbeatTimeoutTimer.current);
      heartbeatTimeoutTimer.current = null;
      heartbeatPending.current = null;
      const rttMs = Math.max(0, Date.now() - pending.sentAt);
      const state = rttMs <= 500 ? 'healthy' : rttMs <= 2000 ? 'slow' : 'poor';
      setConnectionHealth({ state, rttMs, lastAckAt: Date.now() });
    }

    function clearDeliveryTimeout(clientMessageId) {
      const timer = deliveryTimers.current[clientMessageId];
      if (timer) clearTimeout(timer);
      delete deliveryTimers.current[clientMessageId];
    }

    function setTrackedDeliveryState(clientMessageId, state) {
      if (!clientMessageId) return;
      if (!Object.prototype.hasOwnProperty.call(deliveryStatesRef.current, clientMessageId)
        && Object.keys(deliveryStatesRef.current).length >= CLIENT_RUNTIME_RECORD_LIMIT) {
        const oldest = Object.keys(deliveryStatesRef.current)[0];
        clearDeliveryTimeout(oldest);
        delete deliverySessionsRef.current[oldest];
      }
      deliveryStatesRef.current = boundedRecordWith(deliveryStatesRef.current, clientMessageId, state);
      setDeliveryStates(prev => boundedRecordWith(prev, clientMessageId, state));
    }

    function trackDeliverySession(clientMessageId, sessionId) {
      if (!clientMessageId || !sessionId) return;
      deliverySessionsRef.current = boundedRecordWith(
        deliverySessionsRef.current,
        clientMessageId,
        sessionId,
      );
    }

    function updateTrackedDeliveryMessage(clientMessageId, sessionHint, updater) {
      if (!clientMessageId) return;
      setMessages(prev => {
        const sessionId = resolveDeliverySession(
          prev,
          clientMessageId,
          sessionHint || deliverySessionsRef.current[clientMessageId] || '',
        );
        if (!sessionId) return prev;
        trackDeliverySession(clientMessageId, sessionId);
        return updateDeliveryMessage(prev, clientMessageId, sessionId, updater);
      });
    }

    function markDeliveryFailed(clientMessageId, reason, sessionId = '') {
      if (!clientMessageId) return;
      if (deliveryStatesRef.current[clientMessageId] === 'agent_started') return;
      clearDeliveryTimeout(clientMessageId);
      setTrackedDeliveryState(clientMessageId, 'failed');
      updateTrackedDeliveryMessage(clientMessageId, sessionId, message => ({
        ...message,
        _sendError: reason || 'Send failed',
      }));
    }

    function armDeliveryTimeout(clientMessageId, stage, reason) {
      clearDeliveryTimeout(clientMessageId);
      const timeoutMs = DELIVERY_STAGE_TIMEOUT_MS[stage];
      if (!timeoutMs) return;
      deliveryTimers.current[clientMessageId] = setTimeout(() => {
        delete deliveryTimers.current[clientMessageId];
        if (deliveryStatesRef.current[clientMessageId] !== stage) return;
        markDeliveryFailed(clientMessageId, reason);
      }, timeoutMs);
    }

    useEffect(() => { agentConfigsRef.current = agentConfigs; }, [agentConfigs]);
    useEffect(() => { permissionPromptsRef.current = permissionPrompts; }, [permissionPrompts]);

    function configControlKey(sessionId, field) {
      return `${sessionId}:${field}`;
    }

    function setConfigControlState(key, value) {
      if (!Object.prototype.hasOwnProperty.call(configControlStatesRef.current, key)
        && Object.keys(configControlStatesRef.current).length >= CLIENT_RUNTIME_RECORD_LIMIT) {
        clearConfigControlTimer(Object.keys(configControlStatesRef.current)[0]);
      }
      configControlStatesRef.current = boundedRecordWith(configControlStatesRef.current, key, value);
      setConfigControlStates(configControlStatesRef.current);
    }

    function clearConfigControlTimer(key) {
      const timer = configControlTimers.current[key];
      if (timer) clearTimeout(timer);
      delete configControlTimers.current[key];
    }

    function rollbackConfigControl(key, error) {
      const transaction = configControlStatesRef.current[key];
      if (!transaction || !['pending', 'awaiting_config'].includes(transaction.status)) return;
      clearConfigControlTimer(key);
      const current = agentConfigsRef.current[transaction.sessionId] || {};
      const restored = { ...current, [transaction.configKey]: transaction.previousValue };
      agentConfigsRef.current = { ...agentConfigsRef.current, [transaction.sessionId]: restored };
      setAgentConfigs(prev => ({
        ...prev,
        [transaction.sessionId]: { ...(prev[transaction.sessionId] || {}), [transaction.configKey]: transaction.previousValue },
      }));
      setConfigControlState(key, { ...transaction, status: 'failed', error: error || 'Control change failed and was rolled back.', completedAt: Date.now() });
    }

    function submitConfigControl(sessionId, field, configKey, requestedValue, payload, requestId) {
      const key = configControlKey(sessionId, field);
      clearConfigControlTimer(key);
      const current = agentConfigsRef.current[sessionId] || {};
      const transaction = {
        sessionId, field, configKey, requestId,
        previousValue: current[configKey], requestedValue,
        status: 'pending', error: null, startedAt: Date.now(),
      };
      const optimistic = { ...current, [configKey]: requestedValue };
      agentConfigsRef.current = { ...agentConfigsRef.current, [sessionId]: optimistic };
      setAgentConfigs(prev => ({ ...prev, [sessionId]: { ...(prev[sessionId] || {}), [configKey]: requestedValue } }));
      setConfigControlState(key, transaction);
      configControlTimers.current[key] = setTimeout(
        () => rollbackConfigControl(key, 'Timed out waiting for the agent to confirm this setting.'),
        CONFIG_CONTROL_TIMEOUT_MS,
      );
      send({ ...payload, session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function reconcileConfigControls(sessionId, configMessage) {
      Object.entries(configControlStatesRef.current).forEach(([key, transaction]) => {
        if (transaction.sessionId !== sessionId || !['pending', 'awaiting_config'].includes(transaction.status)) return;
        if (!Object.prototype.hasOwnProperty.call(configMessage, transaction.configKey)) return;
        if (configMessage[transaction.configKey] !== transaction.requestedValue) return;
        clearConfigControlTimer(key);
        setConfigControlState(key, { ...transaction, status: 'ok', error: null, completedAt: Date.now() });
      });
    }

    const connect = useCallback(() => {
      cancelStartupDrain();
      startupReady.current = false;
      startupDeferredMessages.current.clear();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws    = new WebSocket(`${proto}://${location.host}/client-ws`);
      wsRef.current = ws;

      ws.onopen  = () => {
        reconnectAttempt.current = 0;
        setConnected(true);
        setConnectionHealth({ state: 'connecting', rttMs: null, lastAckAt: null });
        ws.send(JSON.stringify({
          type: 'subscribe',
          protocol_version: 1,
          request_id: `web-sub-${Date.now()}-${++sessionSubscriptionSerial.current}`,
          sessions: sessionSubscriptionsRef.current,
        }));
        if (hostResourceDesiredRef.current.active) {
          sendHostResourceSubscribe(
            hostResourceDesiredRef.current.aggregateOnly,
            hostResourceSubscriptionRef.current,
          );
        }
      };
      ws.onclose = () => {
        clearRelayHeartbeat();
        Object.entries(configControlStatesRef.current).forEach(([key, transaction]) => {
          if (['pending', 'awaiting_config'].includes(transaction?.status)) {
            rollbackConfigControl(key, 'Connection changed before the native setting was confirmed. Retry after reconnecting.');
          }
        });
        Object.values(historyChunkTimers.current).forEach(timer => clearTimeout(timer));
        historyChunkTimers.current = {};
        Object.keys(historyChunkState.current).forEach(id => {
          historyChunkState.current[id] = {
            ...(historyChunkState.current[id] || {}),
            inFlight: false,
          };
        });
        setHistoryLoading({});
        clearAllProvisionalStreams();
        setConnected(false);
        setConnectionHealth({ state: 'offline', rttMs: null, lastAckAt: null });
        if (hostResourceDesiredRef.current.active) {
          setHostResourceSubscription(previous => ({ ...previous, status: 'reconnecting' }));
        }
        if (wsRef.current !== ws) return;
        const attempt = reconnectAttempt.current++;
        const delay = RELAY_RECONNECT_DELAYS_MS[Math.min(attempt, RELAY_RECONNECT_DELAYS_MS.length - 1)];
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          connect();
        }, delay);
      };

      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.stream_trace && typeof msg.stream_trace === 'object') {
          msg.stream_trace = { ...msg.stream_trace, browser_received_at_ms: Date.now() };
        }
        handleRelayMessageRef.current(msg);
      };
    }, [send, sendHostResourceSubscribe]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      connect();
      return () => {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        clearRelayHeartbeat();
        Object.values(deliveryTimers.current).forEach(timer => clearTimeout(timer));
        deliveryTimers.current = {};
        Object.values(configControlTimers.current).forEach(timer => clearTimeout(timer));
        configControlTimers.current = {};
        cancelStartupDrain();
        if (provisionalFlushHandle.current != null) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(provisionalFlushHandle.current);
          else clearTimeout(provisionalFlushHandle.current);
          provisionalFlushHandle.current = null;
        }
        provisionalPendingFlush.current.clear();
        const current = wsRef.current;
        wsRef.current = null;
        try { current?.close(); } catch {}
      };
    }, [connect]);

    function mergeSessionMetadataActivity(sessionList) {
      const normalized = sessionMetadataActivityMaps(sessionList);
      setActivities(prev => shallowMapMerge(
        prev,
        sessionMetadataActivityMaps(sessionList, prev).activities,
      ));
      setThinkingContent(prev => shallowMapMerge(prev, normalized.thinkingContent));
      setThinking(prev => shallowMapMerge(prev, normalized.thinking));
    }

    function clearRemovedSessionActivity(sessionList) {
      const liveIds = new Set((sessionList || []).map(session => (
        session && typeof session === 'object' ? session.session_id : session
      )).filter(Boolean));
      const retainLive = previous => {
        let changed = false;
        const next = { ...previous };
        Object.keys(next).forEach(id => {
          if (liveIds.has(id)) return;
          delete next[id];
          changed = true;
        });
        return changed ? next : previous;
      };
      Object.keys(thinkingTimers.current).forEach(id => {
        if (liveIds.has(id)) return;
        clearTimeout(thinkingTimers.current[id]);
        delete thinkingTimers.current[id];
      });
      [
        latestHistoryRequest,
        latestHistoryChunkRequest,
        historyChunkState,
        activeCursorThreadIdentity,
        pendingCursorThreadHistoryReset,
      ].forEach(ref => {
        Object.keys(ref.current).forEach(id => {
          if (!liveIds.has(id)) delete ref.current[id];
        });
      });
      Object.keys(provisionalStreamsRef.current).forEach(id => {
        if (!liveIds.has(id)) delete provisionalStreamsRef.current[id];
      });
      for (const id of provisionalPendingFlush.current.keys()) {
        if (!liveIds.has(id)) provisionalPendingFlush.current.delete(id);
      }
      Object.keys(historyChunkTimers.current).forEach(id => {
        if (liveIds.has(id)) return;
        clearTimeout(historyChunkTimers.current[id]);
        delete historyChunkTimers.current[id];
      });
      let configChanged = false;
      Object.entries(configControlStatesRef.current).forEach(([key, transaction]) => {
        if (liveIds.has(transaction?.sessionId)) return;
        clearConfigControlTimer(key);
        delete configControlStatesRef.current[key];
        configChanged = true;
      });
      if (configChanged) setConfigControlStates({ ...configControlStatesRef.current });
      setActivities(retainLive);
      setThinkingContent(retainLive);
      setThinking(retainLive);
      setHistoryMeta(retainLive);
      setHistoryLoading(retainLive);
      setUnread(retainLive);
      setHealth(retainLive);
      setQueuedMessages(retainLive);
      setPermissionPrompts(retainLive);
      setErrorPrompts(retainLive);
      setAgentConfigs(retainLive);
      setChatLists(retainLive);
      setThreadLists(retainLive);
      setTerminalOutputs(retainLive);
      setFileChanges(retainLive);
      setBranchLists(retainLive);
      setSkillLists(retainLive);
      setAutomationViews(retainLive);
      setDirectoryListings(retainLive);
      setProvisionalStreams(retainLive);
      setFileContents(previous => {
        let changed = false;
        const next = { ...previous };
        Object.keys(next).forEach(key => {
          const separator = key.indexOf(':');
          const sessionId = separator >= 0 ? key.slice(0, separator) : key;
          if (liveIds.has(sessionId)) return;
          delete next[key];
          changed = true;
        });
        return changed ? next : previous;
      });
    }

    function mergeSessionConfigHints(sessionList) {
      const next = {};
      (sessionList || []).forEach(session => {
        if (!session || typeof session !== 'object' || !session.session_id) return;
        if (typeof session.auto_approve_permissions !== 'boolean') return;
        next[session.session_id] = { auto_approve_permissions: session.auto_approve_permissions };
      });
      if (Object.keys(next).length > 0) {
        setAgentConfigs(prev => {
          let changed = false;
          const merged = { ...prev };
          Object.entries(next).forEach(([sid, hints]) => {
            const nextCfg = { ...(merged[sid] || {}), ...hints };
            if (sessionRegistryValueEqual(merged[sid] || {}, nextCfg)) return;
            merged[sid] = nextCfg;
            changed = true;
          });
          return changed ? merged : prev;
        });
      }
    }

    function mergeSessionChatLists(sessionList) {
      const next = {};
      (sessionList || []).forEach(session => {
        if (!session || typeof session !== 'object' || !session.session_id) return;
        if (Array.isArray(session.chat_list)) next[session.session_id] = session.chat_list;
      });
      setChatLists(prev => shallowMapMerge(prev, next));
    }

    function mergeSessionHealth(sessionList) {
      const next = {};
      (sessionList || []).forEach(session => {
        if (!session || typeof session !== 'object' || !session.session_id) return;
        if (!session.status) return;
        next[session.session_id] = session.status;
      });
      setHealth(prev => shallowMapMerge(prev, next));
    }

    function requestHistory(sessionOrId, options = {}) {
      const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.session_id;
      if (!id) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const requestId = `hist-${Date.now()}-${++historyRequestSerial.current}`;
      latestHistoryRequest.current[id] = requestId;
      const afterSequence = Math.max(0, Math.floor(Number(options.afterSequence ?? options.after_sequence) || 0));
      const mode = afterSequence > 0 ? 'delta' : (options.full ? 'full' : 'tail');
      setHistoryLoading(prev => ({
        ...prev,
        [id]: { mode, requestedAt: Date.now(), requestId },
      }));
      const payload = {
        type: afterSequence > 0 ? 'history_request' : 'get_history',
        session: id,
        session_id: id,
        request_id: requestId,
      };
      if (afterSequence > 0) payload.after_sequence = afterSequence;
      const limit = Number(options.limit || options.tailLimit || 0);
      if (afterSequence <= 0 && Number.isFinite(limit) && limit > 0 && !options.full) {
        payload.limit = Math.floor(limit);
        payload.tail = true;
      }
      if (options.full) payload.full = true;
      send(payload);
    }

    function requestHistoryChunk(sessionOrId, options = {}) {
      const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.session_id;
      if (!id) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const mode = options.mode === 'older' ? 'older' : options.mode === 'around' ? 'around' : 'tail';
      const source = options.source || 'relay_sqlite';
      const replace = mode === 'around' || (mode === 'tail' && options.replace !== false);
      const beforeOffset = options.beforeOffset ?? options.before_offset ?? null;
      const beforeId = options.beforeId ?? options.before_id ?? null;
      const aroundId = options.aroundId ?? options.around_id ?? null;
      const requestCursorSig = `${mode}\u0001${source}\u0001${beforeOffset ?? ''}\u0001${beforeId ?? ''}\u0001${aroundId ?? ''}`;
      const currentChunkState = historyChunkState.current[id] || {};
      const nowMs = Date.now();
      // An explicit search deep-link must supersede an automatic tail hydration;
      // otherwise a large initial tail can strand the user at the newest row.
      if (currentChunkState.inFlight && mode !== 'around') return;
      if (
        mode === 'older'
        && currentChunkState.lastRequestSig === requestCursorSig
        && nowMs - Number(currentChunkState.lastRequestAt || 0) < 1500
      ) {
        return;
      }
      const requestId = `histchunk-${Date.now()}-${++historyChunkSerial.current}`;
      const chunkBytes = Math.max(256 * 1024, Math.min(16 * 1024 * 1024, Number(options.chunkBytes || options.chunk_bytes || CODEX_CLI_HISTORY_CHUNK_BYTES) || CODEX_CLI_HISTORY_CHUNK_BYTES));
      if (mode !== 'older') {
        const retryBaselineKeys = Number(options.retryAttempt || 0) > 0
          ? currentChunkState.baselineMessageKeys
          : null;
        const baselineMessageKeys = Array.isArray(retryBaselineKeys)
          ? retryBaselineKeys
          : (messages[id] || []).map(messageDedupeKey).filter(Boolean);
        clearTimeout(historyChunkTimers.current[id]);
        historyChunkState.current[id] = {
          source,
          chunkBytes,
          limit: options.limit || null,
          inFlight: true,
          mode,
          replace,
          baselineMessageKeys,
          lastRequestSig: requestCursorSig,
          lastRequestAt: nowMs,
        };
      } else {
        historyChunkState.current[id] = { ...(historyChunkState.current[id] || {}), source, chunkBytes, limit: options.limit || historyChunkState.current[id]?.limit || null, inFlight: true, mode, lastRequestSig: requestCursorSig, lastRequestAt: nowMs };
      }
      latestHistoryChunkRequest.current[id] = requestId;
      setHistoryMeta(prev => {
        if (!prev[id]?.error) return prev;
        const nextMeta = { ...prev[id] };
        delete nextMeta.error;
        return { ...prev, [id]: nextMeta };
      });
      setHistoryLoading(prev => ({
        ...prev,
        [id]: { mode, kind: 'chunked', requestedAt: Date.now(), requestId },
      }));
      const payload = {
        type: 'history_chunk_request',
        session: id,
        session_id: id,
        request_id: requestId,
        mode,
        source,
        replace,
        chunk_bytes: chunkBytes,
      };
      const limit = Number(options.limit || options.tailLimit || 0);
      if (Number.isFinite(limit) && limit > 0) payload.limit = Math.floor(limit);
      if (options.userInitiated || options.user_initiated) payload.user_initiated = true;
      if (mode === 'older' && beforeOffset != null) payload.before_offset = beforeOffset;
      if (mode === 'older' && beforeId != null) payload.before_id = beforeId;
      if (mode === 'around' && aroundId != null) payload.around_id = aroundId;
      send(payload);
      historyChunkTimers.current[id] = setTimeout(() => {
        delete historyChunkTimers.current[id];
        if (latestHistoryChunkRequest.current[id] !== requestId) return;
        const latestState = historyChunkState.current[id] || {};
        if (!latestState.inFlight) return;
        historyChunkState.current[id] = { ...latestState, inFlight: false };

        const retryAttempt = Number(options.retryAttempt || 0);
        if (retryAttempt < MAX_HISTORY_CHUNK_RETRIES && wsRef.current?.readyState === WebSocket.OPEN) {
          requestHistoryChunk(id, {
            ...options,
            mode,
            source,
            beforeOffset,
            beforeId,
            chunkBytes,
            retryAttempt: retryAttempt + 1,
          });
          return;
        }

        setHistoryLoading(prev => {
          if (prev[id]?.requestId !== requestId) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setHistoryMeta(prev => ({
          ...prev,
          [id]: {
            ...(prev[id] || {}),
            error: 'Transcript history request timed out. Retry to load the latest messages.',
          },
        }));
      }, HISTORY_CHUNK_TIMEOUT_MS);
    }

    function messageDedupeKey(msg) {
      if (!msg) return '';
      if (msg.source_message_id) return `source\u0001${msg.source_message_id}`;
      if (msg.native_source_id) return `native\u0001${msg.native_source_id}`;
      if (msg.id != null) return `id\u0001${msg.id}`;
      if (msg.server_message_id != null) return `server\u0001${msg.server_message_id}`;
      if (msg.sequence != null && msg.ts != null) return `seq\u0001${msg.sequence}\u0001${msg.ts}\u0001${msg.role || ''}`;
      if (msg.client_msg_id) return `client\u0001${msg.client_msg_id}`;
      const blocks = Array.isArray(msg.content_blocks) ? JSON.stringify(msg.content_blocks) : '';
      return `${msg.role || ''}\u0001${msg.content || ''}\u0001${blocks}`;
    }

    function mergeHistoryChunk(existing, incoming, mode) {
      const current = Array.isArray(existing) ? existing : [];
      const nextIncoming = Array.isArray(incoming) ? incoming : [];
      if (mode === 'older') {
        const seen = new Set(current.map(messageDedupeKey));
        const older = [];
        nextIncoming.forEach(msg => {
          const key = messageDedupeKey(msg);
          if (seen.has(key)) return;
          seen.add(key);
          older.push(msg);
        });
        return older.length ? [...older, ...current] : current;
      }
      const overlapMerged = mergeHistoryTailByOverlap(current, nextIncoming);
      if (overlapMerged) return overlapMerged;
      const seen = new Set(current.map(messageDedupeKey));
      const merged = [...current];
      let added = 0;
      nextIncoming.forEach(msg => {
        const key = messageDedupeKey(msg);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(msg);
        added++;
      });
      return added ? merged : current;
    }

    function mergeHistoryTailSnapshot(existing, incoming) {
      const current = Array.isArray(existing) ? existing : [];
      const nextIncoming = Array.isArray(incoming) ? incoming : [];
      if (!current.length) return nextIncoming;
      if (!nextIncoming.length) return current;
      const overlapMerged = mergeHistoryTailByOverlap(current, nextIncoming);
      if (overlapMerged) return overlapMerged;
      const seen = new Set(current.map(messageDedupeKey));
      const merged = [...current];
      let added = 0;
      nextIncoming.forEach(msg => {
        const key = messageDedupeKey(msg);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(msg);
        added++;
      });
      return added ? merged : current;
    }

    function reconcileHistoryTailReplacement(existing, incoming, chunkState, responseSource) {
      const current = Array.isArray(existing) ? existing : [];
      const nextIncoming = Array.isArray(incoming) ? incoming : [];
      const baselineKeys = new Set(Array.isArray(chunkState?.baselineMessageKeys)
        ? chunkState.baselineMessageKeys
        : []);
      const nativeSource = chunkState?.source === 'native'
        || responseSource === 'codex_cli_jsonl'
        || responseSource === 'cursor_cli_jsonl';
      if (nativeSource && baselineKeys.size > nextIncoming.length) return current;
      const arrivedAfterRequest = current.filter(message => {
        const key = messageDedupeKey(message);
        return key && !baselineKeys.has(key);
      });
      if (arrivedAfterRequest.length === 0) return nextIncoming;
      return mergeHistoryChunk(nextIncoming, arrivedAfterRequest, 'tail');
    }

    function shouldPreserveTranscriptInListView(session) {
      if (!session || typeof session !== 'object') return false;
      return ['codex', 'codex-desktop', 'cursor', 'codex_cli', 'cursor_cli', 'roo_code', 'cline'].includes(session.agent_type);
    }

    function clearSessionTranscript(sessionId) {
      if (!sessionId) return;
      setMessages(prev => ({ ...prev, [sessionId]: [] }));
      setQueuedMessages(prev => ({ ...prev, [sessionId]: [] }));
      setThinking(prev => ({ ...prev, [sessionId]: false }));
      setThinkingContent(prev => ({ ...prev, [sessionId]: '' }));
      setActivities(prev => ({ ...prev, [sessionId]: false }));
      setHistoryMeta(prev => ({ ...prev, [sessionId]: null }));
      setHistoryLoading(prev => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }

    // Responds to a permission prompt.
    function respondToPrompt(sessionId, promptId, choiceId, details = {}) {
      const requestId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const instruction = typeof details.instruction === 'string' ? details.instruction.trim() : '';
      const prompt = permissionPromptsRef.current[sessionId];
      const firstClassQuestion = prompt?.type === 'question_prompt';
      const questionAction = details.action === 'cancel' ? 'cancel' : 'answer';
      const submittingChoiceId = choiceId || (questionAction === 'cancel'
        ? 'question_cancel' : (Array.isArray(details.answers)
          ? 'question_answers' : (instruction ? 'alternate_instruction' : null)));
      setPermissionPrompts(prev => prev[sessionId]
        ? { ...prev, [sessionId]: { ...prev[sessionId], submitting_choice_id: submittingChoiceId, request_id: requestId, error: null } }
        : prev);
      if (firstClassQuestion) {
        send({
          type: 'question_response', session_id: sessionId, prompt_id: promptId,
          generation: prompt.generation, action: questionAction,
          ...(questionAction === 'answer' ? { answers: details.answers || [] } : {}),
          request_id: requestId,
        });
      } else {
        send({
          type: 'permission_response', session_id: sessionId, prompt_id: promptId,
          ...(choiceId ? { choice_id: choiceId } : {}),
          ...(Array.isArray(details.answers) ? { answers: details.answers } : {}),
          ...(instruction ? { instruction } : {}),
          request_id: requestId,
        });
      }
    }

    function respondToErrorPrompt(sessionId, promptId, actionId, operatorEvent) {
      const requestId = `errprompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setErrorPrompts(prev => prev[sessionId]
        ? { ...prev, [sessionId]: { ...prev[sessionId], submitting_action_id: actionId, request_id: requestId, error: null } }
        : prev);
      send({
        type: 'error_prompt_action', session_id: sessionId, prompt_id: promptId,
        action_id: actionId, request_id: requestId,
        ...(actionId === 'open_native_window'
          ? { operator_user_gesture: operatorEvent?.isTrusted === true } : {}),
      });
    }

    function interruptSession(sessionId, options = {}) {
      const requestId = `interrupt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({
        type: 'agent_interrupt',
        session_id: sessionId,
        request_id: requestId,
        connection_id: controlConnectionIdRef.current,
        session_generation: Math.max(0, Number(options.sessionGeneration) || 0),
        turn_generation: Math.max(0, Number(options.turnGeneration) || 0),
      });
      return requestId;
    }

    function controlGoal(sessionId, action, goal, options = {}) {
      const requestId = `goal-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({
        type: 'agent_goal_control',
        session_id: sessionId,
        request_id: requestId,
        action,
        connection_id: controlConnectionIdRef.current,
        session_generation: Math.max(0, Number(options.sessionGeneration) || 0),
        goal_generation: Math.max(0, Number(goal?.generation) || 0),
        goal_transition_seq: Math.max(0, Number(goal?.transition_seq) || 0),
        goal_fingerprint: String(goal?.fingerprint || ''),
      });
      return requestId;
    }

    function requestAgentConfig(sessionId) {
      const requestId = `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'agent_config_request', session_id: sessionId, request_id: requestId });
    }

    function setAgentModel(sessionId, modelId) {
      const requestId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const config = agentConfigsRef.current[sessionId] || {};
      const configKey = config.config_semantics === 'observed_and_next_send' ? 'next_send_model_id' : 'model_id';
      return submitConfigControl(sessionId, 'model', configKey, modelId, { type: 'agent_set_model', model_id: modelId }, requestId);
    }

    function setAgentEffort(sessionId, effort) {
      const requestId = `effort-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const config = agentConfigsRef.current[sessionId] || {};
      const configKey = config.config_semantics === 'observed_and_next_send' ? 'next_send_effort' : 'effort';
      return submitConfigControl(sessionId, 'effort', configKey, effort, { type: 'agent_set_effort', effort }, requestId);
    }

    function setAgentPermissionMode(sessionId, mode) {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return submitConfigControl(sessionId, 'permission_mode', 'permission_mode', mode, { type: 'agent_set_permission_mode', mode }, requestId);
    }

    function setAutoApprovePermissions(sessionId, enabled) {
      const requestId = `autoperm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return submitConfigControl(sessionId, 'auto_approve_permissions', 'auto_approve_permissions', !!enabled, { type: 'agent_set_auto_approve_permissions', enabled: !!enabled }, requestId);
    }

    function setAntigravityMode(sessionId, mode) {
      const requestId = `mode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const configKey = Object.prototype.hasOwnProperty.call(agentConfigsRef.current[sessionId] || {}, 'conversation_mode') ? 'conversation_mode' : 'mode';
      return submitConfigControl(sessionId, 'mode', configKey, mode, { type: 'agent_set_mode', mode }, requestId);
    }

    function setCodexConfig(sessionId, {
      model_id,
      effort,
      speed,
      access_mode,
      permission_profile,
      confirm_bypass,
      workspace_mode,
    }) {
      const requestId = `codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const config = agentConfigsRef.current[sessionId] || {};
      const options = [
        ['model', 'model_id', model_id], ['effort', 'effort', effort], ['speed', 'speed', speed],
        ['access_mode', 'permission_mode', access_mode], ['workspace_mode', 'workspace_mode', workspace_mode],
        ['permission_profile', 'permission_profile', permission_profile],
      ];
      const [field, configKey, requestedValue] = options.find(([, , value]) => value != null) || ['codex_config', 'model_id', model_id];
      return submitConfigControl(sessionId, field, configKey, requestedValue, {
        type: 'set_codex_config',
        model_id,
        effort,
        speed,
        access_mode,
        permission_profile,
        confirm_bypass,
        workspace_mode,
        source_revision: config.source_revision,
      }, requestId);
    }

    function newThread(sessionId) {
      const requestId = `new-thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      clearSessionTranscript(sessionId);
      send({ type: 'new_thread', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function openPanel(sessionId) {
      const requestId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'open_panel', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function openNativeWindow(sessionId, operatorEvent) {
      const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({
        type: 'open_native_window', session_id: sessionId, request_id: requestId,
        operator_user_gesture: operatorEvent?.isTrusted === true,
      });
      return requestId;
    }

    function requestChatList(sessionId) {
      const requestId = `chatlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'chat_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function switchChat(sessionId, chatId) {
      const requestId = `switch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'switch_chat', session_id: sessionId, chat_id: chatId, request_id: requestId });
      return requestId;
    }

    function newChat(sessionId) {
      const requestId = `newchat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'new_chat', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function requestThreadList(sessionId) {
      const requestId = `threads-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'thread_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function switchThread(sessionId, threadId) {
      const requestId = `swthread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      clearSessionTranscript(sessionId);
      send({ type: 'switch_thread', session_id: sessionId, thread_id: threadId, request_id: requestId });
      return requestId;
    }

    function requestTerminalOutput(sessionId) {
      const requestId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'terminal_output', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function sendTerminalInput(sessionId, text) {
      const requestId = `termin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'terminal_input', session_id: sessionId, request_id: requestId, text });
      return requestId;
    }

    function requestFileChanges(sessionId) {
      const requestId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'file_changes', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function respondToFileChange(sessionId, changeId, action) {
      const requestId = `filechg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({
        type: 'file_change_response',
        session_id: sessionId,
        change_id: changeId,
        action,
        request_id: requestId,
      });
      return requestId;
    }

    function requestDirectoryListing(sessionId, dirPath) {
      const requestId = `dir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'list_directory', session_id: sessionId, request_id: requestId, path: dirPath || '.' });
      return requestId;
    }

    function requestFileContent(sessionId, filePath) {
      const requestId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'read_file', session_id: sessionId, request_id: requestId, path: filePath });
      return requestId;
    }

    function requestSkillList(sessionId) {
      const requestId = `skills-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'skill_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function showCodexAutomation(sessionId) {
      const requestId = `automation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'automation_view_action', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function sendAttachment(sessionId, base64Data, mimeType, filename) {
      const requestId = `attach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'send_attachment', session_id: sessionId, request_id: requestId, data: base64Data, mime_type: mimeType, filename: filename });
      return requestId;
    }

    function switchWorkspace(sessionId, folderPath) {
      const requestId = `swws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return submitConfigControl(sessionId, 'workspace', 'file_access_scope', folderPath, { type: 'switch_workspace', folder_path: folderPath }, requestId);
    }

    function requestBranchList(sessionId) {
      const requestId = `branches-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'branch_list', session_id: sessionId, request_id: requestId });
      return requestId;
    }

    function switchBranch(sessionId, branchName) {
      const requestId = `swbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'switch_branch', session_id: sessionId, branch_name: branchName, request_id: requestId });
      return requestId;
    }

    function createBranch(sessionId, branchName) {
      const requestId = `newbranch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      send({ type: 'create_branch', session_id: sessionId, branch_name: branchName, request_id: requestId });
      return requestId;
    }

    // Launches a new agent session. Returns the requestId.
    function launchSession(agentType, workspacePath, options = {}) {
      const requestId = `launch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLaunchStates(prev => boundedRecordWith(prev, requestId, { status: 'launching', agentType }));
      send({
        type: 'launch_session',
        agent_type: agentType,
        workspace_path: workspacePath || undefined,
        model_id: options.model_id || undefined,
        permission_mode: options.permission_mode || undefined,
        effort: options.effort || undefined,
        request_id: requestId,
      });
      return requestId;
    }

    // Resumes an old session by launching a new agent and replaying history.
    // For Cursor/Codex/Claude CLI, pass cli_session_id so the proxy resumes the
    // same native chat instead of creating a brand-new one.
    function resumeSession(sourceSession, agentType, workspacePath, options = {}) {
      const requestId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLaunchStates(prev => boundedRecordWith(prev, requestId, { status: 'launching', agentType }));
      send({
        type: 'resume_session',
        source_session: sourceSession,
        agent_type: agentType || 'claude',
        workspace_path: workspacePath || undefined,
        cli_session_id: options.cli_session_id || undefined,
        model_id: options.model_id || undefined,
        permission_mode: options.permission_mode || undefined,
        request_id: requestId,
      });
      return requestId;
    }

    // Closes an existing session. For disconnected/orphaned sessions, sends
    // dismiss_session so the relay removes it from the sidebar immediately.
    function closeSession(sessionId, isDisconnected) {
      if (isDisconnected) {
        send({ type: 'dismiss_session', session: sessionId });
      } else {
        send({ type: 'close_session', session: sessionId });
      }
    }

    // Sends a user message with delivery tracking. Returns the clientMsgId.
    function sendToSession(session, content, retryClientMessageId = '') {
      const cid = retryClientMessageId || `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      trackDeliverySession(cid, session);
      const retryMessage = retryClientMessageId
        ? (transcriptStoreView[session] || []).find(message => message._cid === cid)
        : null;
      const createdAt = messageInstant(retryMessage)?.iso || new Date().toISOString();
      setMessages(prev => {
        const existing = prev[session] || [];
        const hasRetryTarget = retryClientMessageId && existing.some(message => message._cid === cid);
        return {
          ...prev,
          [session]: hasRetryTarget
            ? existing.map(message => message._cid === cid
              ? { ...message, content, _optimistic: true, _delivered: false, _agentStarted: false, _sendError: null }
              : message)
            : [...existing, normalizeMessageTimestamp({
                role: 'user', content, _cid: cid, _optimistic: true, created_at: createdAt,
              })],
        };
      });
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setTrackedDeliveryState(cid, 'queued');
        armDeliveryTimeout(cid, 'queued', 'Timed out waiting for relay acceptance.');
        send({ type: 'send', session, content, client_message_id: cid, created_at: createdAt });
      } else if (offlineSendQueue.current.length < 20) {
        offlineSendQueue.current = [
          ...offlineSendQueue.current.filter(item => item.cid !== cid),
          { session, content, cid, created_at: createdAt },
        ];
        clearDeliveryTimeout(cid);
        setTrackedDeliveryState(cid, 'offline_queued');
      } else {
        setTrackedDeliveryState(cid, 'queued');
        markDeliveryFailed(cid, 'Offline send queue is full. Reconnect or retry after another message sends.');
      }
      return cid;
    }

    function flushOfflineSendQueue() {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || offlineSendQueue.current.length === 0) return;
      const queued = offlineSendQueue.current;
      offlineSendQueue.current = [];
      queued.forEach(item => {
        trackDeliverySession(item.cid, item.session);
        setTrackedDeliveryState(item.cid, 'queued');
        armDeliveryTimeout(item.cid, 'queued', 'Timed out waiting for relay acceptance after reconnect.');
        ws.send(JSON.stringify({
          type: 'send', session: item.session, content: item.content, client_message_id: item.cid,
          created_at: item.created_at,
        }));
      });
    }

    function steerMessage(sessionId, clientMessageId, content, nativeIndex) {
      const msg = { type: 'steer', session_id: sessionId, client_message_id: clientMessageId, content };
      if (nativeIndex != null) msg.native_index = nativeIndex;
      send(msg);
      // Remove native item from queue bar immediately
      if (clientMessageId && clientMessageId.startsWith('native-')) {
        setQueuedMessages(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter(m => m.cid !== clientMessageId) }));
      }
    }

    function discardQueuedMessage(sessionId, clientMessageId) {
      clearDeliveryTimeout(clientMessageId);
      delete deliveryStatesRef.current[clientMessageId];
      delete deliverySessionsRef.current[clientMessageId];
      send({ type: 'discard_queued', session_id: sessionId, client_message_id: clientMessageId });
      setQueuedMessages(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter(m => m.cid !== clientMessageId) }));
      setDeliveryStates(prev => { const next = { ...prev }; delete next[clientMessageId]; return next; });
      // Remove the optimistic message from chat
      setMessages(prev => {
        const msgs = prev[sessionId] || [];
        return { ...prev, [sessionId]: msgs.filter(m => m._cid !== clientMessageId) };
      });
    }

    function editQueuedMessage(sessionId, clientMessageId, newContent) {
      // Update locally
      setQueuedMessages(prev => ({
        ...prev,
        [sessionId]: (prev[sessionId] || []).map(m => m.cid === clientMessageId ? {
          ...m,
          content: newContent,
          content_blocks: (m.content_blocks || []).map(block => block?.type === 'queued_message'
            ? { ...block, content: newContent }
            : block),
        } : m),
      }));
      // Update the optimistic message in chat
      setMessages(prev => {
        const msgs = prev[sessionId] || [];
        return { ...prev, [sessionId]: msgs.map(m => m._cid === clientMessageId ? { ...m, content: newContent } : m) };
      });
      // Tell proxy to update the queued content
      send({ type: 'edit_queued', session_id: sessionId, client_message_id: clientMessageId, content: newContent });
    }

    function mergeScheduledSend(job) {
      if (!job?.id) return;
      setScheduledSends(prev => {
        const next = prev.filter(item => item.id !== job.id);
        return ['completed', 'cancelled'].includes(job.state) ? next : [job, ...next];
      });
    }

    async function refreshScheduledSends() {
      const response = await fetch('/api/scheduled-sends', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not load scheduled sends (${response.status})`);
      const body = await response.json();
      setScheduledSends((body.scheduled_sends || []).filter(job => !['completed', 'cancelled'].includes(job.state)));
      return body.scheduled_sends || [];
    }

    async function scheduleSend(sessionId, content, triggerKind, deliverAt = null) {
      const response = await fetch('/api/scheduled-sends', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId, content, trigger_kind: triggerKind,
          ...(triggerKind === 'at' ? { deliver_at: deliverAt } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not schedule message (${response.status})`);
      mergeScheduledSend(body.scheduled_send);
      return body.scheduled_send;
    }

    async function cancelScheduledSend(id) {
      const response = await fetch(`/api/scheduled-sends/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'same-origin',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not cancel scheduled message (${response.status})`);
      mergeScheduledSend(body.scheduled_send);
      return body.scheduled_send;
    }

    function recordStreamTraceAfterPaint(msg, sessionId) {
      if (!msg?.stream_trace || typeof window === 'undefined') return;
      const trace = { ...msg.stream_trace, session_id: sessionId || msg.session || msg.session_id || '' };
      const raf = window.requestAnimationFrame || (callback => window.setTimeout(callback, 16));
      raf(() => raf(() => {
        const rows = Array.isArray(window.__RAC_STREAM_TRACES__) ? window.__RAC_STREAM_TRACES__ : [];
        rows.push({ ...trace, browser_paint_at_ms: Date.now() });
        if (rows.length > 500) rows.splice(0, rows.length - 500);
        window.__RAC_STREAM_TRACES__ = rows;
      }));
    }

    function handleRelayMessage(msg) {
      const t = msg.type;

      if (!navigationEpochGate.current.accept(msg)) return;
      if (t === 'navigation_started') return;

      if (t === 'connection_ack') {
        stateSequenceGate.current.reset(msg.state_epoch);
        controlConnectionIdRef.current = String(msg.connection_id || '');
      }
      const stateSessionId = msg.session || msg.session_id || '';
      const stateKey = (t === 'session_list' || t === 'session_snapshot' || t === 'proxy_session_snapshot')
        ? 'session_list'
        : ((t === 'status' || t === 'proxy_status' || t === 'session_status' || t === 'session_summary' || t === 'session_patch') && stateSessionId)
          ? `status:${stateSessionId}`
          : '';
      if (stateKey && !stateSequenceGate.current.accept(msg, stateKey)) return;

      if (t === 'heartbeat_ack') {
        handleHeartbeatAck(msg);
        return;
      }
      if (t === 'provider_usage_snapshot') {
        if (msg.snapshot && typeof msg.snapshot === 'object') {
          setProviderUsage(previous => retainNewerProviderUsage(previous, msg.snapshot));
        }
        return;
      }
      if (t === 'provider_usage_threshold') {
        const affected = new Set(Array.isArray(msg.affected_session_ids) ? msg.affected_session_ids.map(String) : []);
        if (affected.size > 0) {
          setSessions(previous => previous.map(session => {
            const id = typeof session === 'string' ? session : session?.session_id;
            if (!affected.has(id)) return session;
            return {
              ...(typeof session === 'object' ? session : {}),
              session_id: id,
              percent_used: Number.isFinite(Number(msg.percent_used)) ? Number(msg.percent_used) : null,
              rate_limit_active: msg.hard_limited === true,
              rate_limited_until: msg.reset_hint || 'unknown',
              usage_limit_provider: msg.provider_id || null,
              usage_limit_window: msg.window_label || msg.window_id || null,
            };
          }));
        }
        return;
      }
      if (t === 'provider_usage_refresh_receipt') {
        setProviderUsageRefreshReceipt(previous => (
          !previous || !msg.request_id || previous.requestId === msg.request_id
            ? { requestId: msg.request_id || previous?.requestId || '', status: msg.status || 'error', ...msg }
            : previous
        ));
        return;
      }
      if (t === 'provider_usage_reset_credit_receipt') {
        setProviderUsageResetReceipt(previous => (
          previous?.requestId && msg.request_id !== previous.requestId
            ? previous
            : {
                requestId: msg.request_id,
                status: msg.status || 'error',
                outcome: msg.outcome || null,
                availableCount: msg.reset_credits_available,
                error: msg.code || null,
              }
        ));
        return;
      }
      if (t === 'provider_usage_cost_detail') {
        setProviderUsageCostDetail(previous => (
          previous?.requestId === msg.request_id
            ? { ...previous, status: 'ready', detail: msg.detail, error: null }
            : previous
        ));
        return;
      }
      if (t === 'provider_usage_cost_detail_error') {
        setProviderUsageCostDetail(previous => (
          previous?.requestId === msg.request_id
            ? { ...previous, status: 'error', error: msg.code || 'cost_detail_failed' }
            : previous
        ));
        return;
      }
      if (t === 'host_resource_snapshot') {
        if (msg.snapshot && typeof msg.snapshot === 'object') {
          setHostResources(msg.snapshot);
          setHostResourceError(null);
        }
        return;
      }
      if (t === 'host_resource_subscription_ack') {
        if (!hostResourceDesiredRef.current.active
          || msg.request_id !== hostResourceSubscribeRequestRef.current
          || typeof msg.subscription_id !== 'string') return;
        const previousId = hostResourceSubscriptionRef.current;
        const subscriptionId = msg.subscription_id;
        const resumed = msg.resumed === true && previousId === subscriptionId;
        const acknowledgedAggregateOnly = msg.aggregate_only === true;
        const modeChanged = previousId === subscriptionId
          && hostResourceActiveModeRef.current !== acknowledgedAggregateOnly;
        hostResourceSubscriptionRef.current = subscriptionId;
        hostResourceActiveModeRef.current = acknowledgedAggregateOnly;
        hostResourceSubscribeRequestRef.current = '';
        if (!resumed) {
          setHostResourceHistory([]);
          setHostResourceDetails([]);
          setHostResources(null);
          hostResourceHistoryCursorRef.current = { system: 0, detail: 0 };
          hostResourceLastLiveSequenceRef.current = { system: 0, detail: 0 };
        } else if (modeChanged && acknowledgedAggregateOnly) {
          setHostResourceHistory(previous => mergeOrderedHostResourceFrames(
            [], previous, HOST_RESOURCE_COMPACT_HISTORY_LIMIT,
          ));
          setHostResourceDetails([]);
          setHostResources(null);
          hostResourceHistoryRequestRef.current.detail = '';
          hostResourceHistoryCursorRef.current.detail = 0;
          hostResourceLastLiveSequenceRef.current.detail = 0;
        }
        setHostResourceSubscription({
          id: subscriptionId,
          status: 'live',
          aggregateOnly: acknowledgedAggregateOnly,
          resumed,
          consumerCount: hostResourceDesiredRef.current.consumerCount,
          detailConsumerCount: hostResourceDesiredRef.current.detailConsumerCount,
        });
        requestHostResourceHistory('system', resumed ? hostResourceHistoryCursorRef.current.system : 0);
        if (!acknowledgedAggregateOnly) {
          requestHostResourceHistory('detail', resumed ? hostResourceHistoryCursorRef.current.detail : 0);
        }
        if (hostResourceDesiredRef.current.aggregateOnly !== acknowledgedAggregateOnly) {
          sendHostResourceSubscribe(hostResourceDesiredRef.current.aggregateOnly, subscriptionId);
        }
        return;
      }
      if (t === 'host_resource_history_chunk') {
        const chunk = msg.chunk;
        const stream = chunk?.stream === 'detail' ? 'detail' : chunk?.stream === 'system' ? 'system' : '';
        if (!stream || msg.subscription_id !== hostResourceSubscriptionRef.current
          || msg.request_id !== hostResourceHistoryRequestRef.current[stream]) return;
        const points = Array.isArray(chunk.points) ? chunk.points : [];
        if (stream === 'system') {
          const historyLimit = hostResourceDesiredRef.current.aggregateOnly
            ? HOST_RESOURCE_COMPACT_HISTORY_LIMIT
            : HOST_RESOURCE_HISTORY_LIMIT;
          setHostResourceHistory(previous => mergeOrderedHostResourceFrames(previous, points, historyLimit));
        } else {
          if (hostResourceDesiredRef.current.aggregateOnly) return;
          setHostResourceDetails(previous => mergeOrderedHostResourceFrames(previous, points, HOST_RESOURCE_DETAIL_LIMIT));
          const latest = points.filter(point => point && typeof point === 'object')
            .sort((left, right) => Number(left.sample_sequence || 0) - Number(right.sample_sequence || 0)).at(-1);
          if (latest) setHostResources(latest);
        }
        const nextSequence = Math.max(
          hostResourceHistoryCursorRef.current[stream],
          Math.round(Number(chunk.next_sequence) || 0),
        );
        hostResourceHistoryCursorRef.current[stream] = nextSequence;
        hostResourceHistoryRequestRef.current[stream] = '';
        if (chunk.done !== true) requestHostResourceHistory(stream, nextSequence);
        return;
      }
      if (t === 'host_resource_live') {
        const point = msg.point;
        const sequence = Number(point?.sample_sequence);
        if (msg.subscription_id !== hostResourceSubscriptionRef.current
          || !Number.isSafeInteger(sequence)
          || sequence <= hostResourceLastLiveSequenceRef.current.system) return;
        hostResourceLastLiveSequenceRef.current.system = sequence;
        hostResourceHistoryCursorRef.current.system = Math.max(hostResourceHistoryCursorRef.current.system, sequence);
        const historyLimit = hostResourceDesiredRef.current.aggregateOnly
          ? HOST_RESOURCE_COMPACT_HISTORY_LIMIT
          : HOST_RESOURCE_HISTORY_LIMIT;
        setHostResourceHistory(previous => mergeOrderedHostResourceFrames(previous, point, historyLimit));
        setHostResourceError(null);
        return;
      }
      if (t === 'host_resource_detail') {
        if (hostResourceDesiredRef.current.aggregateOnly) return;
        const snapshot = msg.snapshot;
        const sequence = Number(snapshot?.sample_sequence);
        if (msg.subscription_id !== hostResourceSubscriptionRef.current
          || !Number.isSafeInteger(sequence)
          || sequence <= hostResourceLastLiveSequenceRef.current.detail) return;
        hostResourceLastLiveSequenceRef.current.detail = sequence;
        hostResourceHistoryCursorRef.current.detail = Math.max(hostResourceHistoryCursorRef.current.detail, sequence);
        setHostResourceDetails(previous => mergeOrderedHostResourceFrames(previous, snapshot, HOST_RESOURCE_DETAIL_LIMIT));
        setHostResources(snapshot);
        setHostResourceError(null);
        return;
      }
      if (t === 'host_resource_unsubscribed') {
        if (msg.subscription_id && msg.subscription_id !== hostResourceSubscriptionRef.current) return;
        return;
      }
      if (t === 'host_resource_error') {
        setHostResourceError({
          code: msg.code || 'unavailable',
          message: msg.message || 'Windows host metrics are unavailable.',
        });
        return;
      }
      if (t === 'semantic_notification') {
        setSemanticNotifications(previous => mergeSemanticNotifications(previous, msg));
        return;
      }
      if (!startupReady.current && !msg.request_id && STARTUP_DEFERRED_RELAY_TYPES.has(t)) {
        const id = msg.session || msg.session_id || 'global';
        const source = t === 'history_chunk' ? (msg.source || 'native') : '';
        startupDeferredMessages.current.set(`${t}:${id}:${source}`, msg);
        while (startupDeferredMessages.current.size > 256) {
          startupDeferredMessages.current.delete(startupDeferredMessages.current.keys().next().value);
        }
        return;
      }

      // ── Session list (legacy) ───────────────────────────────────────────────
      if (t === 'session_list') {
        clearRemovedSessionActivity(msg.sessions || []);
        setSessionRegistry(prev => reconcileSessionRegistry(prev, msg.sessions || []));
        mergeSessionMetadataActivity(msg.sessions || []);
        mergeSessionConfigHints(msg.sessions || []);
        mergeSessionChatLists(msg.sessions || []);
        mergeSessionHealth(msg.sessions || []);
        (msg.sessions || []).forEach(s => {
          const id = s && typeof s === 'object' ? s.session_id : s;
          const preserveListViewHistory = shouldPreserveTranscriptInListView(s);
          if (s && typeof s === 'object' && s.is_list_view && !preserveListViewHistory) {
            if (id) setMessages(prev => {
              if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
              return prev;
            });
          }
        });
        if (Array.isArray(msg.workspaces)) setWorkspaces(prev => sessionRegistryValueEqual(prev, msg.workspaces) ? prev : msg.workspaces);
        return;
      }

      // ── Session snapshot (v1) ───────────────────────────────────────────────
      if (t === 'session_snapshot' || t === 'proxy_session_snapshot') {
        clearRemovedSessionActivity(msg.sessions || []);
        setSessionRegistry(prev => reconcileSessionRegistry(prev, msg.sessions || []));
        mergeSessionMetadataActivity(msg.sessions || []);
        mergeSessionConfigHints(msg.sessions || []);
        mergeSessionChatLists(msg.sessions || []);
        mergeSessionHealth(msg.sessions || []);
        (msg.sessions || []).forEach(s => {
          const id = s && typeof s === 'object' ? s.session_id : s;
          const preserveListViewHistory = shouldPreserveTranscriptInListView(s);
          if (s && typeof s === 'object' && s.is_list_view && !preserveListViewHistory) {
            // Panel is in list/new-chat mode — clear stale messages instead of fetching
            if (id) setMessages(prev => {
              if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
              return prev;
            });
          }
        });
        return;
      }

      // ── connection_ack may include initial session list + health snapshot ────
      if (t === 'connection_ack') {
        startRelayHeartbeat(msg);
        if (Array.isArray(msg.semantic_notifications)) {
          setSemanticNotifications(previous => mergeSemanticNotifications(previous, msg.semantic_notifications));
        }
        flushOfflineSendQueue();
        refreshScheduledSends().catch(() => {});
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_proxy_alarms) ? msg.duplicate_proxy_alarms : []);
        setNightlyValidationFailures(Array.isArray(msg.nightly_validation_failures) ? msg.nightly_validation_failures : []);
        setLatestAppUpdateValidation(msg.latest_app_update_validation || null);
        setRevalidationProgramHealth(msg.revalidation_program_health || null);
        if (msg.provider_usage && typeof msg.provider_usage === 'object') {
          setProviderUsage(previous => retainNewerProviderUsage(previous, msg.provider_usage));
        }
        if (msg.sessions && msg.sessions.length > 0) {
          setSessionRegistry(prev => reconcileSessionRegistry(prev, msg.sessions));
          mergeSessionMetadataActivity(msg.sessions);
          mergeSessionConfigHints(msg.sessions);
          mergeSessionChatLists(msg.sessions);
          mergeSessionHealth(msg.sessions);
          msg.sessions.forEach(s => {
            const preserveListViewHistory = shouldPreserveTranscriptInListView(s);
            if (s && typeof s === 'object' && s.is_list_view && !preserveListViewHistory) {
              const id = s.session_id;
              if (id) setMessages(prev => {
                if (prev[id] && prev[id].length > 0) return { ...prev, [id]: [] };
                return prev;
              });
            }
          });
        }
        if (Array.isArray(msg.workspaces)) setWorkspaces(prev => sessionRegistryValueEqual(prev, msg.workspaces) ? prev : msg.workspaces);
        if (msg.session_health) {
          const h = {};
          Object.entries(msg.session_health).forEach(([id, v]) => {
            h[id] = typeof v === 'object' ? v.health : v;
          });
          setHealth(prev => shallowMapMerge(prev, h));
        }
        // Restore cached agent configs on (re)connect
        if (msg.agent_configs && typeof msg.agent_configs === 'object') {
          setAgentConfigs(prev => ({ ...prev, ...msg.agent_configs }));
        }
        // Restore open permission prompts on reconnect
        {
          const restored = {};
          [...(msg.open_prompts || []), ...(msg.open_question_prompts || [])].forEach(p => {
            const sid = p.session_id || p.session;
            if (sid) restored[sid] = { ...p, received_at: Date.now() };
          });
          setPermissionPrompts(restored);
        }
        {
          const restored = {};
          (msg.open_error_prompts || []).forEach(p => {
            const sid = p.session_id || p.session;
            if (sid) restored[sid] = { ...p, received_at: Date.now() };
          });
          setErrorPrompts(restored);
        }
        markStartupReadyAfterPaint();
        return;
      }

      if (t === 'session_patch') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        setSessionRegistry(prev => patchSessionRegistry(prev, msg));
        const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
        const projected = { session_id: id, ...patch };
        if (patch.activity) mergeSessionMetadataActivity([projected]);
        if (patch.model_id !== undefined || patch.permission_mode !== undefined || patch.capabilities !== undefined) {
          mergeSessionConfigHints([projected]);
        }
        if (patch.chat_list) mergeSessionChatLists([projected]);
        if (patch.status) mergeSessionHealth([projected]);
        return;
      }

      // ── Session health update ────────────────────────────────────────────────
      if (t === 'session_health') {
        const id = msg.session || msg.session_id;
        if (id) setHealth(prev => ({ ...prev, [id]: msg.health }));
        return;
      }

      if (t === 'scheduled_send_status') {
        mergeScheduledSend(msg.scheduled_send);
        return;
      }

      if (t === 'session_summary') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        setSessions(prev => prev.map(session => {
          const sessionId = typeof session === 'string' ? session : session?.session_id;
          if (sessionId !== id) return session;
          return {
            ...(typeof session === 'object' ? session : {}),
            session_id: id,
            ...(msg.status ? { status: msg.status } : {}),
            ...(msg.activity ? { activity: msg.activity } : {}),
            ...(msg.goal ? { goal: msg.goal } : {}),
            ...(msg.fleet_summary ? { fleet_summary: msg.fleet_summary } : {}),
            ...(msg.fleet_work_context ? { fleet_work_context: msg.fleet_work_context } : {}),
            ...(msg.last_user_request ? { last_user_request: msg.last_user_request } : {}),
            ...(msg.last_snippet != null ? { last_snippet: msg.last_snippet } : {}),
            ...latestVisibleMessageSessionPatch(msg),
            ...sessionChatTitleMetadataPatch(msg),
          };
        }));
        if (msg.status) setHealth(prev => ({ ...prev, [id]: msg.status }));
        if (msg.activity) {
          const kind = String(msg.activity.kind || 'idle').toLowerCase();
          handleRelayMessage({
            type: 'status',
            session: id,
            activity: msg.activity,
            activity_trace: msg.activity_trace,
            thinking: ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(kind),
            label: msg.activity.label || '',
          });
        }
        if (Number(msg.unread_delta) > 0 && id !== activeSessionRef.current) {
          setUnread(prev => ({ ...prev, [id]: (prev[id] || 0) + Number(msg.unread_delta) }));
        }
        return;
      }

      if (t === 'message_delta') {
        const id = msg.session_id || msg.session;
        if (!id) return;
        const reduced = reduceMessageDeltaStream(provisionalStreamsRef.current[id] || null, msg);
        if (!reduced.accepted) return;
        publishProvisionalStream(id, reduced.stream, msg.stream_trace || null);
        return;
      }

      if (t === 'transcript_resync_required') {
        const id = msg.session_id || msg.session;
        if (!id || id !== activeSessionRef.current) return;
        const currentChunkState = historyChunkState.current[id] || {};
        historyChunkState.current[id] = { ...currentChunkState, inFlight: false };
        clearTimeout(historyChunkTimers.current[id]);
        delete historyChunkTimers.current[id];
        requestHistoryChunk(id, {
          mode: 'tail',
          source: 'relay_sqlite',
          replace: true,
        });
        return;
      }

      // ── History snapshot (legacy + v1) ──────────────────────────────────────
      if (t === 'history' || t === 'history_snapshot') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        if (
          msg.request_id
          && latestHistoryRequest.current[id]
          && latestHistoryRequest.current[id] !== msg.request_id
        ) {
          return;
        }
        // Don't overwrite cleared messages for sessions in list-view mode
        const sessionObj = sessions.find(s => (typeof s === 'object' ? s.session_id : s) === id);
        const preserveListViewHistory = shouldPreserveTranscriptInListView(sessionObj);
        if (sessionObj && typeof sessionObj === 'object' && sessionObj.is_list_view && msg.messages?.length > 0 && !preserveListViewHistory) {
          setHistoryLoading(prev => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          return;
        }
        if (!msg.partial && (!msg.mode || msg.mode === 'full')) clearProvisionalStream(id);
        const nextMessages = msg.messages || [];
        const priorHistoryMeta = historyMeta[id] || null;
        const forceCursorIdentityReplace = !!pendingCursorThreadHistoryReset.current[id]
          && nextMessages.length > 0;
        const shouldMergeTailSnapshot = !forceCursorIdentityReplace
          && shouldMergeHistorySnapshot(t, msg, priorHistoryMeta);
        setMessages(prev => {
          const mergedRaw = shouldMergeTailSnapshot
            ? mergeHistoryTailSnapshot(prev[id], nextMessages)
            : nextMessages;
          const merged = removeSupersededCliTranscriptPlaceholders(
            preserveOptimisticMessagesAcrossHistory(mergedRaw, prev[id]),
          );
          if (merged === prev[id]) return prev;
          return { ...prev, [id]: merged };
        });
        setHistoryMeta(prev => {
          const nextMeta = {
            ...(shouldMergeTailSnapshot ? (prev[id] || {}) : {}),
            partial: !!msg.partial || !!(shouldMergeTailSnapshot && prev[id]?.partial),
            loaded: shouldMergeTailSnapshot
              ? Math.max(
                  Number(prev[id]?.loaded || 0),
                  Number(msg.loaded_messages ?? nextMessages.length) || nextMessages.length,
                  (messages[id] || []).length
                )
              : (Number(msg.loaded_messages ?? nextMessages.length) || nextMessages.length),
            total: Number(msg.total_messages ?? prev[id]?.total ?? nextMessages.length) || nextMessages.length,
            limit: msg.limit || null,
            mode: shouldMergeTailSnapshot ? (prev[id]?.mode || 'chunked') : (msg.mode || (msg.partial ? 'tail' : 'full')),
          };
          if (sessionRegistryValueEqual(prev[id] || null, nextMeta)) return prev;
          return { ...prev, [id]: nextMeta };
        });
        setHistoryLoading(prev => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (forceCursorIdentityReplace) delete pendingCursorThreadHistoryReset.current[id];
        return;
      }

      // ── History delta (v1) ──────────────────────────────────────────────────
      if (t === 'history_chunk') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        const currentChunkState = historyChunkState.current[id] || {};
        const isCompatibleTailResponse = (
          msg.mode !== 'older'
          && currentChunkState.mode === 'tail'
          && (msg.source || 'relay_sqlite') === (currentChunkState.source || 'relay_sqlite')
        );
        if (
          msg.request_id
          && latestHistoryChunkRequest.current[id]
          && latestHistoryChunkRequest.current[id] !== msg.request_id
          && !isCompatibleTailResponse
        ) {
          return;
        }
        if (msg.error && (!Array.isArray(msg.messages) || msg.messages.length === 0)) {
          setHistoryLoading(prev => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          historyChunkState.current[id] = {
            ...(historyChunkState.current[id] || {}),
            inFlight: false,
          };
          clearTimeout(historyChunkTimers.current[id]);
          delete historyChunkTimers.current[id];
          setHistoryMeta(prev => ({
            ...prev,
            [id]: {
              ...(prev[id] || {}),
              error: String(msg.error?.message || msg.error || 'Transcript history could not be loaded.'),
            },
          }));
          return;
        }
        const mode = msg.mode === 'older' ? 'older' : msg.mode === 'around' ? 'around' : 'tail';
        const cursor = msg.cursor || {};
        const nextBeforeOffset = cursor.next_before_offset ?? null;
        const nextBeforeId = cursor.next_before_id ?? null;
        const hasMore = !!(msg.partial && (nextBeforeOffset != null || nextBeforeId != null));
        const incoming = Array.isArray(msg.messages) ? msg.messages : [];
        const replaceTail = mode === 'around' || (mode === 'tail' && msg.replace === true);
        const estimatedMessages = replaceTail ? incoming : mergeHistoryChunk(messages[id], incoming, mode);
        const estimatedLength = estimatedMessages.length;
        setMessages(prev => {
          const merged = removeSupersededCliTranscriptPlaceholders(
            preserveOptimisticMessagesAcrossHistory(
              replaceTail
                ? reconcileHistoryTailReplacement(prev[id], incoming, currentChunkState, msg.source)
                : mergeHistoryChunk(prev[id], incoming, mode),
              prev[id],
            )
          );
          if (merged === prev[id]) return prev;
          return { ...prev, [id]: merged };
        });
        setHistoryMeta(prev => {
          const nextMeta = {
            ...(prev[id] || {}),
            partial: hasMore,
            loaded: replaceTail
              ? (Number(msg.loaded_messages ?? estimatedLength) || estimatedLength)
              : Math.max(Number(prev[id]?.loaded || 0), Number(msg.loaded_messages || 0), estimatedLength),
            total: Number(msg.total_messages || prev[id]?.total || estimatedLength) || estimatedLength,
            limit: null,
            mode: 'chunked',
            source: msg.source || 'native',
            cursor,
            bytes_total: cursor.total_bytes || 0,
          };
          delete nextMeta.error;
          if (sessionRegistryValueEqual(prev[id] || null, nextMeta)) return prev;
          return { ...prev, [id]: nextMeta };
        });
        setHistoryLoading(prev => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        historyChunkState.current[id] = {
          ...(historyChunkState.current[id] || {}),
          inFlight: false,
          nextBeforeOffset,
          nextBeforeId,
        };
        clearTimeout(historyChunkTimers.current[id]);
        delete historyChunkTimers.current[id];
        return;
      }

      if (t === 'history_delta') {
        const id      = msg.session || msg.session_id;
        if (!id) return;
        if (
          msg.request_id
          && latestHistoryRequest.current[id]
          && latestHistoryRequest.current[id] !== msg.request_id
        ) return;
        const rawDelta = Array.isArray(msg.messages) ? msg.messages : (Array.isArray(msg.events) ? msg.events : []);
        const newMsgs = rawDelta.map(event => event?.message || event).filter(Boolean);
        const estimated = mergeHistoryChunk(messages[id], newMsgs, 'tail');
        setMessages(prev => {
          const merged = removeSupersededCliTranscriptPlaceholders(mergeHistoryChunk(prev[id], newMsgs, 'tail'));
          if (merged === prev[id]) return prev;
          return { ...prev, [id]: merged };
        });
        setHistoryMeta(prev => {
          const prior = prev[id] || {};
          const loaded = Math.max(Number(prior.loaded || 0), estimated.length);
          const total = Math.max(Number(msg.total_messages || 0), Number(prior.total || 0), loaded);
          return {
            ...prev,
            [id]: {
              ...prior,
              loaded,
              total,
              last_sequence: Number(msg.last_sequence || prior.last_sequence || 0),
              mode: prior.mode || 'chunked',
            },
          };
        });
        setHistoryLoading(prev => {
          if (prev[id]?.requestId !== msg.request_id) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return;
      }

      // ── Thinking / activity status ──────────────────────────────────────────
      if (t === 'status' || t === 'proxy_status' || t === 'session_status') {
        const id = msg.session || msg.session_id;
        if (!id) return;
        const activityKind = msg.activity?.kind || '';
        const isThinking = msg.thinking
          || ['thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working'].includes(activityKind);
        if (shouldClearEmptyProvisionalOnTerminal(
          provisionalStreamsRef.current[id],
          msg.activity || (!isThinking ? { kind: 'idle' } : null),
          isThinking,
        )) clearProvisionalStream(id);
        const label = msg.label || msg.activity?.label || (activityKind === 'idle' ? '' : 'Thinking');
        const activity = isThinking || msg.activity
          ? {
              kind:      msg.activity?.kind || (isThinking ? 'thinking' : 'working'),
              label,
              updatedAt: msg.activity?.updated_at || null,
              observed_at: msg.activity?.observed_at || null,
              startedAt: msg.activity?.started_at || null,
              interruptHint: msg.activity?.interrupt_hint || '',
              goal: msg.activity?.goal || null,
              goal_run: msg.activity?.goal_run || null,
              thinking: msg.activity?.thinking || null,
              current: msg.activity?.current || null,
              step: msg.activity?.step || null,
              usage: msg.activity?.usage || null,
              task_list: msg.activity?.task_list || null,
              context_card: msg.activity?.context_card || null,
              thinkingContent: msg.activity?.thinking?.text || msg.activity?.thinkingContent || '',
              transport: normalizeFleetActivityTrace(msg.activity_trace),
            }
          : false;
        if (isThinking) {
          clearTimeout(thinkingTimers.current[id]);
          setThinking(prev => Object.is(prev[id], label) ? prev : ({ ...prev, [id]: label }));
          setActivities(prev => shallowMapMerge(prev, { [id]: activity }));
          // Store Claude Code thinking content text
          const nextThinkingContent = msg.activity?.thinking?.text ?? msg.thinking_content ?? msg.activity?.thinkingContent;
          if (nextThinkingContent != null) {
            setThinkingContent(prev => Object.is(prev[id], nextThinkingContent) ? prev : ({ ...prev, [id]: nextThinkingContent }));
          }
        } else if (activityKind === 'idle') {
          clearTimeout(thinkingTimers.current[id]);
          setThinking(prev => prev[id] === false ? prev : ({ ...prev, [id]: false }));
          setActivities(prev => {
            const nextActivity = activity;
            return Object.is(prev[id], nextActivity) ? prev : ({ ...prev, [id]: nextActivity });
          });
          setThinkingContent(prev => prev[id] === '' ? prev : ({ ...prev, [id]: '' }));
        } else if (msg.activity?.goal || msg.activity?.task_list || msg.activity?.step || msg.activity?.usage) {
          clearTimeout(thinkingTimers.current[id]);
          setThinking(prev => prev[id] === false ? prev : ({ ...prev, [id]: false }));
          setActivities(prev => shallowMapMerge(prev, { [id]: activity }));
        } else {
          clearTimeout(thinkingTimers.current[id]);
          thinkingTimers.current[id] = setTimeout(() => {
            setThinking(prev => prev[id] === false ? prev : ({ ...prev, [id]: false }));
            setActivities(prev => prev[id] === false ? prev : ({ ...prev, [id]: false }));
            setThinkingContent(prev => prev[id] === '' ? prev : ({ ...prev, [id]: '' }));
          }, 4000);
        }
        recordStreamTraceAfterPaint(msg, id);
        return;
      }

      // ── Permission prompts ───────────────────────────────────────────────────
      if (t === 'permission_prompt') {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts(prev => ({ ...prev, [sid]: { ...msg, received_at: Date.now() } }));
        return;
      }

      if (t === 'question_prompt') {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts(prev => {
          const current = prev[sid];
          const samePrompt = current?.prompt_id === msg.prompt_id && current?.generation === msg.generation;
          return {
            ...prev,
            [sid]: {
              ...(samePrompt ? current : {}),
              ...msg,
              received_at: samePrompt ? current.received_at : Date.now(),
              ...(msg.lifecycle === 'submitting'
                ? { submitting_choice_id: current?.submitting_choice_id || 'question_answers' }
                : {}),
            },
          };
        });
        return;
      }

      if (t === 'question_prompt_state') {
        const sid = msg.session_id || msg.session;
        if (sid && msg.lifecycle === 'failed') {
          setPermissionPrompts(prev => {
            const current = prev[sid];
            const samePrompt = current?.prompt_id === msg.prompt_id && current?.generation === msg.generation;
            if (current && !samePrompt) return prev;
            return {
              ...prev,
              [sid]: {
                ...(samePrompt ? current : {}),
                ...msg,
                type: 'question_prompt',
                received_at: samePrompt ? current.received_at : Date.now(),
                submitting_choice_id: null,
              },
            };
          });
        } else if (sid && !['open', 'submitting'].includes(msg.lifecycle)) {
          setPermissionPrompts(prev => {
            const current = prev[sid];
            if (current?.prompt_id !== msg.prompt_id || current?.generation !== msg.generation) return prev;
            const { [sid]: _, ...rest } = prev;
            return rest;
          });
        }
        return;
      }

      if (t === 'permission_prompt_expired') {
        const sid = msg.session_id || msg.session;
        if (sid) setPermissionPrompts(prev => { const { [sid]: _, ...rest } = prev; return rest; });
        return;
      }

      if (t === 'session_error_prompt') {
        const sid = msg.session_id || msg.session;
        if (sid) setErrorPrompts(prev => ({ ...prev, [sid]: { ...msg, received_at: Date.now() } }));
        return;
      }

      if (t === 'session_error_prompt_cleared') {
        const sid = msg.session_id || msg.session;
        if (sid) setErrorPrompts(prev => { const { [sid]: _, ...rest } = prev; return rest; });
        return;
      }

      // ── Chat list (Epic 9) ──────────────────────────────────────────────────
      if (t === 'chat_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setChatLists(prev => ({ ...prev, [sid]: msg.chats || [] }));
        return;
      }

      // ── Branch list ──────────────────────────────────────────────────────
      if (t === 'branch_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setBranchLists(prev => ({ ...prev, [sid]: { branches: msg.branches || [], current: msg.current || '' } }));
        return;
      }

      // ── Thread list (Epic 2) ──────────────────────────────────────────────
      if (t === 'thread_list') {
        const sid = msg.session_id || msg.session;
        if (sid) {
          const threads = msg.threads || [];
          const activeThread = threads.find(thread => thread?.active);
          const cursorIdentity = String(activeThread?.cache_key || '');
          const previousIdentity = activeCursorThreadIdentity.current[sid] || '';
          if (cursorIdentity && previousIdentity && cursorIdentity !== previousIdentity) {
            pendingCursorThreadHistoryReset.current[sid] = cursorIdentity;
            clearSessionTranscript(sid);
          }
          if (cursorIdentity) activeCursorThreadIdentity.current[sid] = cursorIdentity;
          setThreadLists(prev => ({ ...prev, [sid]: threads }));
        }
        return;
      }

      if (t === 'duplicate_proxy_alarm') {
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_sessions) ? msg.duplicate_sessions : []);
        return;
      }

      if (t === 'nightly_validation_status') {
        setNightlyValidationFailures(Array.isArray(msg.failures) ? msg.failures : []);
        if (msg.revalidation_program_health) setRevalidationProgramHealth(msg.revalidation_program_health);
        return;
      }

      if (t === 'app_update_validation_status') {
        setLatestAppUpdateValidation(msg.validation || null);
        return;
      }

      if (t === 'harness_revalidation_status') {
        setRevalidationProgramHealth(msg.program_health || null);
        return;
      }

      // ── Skill list (Codex Desktop) ────────────────────────────────────────
      if (t === 'skill_list') {
        const sid = msg.session_id || msg.session;
        if (sid) setSkillLists(prev => ({ ...prev, [sid]: { installed: msg.installed || [], recommended: msg.recommended || [] } }));
        return;
      }

      if (t === 'codex_automation_view') {
        const sid = msg.session_id || msg.session;
        if (sid) setAutomationViews(prev => ({ ...prev, [sid]: msg.view || null }));
        return;
      }

      // ── Terminal output (Epic 4) ──────────────────────────────────────────
      if (t === 'terminal_output') {
        const sid = msg.session_id || msg.session;
        if (sid) setTerminalOutputs(prev => ({ ...prev, [sid]: msg.entries || [] }));
        return;
      }

      // ── File changes / diff (Epic 5) ──────────────────────────────────────
      if (t === 'file_changes') {
        const sid = msg.session_id || msg.session;
        if (sid) setFileChanges(prev => ({ ...prev, [sid]: msg.entries || [] }));
        return;
      }

      // ── Directory listing (file browser) ────────────────────────────────────
      if (t === 'directory_listing') {
        const sid = msg.session_id || msg.session;
        if (sid) setDirectoryListings(prev => ({ ...prev, [sid]: { path: msg.path, entries: msg.entries || [] } }));
        return;
      }

      // ── File content (file browser) ──────────────────────────────────────
      if (t === 'file_content') {
        const sid = msg.session_id || msg.session;
        if (sid) setFileContents(prev => boundedRecordWith(prev, `${sid}:${msg.path}`, { path: msg.path, content: msg.content, truncated: msg.truncated }));
        return;
      }

      // ── Agent config ─────────────────────────────────────────────────────────
      if (t === 'agent_config') {
        const sid = msg.session_id || msg.session;
        if (!sid) return;
        reconcileConfigControls(sid, msg);
        setAgentConfigs(prev => {
          const existing = prev[sid] || {};
          const next = { ...existing, ...msg };
          if ((!Array.isArray(msg.available_models) || msg.available_models.length === 0)
              && Array.isArray(existing.available_models)
              && existing.available_models.length > 0) {
            next.available_models = existing.available_models;
          }
          Object.values(configControlStatesRef.current).forEach(transaction => {
            if (transaction.sessionId !== sid || !['pending', 'awaiting_config'].includes(transaction.status)) return;
            next[transaction.configKey] = transaction.requestedValue;
          });
          agentConfigsRef.current = { ...agentConfigsRef.current, [sid]: next };
          return { ...prev, [sid]: next };
        });
        return;
      }

      if (t === 'agent_control_result') {
        const sid = msg.session_id || msg.session;
        if (msg.request_id) {
          setControlResults(prev => boundedRecordWith(prev, msg.request_id, { ...msg, received_at: Date.now() }));
          const pendingEntry = Object.entries(configControlStatesRef.current)
            .find(([, transaction]) => transaction.requestId === msg.request_id
              && transaction.sessionId === sid
              && ['pending', 'awaiting_config'].includes(transaction.status));
          if (pendingEntry) {
            const [key, transaction] = pendingEntry;
            if (msg.result === 'failed') {
              rollbackConfigControl(key, msg.error?.message || msg.error || 'The agent rejected this setting.');
            } else if (msg.result === 'ok') {
              setConfigControlState(key, { ...transaction, status: 'awaiting_config' });
              if (sid) requestAgentConfig(sid);
            }
          }
        }
        if (sid && msg.result === 'ok' && msg.command === 'new_thread') {
          // The proxy emits an authoritative history snapshot as part of a
          // successful same-session thread creation. Do not start a later
          // empty-store fetch that can leave the new draft stuck loading.
          clearSessionTranscript(sid);
        }
        if (sid && msg.result === 'ok' && ['new_thread', 'switch_thread'].includes(msg.command)) {
          requestThreadList(sid);
        }
        if (sid && msg.result === 'ok' && msg.command === 'switch_chat') {
          requestChatList(sid);
        }
        if (['permission_response', 'question_response'].includes(msg.command) && sid) {
          if (msg.result === 'ok') {
            setPermissionPrompts(prev => {
              if (prev[sid]?.request_id !== msg.request_id) return prev;
              const { [sid]: _, ...rest } = prev;
              return rest;
            });
          } else if (msg.result === 'failed') {
            setPermissionPrompts(prev => prev[sid]?.request_id === msg.request_id
              ? { ...prev, [sid]: { ...prev[sid], submitting_choice_id: null, error: msg.error?.message || 'Permission response failed' } }
              : prev);
          }
        }
        if (msg.command === 'error_prompt_action' && sid && msg.result === 'failed') {
          setErrorPrompts(prev => prev[sid]
            ? { ...prev, [sid]: { ...prev[sid], submitting_action_id: null, error: msg.error?.message || 'Error prompt action failed' } }
            : prev);
        }
        if (msg.command === 'file_change_response' && sid && msg.result === 'ok') {
          requestFileChanges(sid);
        }
        return;
      }

      // ── Delivery ack / failure ───────────────────────────────────────────────
      if (t === 'message_accepted') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        const storedStatus = ['accepted', 'delivered', 'agent_started', 'failed'].includes(msg.status)
          ? msg.status
          : 'accepted';
        const persistedStatus = storedStatus === 'accepted' && msg.launch_accepted_at
          ? 'launch_accepted'
          : storedStatus;
        if (cid && persistedStatus === 'failed') {
          markDeliveryFailed(cid, msg.failure_code || 'Send failed', sid);
          return;
        }
        // Don't overwrite busy_queued or steered — those are higher-priority states
        const current = cid ? deliveryStatesRef.current[cid] : null;
        if (cid && !['busy_queued', 'steered', 'launch_accepted', 'delivered', 'agent_started'].includes(current)) {
          setTrackedDeliveryState(cid, persistedStatus);
          if (persistedStatus === 'accepted') {
            armDeliveryTimeout(cid, 'accepted', 'Relay accepted the message, but native delivery timed out.');
          } else if (persistedStatus === 'launch_accepted') {
            armDeliveryTimeout(cid, 'launch_accepted', 'The native launch was accepted, but no native user turn was observed.');
          } else if (persistedStatus === 'delivered') {
            armDeliveryTimeout(cid, 'delivered', 'Message reached the agent, but agent activity did not start in time.');
          } else {
            clearDeliveryTimeout(cid);
          }
        }
        if (cid) {
          updateTrackedDeliveryMessage(cid, sid, message => normalizeMessageTimestamp({
            ...message,
            ...(msg.created_at != null ? { created_at: msg.created_at } : {}),
            ...(msg.timestamp != null ? { timestamp: msg.timestamp } : {}),
            ...(msg.ts != null ? { ts: msg.ts } : {}),
            ...(msg.launch_accepted_at != null ? { _launchAcceptedAt: msg.launch_accepted_at } : {}),
            _delivered: persistedStatus === 'delivered' || persistedStatus === 'agent_started',
            _agentStarted: persistedStatus === 'agent_started',
            _sendError: null,
          }));
        }
        return;
      }

      if (t === 'proxy_send_result' && msg.result === 'launch_accepted') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        if (cid && !['delivered', 'agent_started'].includes(deliveryStatesRef.current[cid])) {
          setTrackedDeliveryState(cid, 'launch_accepted');
          armDeliveryTimeout(cid, 'launch_accepted', 'The native launch was accepted, but no native user turn was observed.');
          updateTrackedDeliveryMessage(cid, sid, message => ({
            ...message,
            _launchAcceptedAt: msg.accepted_at || new Date().toISOString(),
            _sendError: null,
          }));
        }
        return;
      }

      if (t === 'message_delivered' || (t === 'proxy_send_result' && msg.result === 'delivered')) {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        if (cid && deliveryStatesRef.current[cid] !== 'agent_started') {
          setTrackedDeliveryState(cid, 'delivered');
          armDeliveryTimeout(cid, 'delivered', 'Message reached the agent, but agent activity did not start in time.');
        }
        if (cid) {
          updateTrackedDeliveryMessage(cid, sid, message => ({
            ...message,
            _delivered: true,
            _sendError: null,
          }));
        }
        return;
      }

      if (t === 'agent_started') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid && sid) trackDeliverySession(cid, sid);
        if (cid) {
          clearDeliveryTimeout(cid);
          setTrackedDeliveryState(cid, 'agent_started');
        }
        if (sid) openProvisionalStream(sid, cid || null);
        if (cid) {
          updateTrackedDeliveryMessage(cid, sid, message => ({
            ...message,
            _delivered: true,
            _agentStarted: true,
            _sendError: null,
          }));
        }
        return;
      }

      if (t === 'message_failed' || (t === 'proxy_send_result' && msg.result === 'failed')) {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (sid) clearProvisionalStream(sid);
        if (cid) {
          const failureReason = msg.reason || msg.message || msg.error?.message || 'Send failed';
          markDeliveryFailed(cid, failureReason, sid);
        }
        return;
      }

      // ── Steer / queue messages ──────────────────────────────────────────────
      if (t === 'message_queued') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          const contentBlocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : [];
          const queuedBlock = contentBlocks.find(block => block?.type === 'queued_message');
          clearDeliveryTimeout(cid);
          setTrackedDeliveryState(cid, 'busy_queued');
          if (sid) {
            setQueuedMessages(prev => ({
              ...prev,
              [sid]: [...(prev[sid] || []), {
                cid,
                content: queuedBlock?.content ?? msg.content,
                content_blocks: contentBlocks,
                queuedAt: msg.queued_at,
              }],
            }));
          }
        }
        return;
      }
      if (t === 'queue_delivered') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          setTrackedDeliveryState(cid, 'accepted');
          armDeliveryTimeout(cid, 'accepted', 'Queued message left the relay, but native delivery timed out.');
          if (sid) setQueuedMessages(prev => ({ ...prev, [sid]: (prev[sid] || []).filter(m => m.cid !== cid) }));
        }
        return;
      }
      if (t === 'steer_result') {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (cid) {
          if (msg.result === 'ok') {
            setTrackedDeliveryState(cid, 'steered');
            armDeliveryTimeout(cid, 'steered', 'Message was steered, but agent activity did not start in time.');
          } else {
            markDeliveryFailed(cid, msg.error?.message || msg.error || 'The desktop proxy rejected the message.', sid);
          }
          if (sid) setQueuedMessages(prev => ({ ...prev, [sid]: (prev[sid] || []).filter(m => m.cid !== cid) }));
        }
        return;
      }

      // ── Native queue (Codex side-panel queue items detected via DOM) ────────
      if (t === 'native_queue') {
        const sid = msg.session_id || msg.session;
        const items = msg.items || [];
        if (sid) {
          // Merge native queue items into queuedMessages, using 'native-N' as cid
          setQueuedMessages(prev => {
            // Remove old native items, keep proxy-queued items (those with cmsg- prefix)
            const existing = (prev[sid] || []).filter(m => m.cid && m.cid.startsWith('cmsg-'));
            const native = items.map((item, i) => ({
              cid: `native-${i}`,
              content: item.content_blocks?.find(block => block?.type === 'queued_message')?.content ?? item.text,
              content_blocks: Array.isArray(item.content_blocks) ? item.content_blocks : [],
              native: true,
              nativeIndex: item.index,
              status: item.state || 'queued',
            }));
            return { ...prev, [sid]: [...existing, ...native] };
          });
        }
        return;
      }

      // ── Rate limit / usage warning ──────────────────────────────────────────
      if (t === 'rate_limit_active') {
        const sid = msg.session_id || msg.session;
        const pct = msg.percent_used ?? null;
        // Hard limit = 100% or no percent (legacy). Below 100% = usage warning only.
        const isHardLimit = pct == null || pct >= 100;
        if (sid) {
          setSessions(prev => prev.map(s =>
            (typeof s === 'string' ? s : s?.session_id) === sid
              ? { ...(typeof s === 'object' ? s : {}), session_id: sid, rate_limited_until: msg.retry_after_hint || (isHardLimit ? 'unknown' : null), rate_limit_active: isHardLimit, percent_used: pct }
              : s
          ));
        }
        return;
      }
      if (t === 'rate_limit_cleared') {
        const sid = msg.session_id || msg.session;
        if (sid) {
          setSessions(prev => prev.map(s =>
            (typeof s === 'string' ? s : s?.session_id) === sid
              ? { ...(typeof s === 'object' ? s : {}), session_id: sid, rate_limited_until: null, rate_limit_active: false, percent_used: null }
              : s
          ));
        }
        return;
      }

      // ── Session launch lifecycle ─────────────────────────────────────────────
      if (t === 'session_launching') {
        // Relay acknowledged the launch request; proxy is now trying to open the agent.
        // launchState already set to 'launching' on send — no change needed here.
        return;
      }

      if (t === 'session_launch_ack') {
        const reqId = msg.request_id;
        const sid   = msg.session_id || msg.session;
        if (reqId) {
          setLaunchStates(prev => {
            const { [reqId]: _removed, ...rest } = prev;
            return rest;
          });
        }
        if (sid) setJustLaunched(sid);
        return;
      }

      if (t === 'session_launch_failed') {
        const reqId = msg.request_id;
        const error = msg.reason || msg.error || 'Launch failed';
        if (reqId) {
          setLaunchStates(prev => boundedRecordWith(
            prev,
            reqId,
            { ...prev[reqId], status: 'failed', error },
          ));
        }
        return;
      }

      if (t === 'session_closed') {
        const id = msg.session || msg.session_id;
        if (id) {
          setSessions(prev => prev.filter(s => (typeof s === 'string' ? s : s?.session_id) !== id));
        }
        return;
      }

      // ── Transcript message (legacy + v1) ────────────────────────────────────
      if (t === 'message' || t === 'proxy_message' || t === 'message_event') {
        const id      = msg.session || msg.session_id || msg.message?.session_id;
        const role    = msg.role    || msg.message?.role;
        const content = msg.content || msg.message?.content;
        const contentBlocks = Array.isArray(msg.content_blocks)
          ? msg.content_blocks
          : (Array.isArray(msg.message?.content_blocks) ? msg.message.content_blocks : null);
        const clientMessageId = msg.client_message_id || msg.message?.client_message_id || null;
        const deliveryStatus = msg.status || msg.message?.status || null;
        const nativeDelivered = deliveryStatus === 'delivered' || deliveryStatus === 'agent_started';
        if (!id || !role || !content) return;
        if (role === 'assistant') clearProvisionalStream(id);
        const incomingMessage = normalizeMessageTimestamp({
          role,
          content,
          ...(contentBlocks ? { content_blocks: contentBlocks } : {}),
          ...(msg.source_message_id ? { source_message_id: msg.source_message_id } : {}),
          ...(msg.native_source_id ? { native_source_id: msg.native_source_id } : {}),
          ...(msg.source_cursor ? { source_cursor: msg.source_cursor } : {}),
          ...(msg.source ? { source: msg.source } : {}),
          ...(msg.server_message_id != null ? { server_message_id: msg.server_message_id } : {}),
          ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
          ...(deliveryStatus ? { status: deliveryStatus } : {}),
          ...(msg.sequence != null ? { sequence: msg.sequence } : {}),
          ...(msg.created_at != null ? { created_at: msg.created_at } : {}),
          ...(msg.timestamp != null ? { timestamp: msg.timestamp } : {}),
          ...(msg.ts != null ? { ts: msg.ts } : {}),
        });

        setMessages(prev => {
          const existing = prev[id] || [];
          if (role === 'user') {
            // Replace a matching optimistic message with the confirmed real one.
            // Preserve _cid and _optimistic so delivery state tracking (queued/steer)
            // continues to work after the relay echoes the message back.
            const idx = existing.findIndex(m => m._optimistic && (
              (clientMessageId && m._cid === clientMessageId)
              || (!clientMessageId && m.content === content)
            ));
            if (idx >= 0) {
              const updated = [...existing];
              const prev_msg = existing[idx];
              updated[idx] = normalizeMessageTimestamp({
                ...prev_msg,
                role,
                content,
                ...(contentBlocks ? { content_blocks: contentBlocks } : {}),
                ...(incomingMessage.source_message_id ? { source_message_id: incomingMessage.source_message_id } : {}),
                ...(incomingMessage.native_source_id ? { native_source_id: incomingMessage.native_source_id } : {}),
                ...(incomingMessage.source_cursor ? { source_cursor: incomingMessage.source_cursor } : {}),
                ...(incomingMessage.source ? { source: incomingMessage.source } : {}),
                ...(incomingMessage.server_message_id != null ? { server_message_id: incomingMessage.server_message_id } : {}),
                ...(incomingMessage.client_message_id ? { client_message_id: incomingMessage.client_message_id } : {}),
                ...(incomingMessage.status ? { status: incomingMessage.status } : {}),
                ...(incomingMessage.sequence != null ? { sequence: incomingMessage.sequence } : {}),
                ...(incomingMessage.created_at != null ? { created_at: incomingMessage.created_at } : {}),
                ...(incomingMessage.timestamp != null ? { timestamp: incomingMessage.timestamp } : {}),
                ...(incomingMessage.ts != null ? { ts: incomingMessage.ts } : {}),
                _delivered: prev_msg._delivered || nativeDelivered,
                _agentStarted: prev_msg._agentStarted || deliveryStatus === 'agent_started',
                _cid: prev_msg._cid,
                _optimistic: prev_msg._optimistic,
              });
              return { ...prev, [id]: removeSupersededCliTranscriptPlaceholders(updated) };
            }
          }
          const stableIncomingId = stableHistoryMessageId(incomingMessage);
          if (existing.some(message => (
            stableIncomingId
              ? stableHistoryMessageId(message) === stableIncomingId
              : message.role === role && message.content === content
          ))) {
            return prev;
          }
          return {
            ...prev,
            [id]: removeSupersededCliTranscriptPlaceholders([
              ...existing,
              {
                ...incomingMessage,
                ...(role === 'user' && clientMessageId ? { _cid: clientMessageId } : {}),
                _delivered: role === 'user' && nativeDelivered,
                _agentStarted: role === 'user' && deliveryStatus === 'agent_started',
              },
            ]),
          };
        });

        if (role === 'assistant' && id !== activeSessionRef.current) {
          setUnread(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
        }
        const latestMessagePatch = latestVisibleMessageSessionPatch(msg);
        if (Object.keys(latestMessagePatch).length > 0) {
          setSessions(prev => prev.map(session => (
            (typeof session === 'string' ? session : session?.session_id) === id
              ? { ...(typeof session === 'object' ? session : {}), session_id: id, ...latestMessagePatch }
              : session
          )));
        }
        return;
      }
    }

    // Keep ref in sync so the WebSocket onmessage handler always calls
    // the latest render's handleRelayMessage (avoids stale closure issues
    // where `sessions` / `messages` would be frozen at initial render values).
    handleRelayMessageRef.current = handleRelayMessage;

    return { sessions, messages, provisionalStreams, historyMeta, historyLoading, connected, connectionHealth, unread, setUnread, thinking, thinkingContent, activities, health, deliveryStates, launchStates, justLaunched, setJustLaunched, permissionPrompts, respondToPrompt, errorPrompts, respondToErrorPrompt, interruptSession, controlGoal, agentConfigs, configControlStates, requestAgentConfig, setAgentModel, setAgentEffort, setAgentPermissionMode, setAutoApprovePermissions, setAntigravityMode, setCodexConfig, newThread, openPanel, openNativeWindow, requestChatList, switchChat, newChat, chatLists, requestThreadList, switchThread, threadLists, switchWorkspace, requestTerminalOutput, sendTerminalInput, terminalOutputs, requestFileChanges, respondToFileChange, fileChanges, sendAttachment, send, sendToSession, steerMessage, discardQueuedMessage, editQueuedMessage, queuedMessages, scheduledSends, scheduleSend, cancelScheduledSend, refreshScheduledSends, launchSession, resumeSession, closeSession, activeSessionRef, restoreCachedTranscript, setSessionSubscriptions, workspaces, branchLists, requestBranchList, switchBranch, createBranch, skillLists, requestSkillList, automationViews, showCodexAutomation, controlResults, directoryListings, requestDirectoryListing, fileContents, requestFileContent, requestHistory, requestHistoryChunk, duplicateProxyAlarms, nightlyValidationFailures, latestAppUpdateValidation, revalidationProgramHealth, providerUsage, providerUsageRefreshReceipt, requestProviderUsageRefresh, setProviderUsageWatching, providerUsageResetReceipt, consumeProviderUsageResetCredit, providerUsageCostDetail, requestProviderUsageCostDetail, hostResources, hostResourceError, hostResourceHistory, hostResourceDetails, hostResourceSubscription, subscribeHostResources, unsubscribeHostResources, requestHostResourceRefresh, clearHostResources, semanticNotifications };
  }

// (removed window.useRelay — now an ES module export)
