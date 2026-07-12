import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Animated,
  LayoutAnimation, Platform, UIManager,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RelayClient }   from '../lib/relay';
import {
  DEFAULT_GROUP_ALIASES,
  GROUP_ALIAS_STORAGE_KEY,
  groupSessionsByDirectory,
  normalizeGroupAliases,
} from '../lib/workspace-groups';
import { getStoredJwt, getJwtDaysRemaining, RELAY_URL, signOut } from '../lib/auth';
import { registerForPushNotifications, subscribeToTokenRefresh } from '../lib/notifications';
import { AgentIcon } from '../components/AgentIcons';
import SessionHistorySheet from '../components/SessionHistorySheet';
import LaunchSessionSheet from '../components/LaunchSessionSheet';
import SessionPreferencesSheet from '../components/SessionPreferencesSheet';

const COLLAPSED_DIRECTORY_KEY = 'remote-agent-chat:collapsed-directories:v1';

export default function SessionListScreen({ navigation }) {
  const [sessions,    setSessions]    = useState([]);
  const [activities,  setActivities]  = useState({});  // sessionId → activity obj | null
  const [connected,   setConnected]   = useState(false);
  const [connectionHealth, setConnectionHealth] = useState({ state: 'connecting', rttMs: null });
  const [loading,     setLoading]     = useState(true);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [reconnectInfo, setReconnectInfo] = useState(null); // { attempt, nextRetryMs }
  const [jwtDaysLeft,   setJwtDaysLeft]   = useState(null); // days until JWT expiry
  const [healthMap,     setHealthMap]     = useState({});    // sessionId → 'healthy'|'degraded'|'disconnected'
  const [unreadMap,     setUnreadMap]     = useState({});    // sessionId → unread count
  const [showHistory,   setShowHistory]   = useState(false);
  const [permPrompts,   setPermPrompts]   = useState({});    // sessionId → prompt object
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [groupAliases, setGroupAliases] = useState(DEFAULT_GROUP_ALIASES);
  const [showLaunch, setShowLaunch] = useState(false);
  const [launchState, setLaunchState] = useState(null);
  const [closingSessions, setClosingSessions] = useState({});
  const [sessionPreferences, setSessionPreferences] = useState({});
  const [showSessionPreferences, setShowSessionPreferences] = useState(false);
  const [managingSession, setManagingSession] = useState(null);
  const [duplicateProxyAlarms, setDuplicateProxyAlarms] = useState([]);
  const [nightlyValidationFailures, setNightlyValidationFailures] = useState([]);
  const clientRef     = useRef(null);
  const activeSessionRef = useRef(null);                     // session currently being viewed
  const launchRequestRef = useRef(null);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
    AsyncStorage.getItem(COLLAPSED_DIRECTORY_KEY).then(raw => {
      const stored = JSON.parse(raw || '[]');
      if (Array.isArray(stored)) {
        setCollapsedGroups(Object.fromEntries(stored.map(key => [String(key), true])));
      }
    }).catch(() => {});
    AsyncStorage.getItem(GROUP_ALIAS_STORAGE_KEY).then(raw => {
      const aliases = normalizeGroupAliases(JSON.parse(raw || '{}'));
      setGroupAliases(aliases);
      return AsyncStorage.setItem(GROUP_ALIAS_STORAGE_KEY, JSON.stringify(aliases));
    }).catch(() => {});
  }, []);

  const toggleGroup = useCallback((key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedGroups(previous => {
      const next = { ...previous, [key]: !previous[key] };
      const persisted = Object.keys(next).filter(groupKey => next[groupKey]);
      AsyncStorage.setItem(COLLAPSED_DIRECTORY_KEY, JSON.stringify(persisted)).catch(() => {});
      return next;
    });
  }, []);

  const loadSessionPreferences = useCallback(async () => {
    const jwt = await getStoredJwt();
    if (!jwt) return;
    const response = await fetch(`${RELAY_URL}/api/preferences/sessions`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to load session settings.');
    setSessionPreferences(body.preferences || {});
  }, []);

  async function saveSessionPreference(sessionIdValue, updates) {
    const jwt = await getStoredJwt();
    if (!jwt) throw new Error('Sign in again to sync session settings.');
    const response = await fetch(`${RELAY_URL}/api/preferences/sessions/${encodeURIComponent(sessionIdValue)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preference: updates }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to save session settings.');
    setSessionPreferences(previous => ({ ...previous, [sessionIdValue]: body.preference }));
    return body.preference;
  }

  // ── Message handler ─────────────────────────────────────────────────────────

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case '_connected':
        setConnected(true);
        setLoading(false);
        setReconnectInfo(null);
        break;

      case '_disconnected':
        setConnected(false);
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

      case 'session_list':
        setSessions(msg.sessions || []);
        setClosingSessions(previous => {
          const liveIds = new Set((msg.sessions || []).map(item => typeof item === 'string' ? item : (item.session_id || item.id)));
          return Object.fromEntries(Object.entries(previous).filter(([id]) => liveIds.has(id)));
        });
        break;

      case 'status': {
        // Relay sends { type: 'status', session, thinking, label }
        const sid = msg.session;
        if (!sid) break;
        if (msg.thinking) {
          setActivities(prev => ({ ...prev, [sid]: { generating: true, label: msg.label || 'Thinking' } }));
        } else {
          setActivities(prev => ({ ...prev, [sid]: null }));
        }
        break;
      }

      case 'connection_ack':
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_proxy_alarms) ? msg.duplicate_proxy_alarms : []);
        setNightlyValidationFailures(Array.isArray(msg.nightly_validation_failures) ? msg.nightly_validation_failures : []);
        if (msg.sessions) {
          setSessions(msg.sessions);
        }
        if (msg.session_health) {
          setHealthMap(msg.session_health);
        }
        if (Array.isArray(msg.open_prompts) && msg.open_prompts.length > 0) {
          const restored = {};
          msg.open_prompts.forEach(p => {
            const sid = p.session_id || p.session;
            if (sid) restored[sid] = p;
          });
          setPermPrompts(restored);
        }
        break;

      case 'session_health': {
        const sid = msg.session || msg.session_id;
        if (sid) setHealthMap(prev => ({ ...prev, [sid]: msg.health }));
        break;
      }

      case 'message': {
        // Track unread messages for sessions the user isn't currently viewing
        const msgSid = msg.session;
        if (msgSid && msgSid !== activeSessionRef.current && msg.role === 'assistant') {
          setUnreadMap(prev => ({ ...prev, [msgSid]: (prev[msgSid] || 0) + 1 }));
        }
        break;
      }

      case 'permission_prompt': {
        const sid = msg.session_id || msg.session;
        if (sid) setPermPrompts(prev => ({ ...prev, [sid]: msg }));
        break;
      }

      case 'permission_prompt_expired': {
        const sid = msg.session_id || msg.session;
        if (sid) setPermPrompts(prev => { const { [sid]: _, ...rest } = prev; return rest; });
        break;
      }

      case 'agent_control_result': {
        const sid = msg.session_id || msg.session;
        if (sid && msg.command === 'permission_response' && msg.result === 'ok') {
          setPermPrompts(prev => { const { [sid]: _, ...rest } = prev; return rest; });
        }
        break;
      }

      case 'session_meta':
        // Update display name if server sends it
        setSessions(prev =>
          prev.map(s =>
            (s.session_id || s.id || s) === msg.session_id
              ? { ...(typeof s === 'string' ? { session_id: s } : s), name: msg.name }
              : s
          )
        );
        break;

      case 'duplicate_proxy_alarm':
        setDuplicateProxyAlarms(Array.isArray(msg.duplicate_sessions) ? msg.duplicate_sessions : []);
        break;

      case 'nightly_validation_status':
        setNightlyValidationFailures(Array.isArray(msg.failures) ? msg.failures : []);
        break;

      case 'session_launching': {
        if (launchRequestRef.current?.requestId === msg.request_id) {
          setLaunchState(previous => ({ ...(previous || {}), status: 'launching' }));
        }
        break;
      }

      case 'session_launch_ack': {
        if (launchRequestRef.current?.requestId !== msg.request_id) break;
        const launch = launchRequestRef.current;
        const sid = msg.session_id || msg.session;
        launchRequestRef.current = null;
        setLaunchState(null);
        setShowLaunch(false);
        setShowHistory(false);
        if (sid) {
          navigation.navigate('Chat', {
            sessionId: sid,
            title: `New ${agentBadge(msg.agent_type || launch.agentType).label}`,
            agentType: msg.agent_type || launch.agentType,
          });
        }
        break;
      }

      case 'session_launch_failed': {
        if (launchRequestRef.current?.requestId !== msg.request_id) break;
        const reason = msg.reason || msg.error?.message || msg.error || 'Launch failed';
        const mode = launchRequestRef.current.mode;
        launchRequestRef.current = null;
        setLaunchState({ status: 'failed', error: reason });
        if (mode === 'resume') Alert.alert('Could not resume session', reason);
        break;
      }

      case 'session_closed': {
        const sid = msg.session_id || msg.session;
        if (!sid) break;
        setSessions(previous => previous.filter(item => sessionId(item) !== sid));
        setClosingSessions(previous => {
          const next = { ...previous };
          delete next[sid];
          return next;
        });
        break;
      }

      case 'connection_error': {
        if (msg.code === 'session_unknown') {
          setClosingSessions({});
          Alert.alert('Could not close session', msg.message || 'The session is no longer connected.');
        }
        break;
      }

      default:
        break;
    }
  }, [navigation]);

  // ── Connect / disconnect on focus ───────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      activeSessionRef.current = null; // back on session list — no session active
      const client = new RelayClient(handleMessage);
      clientRef.current = client;
      client.connect();

      // Register for push notifications once connected; subscribe to token rotation
      getStoredJwt().then(jwt => {
        if (jwt) registerForPushNotifications(jwt);
      });

      // Check JWT expiry — warn if < 7 days remaining
      getJwtDaysRemaining().then(days => setJwtDaysLeft(days));
      loadSessionPreferences().catch(() => {});

      return () => {
        client.disconnect();
        clientRef.current = null;
      };
    }, [handleMessage, loadSessionPreferences])
  );

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function sessionId(s)   { return typeof s === 'string' ? s : (s.session_id || s.id); }
  function sessionName(s) {
    if (typeof s !== 'object') return s;
    return s.display_name || s.workspace_name || s.name || sessionId(s);
  }

  function sessionSubtitle(s) {
    if (typeof s !== 'object') return null;
    // Show workspace path or window title as subtitle context
    const name = sessionName(s);
    const sub = s.workspace_path || s.window_title;
    if (!sub || sub === name) return null;
    return sub;
  }

  function activityLabel(sid) {
    const a = activities[sid];
    if (!a) return null;
    return `● ${a.label || 'Generating'}`;
  }

  function healthDotColor(sid) {
    const health   = healthMap[sid];
    const activity = activities[sid];
    if (health === 'degraded')     return '#d29922';   // yellow
    if (health === 'disconnected') return '#484f58';   // gray
    if (activity?.generating)      return '#58a6ff';   // blue — active
    if (health === 'healthy')      return '#3fb950';   // green — idle
    return '#484f58';                                  // gray — unknown
  }

  const managedSessions = sessions.map(item => {
    const preference = sessionPreferences[sessionId(item)];
    if (!preference?.display_name) return item;
    return typeof item === 'object'
      ? { ...item, display_name: preference.display_name }
      : { session_id: item, display_name: preference.display_name };
  });
  const visibleSessions = managedSessions.filter(item => !sessionPreferences[sessionId(item)]?.archived);
  const filteredSessions = searchQuery
    ? visibleSessions.filter(item => sessionName(item).toLowerCase().includes(searchQuery.toLowerCase()))
    : visibleSessions;

  const AGENT_BADGES = {
    claude:            { abbr: 'CC', color: '#cc785c', label: 'Claude Code' },
    claude_cli:        { abbr: 'CLI', color: '#d97757', label: 'Claude Code CLI' },
    'claude-desktop':  { abbr: 'CD', color: '#cc785c', label: 'Claude Desktop' },
    codex:             { abbr: 'CX', color: '#10a37f', label: 'Codex' },
    codex_cli:         { abbr: 'CLI', color: '#10a37f', label: 'Codex CLI' },
    'codex-desktop':   { abbr: 'CX', color: '#10a37f', label: 'Codex Desktop' },
    cursor:            { abbr: 'CR', color: '#7AA2F7', label: 'Cursor' },
    cursor_cli:        { abbr: 'CLI', color: '#7c6cf0', label: 'Cursor CLI' },
    gemini:            { abbr: 'GC', color: '#4285f4', label: 'Gemini' },
    continue:          { abbr: 'CN', color: '#d29922', label: 'Continue' },
    continue_yolo:     { abbr: 'CY', color: '#f59e0b', label: 'Continue YOLO' },
    roo_code:          { abbr: 'RC', color: '#06b6d4', label: 'Roo Code' },
    cline:             { abbr: 'CL', color: '#6366f1', label: 'Cline' },
    antigravity:       { abbr: 'AG', color: '#a855f7', label: 'Antigravity' },
    antigravity_panel: { abbr: 'AC', color: '#a855f7', label: 'Antigravity Chat' },
    'antigravity-v2':  { abbr: 'A2', color: '#7c3aed', label: 'Antigravity v2' },
  };
  const DEFAULT_BADGE = { abbr: 'AG', color: '#8b949e', label: 'Agent' };

  function agentType(s) {
    if (typeof s !== 'object') return 'unknown';
    return s.agent_type || 'unknown';
  }

  function agentBadge(type) {
    return AGENT_BADGES[type] || DEFAULT_BADGE;
  }

  const sections = groupSessionsByDirectory(filteredSessions, groupAliases).map(group => {
    const collapsed = !!collapsedGroups[group.key] && !searchQuery;
    const summary = group.sessions.reduce((result, item) => {
      const sid = sessionId(item);
      result.unread += unreadMap[sid] || 0;
      result.working = result.working || !!activities[sid]?.generating;
      result.hasPrompt = result.hasPrompt || !!permPrompts[sid];
      return result;
    }, { unread: 0, working: false, hasPrompt: false });
    return {
      key: group.key,
      title: group.title,
      count: group.sessions.length,
      collapsed,
      ...summary,
      data: collapsed ? [] : group.sessions,
    };
  });

  function handleSignOut() {
    clientRef.current?.disconnect();
    signOut().then(() => navigation.replace('Login'));
  }

  function beginLaunch(agentTypeValue, workspacePath, options) {
    const requestId = clientRef.current?.launchSession(agentTypeValue, workspacePath, options);
    if (!requestId) return;
    launchRequestRef.current = { requestId, mode: 'new', agentType: agentTypeValue };
    setLaunchState({ requestId, status: 'launching', agentType: agentTypeValue });
  }

  function beginResume(session) {
    const agentTypeValue = session.agent_type || 'claude';
    const requestId = clientRef.current?.resumeSession(
      session.session_id,
      agentTypeValue,
      session.workspace_path,
      {
        cli_session_id: session.cli_session_id,
        model_id: session.model_id,
        permission_mode: session.permission_mode,
      },
    );
    if (!requestId) return;
    launchRequestRef.current = { requestId, mode: 'resume', agentType: agentTypeValue };
    setLaunchState({ requestId, status: 'launching', agentType: agentTypeValue });
    setShowHistory(false);
  }

  function confirmCloseSession(item) {
    const sid = sessionId(item);
    const disconnected = healthMap[sid] === 'disconnected' || item?.status === 'disconnected';
    Alert.alert(
      disconnected ? 'Dismiss session?' : 'Close native session?',
      disconnected
        ? 'Remove this disconnected session from the list? Its saved history will remain available.'
        : 'This asks the desktop proxy to close the native session. Saved history will remain available.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: disconnected ? 'Dismiss' : 'Close',
          style: 'destructive',
          onPress: () => {
            setClosingSessions(previous => ({ ...previous, [sid]: true }));
            clientRef.current?.closeSession(sid, disconnected);
          },
        },
      ],
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.container}>
        <View style={{ padding: 12, gap: 8 }}>
          {[0, 1, 2].map(i => <SkeletonCard key={i} delay={i * 200} />)}
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {duplicateProxyAlarms.length > 0 && (
        <View style={s.duplicateProxyBanner} accessibilityRole="alert">
          <Text style={s.duplicateProxyTitle}>Duplicate proxy detected</Text>
          <Text style={s.duplicateProxyText}>
            {duplicateProxyAlarms.length} session{duplicateProxyAlarms.length === 1 ? '' : 's'} claimed by multiple proxies. Stop the extra proxy.
          </Text>
        </View>
      )}
      {nightlyValidationFailures.length > 0 && (
        <View style={s.duplicateProxyBanner} accessibilityRole="alert">
          <Text style={s.duplicateProxyTitle}>Nightly validation failed</Text>
          <Text style={s.duplicateProxyText}>
            {nightlyValidationFailures.map(item => `${item.harness} (${item.app_version})`).join(', ')}. Check the validation ledger before using affected controls.
          </Text>
        </View>
      )}
      {/* Connection banner */}
      {!connected && (
        <TouchableOpacity
          style={s.disconnectBanner}
          activeOpacity={0.7}
          onPress={() => {
            clientRef.current?.disconnect();
            const c = new RelayClient(handleMessage);
            clientRef.current = c;
            c.connect();
          }}
        >
          <Text style={s.disconnectText}>
            {reconnectInfo && reconnectInfo.attempt >= 5
              ? "Can't reach server — tap to retry"
              : reconnectInfo
                ? `Reconnecting (attempt ${reconnectInfo.attempt}, retry in ${Math.round(reconnectInfo.nextRetryMs / 1000)}s)…`
                : 'Reconnecting…'}
          </Text>
        </TouchableOpacity>
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

      {/* JWT expiry warning */}
      {jwtDaysLeft !== null && jwtDaysLeft <= 7 && (
        <TouchableOpacity
          style={s.expiryBanner}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={s.expiryText}>
            {jwtDaysLeft === 0
              ? 'Session expires today — tap to re-authenticate'
              : `Session expires in ${jwtDaysLeft} day${jwtDaysLeft === 1 ? '' : 's'} — tap to re-authenticate`}
          </Text>
        </TouchableOpacity>
      )}

      {sessions.length > 0 && (
        <View style={s.searchContainer}>
          <TextInput
            style={s.searchInput}
            placeholder="Search sessions…"
            placeholderTextColor="#484f58"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity style={s.searchClear} onPress={() => setSearchQuery('')}>
              <Text style={s.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={item => sessionId(item)}
        contentContainerStyle={sessions.length === 0 ? s.emptyContainer : s.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => clientRef.current?.connect()}
            tintColor="#58a6ff"
          />
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No active sessions</Text>
            <Text style={s.emptyHint}>
              Start an agent in Antigravity IDE to see sessions here.
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <TouchableOpacity
            style={s.sectionHeader}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: !section.collapsed }}
            accessibilityLabel={`${section.collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
            onPress={() => toggleGroup(section.key)}
          >
            <Text style={s.sectionCaret}>{section.collapsed ? '>' : 'v'}</Text>
            <Text style={s.sectionTitle} numberOfLines={1}>{section.title}</Text>
            {section.hasPrompt && <Text style={s.sectionAlert}>!</Text>}
            {section.working && <View style={s.sectionWorking} />}
            {section.unread > 0 && (
              <View style={s.sectionUnread}>
                <Text style={s.sectionUnreadText}>{section.unread > 99 ? '99+' : section.unread}</Text>
              </View>
            )}
            <View style={s.sectionCount}>
              <Text style={s.sectionCountText}>{section.count}</Text>
            </View>
          </TouchableOpacity>
        )}
        renderItem={({ item }) => {
          const sid    = sessionId(item);
          const label  = activityLabel(sid);
          const dotColor = healthDotColor(sid);
          const subtitle = sessionSubtitle(item);
          const unread = unreadMap[sid] || 0;
          const badge  = agentBadge(agentType(item));
          const hasPerm = !!permPrompts[sid];
          return (
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.75}
              onPress={() => {
                activeSessionRef.current = sid;
                setUnreadMap(prev => { const next = { ...prev }; delete next[sid]; return next; });
                navigation.navigate('Chat', {
                  sessionId:  sid,
                  title:      sessionName(item),
                  agentType:  agentType(item),
                });
              }}
            >
              <View style={s.badgeWrap}>
                <View style={[s.agentBadge, { backgroundColor: badge.color + '22', borderColor: badge.color + '55' }]}>
                  <AgentIcon agentType={agentType(item)} size={20} />
                </View>
                <View style={[s.healthDotOverlay, { backgroundColor: dotColor }]} />
              </View>
              <View style={s.cardMain}>
                <Text style={s.cardName} numberOfLines={1}>{sessionName(item)}</Text>
                {hasPerm
                  ? <Text style={s.cardPermLabel}>Permission required</Text>
                  : subtitle ? <Text style={s.cardSubtitle} numberOfLines={1}>{subtitle}</Text>
                  : null}
                {label && <Text style={s.cardActivity}>{label}</Text>}
              </View>
              {hasPerm && (
                <Text style={s.permBadge}>⚠</Text>
              )}
              {!hasPerm && unread > 0 && (
                <View style={s.unreadBadge}>
                  <Text style={s.unreadBadgeText}>
                    {unread > 99 ? '99+' : unread}
                  </Text>
                </View>
              )}
              {!!sessionPreferences[sid]?.muted && <Text style={s.mutedBadge}>Muted</Text>}
              {agentType(item) === 'codex-desktop' && (
                <TouchableOpacity
                  style={s.automationsBtn}
                  onPress={(e) => {
                    e.stopPropagation && e.stopPropagation();
                    navigation.navigate('Automations');
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.automationsBtnText}>⚡</Text>
                </TouchableOpacity>
              )}
              {agentType(item) === 'codex-desktop' && (
                <TouchableOpacity
                  style={s.automationsBtn}
                  onPress={(e) => {
                    e.stopPropagation && e.stopPropagation();
                    navigation.navigate('Skills', { sessionId: sid });
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.automationsBtnText}>⊞</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={s.manageSessionBtn}
                onPress={(event) => {
                  event.stopPropagation && event.stopPropagation();
                  setManagingSession(item);
                  setShowSessionPreferences(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${sessionName(item)}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.manageSessionText}>Manage</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.closeSessionBtn, closingSessions[sid] && s.closeSessionPending]}
                onPress={(event) => {
                  event.stopPropagation && event.stopPropagation();
                  confirmCloseSession(item);
                }}
                disabled={!!closingSessions[sid]}
                accessibilityRole="button"
                accessibilityLabel={`${healthMap[sid] === 'disconnected' ? 'Dismiss' : 'Close'} ${sessionName(item)}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {closingSessions[sid]
                  ? <ActivityIndicator size="small" color="#8b949e" />
                  : <Text style={s.closeSessionText}>Close</Text>}
              </TouchableOpacity>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          );
        }}
      />

      <View style={s.lifecycleBar}>
        <TouchableOpacity
          style={[s.lifecycleBtn, s.launchBtn]}
          activeOpacity={0.7}
          onPress={() => {
            setLaunchState(null);
            setShowLaunch(true);
          }}
          disabled={!connected}
          accessibilityRole="button"
        >
          <Text style={s.launchBtnText}>New Session</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.lifecycleBtn}
          activeOpacity={0.7}
          onPress={() => setShowHistory(true)}
          disabled={!connected}
          accessibilityRole="button"
        >
          <Text style={s.resumeBtnText}>Resume Past</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.lifecycleBtn}
          activeOpacity={0.7}
          onPress={() => {
            setManagingSession(null);
            setShowSessionPreferences(true);
          }}
          accessibilityRole="button"
        >
          <Text style={s.resumeBtnText}>
            Hidden ({managedSessions.filter(item => sessionPreferences[sessionId(item)]?.archived).length})
          </Text>
        </TouchableOpacity>
      </View>

      <LaunchSessionSheet
        visible={showLaunch}
        launchState={launchState}
        onLaunch={beginLaunch}
        onClose={() => {
          if (launchState?.status !== 'launching') setShowLaunch(false);
        }}
      />

      <SessionHistorySheet
        visible={showHistory}
        onResume={beginResume}
        onClose={() => setShowHistory(false)}
      />
      <SessionPreferencesSheet
        visible={showSessionPreferences}
        sessions={managedSessions}
        preferences={sessionPreferences}
        initialSession={managingSession}
        onSave={saveSessionPreference}
        onClose={() => setShowSessionPreferences(false)}
      />
    </View>
  );
}

// ── Skeleton shimmer card ────────────────────────────────────────────────────

function SkeletonCard({ delay = 0 }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.6, duration: 800, delay, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={[s.card, { opacity }]}>
      <View style={[s.agentBadge, { backgroundColor: '#21262d', borderColor: '#30363d', marginRight: 10 }]}>
        <View style={{ width: 14, height: 10, backgroundColor: '#30363d', borderRadius: 3 }} />
      </View>
      <View style={s.cardMain}>
        <View style={{ backgroundColor: '#30363d', borderRadius: 4, width: '60%', height: 14 }} />
        <View style={{ backgroundColor: '#21262d', borderRadius: 4, width: '35%', height: 10, marginTop: 6 }} />
      </View>
    </Animated.View>
  );
}

// Set header right button from parent
SessionListScreen.navigationOptions = ({ navigation }) => ({
  headerRight: () => (
    <TouchableOpacity onPress={() => navigation.getParent()?.setParams({ signOut: true })} style={{ marginRight: 12 }}>
      <Text style={{ color: '#768390', fontSize: 14 }}>Sign out</Text>
    </TouchableOpacity>
  ),
});

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0b0f14',
  },
  lifecycleBar: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#30363d',
    backgroundColor: '#0d1117',
  },
  duplicateProxyBanner: {
    backgroundColor: '#4b2e0b',
    borderBottomColor: '#d29922',
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  duplicateProxyTitle: { color: '#f0d49a', fontSize: 13, fontWeight: '700' },
  duplicateProxyText: { color: '#d7bd87', fontSize: 12, marginTop: 2 },
  lifecycleBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(104, 179, 255, 0.3)',
    backgroundColor: 'rgba(104, 179, 255, 0.08)',
    alignItems: 'center',
  },
  launchBtn: {
    backgroundColor: '#238636',
    borderColor: '#2ea043',
  },
  launchBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  resumeBtnText: {
    color: '#58a6ff',
    fontSize: 13,
    fontWeight: '500',
  },
  center: {
    flex:            1,
    backgroundColor: '#0b0f14',
    justifyContent:  'center',
    alignItems:      'center',
  },
  disconnectBanner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#f0883e',
    paddingVertical:   8,
    alignItems:        'center',
  },
  expiryBanner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#d29922',
    paddingVertical:   8,
    alignItems:        'center',
    paddingHorizontal: 16,
  },
  expiryText: {
    color:    '#d29922',
    fontSize: 13,
    textAlign: 'center',
  },
  disconnectText: {
    color:    '#f0883e',
    fontSize: 13,
  },
  connectionHealthBar: {
    minHeight: 26,
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
  searchContainer: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  12,
    marginTop:         12,
    marginBottom:      4,
    backgroundColor:   '#161b22',
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#30363d',
  },
  searchInput: {
    flex:              1,
    color:             '#cdd9e5',
    fontSize:          14,
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  searchClear: {
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  searchClearText: {
    color:    '#768390',
    fontSize: 14,
  },
  list: {
    padding: 12,
    gap:     8,
  },
  sectionHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingTop:        12,
    paddingBottom:     6,
    paddingHorizontal: 4,
    gap:               7,
  },
  sectionCaret: {
    color:             '#768390',
    width:             10,
    fontSize:          11,
    fontFamily:        Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign:         'center',
  },
  sectionTitle: {
    flex:              1,
    color:             '#768390',
    fontSize:          12,
    fontWeight:        '600',
    textTransform:     'uppercase',
    letterSpacing:     0.5,
  },
  sectionWorking: {
    width:             7,
    height:            7,
    borderRadius:      4,
    backgroundColor:   '#58a6ff',
  },
  sectionAlert: {
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    backgroundColor:   '#d29922',
    color:             '#fff',
    textAlign:         'center',
    lineHeight:        16,
    fontSize:          10,
    fontWeight:        '700',
  },
  sectionUnread: {
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    paddingHorizontal: 4,
    alignItems:        'center',
    justifyContent:    'center',
    backgroundColor:   '#58a6ff',
  },
  sectionUnreadText: {
    color:             '#fff',
    fontSize:          9,
    fontWeight:        '700',
  },
  sectionCount: {
    minWidth:          20,
    height:            18,
    borderRadius:      9,
    paddingHorizontal: 5,
    alignItems:        'center',
    justifyContent:    'center',
    borderWidth:       1,
    borderColor:       '#30363d',
  },
  sectionCountText: {
    color:             '#768390',
    fontSize:          10,
  },
  emptyContainer: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        40,
  },
  empty: {
    alignItems: 'center',
  },
  emptyTitle: {
    color:        '#cdd9e5',
    fontSize:     18,
    fontWeight:   '600',
    marginBottom: 8,
  },
  emptyHint: {
    color:     '#768390',
    fontSize:  14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     '#30363d',
    padding:         16,
    flexDirection:   'row',
    alignItems:      'center',
    marginBottom:    8,
  },
  badgeWrap: {
    width:        36,
    height:       36,
    marginRight:  10,
  },
  agentBadge: {
    width:        36,
    height:       36,
    borderRadius: 10,
    borderWidth:  1,
    alignItems:   'center',
    justifyContent: 'center',
  },
  agentBadgeText: {
    fontSize:   12,
    fontWeight: '700',
  },
  healthDotOverlay: {
    position:     'absolute',
    bottom:       -2,
    right:        -2,
    width:        10,
    height:       10,
    borderRadius: 5,
    borderWidth:  2,
    borderColor:  '#161b22',
  },
  cardMain: {
    flex: 1,
  },
  cardName: {
    color:      '#cdd9e5',
    fontSize:   16,
    fontWeight: '500',
  },
  cardSubtitle: {
    color:     '#768390',
    fontSize:  12,
    marginTop: 2,
  },
  cardActivity: {
    color:     '#58a6ff',
    fontSize:  12,
    marginTop: 4,
  },
  cardPermLabel: {
    color:      '#d9a441',
    fontSize:   12,
    fontWeight: '600',
    marginTop:  2,
  },
  permBadge: {
    fontSize:   16,
    color:      '#d9a441',
    marginLeft: 8,
  },
  unreadBadge: {
    backgroundColor: '#58a6ff',
    minWidth:        20,
    height:          20,
    borderRadius:    10,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 5,
    marginLeft:      8,
  },
  unreadBadgeText: {
    color:      '#fff',
    fontSize:   11,
    fontWeight: '700',
  },
  automationsBtn: {
    marginLeft: 8,
    padding:    4,
  },
  closeSessionBtn: {
    minWidth: 44,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  closeSessionPending: { opacity: 0.55 },
  closeSessionText: { color: '#f85149', fontSize: 11, fontWeight: '700' },
  manageSessionBtn: {
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  manageSessionText: { color: '#58a6ff', fontSize: 11, fontWeight: '700' },
  mutedBadge: { color: '#768390', fontSize: 10, fontWeight: '600' },
  automationsBtnText: {
    color:    '#cdd9e5',
    fontSize: 16,
  },
  chevron: {
    color:    '#444c56',
    fontSize: 22,
    marginLeft: 8,
  },
});
