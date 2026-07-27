'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROGRAM_PATH = path.join(ROOT, 'config', 'harness-revalidation-program.json');
const DEFAULT_STATE_PATH = path.resolve(
  process.env.RAC_APP_UPDATE_DRIFT_STATE_PATH
    || path.join(ROOT, 'data', 'app-update-drift-state.json'),
);

const AGENT_TYPE_TO_HARNESS = Object.freeze({
  'antigravity-v2': 'antigravity-v2',
  claude: 'claude',
  'claude-desktop': 'claude',
  claude_cli: 'claude-cli',
  codex: 'codex',
  codex_cli: 'codex-cli',
  'codex-desktop': 'codex-desktop',
  continue: 'continue',
  continue_yolo: 'continue',
  cursor: 'cursor',
  cursor_cli: 'cursor-cli',
  gemini: 'gemini',
  roo_code: 'roo_code',
  cline: 'cline',
});

const WRITE_CAPABILITY_KEYS = Object.freeze([
  'send', 'send_message', 'message_send',
  'interrupt', 'goal_pause_resume', 'set_model', 'set_mode', 'permission_mode_change',
  'auto_approve_permissions_toggle', 'permission_dialogs', 'question_prompts',
  'set_codex_config', 'codex_model_change', 'codex_effort_change', 'codex_access_change',
  'codex_speed_change', 'codex_permission_profile_change', 'codex_bypass_permissions',
  'set_effort', 'new_thread', 'switch_thread', 'switch_workspace', 'native_window',
  'switch_chat', 'new_chat', 'terminal_input', 'send_attachment', 'switch_branch',
  'create_branch', 'open_panel',
]);

const WRITE_COMMAND_ALIASES = Object.freeze({
  send: 'send_message',
  message_send: 'send_message',
});

const WRITE_COMMANDS = new Set([
  'send_message', 'send', 'message_send', 'steer', 'discard_queued', 'edit_queued',
  'agent_interrupt', 'agent_goal_control', 'permission_response', 'question_response',
  'error_prompt_action', 'agent_set_model', 'agent_set_effort', 'agent_set_mode',
  'agent_set_permission_mode', 'agent_set_auto_approve_permissions', 'set_codex_config', 'new_thread',
  'switch_thread', 'switch_workspace', 'open_native_window', 'open_panel', 'switch_chat',
  'new_chat', 'terminal_input', 'file_change_response', 'send_attachment',
  'switch_branch', 'create_branch', 'automation_view_action', 'launch_session', 'close_session',
]);

let cachedState = null;
let cachedStatePath = null;
let cachedStateMtime = -1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadProgram(programPath = DEFAULT_PROGRAM_PATH) {
  const program = readJson(programPath);
  if (program?.schema_version !== 1 || !program.harnesses || typeof program.harnesses !== 'object') {
    throw new Error(`Invalid harness revalidation program: ${programPath}`);
  }
  return program;
}

function loadState(statePath = DEFAULT_STATE_PATH) {
  try {
    const mtime = fs.statSync(statePath).mtimeMs;
    if (cachedState && cachedStatePath === statePath && cachedStateMtime === mtime) return cachedState;
    const state = readJson(statePath);
    cachedState = state && typeof state === 'object' ? state : null;
    cachedStatePath = statePath;
    cachedStateMtime = mtime;
    return cachedState;
  } catch {
    return null;
  }
}

function harnessForAgentType(agentType) {
  return AGENT_TYPE_TO_HARNESS[String(agentType || '')] || null;
}

