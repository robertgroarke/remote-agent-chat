import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';

// ── ChatListSheet (Epic 9) ──────────────────────────────────────────────────
// Bottom sheet showing Codex conversation list with switch/new chat actions.
// Shared between Codex (iframe) and Codex Desktop, and reusable for
// Antigravity Panel (Epic 10).

export default function ChatListSheet({ visible, chats, onSwitch, onNew, onClose, onMinimize, loading }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onMinimize || onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>

      <View style={s.sheet}>
        <View style={s.header}>
          <Text style={s.title}>Conversations</Text>
          <TouchableOpacity onPress={onNew} style={s.newBtn} activeOpacity={0.7}>
            <Text style={s.newBtnText}>+ New</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onMinimize || onClose}
            style={s.minimizeBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Minimize Conversations"
            accessibilityState={{ expanded: true }}
            testID="pane-minimize-chat-list"
          >
            <Text style={s.minimizeBtnText}>Minimize</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {loading && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color="#888" />
              <Text style={s.loadingText}>Loading conversations…</Text>
            </View>
          )}

          {!loading && (!chats || chats.length === 0) && (
            <Text style={s.emptyText}>No conversations found</Text>
          )}

          {(chats || []).map((chat, i) => (
            <TouchableOpacity
              key={chat.id || `chat-${i}`}
              style={[s.chatItem, chat.active && s.chatItemActive]}
              onPress={() => onSwitch(chat.id)}
              activeOpacity={0.7}
            >
              <Text style={s.chatTitle} numberOfLines={2}>{chat.title}</Text>
              {chat.active && <Text style={s.activeDot}>●</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>
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
    maxHeight: '45%',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
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
  newBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    backgroundColor: '#10a37f22',
    borderRadius: 6,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: {
    color: '#10a37f',
    fontSize: 13,
    fontWeight: '600',
  },
  minimizeBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#484f58',
    borderRadius: 7,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizeBtnText: { color: '#f0f6fc', fontSize: 10, fontWeight: '700' },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#888',
    fontSize: 16,
  },
  body: {
    maxHeight: 300,
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
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  chatItemActive: {
    backgroundColor: '#ffffff08',
    borderLeftColor: '#10a37f',
  },
  chatTitle: {
    flex: 1,
    color: '#ddd',
    fontSize: 14,
  },
  activeDot: {
    color: '#10a37f',
    fontSize: 10,
    marginLeft: 8,
  },
});
