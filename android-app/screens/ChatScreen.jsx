import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity,
  Text, StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Keyboard, Image, Alert, Share,
} from 'react-native';
import * as ImagePicker    from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem     from 'expo-file-system';
import AsyncStorage        from '@react-native-async-storage/async-storage';
import { RelayClient }      from '../lib/relay';
import { createStateSequenceGate } from '../lib/state-sequence';
import { getStoredJwt, signOut, RELAY_URL } from '../lib/auth';
import MessageBubble         from '../components/MessageBubble';
import ActivityRow           from '../components/ActivityRow';
import PermissionPrompt      from '../components/PermissionPrompt';
import ErrorPrompt           from '../components/ErrorPrompt';
import QueuedMessageBar      from '../components/QueuedMessageBar';
import FileBrowserSheet      from '../components/FileBrowserSheet';
import AgentSettingsSheet    from '../components/AgentSettingsSheet';
import ScheduledSendSheet    from '../components/ScheduledSendSheet';
import ChatListSheet         from '../components/ChatListSheet';
import ThreadHistorySheet    from '../components/ThreadHistorySheet';
import TerminalViewer        from '../components/TerminalViewer';
import DiffViewer            from '../components/DiffViewer';
import BranchSelectorSheet   from '../components/BranchSelectorSheet';
import { createProvisionalStream, reduceMessageDeltaStream, shouldClearEmptyProvisionalOnTerminal } from '../lib/message-delta';
import {
  formatAbsoluteMessageTime,
  formatVisibleMessageTime,
  messageInstant,
  normalizeMessageTimestamp,
  normalizeTranscriptTimestamps,
  parseMessageInstant,
} from '../lib/message-time';
import { getCachedTranscript, setCachedTranscript, stableTranscriptMessageKey } from '../lib/transcript-cache';
import {
  clearPromptAttentionFeedback,
  notePromptForAttentionFeedback,
  refreshAttentionHapticPreference,
  rememberPromptForAttentionFeedback,
} from '../lib/attention-feedback';
import { processSemanticNotification } from '../lib/semantic-notifications';
import {
  resolveSessionChatTitleProjection,
  retainStrongerSessionChatTitleProjection,
  sessionChatTitleMetadataPatch,
} from '../lib/session-title';

const DRAFT_STORAGE_PREFIX = 'remote-agent-chat:draft:v1:';
const HISTORY_PAGE_SIZE = 200;
const DELIVERY_STAGE_TIMEOUT_MS = Object.freeze({
  queued: 10000,
  accepted: 30000,
  launch_accepted: 30000,
  delivered: 30000,
  steered: 30000,
});
const SLASH_COMMANDS = [
  { command: '/plan', detail: 'Outline the implementation approach and major steps.' },
  { command: '/review', detail: 'Review the current changes for bugs, regressions, and missing tests.' },
  { command: '/fix', detail: 'Implement or repair the current issue.' },
  { command: '/summarize', detail: 'Summarize the current state and important changes.' },
];

function routeTitleProjection(value) {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return title
    ? { title, source: 'route', field: 'route_param' }
    : { title: 'New chat', source: 'fallback', field: 'new_chat' };
}

function ProvisionalBubble({ stream }) {
  const instant = parseMessageInstant(stream?.startedAtMs);
  const absoluteTimestamp = instant ? formatAbsoluteMessageTime(instant) : 'time unknown';
  return (
    <View style={s.provisionalWrapper} accessibilityLabel="Streaming assistant response">
      <View style={s.provisionalBubble}>
        {!!stream?.content && <Text style={s.provisionalText} selectable>{stream.content}</Text>}
        {stream?.open && <View style={s.provisionalCaret} />}
      </View>
      <Text style={s.provisionalTimestamp} accessibilityLabel={`Sent ${absoluteTimestamp}`}>
        {instant ? formatVisibleMessageTime(instant) : 'Time unknown'}
      </Text>
    </View>
  );
}