function coverageMatrix(program, versions = {}, root = ROOT) {
  return Object.entries(program.harnesses).sort(([left], [right]) => left.localeCompare(right))
    .map(([harness, definition]) => {
      const fixturePath = definition.fixture ? path.resolve(root, definition.fixture) : null;
      let fixture = null;
      let fixtureError = null;
      if (fixturePath) {
        try { fixture = readJson(fixturePath); } catch (error) { fixtureError = error.message; }
      }
      const installedVersion = Object.prototype.hasOwnProperty.call(versions, harness)
        ? String(versions[harness])
        : null;
      const fixtureCovered = Boolean(definition.fixture_gate || (
        fixture
        && fixture.harness === harness
        && (!installedVersion || installedVersion === 'unavailable' || String(fixture.installed_version) === installedVersion)
      ));
      const tier1Covered = Boolean(definition.tier1_gate || (
        Array.isArray(definition.tier1) && definition.tier1.length >= 2
        && (definition.tier1[0] !== 'node' || fs.existsSync(path.resolve(root, definition.tier1[1])))
      ));
      const tier2Covered = Boolean(
        definition.tier2?.mode === 'gated' && definition.tier2.reason
        || definition.tier2?.mode === 'owned_disposable'
          && Array.isArray(definition.tier2.command) && definition.tier2.command.length >= 2
          && (definition.tier2.command[0] !== 'node' || fs.existsSync(path.resolve(root, definition.tier2.command[1])))
      );
      const capabilityGatingCovered = definition.capability_gate === true;
      const issues = [];
      if (!fixtureCovered) {
        issues.push(fixtureError
          ? `fixture unreadable: ${fixtureError}`
          : `fixture version mismatch: expected ${installedVersion || 'declared fixture'}, found ${fixture?.installed_version || 'missing'}`);
      }
      if (!tier1Covered) issues.push('tier-1 validator or explicit gate missing');
      if (!tier2Covered) issues.push('tier-2 definition or explicit gate missing');
      if (!capabilityGatingCovered) issues.push('capability fail-close policy missing');
      return {
        harness,
        installed_version: installedVersion,
        fixture: fixtureCovered ? (definition.fixture || `GATED: ${definition.fixture_gate}`) : null,
        tier1: tier1Covered ? (definition.tier1 || `GATED: ${definition.tier1_gate}`) : null,
        tier2: tier2Covered ? definition.tier2 : null,
        capability_gating: capabilityGatingCovered,
        issues,
      };
    });
}

function programCoverage(program, versions = {}, root = ROOT) {
  const matrix = coverageMatrix(program, versions, root);
  return { ok: matrix.every(row => row.issues.length === 0), matrix };
}

function exactFixtureWriteContract(harness, installedVersion, command, options = {}) {
  const canonicalCommand = WRITE_COMMAND_ALIASES[String(command || '')] || String(command || '');
  if (!harness || !installedVersion || !canonicalCommand) return null;
  try {
    const program = options.program || loadProgram(options.programPath || DEFAULT_PROGRAM_PATH);
    const definition = program?.harnesses?.[harness];
    if (!definition?.fixture) return null;
    const fixtureRoot = options.root || ROOT;
    const fixture = readJson(path.resolve(fixtureRoot, definition.fixture));
    if (fixture?.harness !== harness || String(fixture?.installed_version || '') !== String(installedVersion)) {
      return null;
    }
    const contract = fixture?.write_contracts?.[canonicalCommand];
    const commands = Array.isArray(contract?.commands) ? contract.commands.map(String) : [canonicalCommand];
    if (contract?.status !== 'read_only_compatible'
        || contract?.does_not_claim_live_delivery !== true
        || (!commands.includes(canonicalCommand) && !commands.includes(String(command)))) {
      return null;
    }
    return { ...contract, command: canonicalCommand };
  } catch {
    return null;
  }
}

function normalizedTierStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'gated') return 'unavailable';
  if (['pass', 'failed', 'fail', 'not_run', 'unavailable', 'stale', 'pending'].includes(status)) {
    return status === 'fail' ? 'failed' : status;
  }
  return null;
}

const OWNED_REVALIDATION_PROTECTED_CDP_PORTS = new Set([9223, 9225, 9240]);

