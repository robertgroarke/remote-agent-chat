import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';

export default function QueuedMessageBar({ items, onSteer, onDiscard, onEdit }) {
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    if (editingId && !items.some(item => item.cid === editingId)) {
      setEditingId(null);
      setEditText('');
    }
  }, [editingId, items]);

  if (!items.length) return null;

  function startEdit(item) {
    setEditingId(item.cid);
    setEditText(item.content || '');
  }

  function saveEdit(item) {
    const content = editText.trim();
    if (!content) return;
    onEdit(item, content);
    setEditingId(null);
    setEditText('');
  }

  return (
    <View style={s.container} accessibilityRole="summary">
      <Text style={s.heading}>QUEUED ({items.length})</Text>
      <ScrollView style={s.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {items.map(item => {
          const editing = editingId === item.cid;
          const pending = !!item.pending_action;
          return (
            <View key={item.cid} style={[s.item, item.native && s.nativeItem]}>
              {editing ? (
                <>
                  <TextInput
                    style={s.editInput}
                    value={editText}
                    onChangeText={setEditText}
                    multiline
                    autoFocus
                    accessibilityLabel="Edit queued message"
                  />
                  <View style={s.actions}>
                    <Action label="Save" onPress={() => saveEdit(item)} disabled={!editText.trim()} />
                    <Action label="Cancel" onPress={() => setEditingId(null)} secondary />
                  </View>
                </>
              ) : (
                <>
                  <Text style={s.content} selectable>{item.content || 'Queued message'}</Text>
                  {!!item.status && item.status !== 'queued' && <Text style={s.status}>{item.status}</Text>}
                  {!!item.error && <Text style={s.error}>{item.error}</Text>}
                  <View style={s.actions}>
                    <Action
                      label={pending && item.pending_action === 'steer' ? 'Steering...' : 'Steer'}
                      onPress={() => onSteer(item)}
                      disabled={pending}
                    />
                    {!item.native && <Action label="Edit" onPress={() => startEdit(item)} disabled={pending} secondary />}
                    <Action label="Discard" onPress={() => onDiscard(item)} disabled={pending} danger />
                  </View>
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Action({ label, onPress, disabled, secondary, danger }) {
  return (
    <TouchableOpacity
      style={[s.action, secondary && s.actionSecondary, danger && s.actionDanger, disabled && s.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[s.actionText, danger && s.actionDangerText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: '#30363d',
    backgroundColor: '#161b22',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  heading: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  list: { maxHeight: 220 },
  item: {
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    backgroundColor: '#0d1117',
    padding: 10,
    marginBottom: 6,
  },
  nativeItem: { borderColor: '#8957e5' },
  content: { color: '#cdd9e5', fontSize: 13, lineHeight: 18 },
  status: { color: '#d29922', fontSize: 11, marginTop: 4, textTransform: 'uppercase' },
  error: { color: '#ff7b72', fontSize: 11, marginTop: 4 },
  editInput: {
    minHeight: 54,
    maxHeight: 120,
    color: '#f0f6fc',
    backgroundColor: '#010409',
    borderWidth: 1,
    borderColor: '#58a6ff',
    borderRadius: 6,
    padding: 8,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: {
    borderWidth: 1,
    borderColor: '#58a6ff',
    borderRadius: 6,
    backgroundColor: '#1f3b5b',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionSecondary: { borderColor: '#6e7681', backgroundColor: '#21262d' },
  actionDanger: { borderColor: '#f85149', backgroundColor: '#3d1f22' },
  actionText: { color: '#f0f6fc', fontSize: 12, fontWeight: '700' },
  actionDangerText: { color: '#ff7b72' },
  disabled: { opacity: 0.5 },
});
