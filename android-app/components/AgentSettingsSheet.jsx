import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet,
} from 'react-native';

// ── Model / mode constants (matching web UI) ────────────────────────────────

const KNOWN_CLAUDE_MODELS = [
  { id: 'default',             label: 'Auto' },
  { id: 'claude-opus-4-6',    label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-5',    label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-0',    label: 'Claude Opus 4' },
  { id: 'claude-sonnet-4-0',  label: 'Claude Sonnet 4' },
];

const KNOWN_ANTIGRAVITY_MODELS = [
  { id: 'Gemini 3.1 Pro (High)',        label: 'Gemini 3.1 Pro (High)' },
  { id: 'Gemini 3.1 Pro (Low)',         label: 'Gemini 3.1 Pro (Low)' },
  { id: 'Gemini 3 Flash',               label: 'Gemini 3 Flash' },
  { id: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'Claude Opus 4.6 (Thinking)',   label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'GPT-OSS 120B (Medium)',        label: 'GPT-OSS 120B (Medium)' },
];

const KNOWN_GEMINI_MODELS = [
  { id: 'Default',          label: 'Default' },
  { id: '2.5 Flash',        label: 'Gemini 2.5 Flash' },
  { id: '2.5 Pro',          label: 'Gemini 2.5 Pro' },
  { id: '3 Flash Preview',  label: 'Gemini 3 Flash Preview' },
  { id: '3.1 Pro Preview',  label: 'Gemini 3.1 Pro Preview' },
];

const ANTIGRAVITY_MODES = [
  { id: 'Planning', label: 'Planning' },
  { id: 'Fast',     label: 'Fast' },
];

const PERMISSION_MODES = [
  { id: 'bypassPermissions', label: 'Bypass (allow all)' },
  { id: 'default',           label: 'Default (ask each time)' },
];

// ── Picker row component ────────────────────────────────────────────────────

