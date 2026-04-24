import React, { useEffect, useState } from 'react';
import {
  View, Text, Switch, TouchableOpacity,
  StyleSheet, ScrollView, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants     from 'expo-constants';
import { signOut }  from '../lib/auth';

// ── Preference keys ───────────────────────────────────────────────────────────

const PREF_NOTIFY_AGENT_IDLE  = 'pref_notify_agent_idle';
const PREF_NOTIFY_RATE_LIMIT  = 'pref_notify_rate_limit';

const DEFAULTS = {
  [PREF_NOTIFY_AGENT_IDLE]: true,
  [PREF_NOTIFY_RATE_LIMIT]: true,
};

export async function getNotificationPrefs() {
  const raw = await AsyncStorage.multiGet(Object.keys(DEFAULTS));
  return Object.fromEntries(
    raw.map(([k, v]) => [k, v === null ? DEFAULTS[k] : JSON.parse(v)])
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen({ navigation }) {
  const [prefs,   setPrefs]   = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNotificationPrefs().then(p => { setPrefs(p); setLoading(false); });
  }, []);

  async function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await AsyncStorage.setItem(key, JSON.stringify(next[key]));
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
          label="Agent ready"
          description="When an agent finishes and is waiting for input"
          value={prefs[PREF_NOTIFY_AGENT_IDLE]}
          onToggle={() => toggle(PREF_NOTIFY_AGENT_IDLE)}
          disabled={loading}
        />
        <View style={s.divider} />
        <SettingRow
          label="Rate limit cleared"
          description="When a model's rate limit expires"
          value={prefs[PREF_NOTIFY_RATE_LIMIT]}
          onToggle={() => toggle(PREF_NOTIFY_RATE_LIMIT)}
          disabled={loading}
        />
      </View>

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
  version: {
    color:     '#444c56',
    fontSize:  12,
    textAlign: 'center',
    marginTop: 32,
  },
});
