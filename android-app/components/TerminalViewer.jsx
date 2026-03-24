import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator, Platform, TextInput,
} from 'react-native';

// ── TerminalViewer (Epic 4) ─────────────────────────────────────────────────
// Bottom sheet showing terminal/command output from Codex sessions.
// Monospace text with optional command labels + interactive input.

export default function TerminalViewer({ visible, entries, onRefresh, onClose, loading, onSendInput }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

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
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>

      <View style={s.sheet}>
        <View style={s.header}>
          <Text style={s.title}>Terminal</Text>
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
              <Text style={s.loadingText}>Loading output…</Text>
            </View>
          )}

          {!loading && (!entries || entries.length === 0) && (
            <Text style={s.emptyText}>No terminal output captured</Text>
          )}

          {(entries || []).map((entry, i) => (
            <View key={i} style={s.entry}>
              {entry.command && (
                <Text style={s.command}>$ {entry.command}</Text>
              )}
              <Text style={s.output} selectable>{entry.output}</Text>
            </View>
          ))}
        </ScrollView>

        {onSendInput && (
          <View style={s.inputRow}>
            <Text style={s.prompt}>$</Text>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="Type a command…"
              placeholderTextColor="#444c56"
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
    color: '#58a6ff',
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
  command: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#58a6ff',
    fontWeight: '600',
    paddingBottom: 2,
  },
  output: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#c9d1d9',
    lineHeight: 18,
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
});