function ownedCommandRevalidationState(
  record,
  effectiveVersion,
  canonicalCommand,
  options = {},
) {
  const target = record?.command_revalidation_targets?.[canonicalCommand];
  if (record?.status !== 'pending' || !target || target.disposable !== true) return null;
  const targetVersion = target.installed_version != null
    ? String(target.installed_version)
    : null;
  if (!effectiveVersion || targetVersion !== String(effectiveVersion)) return null;
  if (String(target.command || '') !== canonicalCommand) return null;
  if (normalizedTierStatus(target.tier1_status) !== 'pass') return null;

  const expiresAtMs = Date.parse(String(target.expires_at || ''));
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;

  const requestedSessionId = String(options.sessionId || '').trim();
  const targetSessionId = String(target.session_id || '').trim();
  const requestedPort = Number(options.cdpPort);
  const targetPort = Number(target.cdp_port);
  if (!requestedSessionId || requestedSessionId !== targetSessionId) return null;
  if (!Number.isInteger(requestedPort) || requestedPort !== targetPort) return null;
  if (OWNED_REVALIDATION_PROTECTED_CDP_PORTS.has(requestedPort)) return null;

  return {
    command: canonicalCommand,
    status: 'pending',
    executable: true,
    live_verified: false,
    basis: 'owned_disposable_tier2_revalidation',
    installed_version: String(effectiveVersion),
    tier1_status: 'pass',
    tier2_status: 'pending',
    revalidation_owned_target: true,
    revalidation_expires_at: target.expires_at,
    reason: 'Owned disposable tier-2 revalidation is in progress',
  };
}

