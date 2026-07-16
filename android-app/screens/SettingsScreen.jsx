import React, { useEffect, useState } from 'react';
import {
  View, Text, Switch, TouchableOpacity,
  StyleSheet, ScrollView, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants     from 'expo-constants';
import { getStoredJwt, RELAY_URL, signOut } from '../lib/auth';
import { PREF_ATTENTION_HAPTIC, setAttentionHapticPreference } from '../lib/attention-feedback';
import { setAuthoritativeSemanticNotificationPreferences } from '../lib/semantic-notifications';

// ── Preference keys ───────────────────────────────────────────────────────────

const PREF_NOTIFY_PERMISSION  = 'pref_notify_permission_required';
const PREF_NOTIFY_TURN_READY  = 'pref_notify_turn_ready';
const PREF_NOTIFY_GOAL_DONE   = 'pref_notify_goal_completed';
const PREF_NOTIFY_GOAL_ALERT  = 'pref_notify_goal_attention';
const PREF_NOTIFY_AGENT_ERROR = 'pref_notify_agent_error';
const PREF_NOTIFY_OFFLINE     = 'pref_notify_session_offline';
const PREF_NOTIFY_RATE_LIMIT  = 'pref_notify_rate_limit';

const DEFAULTS = {
  [PREF_NOTIFY_PERMISSION]: true,
  [PREF_NOTIFY_TURN_READY]: false,
  [PREF_NOTIFY_GOAL_DONE]: false,
  [PREF_NOTIFY_GOAL_ALERT]: true,
  [PREF_NOTIFY_AGENT_ERROR]: true,
  [PREF_NOTIFY_OFFLINE]: true,
  [PREF_NOTIFY_RATE_LIMIT]: true,
  [PREF_ATTENTION_HAPTIC]: false,
};

const RELAY_KEYS = {
  [PREF_NOTIFY_PERMISSION]: 'permission_required',
  [PREF_NOTIFY_TURN_READY]: 'turn_ready',
  [PREF_NOTIFY_GOAL_DONE]: 'goal_completed',
  [PREF_NOTIFY_GOAL_ALERT]: 'goal_attention',
  [PREF_NOTIFY_AGENT_ERROR]: 'agent_error',
  [PREF_NOTIFY_OFFLINE]: 'session_offline',
  [PREF_NOTIFY_RATE_LIMIT]: 'rate_limit_cleared',
  [PREF_ATTENTION_HAPTIC]: 'completion_haptic',
};

export async function getNotificationPrefs() {
  const raw = await AsyncStorage.multiGet(Object.keys(DEFAULTS));
  return Object.fromEntries(
    raw.map(([k, v]) => [k, v === null ? DEFAULTS[k] : JSON.parse(v)])
  );
}

async function fetchRelayPreferences() {
  const jwt = await getStoredJwt();
  if (!jwt) throw new Error('Sign in again to sync notification settings.');
  const response = await fetch(`${RELAY_URL}/api/preferences/notifications`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to load notification settings.');
  return {
    [PREF_NOTIFY_PERMISSION]: body.preferences?.permission_required !== false,
    [PREF_NOTIFY_TURN_READY]: false,
    [PREF_NOTIFY_GOAL_DONE]: body.preferences?.goal_completed === true,
    [PREF_NOTIFY_GOAL_ALERT]: body.preferences?.goal_attention !== false,
    [PREF_NOTIFY_AGENT_ERROR]: body.preferences?.agent_error !== false,
    [PREF_NOTIFY_OFFLINE]: body.preferences?.session_offline !== false,
    [PREF_NOTIFY_RATE_LIMIT]: body.preferences?.rate_limit_cleared !== false,
    [PREF_ATTENTION_HAPTIC]: body.preferences?.completion_haptic === true,
  };
}

async function saveRelayPreferences(prefs) {
  const jwt = await getStoredJwt();
  if (!jwt) throw new Error('Sign in again to sync notification settings.');
  const preferences = Object.fromEntries(
    Object.entries(RELAY_KEYS).map(([localKey, relayKey]) => [relayKey, !!prefs[localKey]])
  );
  const response = await fetch(`${RELAY_URL}/api/preferences/notifications`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ preferences }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to save notification settings.');
  return body.preferences;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen({ navigation }) {
  const [prefs,   setPrefs]   = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(null);
  const [error,   setError]   = useState('');

  async function loadPreferences() {
    setLoading(true);
    setError('');
    const cached = await getNotificationPrefs();
    setPrefs(cached);
    setAttentionHapticPreference(cached[PREF_ATTENTION_HAPTIC]);
    try {
      const remote = await fetchRelayPreferences();
      setAuthoritativeSemanticNotificationPreferences({
        goal_completed: remote[PREF_NOTIFY_GOAL_DONE],
        goal_attention: remote[PREF_NOTIFY_GOAL_ALERT],
        turn_ready: false,
      });
      setPrefs(remote);
      setAttentionHapticPreference(remote[PREF_ATTENTION_HAPTIC]);
      await AsyncStorage.multiSet(
        Object.entries(remote).map(([key, value]) => [key, JSON.stringify(value)])
      );
    } catch (e) {
      setError(e.message || 'Unable to sync notification settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPreferences(); }, []);

  async function toggle(key) {
    if (saving) return;
    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(key);
    setError('');
    try {
      const saved = await saveRelayPreferences(next);
      setAuthoritativeSemanticNotificationPreferences(saved);
      await AsyncStorage.setItem(key, JSON.stringify(next[key]));
      if (key === PREF_ATTENTION_HAPTIC) setAttentionHapticPreference(next[key]);
    } catch (e) {
      setPrefs(previous);
      setError(e.message || 'Unable to save notification settings.');
      Alert.alert('Settings not saved', e.message || 'Unable to save notification settings.');
    } finally {
      setSaving(null);
    }
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          navigation.replace('Login');
        },
      },
    ]);
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      <Text style={s.sectionLabel}>Notifications</Text>
      <View style={s.group}>
        <SettingRow
          label="Permission required"
          description="When an agent needs approval to continue"
          value={prefs[PREF_NOTIFY_PERMISSION]}
          onToggle={() => toggle(PREF_NOTIFY_PERMISSION)}
          disabled={loading || !!saving}
        />
        <View style={s.divider} />
        <SettingRow
          label="Turn finished"
          description="Unavailable until this harness supplies an authoritative native turn boundary"
          value={false}
          onToggle={() => toggle(PREF_NOTIFY_TURN_READY)}
          disabled
        />
        <View style={s.divider} />
        <SettingRow
          label="Goal completed"
          description="Only when the native goal reaches completed state"
          value={prefs[PREF_NOTIFY_GOAL_DONE]}
          onToggle={() => toggle(PREF_NOTIFY_GOAL_DONE)}
          disabled={loading || !!saving}
        />
        <View style={s.divider} />
        <SettingRow
          label="Goal needs attention"
          description="Paused, blocked, limited, cancelled, or failed goals"
          value={prefs[PREF_NOTIFY_GOAL_ALERT]}
          onToggle={() => toggle(PREF_NOTIFY_GOAL_ALERT)}
          disabled={loading || !!saving}
        />
        <Text style={s.inlineNote}>Active /goal loop checkpoints stay quiet between turns.</Text>
        <View style={s.divider} />
        <SettingRow
          label="Agent error or rate limit"
          description="When an agent stops and needs attention"
          value={prefs[PREF_NOTIFY_AGENT_ERROR]}
          onToggle={() => toggle(PREF_NOTIFY_AGENT_ERROR)}
          disabled={loading || !!saving}
        />
        <View style={s.divider} />
        <SettingRow
          label="Session offline"
          description="When an agent disconnects from the relay"
          value={prefs[PREF_NOTIFY_OFFLINE]}
          onToggle={() => toggle(PREF_NOTIFY_OFFLINE)}
          disabled={loading || !!saving}
        />
        <View style={s.divider} />
        <SettingRow
          label="Rate limit cleared"
          description="When a model's rate limit expires"
          value={prefs[PREF_NOTIFY_RATE_LIMIT]}
          onToggle={() => toggle(PREF_NOTIFY_RATE_LIMIT)}
          disabled={loading || !!saving}
        />
        <View style={s.divider} />
        <SettingRow
          label="Notification haptic"
          description="Subtle vibration for allowed prompts and explicit goal lifecycle events"
          value={prefs[PREF_ATTENTION_HAPTIC]}
          onToggle={() => toggle(PREF_ATTENTION_HAPTIC)}
          disabled={loading || !!saving}
        />
      </View>
      {!!error && (
        <View style={s.syncError} accessibilityRole="alert">
          <Text style={s.syncErrorText}>{error}</Text>
          <TouchableOpacity onPress={loadPreferences} disabled={loading} accessibilityRole="button">
            <Text style={s.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={s.syncNote}>These preferences sync across web and Android.</Text>

      <Text style={s.sectionLabel}>Account</Text>
      <View style={s.group}>
        <TouchableOpacity style={s.dangerRow} onPress={handleSignOut} activeOpacity={0.7}>
          <Text style={s.dangerText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.version}>Agent Chat v{Constants.expoConfig?.version || '1.0.0'}</Text>
    </ScrollView>
  );
}

function SettingRow({ label, description, value, onToggle, disabled }) {
  return (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!description && <Text style={s.rowDesc}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: '#30363d', true: '#1f4d8a' }}
        thumbColor={value ? '#58a6ff' : '#444c56'}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0b0f14',
  },
  content: {
    padding: 16,
    gap:     8,
  },
  sectionLabel: {
    color:         '#768390',
    fontSize:      12,
    fontWeight:    '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop:     16,
    marginBottom:  6,
    marginLeft:    4,
  },
  group: {
    backgroundColor: '#161b22',
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     '#30363d',
    overflow:        'hidden',
  },
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: {
    flex:   1,
    gap:    2,
    marginRight: 12,
  },
  rowLabel: {
    color:    '#cdd9e5',
    fontSize: 15,
  },
  rowDesc: {
    color:    '#768390',
    fontSize: 12,
  },
  divider: {
    height:          1,
    backgroundColor: '#21262d',
    marginLeft:      16,
  },
  dangerRow: {
    paddingVertical:   14,
    paddingHorizontal: 16,
  },
  dangerText: {
    color:    '#f85149',
    fontSize: 15,
  },
  inlineNote: {
    color: '#768390',
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  syncError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  syncErrorText: {
    color: '#f85149',
    flex: 1,
    fontSize: 12,
  },
  retryText: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
  },
  syncNote: {
    color: '#768390',
    fontSize: 12,
    marginHorizontal: 4,
  },
  version: {
    color:     '#444c56',
    fontSize:  12,
    textAlign: 'center',
    marginTop: 32,
  },
});
