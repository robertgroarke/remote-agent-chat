'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROGRAM_PATH = path.join(ROOT, 'config', 'harness-revalidation-program.json');
const DEFAULT_STATE_PATH = path.join(ROOT, 'data', 'app-update-drift-state.json');

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
  // A newly installed app is initially failed at fixture coverage before any
  // native action is attempted. Once a current-version fixture has been
  // captured, permit only the explicitly scoped, read-only-compatible command
  // contract while the broader revalidation remains red. This prevents an
  // unrelated transcript/fidelity gate from disabling a separately grounded
  // current-thread send path, without enabling any other write capability.
  const partialContract = record.failure_stage === 'fixture_coverage'
    ? exactFixtureWriteContract(harness, recordVersion || installedVersion, command, options)
    : null;
  if (partialContract) {
    return {
      gated: false,
      partial: true,
      reason: null,
      harness,
      installed_version: recordVersion || installedVersion,
      status: record.status || 'fail',
      validated_command: partialContract.command,
      write_contract: partialContract,
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
  coverageMatrix,
  exactFixtureWriteContract,
  harnessForAgentType,
  isWriteCommand,
  loadProgram,
  loadState,
  programCoverage,
  validationGateForAgentType,
  validationGateForHarness,
};