export default function ChatScreen({ route, navigation }) {
  const { sessionId, title, agentType, searchMessageId, session: routeSession } = route.params;

  const [messages,  setMessages]  = useState(() => getCachedTranscript(sessionId) || []);
  const [sessionMeta, setSessionMeta] = useState(() => (
    routeSession && typeof routeSession === 'object'
      ? { ...routeSession, session_id: sessionId }
      : { session_id: sessionId, agent_type: agentType }
  ));
  const [liveTitleState, setLiveTitleState] = useState(() => ({
    sessionId,
    projection: routeTitleProjection(title),
  }));
  const [activity,  setActivity]  = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectionHealth, setConnectionHealth] = useState({ state: 'connecting', rttMs: null });
  const [permPrompt, setPermPrompt] = useState(null);   // current permission prompt
  const [errorPrompt, setErrorPrompt] = useState(null); // current actionable error prompt
  const [input,     setInput]     = useState('');
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [sendPending,   setSendPending]   = useState(false);   // waiting for echo
  const [failedMsg,     setFailedMsg]     = useState(null);    // { sessionId, text, clientMsgId }
  const [deliveryStates, setDeliveryStates] = useState({});    // client message id -> delivery lifecycle
  const [queuedMessages, setQueuedMessages] = useState([]);    // proxy/native queue items for this session
  const [reconnectInfo, setReconnectInfo] = useState(null);  // { attempt, nextRetryMs }
  const [unreadCount,   setUnreadCount]   = useState(0);     // new messages while scrolled up
  const [showJumpBtn,   setShowJumpBtn]   = useState(false); // show jump-to-bottom button
  const [agentConfig,   setAgentConfig]   = useState(null);  // per-session config from relay
  const [settingsOpen,  setSettingsOpen]  = useState(false); // agent settings sheet
  const [scheduleOpen,  setScheduleOpen]  = useState(false); // scheduled message sheet
  const [attachment,    setAttachment]    = useState(null);  // { uri, name, mimeType, isText?, content? }
  const [uploading,     setUploading]     = useState(false); // file upload in progress
  const [chatListOpen,  setChatListOpen]  = useState(false); // chat list sheet visible
  const [chatList,      setChatList]      = useState([]);    // [{ id, title, active }]
  const [chatListLoading, setChatListLoading] = useState(false);
  const [threadListOpen, setThreadListOpen] = useState(false);
  const [threadList,     setThreadList]     = useState([]);
  const [threadListLoading, setThreadListLoading] = useState(false);
  const [terminalOpen,   setTerminalOpen]   = useState(false);
  const [terminalEntries, setTerminalEntries] = useState([]);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [diffOpen,       setDiffOpen]       = useState(false);
  const [diffEntries,    setDiffEntries]    = useState([]);
  const [diffLoading,    setDiffLoading]    = useState(false);
  const [branchOpen,     setBranchOpen]     = useState(false);
  const [branchList,     setBranchList]     = useState([]);
  const [branchCurrent,  setBranchCurrent]  = useState('');
  const [branchLoading,  setBranchLoading]  = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [directoryListing, setDirectoryListing] = useState({ path: '.', entries: [] });
  const [viewingFile, setViewingFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileBrowserLoading, setFileBrowserLoading] = useState(false);
  const [fileBrowserError, setFileBrowserError] = useState(null);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [hasOlderHistory, setHasOlderHistory] = useState(false);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [controlResults, setControlResults] = useState({});
  const [provisionalStream, setProvisionalStream] = useState(null);
  const [highlightedSearchMessageId, setHighlightedSearchMessageId] = useState(
    Number.isSafeInteger(Number(searchMessageId)) ? Number(searchMessageId) : null,
  );
  const errorPromptIsBlocking = !!errorPrompt
    && errorPrompt.blocking !== false
    && errorPrompt.display_mode !== 'inline';
  const composerBlockedByPrompt = !!permPrompt || errorPromptIsBlocking;
  const computedTitleProjection = useMemo(() => resolveSessionChatTitleProjection(
    sessionMeta,
    sessionMeta?.custom_display_name || '',
    messages,
  ), [sessionMeta, messages]);
  const liveTitleProjection = liveTitleState.sessionId === sessionId
    ? liveTitleState.projection
    : routeTitleProjection(title);
  const liveChatTitle = liveTitleProjection.title;

  const clientRef       = useRef(null);
  const stateSequenceGateRef = useRef(createStateSequenceGate());
  const flatListRef     = useRef(null);
  const inputRef        = useRef(null);
  const sendTimer       = useRef(null);
  const deliveryStageTimers = useRef({});
  const deliveryRecords = useRef({});
  const deliveryStatesRef = useRef({});
  const isAtBottom      = useRef(true);
  const seenSequences   = useRef(new Set(messages.map(message => message?.sequence).filter(sequence => sequence != null)));
  const messagesSessionIdRef = useRef(sessionId);
  const pendingMsgId    = useRef(null);   // { _id, _text } of in-flight message
  const failedMsgRef    = useRef(null);   // mirrors failedMsg state for use in callbacks
  const messageQueue    = useRef([]);     // offline queue: [{ text, clientMsgId }], max 5
  const scrollMetrics   = useRef({ contentHeight: 0, layoutHeight: 0, offsetY: 0 });
  const configRetryRef  = useRef(null);
  const draftLoadedRef  = useRef(false);
  const historyUserScrolledRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const historyRequestTimerRef = useRef(null);
  const searchMessageIdRef = useRef(Number.isSafeInteger(Number(searchMessageId)) ? Number(searchMessageId) : null);
  const provisionalStreamRef = useRef(null);
  const provisionalFrameRef = useRef(null);
  const provisionalPendingRef = useRef(null);

  function publishProvisionalStream(stream) {
    provisionalStreamRef.current = stream;
    provisionalPendingRef.current = stream;
    if (provisionalFrameRef.current != null) return;
    provisionalFrameRef.current = requestAnimationFrame(() => {
      provisionalFrameRef.current = null;
      const pending = provisionalPendingRef.current;
      provisionalPendingRef.current = null;
      if (pending) setProvisionalStream(pending);
    });
  }

  function clearProvisionalStream() {
    provisionalStreamRef.current = null;
    provisionalPendingRef.current = null;
    setProvisionalStream(null);
  }

  const mergeSessionMetadata = useCallback((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const sid = candidate.session_id || candidate.session || candidate.id;
    if (sid && sid !== sessionId) return;
    setSessionMeta(previous => ({
      ...(previous && typeof previous === 'object' ? previous : {}),
      ...candidate,
      session_id: sessionId,
    }));
  }, [sessionId]);

  useEffect(() => {
    setSessionMeta(routeSession && typeof routeSession === 'object'
      ? { ...routeSession, session_id: sessionId }
      : { session_id: sessionId, agent_type: agentType });
    setLiveTitleState({ sessionId, projection: routeTitleProjection(title) });
  }, [sessionId]);

  useEffect(() => {
    setLiveTitleState(previous => ({
      sessionId,
      projection: retainStrongerSessionChatTitleProjection(
        previous.sessionId === sessionId ? previous.projection : routeTitleProjection(title),
        computedTitleProjection,
      ),
    }));
  }, [sessionId, title, computedTitleProjection]);

  // Keep ref in sync with state for use inside memoized callbacks
  function updateFailedMsg(val) {
    failedMsgRef.current = val;
    setFailedMsg(val);
  }

  function clearDeliveryStageTimeout(clientMsgId) {
    const timer = deliveryStageTimers.current[clientMsgId];
    if (timer) clearTimeout(timer);
    delete deliveryStageTimers.current[clientMsgId];
  }

  function setTrackedDeliveryState(clientMsgId, state) {
    if (!clientMsgId) return;
    deliveryStatesRef.current[clientMsgId] = state;
    setDeliveryStates(prev => ({ ...prev, [clientMsgId]: state }));
  }

  function failDelivery(clientMsgId, reason) {
    if (!clientMsgId) return;
    if (deliveryStatesRef.current[clientMsgId] === 'agent_started') return;
    const record = deliveryRecords.current[clientMsgId];
    clearDeliveryStageTimeout(clientMsgId);
    delete deliveryRecords.current[clientMsgId];
    setTrackedDeliveryState(clientMsgId, 'failed');
    setMessages(prev => prev.map(item => item._cid === clientMsgId
      ? { ...item, _sendError: reason || 'Send failed' }
      : item));
    if (record) updateFailedMsg({
      sessionId,
      text: record.text,
      clientMsgId,
      reason: reason || 'Send failed',
    });
    if (pendingMsgId.current?._id === clientMsgId) {
      clearTimeout(sendTimer.current);
      setSendPending(false);
      pendingMsgId.current = null;
    }
  }

  function armDeliveryStageTimeout(clientMsgId, stage, reason) {
    clearDeliveryStageTimeout(clientMsgId);
    const timeoutMs = DELIVERY_STAGE_TIMEOUT_MS[stage];
    const record = deliveryRecords.current[clientMsgId];
    if (!timeoutMs || !record) return;
    deliveryRecords.current[clientMsgId] = { ...record, stage };
    deliveryStageTimers.current[clientMsgId] = setTimeout(() => {
      delete deliveryStageTimers.current[clientMsgId];
      if (deliveryRecords.current[clientMsgId]?.stage !== stage) return;
      failDelivery(clientMsgId, reason);
    }, timeoutMs);
  }

  function completeDelivery(clientMsgId) {
    clearDeliveryStageTimeout(clientMsgId);
    delete deliveryRecords.current[clientMsgId];
  }

  // ── Navigation header ───────────────────────────────────────────────────────

  const activityLabel = activity?.label || (activity?.generating ? 'Generating…' : null);

  useLayoutEffect(() => {
    // Derive capabilities from agentType (route param) as primary source,
    // fall back to agentConfig from relay if available
    const caps = agentConfig?.capabilities;
    const at = agentType;
    const hasChatList    = caps?.chat_list    ?? (at === 'codex' || at === 'codex-desktop' || at === 'cursor' || at === 'antigravity_panel');
    const hasOpenPanel   = caps?.open_panel   ?? (at === 'codex' || at === 'antigravity_panel');
    const hasNativeWindow = caps?.native_window ?? (at === 'codex_cli' || at === 'cursor_cli');
    const hasThreadList  = caps?.thread_list  ?? (at === 'codex-desktop' || at === 'cursor');
    const hasTerminal    = caps?.terminal_output ?? (at === 'codex' || at === 'codex-desktop');
    const hasFileChanges = caps?.file_changes ?? (at === 'codex' || at === 'codex-desktop' || at === 'cursor');
    const hasFileBrowser = !!caps?.file_browser;
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ alignItems: 'center', maxWidth: 120 }}>
          <Text
            style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}
            numberOfLines={1}
            accessibilityLabel={liveChatTitle}
          >{liveChatTitle}</Text>
          {activityLabel ? (
            <Text style={{ color: '#58a6ff', fontSize: 10, fontStyle: 'italic' }} numberOfLines={1}>{activityLabel}</Text>
          ) : null}
        </View>
      ),
      headerRight: () => (
        <View style={hr.row}>
          {hasOpenPanel && (
            <TouchableOpacity
              onPress={() => clientRef.current?.openPanel(sessionId)}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Panel</Text>
            </TouchableOpacity>
          )}
          {hasNativeWindow && (
            <TouchableOpacity
              onPress={() => clientRef.current?.openNativeWindow(sessionId)}
              style={hr.btn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Open native command window"
            >
              <Text style={hr.btnText}>Native</Text>
            </TouchableOpacity>
          )}
          {hasThreadList && (
            <TouchableOpacity
              onPress={() => {
                setThreadListOpen(true);
                setThreadListLoading(true);
                clientRef.current?.requestThreadList(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Threads</Text>
            </TouchableOpacity>
          )}
          {hasTerminal && (
            <TouchableOpacity
              onPress={() => {
                setTerminalOpen(true);
                setTerminalLoading(true);
                clientRef.current?.requestTerminalOutput(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Term</Text>
            </TouchableOpacity>
          )}
          {hasFileChanges && (
            <TouchableOpacity
              onPress={() => {
                setDiffOpen(true);
                setDiffLoading(true);
                clientRef.current?.requestFileChanges(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Diff</Text>
            </TouchableOpacity>
          )}
          {hasFileBrowser && (
            <TouchableOpacity
              onPress={() => {
                setFileBrowserOpen(true);
                setViewingFile(null);
                setFileBrowserError(null);
                setFileBrowserLoading(true);
                clientRef.current?.requestDirectoryListing(sessionId, '.');
              }}
              style={hr.btn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Browse workspace files"
            >
              <Text style={hr.btnText}>Files</Text>
            </TouchableOpacity>
          )}
          {hasChatList && (
            <TouchableOpacity
              onPress={() => {
                setChatListOpen(true);
                setChatListLoading(true);
                clientRef.current?.requestChatList(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Chats</Text>
            </TouchableOpacity>
          )}
          {agentConfig?.capabilities?.branch_list && agentConfig?.branch && agentConfig.branch !== 'unknown' && (
            <TouchableOpacity
              onPress={() => {
                setBranchOpen(true);
                setBranchLoading(true);
                clientRef.current?.requestBranchList(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>⑂ {agentConfig.branch.length > 10 ? agentConfig.branch.substring(0, 10) + '…' : agentConfig.branch}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setSettingsOpen(true)}
            style={hr.btn}
            activeOpacity={0.7}
          >
            <Text style={hr.gearText}>⚙</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => clientRef.current?.interrupt(sessionId)}
            style={hr.btn}
            activeOpacity={0.7}
          >
            <Text style={hr.btnText}>■ Stop</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, sessionId, liveChatTitle, agentType, agentConfig, activityLabel]);

  // ── Message handler ─────────────────────────────────────────────────────────

  const handleMessage = useCallback((msg) => {
    console.log('[ChatScreen] msg type=', msg.type, 'session=', msg.session_id || msg.session || '');
    if (msg.type === 'connection_ack') stateSequenceGateRef.current.reset(msg.state_epoch);
    const stateSessionId = msg.session || msg.session_id || '';
    const stateKey = msg.type === 'session_list'
      ? 'session_list'
      : ((msg.type === 'status' || msg.type === 'session_summary' || msg.type === 'session_patch') && stateSessionId)
        ? `status:${stateSessionId}`
        : '';
    if (stateKey && !stateSequenceGateRef.current.accept(msg, stateKey)) return;
    switch (msg.type) {
      case '_connected':
        setConnected(true);
        setReconnectInfo(null);
        setHistoryError(null);
        requestHistoryTail();
        clientRef.current?.requestAgentConfig(sessionId);
        // Retry config request after 3s if not received
        clearTimeout(configRetryRef.current);
        configRetryRef.current = setTimeout(() => {
          console.log('[ChatScreen] Config retry for', sessionId);
          clientRef.current?.requestAgentConfig(sessionId);
        }, 3000);
        // Retry failed message
        if (failedMsgRef.current && failedMsgRef.current.sessionId === sessionId) {
          const { text, clientMsgId } = failedMsgRef.current;
          updateFailedMsg(null);
          doSend(text, clientMsgId);
        }
        // Flush offline queue
        if (messageQueue.current.length > 0) {
          const queued = [...messageQueue.current];
          messageQueue.current = [];
          // Remove queued placeholders from messages
          setMessages(prev => prev.filter(m => !m._queued));
          for (const item of queued) {
            doSend(item.text, item.clientMsgId, item.createdAt);
          }
        }
        break;

      case '_disconnected':
        setConnected(false);
        clearProvisionalStream();
        historyLoadingRef.current = false;
        clearTimeout(historyRequestTimerRef.current);
        setHistoryLoadingOlder(false);
        // Mark pending send as failed
        if (pendingMsgId.current) {
          const failedPending = pendingMsgId.current;
          failDelivery(failedPending._id, 'Connection lost before the relay confirmed delivery.');
        }
        if (msg.reason === 'unauthenticated') {
          signOut().then(() => navigation.replace('Login'));
        }
        break;

      case '_reconnecting':
        setReconnectInfo({ attempt: msg.attempt, nextRetryMs: msg.nextRetryMs });
        break;

      case '_connection_health':
        setConnectionHealth({ state: msg.state || 'connecting', rttMs: msg.rttMs ?? null });
        break;

      case 'session_list': {
        const match = (msg.sessions || []).find(item => (
          typeof item === 'object' && (item.session_id || item.id) === sessionId
        ));
        if (match) mergeSessionMetadata(match);
        break;
      }

      case 'session_patch': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) mergeSessionMetadata(msg.patch || {});
        break;
      }

      case 'session_summary': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) mergeSessionMetadata(sessionChatTitleMetadataPatch(msg));
        break;
      }

      case 'session_meta': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) mergeSessionMetadata(msg);
        break;
      }

      case 'message_delta': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        const reduced = reduceMessageDeltaStream(provisionalStreamRef.current, msg);
        if (reduced.accepted) publishProvisionalStream(reduced.stream);
        break;
      }

      case 'transcript_resync_required': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        historyLoadingRef.current = false;
        clearTimeout(historyRequestTimerRef.current);
        clientRef.current?.requestHistoryChunk(sessionId, {
          mode: 'tail',
          limit: HISTORY_PAGE_SIZE,
          replace: true,
        });
        historyLoadingRef.current = true;
        armHistoryTimeout();
        break;
      }

      case 'history': {
        if (msg.session !== sessionId) break;
        const msgs = normalizeTranscriptTimestamps((msg.messages || []).filter(m => {
          if (seenSequences.current.has(m.sequence)) return false;
          seenSequences.current.add(m.sequence);
          return true;
        }));
        setMessages(prev => mergeSorted([...prev, ...msgs]));
        break;
      }

      case 'message': {
        if (msg.session !== sessionId) break;
        if (msg.role === 'assistant') clearProvisionalStream();
        if (msg.sequence != null) {
          if (seenSequences.current.has(msg.sequence)) break;
          seenSequences.current.add(msg.sequence);
        }
        const clientMsgId = msg.client_message_id || msg.client_msg_id || null;
        const nativeDelivered = msg.status === 'delivered' || msg.status === 'agent_started';
        const matchesPending = msg.role === 'user' && pendingMsgId.current &&
          (clientMsgId === pendingMsgId.current._id || (!clientMsgId && msg.content === pendingMsgId.current._text));
        const matchedClientMsgId = matchesPending ? (clientMsgId || pendingMsgId.current._id) : clientMsgId;
        // Detect the authoritative proxy echo of our optimistic user message.
        if (matchesPending) {
          clearTimeout(sendTimer.current);
          setSendPending(false);
          pendingMsgId.current = null;
        }
        setMessages(prev => {
          const withoutOptimisticEcho = msg.role === 'user'
            ? prev.filter(item => !(item._optimistic && (
                (matchedClientMsgId && item._cid === matchedClientMsgId) ||
                (matchesPending && item.content === msg.content)
              )))
            : prev;
          const previousOptimistic = matchesPending
            ? prev.find(item => item._optimistic && (
                (matchedClientMsgId && item._cid === matchedClientMsgId)
                || item.content === msg.content
              ))
            : null;
          return mergeSorted([...withoutOptimisticEcho, normalizeMessageTimestamp({
            ...previousOptimistic,
            ...msg,
            ...(msg.role === 'user' ? {
              _delivered: previousOptimistic?._delivered || nativeDelivered,
              _agentStarted: previousOptimistic?._agentStarted || msg.status === 'agent_started',
              ...(matchedClientMsgId ? { _cid: matchedClientMsgId, _optimistic: true } : {}),
            } : {}),
          })]);
        });
        break;
      }

      case 'history_chunk': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId || (msg.source && msg.source !== 'relay_sqlite')) break;
        historyLoadingRef.current = false;
        clearTimeout(historyRequestTimerRef.current);
        setHistoryLoadingOlder(false);
        if (msg.error && (!msg.messages || msg.messages.length === 0)) {
          setHistoryError(msg.error?.message || msg.error || 'Transcript history could not be loaded.');
          break;
        }
        const authoritativeReplace = msg.mode === 'around' || (msg.mode === 'tail' && msg.replace === true);
        const rawIncoming = normalizeTranscriptTimestamps(Array.isArray(msg.messages) ? msg.messages : []);
        const incoming = authoritativeReplace ? rawIncoming : rawIncoming.filter(message => {
          if (message.sequence == null) return true;
          if (seenSequences.current.has(message.sequence)) return false;
          seenSequences.current.add(message.sequence);
          return true;
        });
        if (authoritativeReplace) {
          seenSequences.current = new Set(incoming.map(message => message?.sequence).filter(sequence => sequence != null));
          setMessages(incoming);
          const targetId = searchMessageIdRef.current;
          const targetIndex = targetId == null
            ? -1
            : incoming.findIndex(message => Number(message?.id) === Number(targetId));
          if (targetIndex >= 0) {
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0.5 });
              setTimeout(() => setHighlightedSearchMessageId(null), 5000);
            });
          }
          searchMessageIdRef.current = null;
        } else {
          setMessages(prev => mergeSorted([...prev, ...incoming]));
        }
        const nextBeforeId = msg.cursor?.next_before_id ?? null;
        setHistoryCursor(nextBeforeId);
        setHasOlderHistory(!!msg.partial && nextBeforeId != null);
        setHistoryError(null);
        break;
      }

      case 'status': {
        // Preserve the canonical activity object. It carries the stable elapsed-time
        // anchor, granular tool label, interrupt hint, and live partial output.
        if (msg.session !== sessionId) break;
        if (shouldClearEmptyProvisionalOnTerminal(
          provisionalStreamRef.current,
          msg.activity || (!msg.thinking ? { kind: 'idle' } : null),
          !!msg.thinking,
        )) clearProvisionalStream();
        if (msg.activity && typeof msg.activity === 'object') {
          const kind = msg.activity.kind || (msg.thinking ? 'thinking' : 'idle');
          setActivity({
            ...msg.activity,
            kind,
            generating: msg.activity.generating ?? msg.thinking ?? ![
              'idle', 'waiting_for_user', 'completed', 'done', 'failed', 'error', 'interrupted',
            ].includes(String(kind).toLowerCase()),
            label: msg.activity.label || msg.label || (msg.thinking ? 'Thinking' : ''),
            thinkingContent: msg.thinking_content
              ?? msg.activity.thinkingContent
              ?? msg.activity.thinking_content
              ?? '',
          });
        } else if (msg.thinking) {
          const now = new Date().toISOString();
          setActivity({
            kind: 'thinking',
            generating: true,
            label: msg.label || 'Thinking',
            started_at: now,
            updated_at: now,
            thinkingContent: msg.thinking_content || '',
          });
        } else {
          setActivity(null);
        }
        break;
      }

      case 'permission_prompt': {
        notePromptForAttentionFeedback(msg, sessionId).catch(() => {});
        if ((msg.session_id || msg.session) !== sessionId) break;
        setPermPrompt({ ...msg, received_at: Date.now() });
        break;
      }

      case 'semantic_notification': {
        processSemanticNotification(msg, sessionId).catch(() => {});
        break;
      }

      case 'permission_prompt_expired': {
        clearPromptAttentionFeedback(msg);
        if ((msg.session_id || msg.session) !== sessionId) break;
        setPermPrompt(prev => prev?.prompt_id === msg.prompt_id ? null : prev);
        break;
      }

      case 'session_error_prompt': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        setErrorPrompt({ ...msg, received_at: Date.now() });
        break;
      }

      case 'session_error_prompt_cleared': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        setErrorPrompt(prev => prev?.prompt_id === msg.prompt_id ? null : prev);
        break;
      }

      case 'connection_ack': {
        // Restore durable prompts and config from the initial handshake.
        const session = (msg.sessions || []).find(item => (
          typeof item === 'object' && (item.session_id || item.id) === sessionId
        ));
        if (session) mergeSessionMetadata(session);
        const openPermission = (msg.open_prompts || [])
          .find(prompt => (prompt.session_id || prompt.session) === sessionId);
        const openError = (msg.open_error_prompts || [])
          .find(prompt => (prompt.session_id || prompt.session) === sessionId);
        if (openPermission) rememberPromptForAttentionFeedback(openPermission);
        setPermPrompt(openPermission ? { ...openPermission, received_at: Date.now() } : null);
        setErrorPrompt(openError ? { ...openError, received_at: Date.now() } : null);
        if (msg.agent_configs && msg.agent_configs[sessionId]) {
          setAgentConfig(msg.agent_configs[sessionId]);
        }
        (msg.semantic_notifications || []).forEach(event => {
          processSemanticNotification(event, sessionId).catch(() => {});
        });
        break;
      }

      case 'agent_config': {
        const sid = msg.session_id || msg.session;
        console.log('[ChatScreen] agent_config received', sid, 'match=', sid === sessionId, 'caps=', JSON.stringify(msg.capabilities));
        if (sid === sessionId) {
          clearTimeout(configRetryRef.current);
          setAgentConfig(msg);
        }
        break;
      }

      case 'agent_control_result': {
        // Config change acknowledged — refresh config
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        if (msg.request_id) {
          setControlResults(prev => ({ ...prev, [msg.request_id]: { ...msg, received_at: Date.now() } }));
        }
        if (msg.command === 'permission_response') {
          if (msg.result === 'ok') {
            clearPromptAttentionFeedback(msg);
            setPermPrompt(null);
          } else if (msg.result === 'failed') {
            setPermPrompt(prev => prev
              ? { ...prev, submitting_choice_id: null, error: msg.error?.message || 'Permission response failed' }
              : null);
          }
        }
        if (msg.command === 'error_prompt_action' && msg.result === 'failed') {
          setErrorPrompt(prev => prev
            ? { ...prev, submitting_action_id: null, error: msg.error?.message || 'Error prompt action failed' }
            : null);
        }
        if (msg.result === 'ok') {
          clientRef.current?.requestAgentConfig(sessionId);
        } else if (msg.result === 'failed') {
          // Stop any loading spinners on failure
          const cmd = msg.command;
          if (cmd === 'thread_list')     setThreadListLoading(false);
          if (cmd === 'chat_list')       setChatListLoading(false);
          if (cmd === 'terminal_output') setTerminalLoading(false);
          if (cmd === 'file_changes')    setDiffLoading(false);
          if (cmd === 'branch_list')     setBranchLoading(false);
          if (cmd === 'list_directory' || cmd === 'read_file') {
            setFileBrowserLoading(false);
            setFileBrowserError(msg.error?.message || msg.error || 'Could not load workspace files.');
          }
          if (cmd === 'open_native_window') {
            Alert.alert('Could not open native window', msg.error?.message || 'The desktop proxy rejected the request.');
          }
          console.warn('[ChatScreen] control failed:', cmd, msg.error);
        }
        break;
      }

      case 'message_accepted': {
        const cid = msg.client_message_id;
        const storedStatus = ['accepted', 'delivered', 'agent_started', 'failed'].includes(msg.status)
          ? msg.status
          : 'accepted';
        const persistedStatus = storedStatus === 'accepted' && msg.launch_accepted_at
          ? 'launch_accepted'
          : storedStatus;
        if (cid && persistedStatus === 'failed') {
          failDelivery(cid, msg.failure_code || 'Send failed.');
          break;
        }
        const current = cid ? deliveryStatesRef.current[cid] : null;
        if (cid && !['busy_queued', 'steered', 'launch_accepted', 'delivered', 'agent_started'].includes(current)) {
          setTrackedDeliveryState(cid, persistedStatus);
          if (persistedStatus === 'accepted') {
            armDeliveryStageTimeout(cid, 'accepted', 'Relay accepted the message, but native delivery timed out.');
          } else if (persistedStatus === 'launch_accepted') {
            armDeliveryStageTimeout(cid, 'launch_accepted', 'The native launch was accepted, but no native user turn was observed.');
          } else if (persistedStatus === 'delivered') {
            armDeliveryStageTimeout(cid, 'delivered', 'Message reached the agent, but agent activity did not start in time.');
          } else {
            clearDeliveryStageTimeout(cid);
          }
        }
        if (cid) {
          setMessages(prev => prev.map(item => item._cid === cid
            ? normalizeMessageTimestamp({
                ...item,
                ...(msg.created_at != null ? { created_at: msg.created_at } : {}),
                ...(msg.timestamp != null ? { timestamp: msg.timestamp } : {}),
                ...(msg.ts != null ? { ts: msg.ts } : {}),
                ...(msg.launch_accepted_at != null ? { _launchAcceptedAt: msg.launch_accepted_at } : {}),
                _delivered: persistedStatus === 'delivered' || persistedStatus === 'agent_started',
                _agentStarted: persistedStatus === 'agent_started',
              })
            : item));
        }
        break;
      }

      case 'message_delivered':
      case 'proxy_send_result': {
        const cid = msg.client_message_id;
        if (!cid) break;
        if (msg.type === 'proxy_send_result' && msg.result === 'failed') {
          failDelivery(cid, msg.reason || msg.message || msg.error?.message || 'The desktop proxy rejected the message.');
          break;
        }
        if (msg.type === 'proxy_send_result' && msg.result === 'launch_accepted') {
          if (!['delivered', 'agent_started'].includes(deliveryStatesRef.current[cid])) {
            setTrackedDeliveryState(cid, 'launch_accepted');
            armDeliveryStageTimeout(cid, 'launch_accepted', 'The native launch was accepted, but no native user turn was observed.');
            setMessages(prev => prev.map(item => item._cid === cid
              ? { ...item, _launchAcceptedAt: msg.accepted_at || new Date().toISOString() }
              : item));
          }
          break;
        }
        if (msg.type === 'proxy_send_result' && msg.result !== 'delivered') break;
        if (deliveryStatesRef.current[cid] !== 'agent_started') {
          setTrackedDeliveryState(cid, 'delivered');
          armDeliveryStageTimeout(cid, 'delivered', 'Message reached the agent, but agent activity did not start in time.');
        }
        setMessages(prev => prev.map(item => item._cid === cid
          ? { ...item, _delivered: true }
          : item));
        if (pendingMsgId.current?._id === cid) {
          clearTimeout(sendTimer.current);
          setSendPending(false);
          pendingMsgId.current = null;
        }
        break;
      }

      case 'agent_started': {
        const cid = msg.client_message_id;
        if (!cid) break;
        const sid = msg.session_id || msg.session;
        if (!sid || sid === sessionId) {
          publishProvisionalStream(createProvisionalStream(sessionId, cid));
        }
        completeDelivery(cid);
        setTrackedDeliveryState(cid, 'agent_started');
        setMessages(prev => prev.map(item => item._cid === cid
          ? { ...item, _delivered: true, _agentStarted: true }
          : item));
        break;
      }

      case 'message_failed': {
        const cid = msg.client_message_id;
        if (!cid) break;
        clearProvisionalStream();
        failDelivery(cid, msg.reason || msg.message || msg.error?.message || 'Send failed.');
        break;
      }

      case 'message_queued': {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (sid && sid !== sessionId) break;
        if (cid) {
          const contentBlocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : [];
          const queuedBlock = contentBlocks.find(block => block?.type === 'queued_message');
          clearDeliveryStageTimeout(cid);
          setTrackedDeliveryState(cid, 'busy_queued');
          if (deliveryRecords.current[cid]) {
            deliveryRecords.current[cid] = { ...deliveryRecords.current[cid], stage: 'busy_queued' };
          }
          setQueuedMessages(prev => {
            const next = {
              cid,
              content: queuedBlock?.content ?? msg.content ?? prev.find(item => item.cid === cid)?.content ?? '',
              content_blocks: contentBlocks,
              queuedAt: msg.queued_at,
            };
            return [...prev.filter(item => item.cid !== cid), next];
          });
          if (pendingMsgId.current?._id === cid) {
            clearTimeout(sendTimer.current);
            setSendPending(false);
            pendingMsgId.current = null;
          }
        }
        break;
      }

      case 'queue_delivered': {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (sid && sid !== sessionId) break;
        if (cid) {
          setTrackedDeliveryState(cid, 'accepted');
          armDeliveryStageTimeout(cid, 'accepted', 'Queued message left the relay, but native delivery timed out.');
          setQueuedMessages(prev => prev.filter(item => item.cid !== cid));
        }
        break;
      }

      case 'steer_result': {
        const cid = msg.client_message_id;
        const sid = msg.session_id || msg.session;
        if (sid && sid !== sessionId) break;
        if (cid) {
          if (msg.result === 'ok') {
            setTrackedDeliveryState(cid, 'steered');
            armDeliveryStageTimeout(cid, 'steered', 'Message was steered, but agent activity did not start in time.');
          } else {
            failDelivery(cid, msg.error?.message || msg.error || 'The desktop proxy rejected the message.');
          }
          const error = msg.error?.message || msg.error || 'The desktop proxy rejected the request.';
          setQueuedMessages(prev => msg.result === 'ok'
            ? prev.filter(item => item.cid !== cid)
            : prev.map(item => item.cid === cid
              ? { ...item, pending_action: null, error }
              : item));
          if (msg.result !== 'ok') Alert.alert('Could not steer message', error);
        }
        break;
      }

      case 'native_queue': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        const nativeItems = (msg.items || []).map((item, index) => ({
          cid: `native-${index}`,
          content: item.content_blocks?.find(block => block?.type === 'queued_message')?.content ?? item.text ?? '',
          content_blocks: Array.isArray(item.content_blocks) ? item.content_blocks : [],
          native: true,
          nativeIndex: item.index,
          status: item.state || 'queued',
        }));
        setQueuedMessages(prev => [
          ...prev.filter(item => !item.native),
          ...nativeItems,
        ]);
        break;
      }

      case 'directory_listing': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        setDirectoryListing({ path: msg.path || '.', entries: msg.entries || [] });
        setViewingFile(null);
        setFileBrowserLoading(false);
        setFileBrowserError(null);
        break;
      }

      case 'file_content': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        setViewingFile(msg.path);
        setFileContent({ path: msg.path, content: msg.content || '', truncated: !!msg.truncated });
        setFileBrowserLoading(false);
        setFileBrowserError(null);
        break;
      }

      case 'chat_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          const chats = msg.chats || [];
          setChatList(chats);
          const activeChat = chats.find(item => item?.active);
          if (activeChat?.title) mergeSessionMetadata({ native_chat_title: activeChat.title });
          setChatListLoading(false);
        }
        break;
      }

      case 'thread_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          const threads = msg.threads || [];
          setThreadList(threads);
          const activeThread = threads.find(item => item?.active);
          if (activeThread?.title) mergeSessionMetadata({ native_chat_title: activeThread.title });
          setThreadListLoading(false);
        }
        break;
      }

      case 'branch_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setBranchList(msg.branches || []);
          setBranchCurrent(msg.current || '');
          setBranchLoading(false);
        }
        break;
      }

      case 'terminal_output': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setTerminalEntries(msg.entries || []);
          setTerminalLoading(false);
        }
        break;
      }

      case 'file_changes': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setDiffEntries(msg.entries || []);
          setDiffLoading(false);
        }
        break;
      }

      default:
        break;
    }
  }, [sessionId, navigation, mergeSessionMetadata]);

  // ── Connect on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    clearTimeout(sendTimer.current);
    Object.values(deliveryStageTimers.current).forEach(timer => clearTimeout(timer));
    deliveryStageTimers.current = {};
    deliveryRecords.current = {};
    deliveryStatesRef.current = {};
    pendingMsgId.current = null;
    setSendPending(false);
    setDeliveryStates({});
    setControlResults({});
    updateFailedMsg(null);
    clearProvisionalStream();
    const cached = getCachedTranscript(sessionId) || [];
    messagesSessionIdRef.current = sessionId;
    setMessages(cached);
    seenSequences.current = new Set(cached.map(message => message?.sequence).filter(sequence => sequence != null));
    setHistoryCursor(null);
    setHasOlderHistory(false);
    setHistoryLoadingOlder(false);
    setHistoryError(null);
    historyLoadingRef.current = false;
    historyUserScrolledRef.current = false;
    searchMessageIdRef.current = Number.isSafeInteger(Number(searchMessageId)) ? Number(searchMessageId) : null;
    setHighlightedSearchMessageId(searchMessageIdRef.current);
    clearTimeout(historyRequestTimerRef.current);
  }, [sessionId, searchMessageId]);

  useEffect(() => {
    if (messagesSessionIdRef.current !== sessionId) return;
    setCachedTranscript(sessionId, messages);
  }, [sessionId, messages]);

  useEffect(() => {
    refreshAttentionHapticPreference().catch(() => {});
    const client = new RelayClient(handleMessage);
    client.setSessionSubscriptions([sessionId]);
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
      clearTimeout(sendTimer.current);
      Object.values(deliveryStageTimers.current).forEach(timer => clearTimeout(timer));
      deliveryStageTimers.current = {};
      deliveryRecords.current = {};
      clearTimeout(configRetryRef.current);
      clearTimeout(historyRequestTimerRef.current);
      if (provisionalFrameRef.current != null) cancelAnimationFrame(provisionalFrameRef.current);
      provisionalFrameRef.current = null;
      provisionalPendingRef.current = null;
    };
  }, [handleMessage]);

  // Restore and persist a separate composer draft for every session.
  useEffect(() => {
    let active = true;
    draftLoadedRef.current = false;
    AsyncStorage.getItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`)
      .then(value => {
        if (active) setInput(value || '');
      })
      .catch(() => {})
      .finally(() => {
        if (active) draftLoadedRef.current = true;
      });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!draftLoadedRef.current) return undefined;
    const timer = setTimeout(() => {
      const key = `${DRAFT_STORAGE_PREFIX}${sessionId}`;
      const op = input ? AsyncStorage.setItem(key, input) : AsyncStorage.removeItem(key);
      op.catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [input, sessionId]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  const prevMsgCount = useRef(0);
  const historyLoaded = useRef(false);
  useEffect(() => {
    const newCount = messages.length - prevMsgCount.current;
    prevMsgCount.current = messages.length;
    if (messages.length === 0) return;

    // Don't count initial history load as "new" messages
    if (!historyLoaded.current) {
      historyLoaded.current = true;
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
      return;
    }

    if (isAtBottom.current) {
      setUnreadCount(0);
      setShowJumpBtn(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } else if (newCount > 0) {
      setUnreadCount(prev => prev + newCount);
      setShowJumpBtn(true);
    }
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────────────

  function doSend(text, clientMsgId, originalCreatedAt = null) {
    const id = clientMsgId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const retryMessage = messages.find(item => item._cid === id);
    const createdAt = parseMessageInstant(originalCreatedAt)?.iso
      || messageInstant(retryMessage)?.iso
      || new Date().toISOString();
    clearDeliveryStageTimeout(id);
    deliveryRecords.current[id] = { text, stage: 'queued' };
    pendingMsgId.current = { _id: id, _text: text };
    setSendPending(true);
    setTrackedDeliveryState(id, 'queued');
    setMessages(prev => prev.some(item => item._cid === id)
      ? prev.map(item => item._cid === id
        ? { ...item, content: text, _optimistic: true, _queued: false, _delivered: false, _agentStarted: false, _sendError: null }
        : item)
      : [...prev, normalizeMessageTimestamp({
          role: 'user',
          content: text,
          _cid: id,
          _optimistic: true,
          created_at: createdAt,
        })]);
    updateFailedMsg(null);
    clientRef.current.sendMessage(sessionId, text, id, createdAt);
    armDeliveryStageTimeout(id, 'queued', 'Timed out waiting for relay acceptance.');

    // Bound the composer while the stage-specific lifecycle timer owns the retry state.
    clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      if (pendingMsgId.current?._id === id) {
        failDelivery(id, 'Timed out waiting for relay acceptance.');
      }
    }, DELIVERY_STAGE_TIMEOUT_MS.queued);
  }

  // ── Attachment helpers ──────────────────────────────────────────────────────

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const name = asset.fileName || `photo-${Date.now()}.jpg`;
    setAttachment({ uri: asset.uri, name, mimeType: asset.mimeType || 'image/jpeg' });
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const isText = isTextFile(asset.name) && (asset.size || 0) < 500 * 1024;
    if (isText) {
      try {
        const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
        setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, isText: true, content });
      } catch {
        setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
      }
    } else {
      setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    }
  }

  function showAttachmentPicker() {
    Alert.alert('Attach', null, [
      { text: 'Photo / Gallery', onPress: pickImage },
      { text: 'File', onPress: pickFile },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function uploadAttachment(att) {
    const jwt = await getStoredJwt();
    const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: FileSystem.EncodingType.Base64 });
    const resp = await fetch(`${RELAY_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `connect.sid=_; token=${jwt}`,
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ filename: att.name, content: base64, mimeType: att.mimeType }),
    });
    if (!resp.ok) throw new Error('Upload failed');
    const { url } = await resp.json();
    return url;
  }

  async function handleSend() {
    const text = input.trim();
    if (!text && !attachment) return;
    setInput('');
    Keyboard.dismiss();

    let content = '';

    if (attachment) {
      const att = attachment;
      setAttachment(null);

      if (att.isText && att.content) {
        const lang = getLang(att.name);
        content = `\`${att.name}\`\n\`\`\`${lang}\n${att.content}\n\`\`\``;
        if (text) content += `\n\n${text}`;
      } else {
        // For codex-desktop with send_attachment + image: inject directly
        const caps = agentConfig?.capabilities || {};
        if (caps.send_attachment && (att.mimeType || '').startsWith('image/')) {
          setUploading(true);
          try {
            const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: FileSystem.EncodingType.Base64 });
            clientRef.current?.sendAttachment(sessionId, base64, att.mimeType, att.name);
            content = text || `[Image: ${att.name}]`;
          } catch {
            Alert.alert('Attachment failed', 'Could not send image to Codex.');
            setInput(text);
            setAttachment(att);
            setUploading(false);
            return;
          }
          setUploading(false);
        } else {
          // Upload binary file/image via relay server
          setUploading(true);
          try {
            const url = await uploadAttachment(att);
            content = `[File: ${att.name}](${url})`;
            if (text) content += `\n\n${text}`;
          } catch {
            Alert.alert('Upload failed', 'Could not upload the file. Try again.');
            setInput(text);
            setAttachment(att);
            setUploading(false);
            return;
          }
          setUploading(false);
        }
      }
    } else {
      content = text;
    }

    // If disconnected or already pending, queue the message (max 5)
    if (!connected || sendPending) {
      if (messageQueue.current.length >= 5) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const createdAt = new Date().toISOString();
      messageQueue.current.push({ text: content, clientMsgId: id, createdAt });
      setDeliveryStates(prev => ({ ...prev, [id]: connected ? 'busy_queued' : 'offline_queued' }));
      setMessages(prev => [...prev, normalizeMessageTimestamp({
        role: 'user', content, _queued: true, _cid: id, _optimistic: true,
        sequence: -(messageQueue.current.length),
        created_at: createdAt,
      })]);
      return;
    }

    doSend(content);
  }

  function handleRetry() {
    if (!failedMsg || !clientRef.current) return;
    const { text, clientMsgId } = failedMsg;
    doSend(text, clientMsgId);
  }

  function handlePermChoice(promptId, choiceId, details = {}) {
    const submittingChoiceId = choiceId || (Array.isArray(details.answers) ? 'question_answers' : null);
    setPermPrompt(prev => prev
      ? { ...prev, submitting_choice_id: submittingChoiceId, error: null }
      : null);
    clientRef.current?.respondToPermission(sessionId, promptId, choiceId, details);
  }

  function handleErrorPromptAction(promptId, actionId) {
    setErrorPrompt(prev => prev
      ? { ...prev, submitting_action_id: actionId, error: null }
      : null);
    clientRef.current?.respondToErrorPrompt(sessionId, promptId, actionId);
  }

  function handleSteerQueued(item) {
    setDeliveryStates(prev => ({ ...prev, [item.cid]: 'busy_queued' }));
    setQueuedMessages(prev => prev.map(queued => queued.cid === item.cid
      ? { ...queued, pending_action: 'steer', error: null }
      : queued));
    clientRef.current?.steerMessage(sessionId, item.cid, item.content, item.nativeIndex);
  }

  function handleDiscardQueued(item) {
    clientRef.current?.discardQueuedMessage(sessionId, item.cid);
    setQueuedMessages(prev => prev.filter(queued => queued.cid !== item.cid));
    setDeliveryStates(prev => {
      const next = { ...prev };
      delete next[item.cid];
      return next;
    });
    setMessages(prev => prev.filter(message => message._cid !== item.cid));
  }

  function handleEditQueued(item, content) {
    setQueuedMessages(prev => prev.map(queued => queued.cid === item.cid
      ? {
        ...queued,
        content,
        content_blocks: (queued.content_blocks || []).map(block => block?.type === 'queued_message'
          ? { ...block, content }
          : block),
      }
      : queued));
    setMessages(prev => prev.map(message => message._cid === item.cid
      ? { ...message, content }
      : message));
    clientRef.current?.editQueuedMessage(sessionId, item.cid, content);
  }

  function navigateFileBrowser(path) {
    setViewingFile(null);
    setFileContent(null);
    setFileBrowserError(null);
    setFileBrowserLoading(true);
    clientRef.current?.requestDirectoryListing(sessionId, path || '.');
  }

  function openFilePreview(path) {
    setViewingFile(path);
    setFileContent(null);
    setFileBrowserError(null);
    setFileBrowserLoading(true);
    clientRef.current?.requestFileContent(sessionId, path);
  }

  function refreshFileBrowser() {
    setFileBrowserError(null);
    setFileBrowserLoading(true);
    if (viewingFile) clientRef.current?.requestFileContent(sessionId, viewingFile);
    else clientRef.current?.requestDirectoryListing(sessionId, directoryListing.path || '.');
  }

  async function shareSessionExport(format) {
    try {
      const jwt = await getStoredJwt();
      if (!jwt) throw new Error('Sign in again to export this session.');
      const response = await fetch(`${RELAY_URL}/api/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const body = await response.text();
      if (!response.ok) {
        let message = '';
        try { message = JSON.parse(body).error || ''; } catch {}
        throw new Error(message || 'Unable to export this session.');
      }
      await Share.share({
        title: `${title || 'Session'} export`,
        message: body,
      });
    } catch (error) {
      Alert.alert('Export failed', error?.message || 'Unable to export this session.');
    }
  }

  function loadOlderHistory() {
    if (!hasOlderHistory || historyLoadingRef.current || historyCursor == null || !connected) return;
    historyLoadingRef.current = true;
    setHistoryLoadingOlder(true);
    setHistoryError(null);
    clientRef.current?.requestHistoryChunk(sessionId, {
      mode: 'older',
      beforeId: historyCursor,
      limit: HISTORY_PAGE_SIZE,
    });
    armHistoryTimeout();
  }

  function retryHistoryTail() {
    if (historyLoadingRef.current || !connected) return;
    requestHistoryTail();
  }

  function requestHistoryTail() {
    historyLoadingRef.current = true;
    setHistoryError(null);
    const aroundId = searchMessageIdRef.current;
    clientRef.current?.requestHistoryChunk(sessionId, aroundId
      ? { mode: 'around', aroundId, limit: HISTORY_PAGE_SIZE }
      : { mode: 'tail', limit: HISTORY_PAGE_SIZE });
    armHistoryTimeout();
  }

  function armHistoryTimeout() {
    clearTimeout(historyRequestTimerRef.current);
    historyRequestTimerRef.current = setTimeout(() => {
      historyLoadingRef.current = false;
      setHistoryLoadingOlder(false);
      setHistoryError('Transcript history timed out. Tap to retry.');
    }, 15000);
  }

  const slashQuery = input.startsWith('/') ? input.slice(1).trim().toLowerCase() : '';
  const filteredSlashCommands = input.startsWith('/')
    && !slashMenuDismissed
    ? SLASH_COMMANDS.filter(item => item.command.slice(1).includes(slashQuery))
    : [];

  function applySlashCommand(command) {
    setInput(`${command} `);
    setSlashMenuDismissed(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {!connected && (
        <View style={s.disconnectBanner}>
          <Text style={s.disconnectText}>
            {reconnectInfo && reconnectInfo.attempt >= 5
              ? "Can't reach server — check connection"
              : reconnectInfo
                ? `Reconnecting (attempt ${reconnectInfo.attempt}, retry in ${Math.round(reconnectInfo.nextRetryMs / 1000)}s)…`
                : 'Reconnecting…'}
          </Text>
        </View>
      )}
      {connected && (
        <View style={s.connectionHealthBar} accessibilityLabel={`Relay ${connectionHealth.state}`}>
          <View style={[
            s.connectionHealthDot,
            { backgroundColor: connectionHealth.state === 'healthy' ? '#3fb950' : connectionHealth.state === 'slow' ? '#d29922' : '#f0883e' },
          ]} />
          <Text style={s.connectionHealthText}>
            {`Relay ${connectionHealth.state}${connectionHealth.rttMs != null ? ` · ${connectionHealth.rttMs} ms` : ''}`}
          </Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={stableTranscriptMessageKey}
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        updateCellsBatchingPeriod={16}
        windowSize={9}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          flatListRef.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
          setTimeout(() => flatListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }), 120);
        }}
        renderItem={({ item }) => (
          <View style={Number(item?.id) === Number(highlightedSearchMessageId) ? s.searchMatch : null}>
            <MessageBubble
              message={item}
              agentType={agentType}
              deliveryState={item._cid ? deliveryStates[item._cid] : null}
            />
          </View>
        )}
        contentContainerStyle={s.messageList}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={hasOlderHistory || historyLoadingOlder || historyError ? (
          <View style={s.historyHeader}>
            {!!historyError && <Text style={s.historyError} accessibilityRole="alert">{historyError}</Text>}
            {!!historyError && !hasOlderHistory && (
              <TouchableOpacity style={s.historyButton} onPress={retryHistoryTail} accessibilityRole="button">
                <Text style={s.historyButtonText}>Retry history</Text>
              </TouchableOpacity>
            )}
            {hasOlderHistory && (
              <TouchableOpacity
                style={s.historyButton}
                onPress={loadOlderHistory}
                disabled={historyLoadingOlder}
                accessibilityRole="button"
              >
                {historyLoadingOlder
                  ? <ActivityIndicator size="small" color="#58a6ff" />
                  : <Text style={s.historyButtonText}>Load earlier messages</Text>}
              </TouchableOpacity>
            )}
          </View>
        ) : null}
        ListFooterComponent={provisionalStream ? <ProvisionalBubble stream={provisionalStream} /> : null}
        onScroll={e => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          scrollMetrics.current = {
            contentHeight: contentSize.height,
            layoutHeight: layoutMeasurement.height,
            offsetY: contentOffset.y,
          };
          const distFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
          if (contentOffset.y > 100) historyUserScrolledRef.current = true;
          if (contentOffset.y < 60 && historyUserScrolledRef.current && hasOlderHistory && !historyLoadingOlder) {
            loadOlderHistory();
          }
          const wasAtBottom = isAtBottom.current;
          isAtBottom.current = distFromBottom < 80;
          if (!wasAtBottom && isAtBottom.current) {
            setUnreadCount(0);
            setShowJumpBtn(false);
          }
          // Show jump button when scrolled significantly up from bottom
          if (!isAtBottom.current && distFromBottom > 200) {
            setShowJumpBtn(true);
          }
        }}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          // Re-evaluate bottom state when content size changes (new messages)
          const { contentHeight, layoutHeight, offsetY } = scrollMetrics.current;
          if (contentHeight > 0) {
            const dist = contentHeight - offsetY - layoutHeight;
            // If we were at the bottom before the content grew, stay at bottom
            if (isAtBottom.current) {
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 30);
            }
          }
        }}
        ListEmptyComponent={provisionalStream ? null : (
          <View style={s.emptyList}>
            <Text style={s.emptyText}>No messages yet</Text>
          </View>
        )}
      />

      {showJumpBtn && (
        <TouchableOpacity
          style={s.scrollToBottom}
          activeOpacity={0.8}
          onPress={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
            setUnreadCount(0);
            setShowJumpBtn(false);
          }}
        >
          <Text style={s.scrollToBottomText}>
            {unreadCount > 0
              ? `↓ ${unreadCount} new message${unreadCount === 1 ? '' : 's'}`
              : '↓ Jump to newest'}
          </Text>
        </TouchableOpacity>
      )}

      <ActivityRow activity={activity} agentType={agentType} />
      <PermissionPrompt prompt={permPrompt} agentType={agentType} onChoice={handlePermChoice} />
      <ErrorPrompt
        prompt={permPrompt ? null : errorPrompt}
        blocking={errorPromptIsBlocking}
        onAction={handleErrorPromptAction}
      />

      {failedMsg && (
        <TouchableOpacity style={s.failedRow} onPress={handleRetry} activeOpacity={0.7}>
          <Text style={s.failedText}>{failedMsg.reason || 'Send failed'} — tap to retry</Text>
        </TouchableOpacity>
      )}

      <QueuedMessageBar
        items={queuedMessages}
        onSteer={handleSteerQueued}
        onDiscard={handleDiscardQueued}
        onEdit={handleEditQueued}
      />

      {attachment && (
        <View style={s.attachPreview}>
          {attachment.mimeType?.startsWith('image/') ? (
            <Image source={{ uri: attachment.uri }} style={s.attachThumb} />
          ) : (
            <View style={s.attachFileIcon}>
              <Text style={s.attachFileEmoji}>📄</Text>
            </View>
          )}
          <Text style={s.attachName} numberOfLines={1}>{attachment.name}</Text>
          <TouchableOpacity onPress={() => setAttachment(null)} style={s.attachRemove}>
            <Text style={s.attachRemoveText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {filteredSlashCommands.length > 0 && (
        <View style={s.slashMenu} accessibilityRole="menu">
          {filteredSlashCommands.map(item => (
            <TouchableOpacity
              key={item.command}
              style={s.slashItem}
              onPress={() => applySlashCommand(item.command)}
              accessibilityRole="menuitem"
              accessibilityLabel={`${item.command}. ${item.detail}`}
            >
              <Text style={s.slashCommand}>{item.command}</Text>
              <Text style={s.slashDetail}>{item.detail}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.inputRow}>
        <TouchableOpacity
          style={s.attachBtn}
          onPress={showAttachmentPicker}
          activeOpacity={0.7}
          disabled={uploading}
        >
          <Text style={s.attachBtnText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={input}
          onChangeText={value => {
            setInput(value);
            setSlashMenuDismissed(false);
          }}
          placeholder="Message…"
          placeholderTextColor="#444c56"
          multiline
          maxLength={4000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[s.attachBtn, !input.trim() && s.sendBtnDisabled]}
          onPress={() => setScheduleOpen(true)}
          disabled={!input.trim()}
          accessibilityRole="button"
          accessibilityLabel="Schedule message"
        ><Text style={s.attachBtnText}>◷</Text></TouchableOpacity>
        <TouchableOpacity
          style={[s.sendBtn, (!input.trim() && !attachment || sendPending || uploading || composerBlockedByPrompt) && s.sendBtnDisabled]}
          onPress={handleSend}
          disabled={(!input.trim() && !attachment) || sendPending || uploading || composerBlockedByPrompt}
          activeOpacity={0.7}
        >
          {sendPending || uploading ? (
            <ActivityIndicator size="small" color="#58a6ff" />
          ) : (
            <Text style={s.sendBtnText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>

      <AgentSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        agentType={agentType}
        config={agentConfig}
        relay={clientRef.current}
        sessionId={sessionId}
        controlResults={controlResults}
        onExport={shareSessionExport}
      />
      <ScheduledSendSheet
        visible={scheduleOpen}
        sessionId={sessionId}
        initialContent={input}
        onCreated={() => setInput('')}
        onClose={() => setScheduleOpen(false)}
      />

      <TerminalViewer
        visible={terminalOpen}
        entries={terminalEntries}
        loading={terminalLoading}
        onRefresh={() => {
          setTerminalLoading(true);
          clientRef.current?.requestTerminalOutput(sessionId);
        }}
        onClose={() => setTerminalOpen(false)}
        onSendInput={(agentType === 'codex-desktop' || agentType === 'cursor') ? (text) => {
          clientRef.current?.sendTerminalInput(sessionId, text);
        } : undefined}
      />

      <DiffViewer
        visible={diffOpen}
        entries={diffEntries}
        loading={diffLoading}
        onRefresh={() => {
          setDiffLoading(true);
          clientRef.current?.requestFileChanges(sessionId);
        }}
        onAccept={(changeId) => clientRef.current?.respondToFileChange(sessionId, changeId, 'accept')}
        onReject={(changeId) => clientRef.current?.respondToFileChange(sessionId, changeId, 'reject')}
        onClose={() => setDiffOpen(false)}
      />

      <FileBrowserSheet
        visible={fileBrowserOpen}
        listing={directoryListing}
        viewingFile={viewingFile}
        fileContent={fileContent}
        loading={fileBrowserLoading}
        error={fileBrowserError}
        onNavigate={navigateFileBrowser}
        onOpenFile={openFilePreview}
        onBack={() => {
          setViewingFile(null);
          setFileContent(null);
          setFileBrowserError(null);
        }}
        onRefresh={refreshFileBrowser}
        onClose={() => {
          setFileBrowserOpen(false);
          setViewingFile(null);
          setFileContent(null);
          setFileBrowserError(null);
        }}
      />

      <ThreadHistorySheet
        visible={threadListOpen}
        threads={threadList}
        loading={threadListLoading}
        onSwitch={(threadId) => {
          clientRef.current?.switchThread(sessionId, threadId);
          setThreadListOpen(false);
        }}
        onNew={() => {
          clientRef.current?.newChat(sessionId);
          setThreadListOpen(false);
        }}
        onClose={() => setThreadListOpen(false)}
      />

      <ChatListSheet
        visible={chatListOpen}
        chats={chatList}
        loading={chatListLoading}
        onSwitch={(chatId) => {
          clientRef.current?.switchChat(sessionId, chatId);
          setChatListOpen(false);
        }}
        onNew={() => {
          clientRef.current?.newChat(sessionId);
          setChatListOpen(false);
        }}
        onClose={() => setChatListOpen(false)}
      />

      <BranchSelectorSheet
        visible={branchOpen}
        branches={branchList}
        current={branchCurrent || agentConfig?.branch || ''}
        loading={branchLoading}
        onSwitch={(branchName) => {
          clientRef.current?.switchBranch(sessionId, branchName);
          setBranchOpen(false);
        }}
        onCreate={(branchName) => {
          clientRef.current?.createBranch(sessionId, branchName);
          setBranchOpen(false);
        }}
        onClose={() => setBranchOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.py', '.sh', '.bat',
  '.css', '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.sql', '.rs', '.go', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.lua', '.swift', '.r', '.m', '.pl', '.php', '.dart',
]);

function isTextFile(name) {
  const ext = (name || '').match(/\.[^.]+$/)?.[0]?.toLowerCase();
  return ext ? TEXT_EXTS.has(ext) : false;
}

function getLang(name) {
  const ext = (name || '').match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';
  const map = { js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', sh: 'bash', bat: 'batch', rs: 'rust', rb: 'ruby', kt: 'kotlin', cs: 'csharp', cpp: 'cpp', hpp: 'cpp' };
  return map[ext] || ext;
}

function mergeSorted(msgs) {
  const seen = new Set();
  return msgs
    .filter(m => {
      const key = m.source_message_id ? `source:${m.source_message_id}`
        : m.native_source_id ? `native:${m.native_source_id}`
        : m.id != null ? `id:${m.id}`
        : m.server_message_id != null ? `server:${m.server_message_id}`
        : m.sequence != null ? `seq:${m.sequence}`
        : m._cid ? `client:${m._cid}`
        : `ts:${messageInstant(m)?.iso || 'unknown'}:${m.role}:${String(m.content)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

// ── Styles ────────────────────────────────────────────────────────────────────

const hr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center' },
  btn:      { marginRight: 4, paddingVertical: 6, paddingHorizontal: 2 },
  btnText:  { color: '#f85149', fontSize: 11, fontWeight: '600' },
  gearText: { color: '#768390', fontSize: 16 },
});

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0b0f14',
  },
  disconnectBanner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#f0883e',
    paddingVertical:   6,
    alignItems:        'center',
  },
  disconnectText: {
    color:    '#f0883e',
    fontSize: 12,
  },
  connectionHealthBar: {
    minHeight: 24,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0d1117',
  },
  connectionHealthDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  connectionHealthText: {
    color: '#8b949e',
    fontSize: 11,
  },
  messageList: {
    paddingVertical: 12,
    flexGrow:        1,
  },
  searchMatch: {
    borderWidth: 2,
    borderColor: '#d29922',
    borderRadius: 10,
    backgroundColor: '#d2992222',
  },
  provisionalWrapper: {
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  provisionalBubble: {
    maxWidth: '92%',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(88, 166, 255, 0.35)',
    paddingLeft: 12,
    paddingVertical: 4,
  },
  provisionalText: {
    color: '#c9d1d9',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  provisionalTimestamp: {
    color: '#8b949e',
    fontSize: 12,
    lineHeight: 16,
    minWidth: 68,
    marginTop: 3,
    marginLeft: 14,
    fontVariant: ['tabular-nums'],
  },
  provisionalCaret: {
    width: 7,
    height: 16,
    marginTop: 3,
    borderRadius: 1,
    backgroundColor: '#58a6ff',
    opacity: 0.75,
  },
  historyHeader: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  historyButton: {
    minHeight: 36,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 18,
    backgroundColor: '#161b22',
    paddingHorizontal: 14,
  },
  historyButtonText: { color: '#58a6ff', fontSize: 12, fontWeight: '700' },
  historyError: { color: '#ff7b72', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  emptyList: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    paddingTop:     60,
  },
  emptyText: {
    color:    '#444c56',
    fontSize: 14,
  },
  scrollToBottom: {
    alignSelf:        'center',
    backgroundColor:  '#1f4d8a',
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderRadius:     16,
    marginVertical:    4,
  },
  scrollToBottomText: {
    color:      '#cdd9e5',
    fontSize:   12,
    fontWeight:  '600',
  },
  failedRow: {
    backgroundColor: '#3d1a1a',
    borderTopWidth:  1,
    borderTopColor:  '#f85149',
    paddingVertical: 8,
    alignItems:      'center',
  },
  failedText: {
    color:    '#f85149',
    fontSize: 12,
    fontWeight: '600',
  },
  attachPreview: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  '#161b22',
    borderTopWidth:   1,
    borderTopColor:   '#30363d',
    paddingHorizontal: 12,
    paddingVertical:   8,
    gap:              8,
  },
  attachThumb: {
    width:        40,
    height:       40,
    borderRadius: 6,
    backgroundColor: '#21262d',
  },
  attachFileIcon: {
    width:           40,
    height:          40,
    borderRadius:    6,
    backgroundColor: '#21262d',
    justifyContent:  'center',
    alignItems:      'center',
  },
  attachFileEmoji: {
    fontSize: 20,
  },
  attachName: {
    flex:     1,
    color:    '#cdd9e5',
    fontSize: 13,
  },
  attachRemove: {
    padding: 4,
  },
  attachRemoveText: {
    color:    '#768390',
    fontSize: 16,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection:   'row',
    alignItems:      'flex-end',
    padding:         10,
    borderTopWidth:  1,
    borderTopColor:  '#30363d',
    backgroundColor: '#161b22',
    gap:             8,
  },
  slashMenu: {
    marginHorizontal: 10,
    marginBottom:      4,
    paddingVertical:   4,
    borderWidth:       1,
    borderColor:       '#30363d',
    borderRadius:      10,
    backgroundColor:   '#1c2128',
    overflow:          'hidden',
  },
  slashItem: {
    paddingHorizontal: 12,
    paddingVertical:   8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363d',
  },
  slashCommand: {
    color:      '#58a6ff',
    fontSize:   13,
    fontWeight: '700',
  },
  slashDetail: {
    color:     '#8b949e',
    fontSize:  11,
    marginTop: 2,
  },
  attachBtn: {
    width:          36,
    height:         40,
    justifyContent: 'center',
    alignItems:     'center',
  },
  attachBtnText: {
    fontSize: 20,
  },
  input: {
    flex:             1,
    minHeight:        40,
    maxHeight:        120,
    backgroundColor:  '#21262d',
    borderRadius:     10,
    borderWidth:      1,
    borderColor:      '#30363d',
    color:            '#cdd9e5',
    fontSize:         14,
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  sendBtn: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: '#58a6ff',
    justifyContent:  'center',
    alignItems:      'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#21262d',
  },
  sendBtnText: {
    color:      '#0b0f14',
    fontSize:   18,
    fontWeight: '700',
  },
});