function SettingRow({ label, options, value, onChange }) {
  return (
    <View style={s.settingRow}>
      <Text style={s.settingLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
        <View style={s.chipRow}>
          {options.map(opt => {
            const active = opt.id === value;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[s.chip, active && s.chipActive]}
                onPress={() => onChange(opt.id)}
                activeOpacity={0.7}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Main sheet ──────────────────────────────────────────────────────────────

export default function AgentSettingsSheet({
  visible, onClose, agentType, config, relay, sessionId,
}) {
  if (!config) return null;
  const caps = config.capabilities || {};

  function modelsForAgent() {
    if (agentType === 'antigravity' || agentType === 'antigravity_panel') return KNOWN_ANTIGRAVITY_MODELS;
    if (agentType === 'gemini') return KNOWN_GEMINI_MODELS;
    if (caps.set_codex_config && config.available_models?.length) return config.available_models;
    return KNOWN_CLAUDE_MODELS;
  }

  function handleModelChange(modelId) {
    if (caps.set_codex_config) {
      relay?.setCodexConfig(sessionId, { model_id: modelId });
    } else {
      relay?.setAgentModel(sessionId, modelId);
    }
  }

  function handlePermissionChange(mode) {
    relay?.setAgentPermissionMode(sessionId, mode);
  }

  function handleModeChange(mode) {
    relay?.setAntigravityMode(sessionId, mode);
  }

  function handleEffortChange(effort) {
    relay?.setCodexConfig(sessionId, { effort });
  }

  function handleAccessChange(accessMode) {
    relay?.setCodexConfig(sessionId, { access_mode: accessMode });
  }

  const showModel = caps.set_model || caps.set_codex_config ||
    agentType === 'antigravity' || agentType === 'antigravity_panel';
  const showPermission = caps.permission_mode_change;
  const showAntigravityMode = agentType === 'antigravity' || agentType === 'antigravity_panel';
  const showEffort = caps.set_codex_config && config.available_efforts?.length > 0;
  const showAccess = caps.set_codex_config && config.available_access?.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <View style={s.handle} />
        <Text style={s.sheetTitle}>Agent Settings</Text>

        <ScrollView style={s.sheetBody} bounces={false}>
          {showModel && (
            <SettingRow
              label="Model"
              options={modelsForAgent()}
              value={config.model_id || 'default'}
              onChange={handleModelChange}
            />
          )}

          {showPermission && (
            <SettingRow
              label="Permissions"
              options={PERMISSION_MODES}
              value={config.permission_mode || 'default'}
              onChange={handlePermissionChange}
            />
          )}

          {showAntigravityMode && (
            <SettingRow
              label="Mode"
              options={ANTIGRAVITY_MODES}
              value={config.conversation_mode || 'Planning'}
              onChange={handleModeChange}
            />
          )}

          {showEffort && (
            <SettingRow
              label="Effort"
              options={config.available_efforts}
              value={(config.effort || 'medium').toLowerCase()}
              onChange={handleEffortChange}
            />
          )}

          {showAccess && (
            <SettingRow
              label="Access"
              options={config.available_access}
              value={config.permission_mode || 'workspace-write'}
              onChange={handleAccessChange}
            />
          )}

          {config.file_access_scope && config.file_access_scope !== 'unknown' && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Workspace</Text>
              <Text style={s.infoValue} numberOfLines={2}>{config.file_access_scope}</Text>
            </View>
          )}

          {caps.switch_workspace && config.available_workspaces?.length > 1 && (
            <SettingRow
              label="Switch Workspace"
              options={config.available_workspaces.map(ws => ({ id: ws.id || ws.title, label: ws.title }))}
              value={config.available_workspaces.find(ws => ws.active)?.id || config.available_workspaces[0]?.id}
              onChange={(wsId) => relay?.switchWorkspace(sessionId, wsId)}
            />
          )}

          {config.branch && config.branch !== 'unknown' && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Branch</Text>
              <Text style={s.infoValue}>{config.branch}</Text>
            </View>
          )}

          {config.sandbox_status && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Sandbox</Text>
              <Text style={[s.infoValue, !config.sandbox_status.active && s.infoDim]}>
                {config.sandbox_status.active ? '\u{1F7E2}' : '\u26AA'}{' '}
                {config.sandbox_status.label || (config.sandbox_status.active ? 'Active' : 'Inactive')}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#161b22',
    borderTopLeftRadius:  16,
    borderTopRightRadius: 16,
    paddingBottom:   34,
    maxHeight:       '60%',
  },
  handle: {
    width:           36,
    height:          4,
    borderRadius:    2,
    backgroundColor: '#484f58',
    alignSelf:       'center',
    marginTop:       10,
    marginBottom:    8,
  },
  sheetTitle: {
    color:             '#cdd9e5',
    fontSize:          16,
    fontWeight:        '600',
    textAlign:         'center',
    paddingBottom:     12,
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
  },
  sheetBody: {
    paddingHorizontal: 16,
    paddingTop:        12,
  },
  settingRow: {
    marginBottom: 16,
  },
  settingLabel: {
    color:        '#768390',
    fontSize:     12,
    fontWeight:   '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipScroll: {
    flexGrow: 0,
  },
  chipRow: {
    flexDirection: 'row',
    gap:           6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      8,
    backgroundColor:   '#21262d',
    borderWidth:       1,
    borderColor:       '#30363d',
  },
  chipActive: {
    backgroundColor: '#1f4d8a',
    borderColor:     '#58a6ff',
  },
  chipText: {
    color:    '#768390',
    fontSize: 13,
  },
  chipTextActive: {
    color:      '#cdd9e5',
    fontWeight: '600',
  },
  infoRow: {
    marginBottom:     16,
    paddingTop:       12,
    borderTopWidth:   1,
    borderTopColor:   '#30363d',
  },
  infoLabel: {
    color:        '#768390',
    fontSize:     12,
    fontWeight:   '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    color:    '#cdd9e5',
    fontSize: 13,
  },
  infoDim: {
    color:   '#666',
  },
});
