import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator, Platform, TextInput, useColorScheme,
} from 'react-native';

// ── TerminalViewer (Epic 4) ─────────────────────────────────────────────────
// Bottom sheet showing terminal/command output from Codex sessions.
// Monospace text with optional command labels + interactive input.

export default function TerminalViewer({
  visible, entries, onRefresh, onClose, onMinimize, loading, onSendInput,
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const light = useColorScheme() === 'light';

  function handleSend() {
    const text = input.trim();
    if (!text || !onSendInput) return;
    setSending(true);
    setInput('');
    onSendInput(text);
    // Auto-refresh after a brief delay to show result
    setTimeout(() => setSending(false), 600);
  }

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

      <View style={[s.sheet, light && s.sheetLight]}>
        <View style={[s.header, light && s.headerLight]}>
          <Text style={[s.title, light && s.textLight]}>Terminal</Text>
          <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.7}>
            <Text style={s.refreshBtnText}>↻</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onMinimize || onClose}
            style={s.minimizeBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Minimize Terminal"
            accessibilityState={{ expanded: true }}
            testID="pane-minimize-terminal"
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
              <ActivityIndicator size="small" color={light ? '#57606a' : '#888'} />
              <Text style={s.loadingText}>Loading output…</Text>
            </View>
          )}

          {!loading && (!entries || entries.length === 0) && (
            <Text style={[s.emptyText, light && s.mutedLight]}>No terminal output captured</Text>
          )}

          {(entries || []).map((entry, i) => (
            <View key={i} style={[s.entry, light && s.entryLight]}>
              {entry.command && (
                <Text style={[s.command, light && s.commandLight]}>$ {entry.command}</Text>
              )}
              <Text style={[s.output, light && s.outputLight]} selectable>{entry.output}</Text>
            </View>
          ))}
        </ScrollView>

        {onSendInput && (
          <View style={[s.inputRow, light && s.inputRowLight]}>
            <Text style={[s.prompt, light && s.commandLight]}>$</Text>
            <TextInput
              style={[s.input, light && s.inputLight]}
              value={input}
              onChangeText={setInput}
              placeholder="Type a command…"
              placeholderTextColor={light ? '#6e7781' : '#444c56'}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              editable={!sending}
            />
            <TouchableOpacity
              style={[s.sendBtn, (!input.trim() || sending) && s.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || sending}
              activeOpacity={0.7}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#58a6ff" />
              ) : (
                <Text style={s.sendBtnText}>↵</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
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
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '45%',
    paddingBottom: 20,
  },
  sheetLight: {
    backgroundColor: '#f6f8fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  headerLight: {
    borderBottomColor: '#d0d7de',
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
    minWidth: 44,
    minHeight: 44,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    color: '#58a6ff',
    fontSize: 16,
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
    maxHeight: 350,
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
  entryLight: {
    borderBottomColor: '#d0d7de',
  },
  command: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#58a6ff',
    fontWeight: '600',
    paddingBottom: 2,
  },
  commandLight: {
    color: '#0550ae',
  },
  output: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#c9d1d9',
    lineHeight: 18,
  },
  outputLight: {
    color: '#24292f',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    gap: 6,
  },
  inputRowLight: {
    borderTopColor: '#d0d7de',
  },
  prompt: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    color: '#58a6ff',
    fontWeight: '700',
  },
  input: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: '#c9d1d9',
    backgroundColor: '#161b22',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 10,
    paddingVertical: 8,
    height: 38,
  },
  inputLight: {
    color: '#24292f',
    backgroundColor: '#ffffff',
    borderColor: '#d0d7de',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#21262d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#58a6ff',
    fontSize: 18,
    fontWeight: '700',
  },
  textLight: {
    color: '#24292f',
  },
  mutedLight: {
    color: '#57606a',
  },
});