function commandValidationForHarness(harness, state = loadState(), command = null, options = {}) {
  const canonicalCommand = WRITE_COMMAND_ALIASES[String(command || '')] || String(command || '');
  const installedVersion = state?.versions?.[harness] != null ? String(state.versions[harness]) : null;
  const record = state?.revalidation_program?.harnesses?.[harness] || null;
  if (!harness || !canonicalCommand) {
    return {
      command: canonicalCommand || null,
      status: 'not_run',
      executable: false,
      live_verified: false,
      reason: 'command validation requires a harness and command',
    };
  }
  if (!record) {
    return {
      command: canonicalCommand,
      status: 'pass',
      executable: true,
      live_verified: true,
      basis: 'trusted_baseline_without_drift_record',
      installed_version: installedVersion,
      reason: null,
    };
  }
  const recordVersion = record.installed_version != null ? String(record.installed_version) : null;
  const effectiveVersion = recordVersion || installedVersion;
  if (installedVersion && recordVersion && installedVersion !== recordVersion) {
    return {
      command: canonicalCommand,
      status: 'stale',
      executable: false,
      live_verified: false,
      basis: 'version_mismatch',
      installed_version: installedVersion,
      validated_version: recordVersion,
      reason: `command contract is stale: installed ${installedVersion}, validated ${recordVersion}`,
    };
  }
  const fullPass = record.status === 'pass'
    && recordVersion
    && (!installedVersion || recordVersion === installedVersion);
  if (fullPass) {
    return {
      command: canonicalCommand,
      status: 'pass',
      executable: true,
      live_verified: true,
      basis: 'full_revalidation_pass',
      installed_version: effectiveVersion,
      reason: null,
    };
  }
  const contract = exactFixtureWriteContract(
    harness,
    effectiveVersion,
    canonicalCommand,
    options,
  );
  if (!contract) {
    const status = record.failure_stage === 'fixture_coverage' ? 'stale' : 'not_run';
    return {
      command: canonicalCommand,
      status,
      executable: false,
      live_verified: false,
      basis: 'exact_version_command_contract_missing',
      installed_version: effectiveVersion,
      reason: record.reason || `no current ${canonicalCommand} contract for ${effectiveVersion || 'installed version'}`,
    };
  }

  const ownedRevalidation = ownedCommandRevalidationState(
    record,
    effectiveVersion,
    canonicalCommand,
    options,
  );
  if (ownedRevalidation) {
    return {
      ...ownedRevalidation,
      write_contract: contract,
    };
  }
  if (record?.status === 'pending'
    && record?.command_revalidation_targets?.[canonicalCommand]) {
    return {
      command: canonicalCommand,
      status: 'pending',
      executable: false,
      live_verified: false,
      basis: 'owned_disposable_tier2_scope_mismatch',
      installed_version: effectiveVersion,
      tier1_status: 'pass',
      tier2_status: 'pending',
      write_contract: contract,
      reason: 'Owned disposable tier-2 revalidation is scoped to a different or expired target',
    };
  }

  const recordedCommandState = record?.command_states?.[canonicalCommand];
  if (recordedCommandState && typeof recordedCommandState === 'object') {
    const commandVersion = recordedCommandState.installed_version != null
      ? String(recordedCommandState.installed_version)
      : effectiveVersion;
    if (effectiveVersion && commandVersion && commandVersion !== effectiveVersion) {
      return {
        command: canonicalCommand,
        status: 'stale',
        executable: false,
        live_verified: false,
        basis: 'recorded_command_state_version_mismatch',
        installed_version: effectiveVersion,
        validated_version: commandVersion,
        write_contract: contract,
        reason: `recorded ${canonicalCommand} state is for ${commandVersion}, installed ${effectiveVersion}`,
      };
    }
    const recordedStatus = normalizedTierStatus(recordedCommandState.status) || 'not_run';
    const executable = recordedStatus === 'pass' || recordedStatus === 'unavailable';
    const tier1Status = normalizedTierStatus(recordedCommandState.tier1_status);
    const tier2Status = normalizedTierStatus(recordedCommandState.tier2_status);
    return {
      command: canonicalCommand,
      status: recordedStatus,
      executable,
      live_verified: executable
        && recordedCommandState.live_verified === true
        && tier2Status === 'pass',
      basis: 'recorded_command_state',
      installed_version: effectiveVersion,
      tier1_status: tier1Status,
      tier2_status: tier2Status,
      checked_at: recordedCommandState.checked_at || record.updated_at || null,
      write_contract: contract,
      reason: recordedCommandState.reason
        || recordedCommandState.tier2_detail
        || recordedCommandState.tier1_detail
        || null,
    };
  }

  // New records publish tier states directly. The legacy inference is narrowly
  // bounded to records produced by the pre-command-state sentinel: the record
  // must say tier 1 passed, must have failed only at tier 2, and must identify
  // tier-2 availability rather than a mutating validation failure.
  const explicitTier1 = normalizedTierStatus(record.command_tier1_status);
  const legacyTier1Pass = record.failure_stage === 'tier-2'
    && /^Tier-1 passed;/i.test(String(record.reason || ''));
  const tier1Status = explicitTier1 || (
    record.failure_stage === 'fixture_coverage' ? 'pass'
      : legacyTier1Pass ? 'pass'
        : record.failure_stage === 'tier-1' ? 'failed'
          : 'not_run'
  );
  if (tier1Status !== 'pass') {
    return {
      command: canonicalCommand,
      status: tier1Status,
      executable: false,
      live_verified: false,
      basis: 'send_specific_tier1_not_green',
      installed_version: effectiveVersion,
      write_contract: contract,
      reason: record.reason || `${canonicalCommand} tier-1 state is ${tier1Status}`,
    };
  }

  const explicitTier2 = normalizedTierStatus(
    record.command_tier2_status || record.last_tier2_status,
  );
  const legacyUnavailable = legacyTier1Pass
    && /tier-2 (?:gated|unavailable):/i.test(String(record.reason || ''));
  const tier2Status = explicitTier2 || (
    record.failure_stage === 'fixture_coverage' ? 'not_run'
      : legacyUnavailable ? 'unavailable'
        : record.failure_stage === 'tier-2' ? 'failed'
          : 'not_run'
  );
  if (tier2Status === 'failed' || tier2Status === 'stale') {
    return {
      command: canonicalCommand,
      status: tier2Status,
      executable: false,
      live_verified: false,
      basis: 'send_specific_tier2_failed',
      installed_version: effectiveVersion,
      tier1_status: tier1Status,
      tier2_status: tier2Status,
      write_contract: contract,
      reason: record.reason || `${canonicalCommand} tier-2 state is ${tier2Status}`,
    };
  }
  return {
    command: canonicalCommand,
    status: tier2Status === 'unavailable' ? 'unavailable' : 'pass',
    executable: true,
    live_verified: tier2Status === 'pass',
    basis: tier2Status === 'unavailable'
      ? 'current_send_contract_live_target_unavailable'
      : 'current_exact_version_send_contract',
    installed_version: effectiveVersion,
    tier1_status: tier1Status,
    tier2_status: tier2Status,
    write_contract: contract,
    reason: tier2Status === 'unavailable'
      ? (record.last_tier2_detail || record.tier2_detail || record.reason || 'owned disposable tier-2 target unavailable')
      : null,
  };
}

