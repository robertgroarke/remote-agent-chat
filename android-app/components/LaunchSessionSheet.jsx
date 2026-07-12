import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';

const AGENT_OPTIONS = [
  ['claude', 'Claude Code'],
  ['claude_cli', 'Claude Code CLI'],
  ['claude-desktop', 'Claude Desktop'],
  ['codex', 'Codex'],
  ['codex_cli', 'Codex CLI'],
  ['codex-desktop', 'Codex Desktop'],
  ['cursor', 'Cursor'],
  ['cursor_cli', 'Cursor CLI'],
  ['gemini', 'Gemini'],
  ['continue', 'Continue'],
  ['continue_yolo', 'Continue YOLO'],
  ['roo_code', 'Roo Code'],
  ['cline', 'Cline'],
  ['antigravity', 'Antigravity IDE'],
  ['antigravity_panel', 'Antigravity Chat'],
  ['antigravity-v2', 'Antigravity v2'],
];

const CLI_DEFAULTS = {
  claude_cli: { model_id: 'deepseek-v4-pro:cloud' },
  codex_cli: { model_id: 'gpt-5.5', permission_mode: 'workspace-write', effort: 'medium' },
  cursor_cli: { model_id: 'grok-4.5-fast-high', permission_mode: 'force' },
};

export default function LaunchSessionSheet({ visible, launchState, onLaunch, onClose }) {
  const [agentType, setAgentType] = useState('claude');
  const [workspacePath, setWorkspacePath] = useState('');
  const [modelId, setModelId] = useState('');
  const launching = launchState?.status === 'launching';

  useEffect(() => {
    if (!visible) return;
    const defaults = CLI_DEFAULTS[agentType];
    setModelId(defaults?.model_id || '');
  }, [agentType, visible]);

  function submit() {
    if (launching) return;
    const defaults = CLI_DEFAULTS[agentType] || {};
    onLaunch(agentType, workspacePath.trim() || undefined, {
      ...defaults,
      model_id: modelId.trim() || defaults.model_id,
    });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} disabled={launching} accessibilityRole="button">
            <Text style={[s.close, launching && s.disabled]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>New Session</Text>
          <View style={s.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Harness</Text>
          <View style={s.agentGrid}>
            {AGENT_OPTIONS.map(([value, label]) => (
              <TouchableOpacity
                key={value}
                style={[s.agent, agentType === value && s.agentSelected]}
                onPress={() => setAgentType(value)}
                disabled={launching}
                accessibilityRole="radio"
                accessibilityState={{ selected: agentType === value, disabled: launching }}
              >
                <Text style={[s.agentText, agentType === value && s.agentTextSelected]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Workspace path (optional)</Text>
          <TextInput
            style={s.input}
            value={workspacePath}
            onChangeText={setWorkspacePath}
            editable={!launching}
            placeholder="C:\\path\\to\\project"
            placeholderTextColor="#484f58"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Workspace path"
          />

          {!!CLI_DEFAULTS[agentType] && (
            <>
              <Text style={s.label}>Model</Text>
              <TextInput
                style={s.input}
                value={modelId}
                onChangeText={setModelId}
                editable={!launching}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Model identifier"
              />
            </>
          )}

          {!!launchState?.error && <Text style={s.error} accessibilityRole="alert">{launchState.error}</Text>}
          <TouchableOpacity
            style={[s.launch, launching && s.disabled]}
            onPress={submit}
            disabled={launching}
            accessibilityRole="button"
          >
            {launching
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Text style={s.launchText}>Launch Session</Text>}
          </TouchableOpacity>
          <Text style={s.notice}>
            Launching may open the selected harness on the desktop. Use only when the desktop is available.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  header: { height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  close: { color: '#58a6ff', fontSize: 14, fontWeight: '700', width: 64 },
  title: { flex: 1, color: '#f0f6fc', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 64 },
  body: { padding: 16, paddingBottom: 32 },
  label: { color: '#8b949e', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 12, marginBottom: 7 },
  agentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  agent: { borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  agentSelected: { borderColor: '#58a6ff', backgroundColor: '#1f3b5b' },
  agentText: { color: '#8b949e', fontSize: 12, fontWeight: '700' },
  agentTextSelected: { color: '#f0f6fc' },
  input: { color: '#f0f6fc', backgroundColor: '#010409', borderWidth: 1, borderColor: '#30363d', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  error: { color: '#ff7b72', backgroundColor: '#2d1518', padding: 10, borderRadius: 7, marginTop: 14 },
  launch: { minHeight: 46, borderRadius: 9, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  launchText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  notice: { color: '#768390', fontSize: 11, lineHeight: 16, marginTop: 10, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
