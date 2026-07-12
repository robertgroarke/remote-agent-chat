import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, Switch,
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

function SettingRow({ label, options, value, onChange, disabled = false }) {
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
                style={[s.chip, active && s.chipActive, disabled && s.chipDisabled]}
                onPress={() => onChange(opt.id)}
                disabled={disabled}
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
  visible, onClose, agentType, config, relay, sessionId, controlResults,
}) {
  const [controlStates, setControlStates] = useState({});
  const controlTimers = useRef({});
  const hasConfig = !!config;
  config = config || {};
  const caps = config.capabilities || {};

  const isPending = field => ['pending', 'awaiting_config'].includes(controlStates[field]?.status);
  const valueFor = (field, current) => isPending(field) ? controlStates[field].requestedValue : current;

  function clearControlTimer(field) {
    if (controlTimers.current[field]) clearTimeout(controlTimers.current[field]);
    delete controlTimers.current[field];
  }

  function submitControl(field, previousValue, requestedValue, submit) {
    clearControlTimer(field);
    const requestId = submit?.();
    if (!requestId) return;
    setControlStates(prev => ({
      ...prev,
      [field]: { requestId, previousValue, requestedValue, status: 'pending', error: null },
    }));
    controlTimers.current[field] = setTimeout(() => {
      setControlStates(prev => ({
        ...prev,
        [field]: { ...prev[field], status: 'failed', error: 'Timed out waiting for the agent to confirm this setting.' },
      }));
    }, 15000);
  }

  useEffect(() => () => {
    Object.values(controlTimers.current).forEach(timer => clearTimeout(timer));
    controlTimers.current = {};
  }, []);

  useEffect(() => {
    Object.values(controlTimers.current).forEach(timer => clearTimeout(timer));
    controlTimers.current = {};
    setControlStates({});
  }, [sessionId]);

  useEffect(() => {
    setControlStates(prev => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([field, state]) => {
        if (!['pending', 'awaiting_config'].includes(state.status)) return;
        const result = controlResults?.[state.requestId];
        if (!result) return;
        if (result.result === 'failed') {
          clearControlTimer(field);
          next[field] = { ...state, status: 'failed', error: result.error?.message || result.error || 'The agent rejected this setting.' };
          changed = true;
        } else if (result.result === 'ok' && state.status !== 'awaiting_config') {
          next[field] = { ...state, status: 'awaiting_config' };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [controlResults]);

  useEffect(() => {
    const confirmedValues = {
      model: config.model_id,
      permission_mode: config.permission_mode,
      auto_approve_permissions: config.auto_approve_permissions,
      mode: config.conversation_mode || config.mode,
      effort: config.effort,
      access_mode: config.permission_mode,
      workspace: config.available_workspaces?.find(workspace => workspace.active)?.id || config.file_access_scope,
    };
    setControlStates(prev => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([field, state]) => {
        if (!['pending', 'awaiting_config'].includes(state.status) || confirmedValues[field] !== state.requestedValue) return;
        clearControlTimer(field);
        next[field] = { ...state, status: 'ok', error: null };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [config.model_id, config.permission_mode, config.auto_approve_permissions, config.conversation_mode, config.mode, config.effort, config.file_access_scope, config.available_workspaces]);

  function modelsForAgent() {
    if (agentType === 'antigravity' || agentType === 'antigravity_panel') return KNOWN_ANTIGRAVITY_MODELS;
    if (agentType === 'gemini') return KNOWN_GEMINI_MODELS;
    if (caps.set_codex_config && config.available_models?.length) return config.available_models;
    return KNOWN_CLAUDE_MODELS;
  }

  function handleModelChange(modelId) {
    if (caps.set_codex_config) {
      submitControl('model', config.model_id, modelId, () => relay?.setCodexConfig(sessionId, { model_id: modelId }));
    } else {
      submitControl('model', config.model_id, modelId, () => relay?.setAgentModel(sessionId, modelId));
    }
  }

  function handlePermissionChange(mode) {
    submitControl('permission_mode', config.permission_mode, mode, () => relay?.setAgentPermissionMode(sessionId, mode));
  }

  function handleModeChange(mode) {
    submitControl('mode', config.conversation_mode || config.mode, mode, () => relay?.setAntigravityMode(sessionId, mode));
  }

  function handleEffortChange(effort) {
    submitControl('effort', config.effort, effort, () => relay?.setCodexConfig(sessionId, { effort }));
  }

  function handleAccessChange(accessMode) {
    submitControl('access_mode', config.permission_mode, accessMode, () => relay?.setCodexConfig(sessionId, { access_mode: accessMode }));
  }

  const showModel = caps.set_model || caps.set_codex_config ||
    agentType === 'antigravity' || agentType === 'antigravity_panel';
  const showPermission = caps.permission_mode_change;
  const showAntigravityMode = agentType === 'antigravity' || agentType === 'antigravity_panel';
  const showEffort = caps.set_codex_config && config.available_efforts?.length > 0;
  const showAccess = caps.set_codex_config && config.available_access?.length > 0;
  const autoApproveEnabled = typeof config.auto_approve_permissions === 'boolean'
    ? config.auto_approve_permissions
    : false;

  if (!hasConfig) return null;

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
              value={valueFor('model', config.model_id || 'default')}
              onChange={handleModelChange}
              disabled={isPending('model')}
            />
          )}

          {showPermission && (
            <SettingRow
              label="Permissions"
              options={PERMISSION_MODES}
              value={valueFor('permission_mode', config.permission_mode || 'default')}
              onChange={handlePermissionChange}
              disabled={isPending('permission_mode')}
            />
          )}

          {caps.auto_approve_permissions_toggle && (
            <View style={s.toggleRow}>
              <Text style={s.settingLabel}>Tool prompts</Text>
              <View style={s.toggleControl}>
                <Text style={s.toggleHint}>Auto-approve permission prompts</Text>
                <Switch
                  value={valueFor('auto_approve_permissions', autoApproveEnabled)}
                  disabled={isPending('auto_approve_permissions')}
                  onValueChange={(v) => submitControl('auto_approve_permissions', autoApproveEnabled, v, () => relay?.setAutoApprovePermissions(sessionId, v))}
                  trackColor={{ false: '#30363d', true: '#1f4d8a' }}
                  thumbColor={autoApproveEnabled ? '#58a6ff' : '#768390'}
                />
              </View>
            </View>
          )}

          {showAntigravityMode && (
            <SettingRow
              label="Mode"
              options={ANTIGRAVITY_MODES}
              value={valueFor('mode', config.conversation_mode || config.mode || 'Planning')}
              onChange={handleModeChange}
              disabled={isPending('mode')}
            />
          )}

          {showEffort && (
            <SettingRow
              label="Effort"
              options={config.available_efforts}
              value={valueFor('effort', (config.effort || 'medium').toLowerCase())}
              onChange={handleEffortChange}
              disabled={isPending('effort')}
            />
          )}

          {showAccess && (
            <SettingRow
              label="Access"
              options={config.available_access}
              value={valueFor('access_mode', config.permission_mode || 'workspace-write')}
              onChange={handleAccessChange}
              disabled={isPending('access_mode')}
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
              value={valueFor('workspace', config.available_workspaces.find(ws => ws.active)?.id || config.available_workspaces[0]?.id)}
              disabled={isPending('workspace')}
              onChange={(wsId) => submitControl('workspace', config.available_workspaces.find(ws => ws.active)?.id, wsId, () => relay?.switchWorkspace(sessionId, wsId))}
            />
          )}

          {Object.values(controlStates).some(state => ['pending', 'awaiting_config', 'failed'].includes(state.status)) && (
            <View style={[s.controlStatus, Object.values(controlStates).some(state => state.status === 'failed') && s.controlStatusFailed]}>
              <Text style={[s.controlStatusText, Object.values(controlStates).some(state => state.status === 'failed') && s.controlStatusTextFailed]}>
                {Object.values(controlStates).find(state => state.status === 'failed')?.error
                  || `Saving ${Object.entries(controlStates).find(([, state]) => ['pending', 'awaiting_config'].includes(state.status))?.[0]?.replace(/_/g, ' ')}…`}
              </Text>
            </View>
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
  toggleRow: {
    marginBottom: 16,
  },
  toggleControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleHint: {
    flex: 1,
    color: '#cdd9e5',
    fontSize: 13,
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
  chipDisabled: {
    opacity: 0.55,
  },
  controlStatus: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: 'rgba(88,166,255,0.10)',
  },
  controlStatusFailed: {
    backgroundColor: 'rgba(248,81,73,0.10)',
  },
  controlStatusText: {
    color: '#58a6ff',
    fontSize: 12,
  },
  controlStatusTextFailed: {
    color: '#f85149',
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
