import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useThemedStyles } from '../lib/theme';

// ── ThreadHistorySheet (Epic 2) ─────────────────────────────────────────────
// Bottom sheet showing Codex Desktop thread history with switch/new actions.
// Same visual style as ChatListSheet.

export default function ThreadHistorySheet({
  visible,
  threads,
  selectedThreadId,
  onSwitch,
  onNew,
  onClose,
  onMinimize,
  loading,
}) {
  const s = useThemedStyles(darkStyles);
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
          <Text style={s.title}>Codex Desktop chats</Text>
          <TouchableOpacity onPress={onNew} style={s.newBtn} activeOpacity={0.7}>
            <Text style={s.newBtnText}>+ New</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onMinimize || onClose}
            style={s.minimizeBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Minimize Threads"
            accessibilityState={{ expanded: true }}
            testID="pane-minimize-thread-list"
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
              <Text style={s.loadingText}>Loading threads…</Text>
            </View>
          )}

          {!loading && (!threads || threads.length === 0) && (
            <Text style={s.emptyText}>No threads found</Text>
          )}

          {(threads || []).map((thread, i) => {
            const threadId = String(thread.id || thread.cache_key || '');
            const selected = !!threadId && threadId === String(selectedThreadId || '');
            const viewState = thread.active
              ? 'native_active'
              : (thread.view_state || (thread.loadable ? 'archive' : 'unavailable'));
            const stateLabel = viewState === 'native_active'
              ? 'Native active'
              : viewState === 'archive'
                ? 'Archive'
                : 'Unavailable';
            return (
              <TouchableOpacity
                key={threadId || `thread-${i}`}
                style={[
                  s.threadItem,
                  thread.active && s.threadItemActive,
                  selected && s.threadItemSelected,
                ]}
                onPress={() => onSwitch(threadId)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${thread.title || 'Untitled chat'}. ${stateLabel}${selected ? '. Selected' : ''}`}
                testID={`desktop-thread-${threadId || i}`}
              >
                <View style={s.threadCopy}>
                  <Text style={s.threadTitle} numberOfLines={2}>{thread.title || 'Untitled chat'}</Text>
                  <View style={s.threadMetadata}>
                    <Text style={[
                      s.stateLabel,
                      viewState === 'native_active' && s.stateLabelActive,
                      viewState === 'archive' && s.stateLabelArchive,
                      viewState === 'unavailable' && s.stateLabelUnavailable,
                    ]}>{stateLabel}</Text>
                    {selected && <Text style={s.selectedLabel}>Selected</Text>}
                    {!!thread.pollability?.state && (
                      <Text style={s.pollabilityLabel}>{thread.pollability.state}</Text>
                    )}
                  </View>
                </View>
                {thread.age ? <Text style={s.ageLabel}>{thread.age}</Text> : null}
                {thread.active && <Text style={s.activeDot}>●</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const darkStyles = StyleSheet.create({
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
    borderBottomColor: '#30363d',
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
    backgroundColor: '#123b2a',
    borderRadius: 6,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: {
    color: '#3fb950',
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
  threadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  threadItemActive: {
    backgroundColor: '#ffffff08',
    borderLeftColor: '#3fb950',
  },
  threadItemSelected: {
    backgroundColor: '#0d2138',
    borderLeftColor: '#58a6ff',
  },
  threadCopy: {
    flex: 1,
    minWidth: 0,
  },
  threadTitle: {
    flex: 1,
    color: '#ddd',
    fontSize: 14,
  },
  ageLabel: {
    color: '#8b949e',
    fontSize: 11,
    marginLeft: 8,
  },
  activeDot: {
    color: '#3fb950',
    fontSize: 10,
    marginLeft: 8,
  },
  threadMetadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  stateLabel: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  stateLabelActive: { color: '#3fb950' },
  stateLabelArchive: { color: '#58a6ff' },
  stateLabelUnavailable: { color: '#f0883e' },
  selectedLabel: {
    color: '#f0f6fc',
    backgroundColor: '#1f3b5b',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pollabilityLabel: {
    color: '#8b949e',
    fontSize: 10,
  },
});
