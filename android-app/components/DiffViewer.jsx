import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';

// ── DiffViewer (Epic 5) ─────────────────────────────────────────────────────
// Bottom sheet showing file changes / diff output from Codex sessions.
// Color-coded lines: green for additions, red for deletions, blue for hunks.

export default function DiffViewer({ visible, entries, onRefresh, onClose, loading, onAccept, onReject }) {
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
          <Text style={s.title}>File Changes</Text>
          <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.7}>
            <Text style={s.refreshBtnText}>↻</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {loading && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color="#888" />
              <Text style={s.loadingText}>Loading changes…</Text>
            </View>
          )}

          {!loading && (!entries || entries.length === 0) && (
            <Text style={s.emptyText}>No file changes detected</Text>
          )}

          {(entries || []).map((entry, i) => (
            <View key={i} style={s.entry}>
              {(entry.file || entry.path) && (
                <View style={s.fileHeaderRow}>
                  <Text style={s.fileHeader}>{entry.file || entry.path}</Text>
                  {(entry.can_accept || entry.can_reject) && onAccept && onReject && (
                    <View style={s.fileActions}>
                      {entry.can_accept && (
                        <TouchableOpacity onPress={() => onAccept(entry.id || entry.path)} style={s.acceptBtn}>
                          <Text style={s.actionBtnText}>Accept</Text>
                        </TouchableOpacity>
                      )}
                      {entry.can_reject && (
                        <TouchableOpacity onPress={() => onReject(entry.id || entry.path)} style={s.rejectBtn}>
                          <Text style={s.actionBtnText}>Reject</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}
              {entry.content ? (
                <Text style={s.diffContent} selectable>
                  {entry.content.split('\n').map((line, li) => {
                    const lineStyle = line.startsWith('+') ? s.diffAdd :
                                      line.startsWith('-') ? s.diffDel :
                                      line.startsWith('@@') ? s.diffHunk : s.diffNormal;
                    return (
                      <Text key={li} style={lineStyle}>{line}{'\n'}</Text>
                    );
                  })}
                </Text>
              ) : (
                <Text style={s.noContent}>No content</Text>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '65%',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  title: {
    flex: 1,
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  refreshBtnText: {
    color: '#d2a8ff',
    fontSize: 16,
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeBtnText: {
    color: '#888',
    fontSize: 16,
  },
  body: {
    maxHeight: 400,
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
  entry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  fileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 4,
  },
  fileHeader: {
    flex: 1,
    fontFamily: mono,
    fontSize: 12,
    color: '#d2a8ff',
    fontWeight: '600',
  },
  fileActions: { flexDirection: 'row', gap: 6 },
  acceptBtn: { backgroundColor: '#238636', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  rejectBtn: { backgroundColor: '#da3633', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  actionBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  diffContent: {
    fontFamily: mono,
    fontSize: 12,
    color: '#c9d1d9',
    lineHeight: 18,
  },
  diffAdd: {
    color: '#3fb950',
  },
  diffDel: {
    color: '#f85149',
  },
  diffHunk: {
    color: '#58a6ff',
    fontWeight: '600',
  },
  diffNormal: {
    color: '#c9d1d9',
  },
  noContent: {
    fontFamily: mono,
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
});