function validationGateForHarness(harness, state = loadState(), command = null, options = {}) {
  if (!harness) return { gated: false, reason: null, harness: null };
  const installedVersion = state?.versions?.[harness] != null ? String(state.versions[harness]) : null;
  const record = state?.revalidation_program?.harnesses?.[harness] || null;
  // Existing trusted baselines remain usable until the sentinel observes a new
  // version. Once a record exists, only a pass for that exact version restores writes.
  if (!record) return { gated: false, reason: null, harness, installed_version: installedVersion };
  const recordVersion = record.installed_version != null ? String(record.installed_version) : null;
  const passed = record.status === 'pass'
    && recordVersion
    && (!installedVersion || recordVersion === installedVersion);
  if (passed) return { gated: false, reason: null, harness, installed_version: recordVersion, ...record };
  // Command truth is independent from whole-harness test availability. A
  // current exact-version command contract may remain executable while its
  // owned live target is unavailable, but an actual command-contract failure
  // remains fail-closed.
  const commandState = command
    ? commandValidationForHarness(harness, state, command, options)
    : null;
  if (commandState?.executable) {
    return {
      gated: false,
      partial: true,
      reason: commandState.reason,
      harness,
      installed_version: recordVersion || installedVersion,
      status: record.status || 'fail',
      validated_command: commandState.command,
      command_state: commandState,
      write_contract: commandState.write_contract,
    };
  }
  return {
    gated: true,
    harness,
    installed_version: recordVersion || installedVersion,
    status: record.status || 'pending',
    reason: record.reason || `pending revalidation for ${recordVersion || installedVersion || 'installed version'}`,
    ...record,
  };
}

function validationGateForAgentType(agentType, state = loadState(), command = null, options = {}) {
  return validationGateForHarness(harnessForAgentType(agentType), state, command, options);
}

function applyWriteCapabilityGate(capabilities, agentType, state = loadState(), options = {}) {
  const gate = validationGateForAgentType(agentType, state);
  if (!gate.gated) return capabilities;
  const sendGate = validationGateForAgentType(agentType, state, 'send_message', options);
  const result = { ...capabilities };
  for (const key of WRITE_CAPABILITY_KEYS) {
    if (result[key] === true) result[key] = false;
  }
  if (sendGate.gated) {
    result.send = false;
    result.send_message = false;
    result.message_send = false;
    result.read_only_due_to_revalidation = true;
    result.write_capability_gate = gate.reason;
  } else {
    result.send = true;
    result.send_message = true;
    result.message_send = true;
    result.write_restricted_due_to_revalidation = true;
    result.revalidation_validated_commands = ['send', 'send_message', 'message_send'];
    result.revalidation_command_states = {
      send_message: sendGate.command_state,
    };
  }
  result.revalidation_harness = gate.harness;
  result.revalidation_version = gate.installed_version;
  result.revalidation_status = gate.status;
  return result;
}

function isWriteCommand(command) {
  return WRITE_COMMANDS.has(String(command || ''));
}

module.exports = {
  AGENT_TYPE_TO_HARNESS,
  DEFAULT_PROGRAM_PATH,
  DEFAULT_STATE_PATH,
  WRITE_CAPABILITY_KEYS,
  WRITE_COMMANDS,
  applyWriteCapabilityGate,
  commandValidationForHarness,
  coverageMatrix,
  exactFixtureWriteContract,
  harnessForAgentType,
  isWriteCommand,
  loadProgram,
  loadState,
  ownedCommandRevalidationState,
  programCoverage,
  validationGateForAgentType,
  validationGateForHarness,
};
