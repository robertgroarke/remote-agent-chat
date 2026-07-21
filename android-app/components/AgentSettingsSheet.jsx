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
  visible, onClose, agentType, config, relay, sessionId, session, controlResults, onExport,
}) {
  const [controlStates, setControlStates] = useState({});
  const [bypassConfirmation, setBypassConfirmation] = useState(false);
  const [bypassRestoreProfile, setBypassRestoreProfile] = useState(null);
  const controlTimers = useRef({});
  const hasConfig = !!config;
  config = config || {};
  const caps = config.capabilities || {};
  const splitObservedConfig = agentType === 'codex_cli' && config.config_semantics === 'observed_and_next_send';

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
    setBypassConfirmation(false);
    setBypassRestoreProfile(null);
  }, [sessionId]);

  useEffect(() => {
    setControlStates(prev => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([field, state]) => {
        if (!['pending', 'awaiting_config'].includes(state.status)) return;
        const result = controlResults?.[state.requestId];
        if (!result || (result.session_id || result.session) !== sessionId) return;
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
  }, [controlResults, sessionId]);

  useEffect(() => {
    const confirmedValues = {
      model: splitObservedConfig ? config.next_send_model_id : config.model_id,
      permission_mode: config.permission_mode,
      auto_approve_permissions: config.auto_approve_permissions,
      mode: config.conversation_mode || config.mode,
      effort: splitObservedConfig ? config.next_send_effort : config.effort,
      access_mode: config.permission_mode,
      permission_profile: config.permission_profile,
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
  }, [config.model_id, config.next_send_model_id, config.permission_mode, config.permission_profile, config.auto_approve_permissions, config.conversation_mode, config.mode, config.effort, config.next_send_effort, config.file_access_scope, config.available_workspaces, splitObservedConfig]);

  function modelsForAgent() {
    if (agentType === 'antigravity' || agentType === 'antigravity_panel') return KNOWN_ANTIGRAVITY_MODELS;
    if (agentType === 'gemini') return KNOWN_GEMINI_MODELS;
    if (config.available_models?.length) return config.available_models;
    return KNOWN_CLAUDE_MODELS;
  }

  function handleModelChange(modelId) {
    if (splitObservedConfig) {
      submitControl('model', config.next_send_model_id, modelId, () => relay?.setAgentModel(sessionId, modelId));
    } else if (caps.set_codex_config) {
      submitControl('model', config.model_id, modelId, () => relay?.setCodexConfig(sessionId, {
        model_id: modelId,
        source_revision: config.source_revision,
      }));
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
    if (splitObservedConfig) {
      submitControl('effort', config.next_send_effort, effort, () => relay?.setAgentEffort(sessionId, effort));
    } else {
      submitControl('effort', config.effort, effort, () => relay?.setCodexConfig(sessionId, {
        effort,
        source_revision: config.source_revision,
      }));
    }
  }

  function handleAccessChange(accessMode) {
    submitControl('access_mode', config.permission_mode, accessMode, () => relay?.setCodexConfig(sessionId, { access_mode: accessMode }));
  }

  function applyPermissionProfile(permissionProfile, confirmBypass = false) {
    if (permissionProfile === 'full-access' && !caps.codex_bypass_permissions) return;
    if (permissionProfile === 'full-access' && !confirmBypass) {
      setBypassConfirmation(true);
      return;
    }
    if (permissionProfile === 'full-access') {
      setBypassRestoreProfile(config.permission_profile && config.permission_profile !== 'full-access'
        ? config.permission_profile
        : 'auto');
    }
    setBypassConfirmation(false);
    submitControl('permission_profile', config.permission_profile, permissionProfile, () => relay?.setCodexConfig(sessionId, {
      permission_profile: permissionProfile,
      ...(confirmBypass ? { confirm_bypass: true } : {}),
      source_revision: config.source_revision,
    }));
  }

  const isVsCodeCodex = agentType === 'codex';
  const codexControlsAvailable = !isVsCodeCodex || config.controls_available !== false;
  const showModel = caps.set_model || caps.codex_model_change ||
    agentType === 'antigravity' || agentType === 'antigravity_panel';
  const showPermission = caps.permission_mode_change;
  const showAntigravityMode = agentType === 'antigravity' || agentType === 'antigravity_panel';
  const showEffort = (caps.set_effort || caps.codex_effort_change) && config.available_efforts?.length > 0;
  const showAccess = caps.codex_access_change && config.available_access?.length > 0;
  const showPermissionProfile = caps.codex_permission_profile_change
    && config.available_permission_profiles?.length > 0;
  const autoApproveEnabled = typeof config.auto_approve_permissions === 'boolean'
    ? config.auto_approve_permissions
    : false;
  const codexLiveOwner = agentType === 'codex_cli' ? session?.codex_live_owner : null;
  const codexLiveOwnerLabel = !codexLiveOwner
    ? 'Ownership status unavailable'
    : codexLiveOwner.state === 'confirmed'
      ? ({
          interactive_tui: 'Interactive terminal active',
          proxy_app_server: 'Headless RAC app-server turn active',
          rotator_exec: 'Headless rotator worker active',
        }[codexLiveOwner.owner_kind] || 'Live owner active')
      : codexLiveOwner.state === 'multiple'
        ? 'Needs attention: multiple owners'
        : codexLiveOwner.state === 'stale'
          ? 'Needs attention: stale owner proof'
          : codexLiveOwner.state === 'unavailable'
            ? 'Ownership startup is not ready'
            : 'No live owner';
  const codexLiveOwnerDetail = codexLiveOwner
    ? [
        codexLiveOwner.thread_id ? `Thread ${codexLiveOwner.thread_id}` : null,
        codexLiveOwner.turn_id ? `Turn ${codexLiveOwner.turn_id}` : null,
        codexLiveOwner.root_pid ? `PID ${codexLiveOwner.root_pid}` : null,
        codexLiveOwner.reason || null,
      ].filter(Boolean).join(' · ')
    : '';

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
          {agentType === 'codex_cli' && (
            <View style={s.infoRow} testID="codex-live-owner-status" accessibilityLabel={`${codexLiveOwnerLabel}. ${codexLiveOwnerDetail}`}>
              <Text style={s.infoLabel}>Live owner</Text>
              <Text style={[s.infoValue, ['multiple', 'stale', 'unavailable'].includes(codexLiveOwner?.state) && s.controlStatusTextFailed]} selectable>
                {codexLiveOwnerLabel}
              </Text>
              {!!codexLiveOwnerDetail && <Text style={[s.infoLabel, s.infoLabelSpaced]} selectable>{codexLiveOwnerDetail}</Text>}
            </View>
          )}
          {agentType === 'codex_cli' && (
            <View style={s.infoRow} testID="codex-headless-send-mode" accessibilityLabel={`${config.send_execution_label || 'Headless / out-of-process'}. ${config.send_execution_detail || 'A separate interactive Codex TUI may remain idle.'}`}>
              <Text style={s.infoLabel}>Remote sends</Text>
              <Text style={s.infoValue}>{config.send_execution_label || 'Headless / out-of-process'}</Text>
              <Text style={[s.infoLabel, s.infoLabelSpaced]}>{config.send_execution_detail || 'A separate interactive Codex TUI may remain idle.'}</Text>
            </View>
          )}
          {splitObservedConfig && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Observed model</Text>
              <Text style={[s.infoValue, config.observed_model_id === 'unknown' && s.infoDim]}>
                {config.observed_model_id || 'unknown'}
              </Text>
              <Text style={s.infoLabel}>Observed effort</Text>
              <Text style={[s.infoValue, config.observed_effort === 'unknown' && s.infoDim]}>
                {config.observed_effort || 'unknown'}
              </Text>
            </View>
          )}
          {showModel && (
            <SettingRow
              label={splitObservedConfig
                ? `Next send model · ${config.next_send_model_status || 'unset'}`
                : (isVsCodeCodex ? 'Next turn model' : 'Model')}
              options={modelsForAgent()}
              value={valueFor('model', splitObservedConfig ? (config.next_send_model_id || '') : (config.model_id || 'default'))}
              onChange={handleModelChange}
              disabled={isPending('model') || !codexControlsAvailable}
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
              label={splitObservedConfig
                ? `Next send effort · ${config.next_send_effort_status && config.next_send_effort_status !== 'unset' ? config.next_send_effort_status : 'no override selected'}`
                : (isVsCodeCodex ? 'Next turn effort' : 'Effort')}
              options={config.available_efforts}
              value={valueFor('effort', splitObservedConfig ? (config.next_send_effort || '') : (config.effort || 'medium').toLowerCase())}
              onChange={handleEffortChange}
              disabled={isPending('effort') || !codexControlsAvailable}
            />
          )}

          {showPermissionProfile && (
            <SettingRow
              label="Next turn permissions"
              options={config.available_permission_profiles.filter(profile =>
                profile.id !== 'full-access' || caps.codex_bypass_permissions)}
              value={valueFor('permission_profile', config.permission_profile || 'unknown')}
              onChange={applyPermissionProfile}
              disabled={isPending('permission_profile') || !codexControlsAvailable}
            />
          )}

          {bypassConfirmation && (
            <View style={s.bypassConfirmation} accessibilityRole="alert">
              <Text style={s.bypassTitle}>Enable Bypass permissions?</Text>
              <Text style={s.bypassCopy}>
                Full access sets approval policy to Never and sandbox access to danger-full-access for this Codex conversation.
              </Text>
              <View style={s.bypassActions}>
                <TouchableOpacity
                  style={s.cancelButton}
                  onPress={() => setBypassConfirmation(false)}
                  accessibilityRole="button"
                >
                  <Text style={s.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.dangerButton}
                  onPress={() => applyPermissionProfile('full-access', true)}
                  accessibilityRole="button"
                >
                  <Text style={s.dangerButtonText}>Enable Full access</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isVsCodeCodex && config.bypass_permissions_active && (bypassRestoreProfile || config.bypass_restore_profile) && (
            <TouchableOpacity
              style={s.restoreButton}
              onPress={() => applyPermissionProfile(bypassRestoreProfile || config.bypass_restore_profile)}
              disabled={isPending('permission_profile')}
              accessibilityRole="button"
            >
              <Text style={s.restoreButtonText}>Restore previous safe permissions</Text>
            </TouchableOpacity>
          )}

          {isVsCodeCodex && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Approval policy</Text>
              <Text style={s.infoValue}>{config.approval_policy || 'Native custom policy'}</Text>
              <Text style={[s.infoLabel, s.infoLabelSpaced]}>Access / sandbox</Text>
              <Text style={s.infoValue}>{config.permission_mode || 'Native custom access'}</Text>
            </View>
          )}

          {isVsCodeCodex && !codexControlsAvailable && (
            <View style={s.controlStatus}>
              <Text style={s.controlStatusText}>
                {config.controls_unavailable_reason || 'Codex controls are unavailable for this conversation.'}
              </Text>
            </View>
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

          {!!onExport && (
            <View style={s.exportSection}>
              <Text style={s.settingLabel}>Export session</Text>
              <Text style={s.toggleHint}>Share the complete transcript with all structured blocks expanded.</Text>
              <View style={s.exportActions}>
                <TouchableOpacity style={s.exportButton} onPress={() => onExport('markdown')} accessibilityRole="button">
                  <Text style={s.exportButtonText}>Share Markdown</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.exportButton} onPress={() => onExport('json')} accessibilityRole="button">
                  <Text style={s.exportButtonText}>Share JSON</Text>
                </TouchableOpacity>
              </View>
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
    minHeight:         44,
    justifyContent:    'center',
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
  infoLabelSpaced: {
    marginTop: 10,
  },
  infoValue: {
    color:    '#cdd9e5',
    fontSize: 13,
  },
  infoDim: {
    color:   '#666',
  },
  bypassConfirmation: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f0883e',
    borderRadius: 10,
    backgroundColor: 'rgba(240,136,62,0.10)',
  },
  bypassTitle: {
    color: '#f0f6fc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  bypassCopy: {
    color: '#cdd9e5',
    fontSize: 13,
    lineHeight: 19,
  },
  bypassActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  cancelButton: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#484f58',
    borderRadius: 8,
  },
  cancelButtonText: {
    color: '#cdd9e5',
    fontSize: 13,
    fontWeight: '600',
  },
  dangerButton: {
    minHeight: 44,
    flex: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#da3633',
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  restoreButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3fb950',
    borderRadius: 8,
    backgroundColor: 'rgba(63,185,80,0.10)',
  },
  restoreButtonText: {
    color: '#56d364',
    fontSize: 13,
    fontWeight: '700',
  },
  exportSection: {
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#30363d',
  },
  exportActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  exportButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    backgroundColor: '#21262d',
    paddingVertical: 9,
  },
  exportButtonText: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
  },
});
