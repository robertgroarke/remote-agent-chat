import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { RelayClient }   from '../lib/relay';
import { getStoredJwt, getJwtDaysRemaining, signOut } from '../lib/auth';
import { registerForPushNotifications, subscribeToTokenRefresh } from '../lib/notifications';
import { AgentIcon } from '../components/AgentIcons';
import SessionHistorySheet from '../components/SessionHistorySheet';

export default function SessionListScreen({ navigation }) {
  const [sessions,    setSessions]    = useState([]);
  const [activities,  setActivities]  = useState({});  // sessionId → activity obj | null
  const [connected,   setConnected]   = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [reconnectInfo, setReconnectInfo] = useState(null); // { attempt, nextRetryMs }
  const [jwtDaysLeft,   setJwtDaysLeft]   = useState(null); // days until JWT expiry
  const [healthMap,     setHealthMap]     = useState({});    // sessionId → 'healthy'|'degraded'|'disconnected'
  const [unreadMap,     setUnreadMap]     = useState({});    // sessionId → unread count
  const [showHistory,   setShowHistory]   = useState(false);
  const [permPrompts,   setPermPrompts]   = useState({});    // sessionId → prompt object
  const clientRef     = useRef(null);
  const activeSessionRef = useRef(null);                     // session currently being viewed

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

      case 'session_list':
        setSessions(msg.sessions || []);
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

      return () => {
        client.disconnect();
        clientRef.current = null;
      };
    }, [handleMessage])
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

  const filteredSessions = searchQuery
    ? sessions.filter(item => sessionName(item).toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  const AGENT_BADGES = {
    claude:            { abbr: 'CC', color: '#cc785c', label: 'Claude Code' },
    codex:             { abbr: 'CX', color: '#10a37f', label: 'Codex' },
    'codex-desktop':   { abbr: 'CX', color: '#10a37f', label: 'Codex Desktop' },
    gemini:            { abbr: 'GC', color: '#4285f4', label: 'Gemini' },
    antigravity:       { abbr: 'AG', color: '#a855f7', label: 'Antigravity' },
    antigravity_panel: { abbr: 'AC', color: '#a855f7', label: 'Antigravity' },
  };
  const DEFAULT_BADGE = { abbr: 'AG', color: '#8b949e', label: 'Agent' };

  function agentType(s) {
    if (typeof s !== 'object') return 'unknown';
    return s.agent_type || 'unknown';
  }

  function agentBadge(type) {
    return AGENT_BADGES[type] || DEFAULT_BADGE;
  }

  const sections = (() => {
    const groups = {};
    for (const item of filteredSessions) {
      const type = agentType(item);
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    }
    return Object.entries(groups).map(([type, data]) => ({
      title: agentBadge(type).label || type,
      data,
    }));
  })();

  function handleSignOut() {
    clientRef.current?.disconnect();
    signOut().then(() => navigation.replace('Login'));
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
        renderSectionHeader={({ section: { title } }) => (
          <Text style={s.sectionHeader}>{title}</Text>
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
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Resume from history button */}
      <TouchableOpacity
        style={s.resumeBtn}
        activeOpacity={0.7}
        onPress={() => setShowHistory(true)}
      >
        <Text style={s.resumeBtnText}>Resume Past Session</Text>
      </TouchableOpacity>

      <SessionHistorySheet
        visible={showHistory}
        onResume={(session) => {
          setShowHistory(false);
          const requestId = clientRef.current?.resumeSession(session.session_id, 'claude');
          // Navigate will happen when the session appears in the session list
        }}
        onClose={() => setShowHistory(false)}
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
  resumeBtn: {
    margin: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(104, 179, 255, 0.3)',
    backgroundColor: 'rgba(104, 179, 255, 0.08)',
    alignItems: 'center',
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
    color:             '#768390',
    fontSize:          12,
    fontWeight:        '600',
    textTransform:     'uppercase',
    letterSpacing:     0.5,
    paddingTop:        12,
    paddingBottom:     6,
    paddingHorizontal: 4,
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
