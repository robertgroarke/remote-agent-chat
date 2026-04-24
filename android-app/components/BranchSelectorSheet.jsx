import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, TextInput, StyleSheet, ActivityIndicator,
} from 'react-native';

// ── BranchSelectorSheet ─────────────────────────────────────────────────────
// Bottom sheet showing git branches with search, current indicator, and create-new.

export default function BranchSelectorSheet({ visible, branches, current, loading, onSwitch, onCreate, onClose }) {
  const [search, setSearch]     = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');

  const branchList = branches || [];
  const filtered = search
    ? branchList.filter(b => b.toLowerCase().includes(search.toLowerCase()))
    : branchList;

  function handleCreate() {
    if (newName.trim()) {
      onCreate(newName.trim());
      setCreating(false);
      setNewName('');
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>

      <View style={s.sheet}>
        <View style={s.header}>
          <Text style={s.title}>Branches</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            placeholder="Search branches…"
            placeholderTextColor="#666"
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {loading && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color="#888" />
              <Text style={s.loadingText}>Loading branches…</Text>
            </View>
          )}

          {!loading && filtered.length === 0 && (
            <Text style={s.emptyText}>No branches found</Text>
          )}

          {filtered.map((branch, i) => (
            <TouchableOpacity
              key={branch}
              style={[s.branchItem, branch === current && s.branchItemActive]}
              onPress={() => { if (branch !== current) onSwitch(branch); }}
              activeOpacity={0.7}
            >
              <Text style={s.checkmark}>{branch === current ? '✓' : ''}</Text>
              <Text style={s.branchName} numberOfLines={1}>{branch}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.footer}>
          {creating ? (
            <View style={s.createRow}>
              <TextInput
                style={s.createInput}
                placeholder="new-branch-name"
                placeholderTextColor="#666"
                value={newName}
                onChangeText={setNewName}
                autoFocus
                onSubmitEditing={handleCreate}
              />
              <TouchableOpacity
                onPress={handleCreate}
                style={[s.createSubmit, !newName.trim() && s.createSubmitDisabled]}
                disabled={!newName.trim()}
                activeOpacity={0.7}
              >
                <Text style={s.createSubmitText}>Create</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setCreating(false); setNewName(''); }} activeOpacity={0.7}>
                <Text style={s.cancelText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setCreating(true)} activeOpacity={0.7}>
              <Text style={s.createBtnText}>+ Create and checkout new branch</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    flex: 1,
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeBtnText: {
    color: '#888',
    fontSize: 16,
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  searchInput: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    color: '#ddd',
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  body: {
    maxHeight: 250,
  },
  bodyContent: {
    paddingVertical: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  loadingText: {
    color: '#888',
    fontSize: 13,
    marginLeft: 8,
  },
  emptyText: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  branchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  branchItemActive: {
    backgroundColor: '#ffffff08',
    borderLeftColor: '#58a6ff',
  },
  checkmark: {
    width: 22,
    color: '#58a6ff',
    fontSize: 13,
    fontWeight: '600',
  },
  branchName: {
    flex: 1,
    color: '#ddd',
    fontSize: 14,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  createBtnText: {
    color: '#58a6ff',
    fontSize: 13,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createInput: {
    flex: 1,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    color: '#ddd',
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 13,
  },
  createSubmit: {
    backgroundColor: '#58a6ff',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  createSubmitDisabled: {
    opacity: 0.5,
  },
  createSubmitText: {
    color: '#0d1117',
    fontSize: 13,
    fontWeight: '600',
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
    paddingHorizontal: 6,
  },
});
