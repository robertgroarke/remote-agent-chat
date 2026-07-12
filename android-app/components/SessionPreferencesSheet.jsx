import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, Switch, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';

const sessionId = session => typeof session === 'string' ? session : (session?.session_id || session?.id || '');
const baseName = session => typeof session === 'string'
  ? session
  : (session?.display_name || session?.workspace_name || session?.name || sessionId(session));

export default function SessionPreferencesSheet({
  visible, sessions, preferences, initialSession, onSave, onClose,
}) {
  const [selected, setSelected] = useState(initialSession || null);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedId = sessionId(selected);
  const preference = preferences[selectedId] || { display_name: '', archived: false, muted: false };
  const hiddenSessions = useMemo(
    () => sessions.filter(session => preferences[sessionId(session)]?.archived),
    [sessions, preferences],
  );

  useEffect(() => {
    setSelected(initialSession || null);
    const id = sessionId(initialSession);
    setDisplayName(preferences[id]?.display_name || '');
    setError('');
  }, [initialSession, visible]);

  useEffect(() => {
    setDisplayName(preference.display_name || '');
  }, [selectedId, preference.display_name]);

  async function update(id, updates) {
    if (!id || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(id, updates);
    } catch (e) {
      setError(e.message || 'Unable to save session settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>Manage Sessions</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close session settings">
            <Text style={s.close}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.content}>
          {!!selectedId && (
            <View style={s.group}>
              <Text style={s.sectionLabel}>Selected session</Text>
              <Text style={s.sessionName} numberOfLines={2}>{preference.display_name || baseName(selected)}</Text>
              <TextInput
                style={s.input}
                value={displayName}
                maxLength={100}
                placeholder={baseName(selected)}
                placeholderTextColor="#59636e"
                onChangeText={setDisplayName}
                accessibilityLabel="Custom session name"
              />
              <TouchableOpacity
                style={s.actionButton}
                disabled={saving}
                onPress={() => update(selectedId, { display_name: displayName })}
                accessibilityRole="button"
              >
                <Text style={s.actionText}>Save name</Text>
              </TouchableOpacity>
              <View style={s.row}>
                <View style={s.rowText}>
                  <Text style={s.rowTitle}>Mute notifications</Text>
                  <Text style={s.rowDescription}>Suppress push notifications for this session</Text>
                </View>
                <Switch
                  value={!!preference.muted}
                  disabled={saving}
                  onValueChange={() => update(selectedId, { muted: !preference.muted })}
                  trackColor={{ false: '#30363d', true: '#1f4d8a' }}
                  thumbColor={preference.muted ? '#58a6ff' : '#444c56'}
                />
              </View>
              <TouchableOpacity
                style={[s.actionButton, !preference.archived && s.dangerButton]}
                disabled={saving}
                onPress={() => update(selectedId, { archived: !preference.archived })}
                accessibilityRole="button"
              >
                <Text style={[s.actionText, !preference.archived && s.dangerText]}>
                  {preference.archived ? 'Restore to session list' : 'Hide from session list'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.sectionLabel}>Hidden sessions ({hiddenSessions.length})</Text>
          <View style={s.group}>
            {hiddenSessions.length === 0 ? (
              <Text style={s.empty}>No hidden sessions.</Text>
            ) : hiddenSessions.map(session => {
              const id = sessionId(session);
              const pref = preferences[id] || {};
              return (
                <View style={s.hiddenRow} key={id}>
                  <TouchableOpacity style={s.hiddenName} onPress={() => setSelected(session)}>
                    <Text style={s.sessionName} numberOfLines={2}>{pref.display_name || baseName(session)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={saving}
                    onPress={() => update(id, { archived: false })}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${pref.display_name || baseName(session)}`}
                  >
                    <Text style={s.restore}>Restore</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
          {saving && <ActivityIndicator color="#58a6ff" />}
          <Text style={s.note}>Names, hidden state, and mute settings sync across web and Android.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363d',
  },
  title: { color: '#cdd9e5', fontSize: 18, fontWeight: '700' },
  close: { color: '#58a6ff', fontSize: 15, fontWeight: '600' },
  content: { padding: 16, gap: 12, paddingBottom: 36 },
  sectionLabel: { color: '#768390', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  group: { backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1, borderRadius: 10, padding: 14, gap: 12 },
  sessionName: { color: '#cdd9e5', fontSize: 14, fontWeight: '600' },
  input: { backgroundColor: '#0d1117', borderColor: '#30363d', borderWidth: 1, borderRadius: 7, color: '#cdd9e5', padding: 10 },
  actionButton: { borderColor: '#30363d', borderWidth: 1, borderRadius: 7, padding: 10, alignItems: 'center' },
  actionText: { color: '#58a6ff', fontSize: 13, fontWeight: '600' },
  dangerButton: { borderColor: 'rgba(248,81,73,0.45)' },
  dangerText: { color: '#f85149' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { color: '#cdd9e5', fontSize: 14 },
  rowDescription: { color: '#768390', fontSize: 12 },
  hiddenRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hiddenName: { flex: 1 },
  restore: { color: '#58a6ff', fontSize: 13, fontWeight: '600' },
  empty: { color: '#768390', fontSize: 13 },
  error: { color: '#f85149', fontSize: 12 },
  note: { color: '#768390', fontSize: 12, lineHeight: 17 },
});
