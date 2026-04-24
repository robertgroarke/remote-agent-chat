import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';

// ── DiffViewer (Epic 5) ─────────────────────────────────────────────────────
// Bottom sheet showing file changes / diff output from Codex sessions.
// Color-coded lines: green for additions, red for deletions, blue for hunks.

export default function DiffViewer({ visible, entries, onRefresh, onClose, loading }) {
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
              {entry.file && (
                <Text style={s.fileHeader}>{entry.file}</Text>
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
  fileHeader: {
    fontFamily: mono,
    fontSize: 12,
    color: '#d2a8ff',
    fontWeight: '600',
    paddingBottom: 4,
  },
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
