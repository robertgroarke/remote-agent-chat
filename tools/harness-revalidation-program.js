'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_PROGRAM_PATH,
  loadProgram,
  programCoverage,
} = require('../agent-proxy/harness-revalidation');

const ROOT = path.resolve(__dirname, '..');
const REPAIR_PLAYBOOK = Object.freeze([
  'probe an owned disposable surface without focusing a protected session',
  'record the expected versus observed selector, store, or event contract',
  'repair the adapter and refresh the installed-version fixture',
  'rerun tier-1 and the guarded tier-2 definition',
  'restore write capabilities only after both required tiers pass',
  'record the version transition and receipt in the validation ledger',
]);

function isoAt(ms) {
  return new Date(ms).toISOString();
}

function nextDailyAt(nowMs = Date.now()) {
  return isoAt(nowMs + 24 * 60 * 60 * 1000);
}

function nextWeeklyAt(weekday, nowMs = Date.now()) {
  const date = new Date(nowMs);
  const requested = Number.isInteger(weekday) ? weekday : 0;
  let days = (requested - date.getUTCDay() + 7) % 7;
  if (days === 0) days = 7;
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(10, 30, 0, 0);
  return date.toISOString();
}

function seedProgramState(priorState, versions, program, nowMs = Date.now()) {
  const previous = priorState?.revalidation_program?.harnesses || {};
  const harnesses = {};
  for (const [harness, definition] of Object.entries(program.harnesses)) {
    const installedVersion = versions[harness] != null ? String(versions[harness]) : null;
    const current = previous[harness];
    harnesses[harness] = current || {
      status: 'pass',
      basis: 'pre_program_trusted_baseline',
      installed_version: installedVersion,
      last_validated_version: installedVersion,
      last_tier2_pass: null,
      next_tier1_at: nextDailyAt(nowMs),
      next_tier2_at: nextWeeklyAt(definition.tier2?.weekday, nowMs),
      updated_at: isoAt(nowMs),
    };
  }
  return {
    schema_version: 1,
    program_path: path.relative(ROOT, DEFAULT_PROGRAM_PATH).replace(/\\/g, '/'),
    harnesses,
    updated_at: isoAt(nowMs),
  };
}

function beginRevalidation(programState, change, coverageRow, nowMs = Date.now()) {
  const previous = programState.harnesses[change.harness] || {};
  programState.harnesses[change.harness] = {
    ...previous,
    status: 'pending',
    reason: `pending revalidation for ${change.app_version}`,
    installed_version: String(change.app_version),
    previous_version: String(change.previous_version),
    failure_stage: null,
    fixture_diff: coverageRow?.issues?.join('; ') || null,
    command_states: {},
    repair_playbook: REPAIR_PLAYBOOK,
    next_tier1_at: nextDailyAt(nowMs),
    updated_at: isoAt(nowMs),
  };
  programState.updated_at = isoAt(nowMs);
}

function finalizeRevalidation(programState, change, entry, definition, nowMs = Date.now()) {
  const previous = programState.harnesses[change.harness] || {};
  const passed = entry.status === 'pass' && entry.tier2_status === 'pass';
  programState.harnesses[change.harness] = {
    ...previous,
    status: passed ? 'pass' : 'fail',
    reason: passed ? null : (entry.detail || `pending revalidation for ${change.app_version}`),
    installed_version: String(change.app_version),
    previous_version: String(change.previous_version),
    failure_stage: passed ? null : (entry.failure_stage || 'tier-1'),
    tier1_status: entry.tier1_status || (entry.failure_stage === 'tier-1' ? 'failed' : 'pass'),
    tier1_detail: entry.failure_stage === 'tier-1' ? (entry.detail || null) : null,
    tier2_status: entry.tier2_status || 'not_run',
    tier2_detail: entry.tier2_detail || null,
    command_states: entry.command_states && typeof entry.command_states === 'object'
      ? entry.command_states
      : {},
    fixture_diff: passed ? null : (entry.fixture_diff || previous.fixture_diff || null),
    repair_playbook: REPAIR_PLAYBOOK,
    last_validated_version: passed ? String(change.app_version) : (previous.last_validated_version || null),
    last_tier2_pass: passed ? entry.completed_at : (previous.last_tier2_pass || null),
    last_tier2_status: entry.tier2_status || 'not_run',
    last_tier2_detail: entry.tier2_detail || null,
    next_tier1_at: nextDailyAt(nowMs),
    next_tier2_at: nextWeeklyAt(definition?.tier2?.weekday, nowMs),
    updated_at: isoAt(nowMs),
  };
  programState.updated_at = isoAt(nowMs);
}

function ownedTargetsFromEnv(env = process.env) {
  try {
    const parsed = JSON.parse(env.RAC_TIER2_OWNED_TARGETS_JSON || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function ownedTargetForHarness(harness, options = {}) {
  const targets = options.ownedTargets || ownedTargetsFromEnv(options.env);
  return targets[harness] || null;
}

function runTier2Definition(harness, definition, options = {}) {
  const started = Date.now();
  const tier2 = definition?.tier2 || {};
  if (tier2.mode === 'gated') {
    return {
      status: 'gated',
      duration_ms: Date.now() - started,
      detail: tier2.reason || 'tier-2 explicitly gated',
    };
  }
  const target = ownedTargetForHarness(harness, options);
  if (!target) {
    return {
      status: 'gated',
      duration_ms: Date.now() - started,
      detail: `no owned disposable tier-2 target configured for ${harness}`,
    };
  }
  const command = tier2.command;
  if (!Array.isArray(command) || command.length < 2) {
    return { status: 'fail', duration_ms: Date.now() - started, detail: 'tier-2 command missing' };
  }
  const executable = command[0] === 'node' ? process.execPath : command[0];
  const args = command.slice(1);
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: Math.min(10 * 60 * 1000, Math.max(10_000, Number(options.timeoutMs) || 60_000)),
    env: {
      ...process.env,
      ...(options.env || {}),
      RAC_TIER2_OWNED_SESSION: typeof target === 'string' ? target : JSON.stringify(target),
      RAC_TIER2_REVALIDATION: '1',
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    status: !result.error && result.status === 0 ? 'pass' : 'fail',
    duration_ms: Date.now() - started,
    exit_code: Number.isInteger(result.status) ? result.status : null,
    detail: result.error?.message || output.slice(-4000) || 'tier-2 produced no output',
  };
}

function runCommandValidations(harness, definition, installedVersion, options = {}) {
  const definitions = definition?.command_validations;
  if (!definitions || typeof definitions !== 'object') return {};
  const timeoutMs = Math.min(
    10 * 60 * 1000,
    Math.max(10_000, Number(options.timeoutMs) || 60_000),
  );
  const results = {};
  for (const [commandName, commandDefinition] of Object.entries(definitions)) {
    const started = Date.now();
    const tier1Commands = Array.isArray(commandDefinition?.tier1)
      ? commandDefinition.tier1
      : [];
    const tier1Receipts = [];
    let tier1Status = tier1Commands.length ? 'pass' : 'not_run';
    for (const command of tier1Commands) {
      if (!Array.isArray(command) || command.length < 2) {
        tier1Status = 'failed';
        tier1Receipts.push({ status: 'failed', detail: 'command-scoped tier-1 command missing' });
        break;
      }
      const executable = command[0] === 'node' ? process.execPath : command[0];
      const execution = spawnSync(executable, command.slice(1), {
        cwd: ROOT,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        env: {
          ...process.env,
          ...(options.env || {}),
          RAC_REVALIDATION_HARNESS: harness,
          RAC_REVALIDATION_COMMAND: commandName,
          RAC_REVALIDATION_VERSION: String(installedVersion || ''),
        },
        maxBuffer: 16 * 1024 * 1024,
      });
      const output = `${execution.stdout || ''}${execution.stderr || ''}`.trim();
      const passed = !execution.error && execution.status === 0;
      tier1Receipts.push({
        status: passed ? 'pass' : 'failed',
        exit_code: Number.isInteger(execution.status) ? execution.status : null,
        duration_ms: Date.now() - started,
        detail: execution.error?.message || output.slice(-2000) || 'command produced no output',
      });
      if (!passed) {
        tier1Status = 'failed';
        break;
      }
    }
    let tier2 = {
      status: 'not_run',
      duration_ms: 0,
      detail: 'command-scoped tier 1 did not pass',
    };
    if (tier1Status === 'pass') {
      const tier2Started = Date.now();
      const target = ownedTargetForHarness(harness, options);
      let releaseTier2Scope = null;
      try {
        if (typeof options.beforeTier2 === 'function') {
          releaseTier2Scope = options.beforeTier2({
            harness,
            command: commandName,
            installedVersion: String(installedVersion || ''),
            target,
            tier1Status,
            tier1Receipts,
            timeoutMs,
          }) || null;
        }
        tier2 = runTier2Definition(harness, {
          tier2: commandDefinition.tier2 || definition.tier2,
        }, options);
      } catch (error) {
        tier2 = {
          status: 'fail',
          duration_ms: Date.now() - tier2Started,
          detail: `command-scoped tier-2 setup failed: ${error.message}`,
        };
      } finally {
        try {
          if (typeof releaseTier2Scope === 'function') releaseTier2Scope();
        } catch (error) {
          tier2 = {
            status: 'fail',
            duration_ms: Date.now() - tier2Started,
            detail: `command-scoped tier-2 cleanup failed: ${error.message}`,
          };
        }
      }
    }
    const tier2Status = tier2.status === 'gated' ? 'unavailable'
      : tier2.status === 'fail' ? 'failed'
        : tier2.status;
    const status = tier1Status !== 'pass' ? tier1Status
      : tier2Status === 'pass' ? 'pass'
        : tier2Status === 'unavailable' ? 'unavailable'
          : 'failed';
    results[commandName] = {
      status,
      installed_version: String(installedVersion || ''),
      tier1_status: tier1Status,
      tier1_receipts: tier1Receipts,
      tier2_status: tier2Status,
      tier2_detail: tier2.detail,
      tier2_duration_ms: tier2.duration_ms,
      live_verified: status === 'pass' && tier2Status === 'pass',
      executable: status === 'pass' || status === 'unavailable',
      reason: status === 'pass'
        ? null
        : tier1Status !== 'pass'
          ? (tier1Receipts.find(receipt => receipt.status !== 'pass')?.detail || `tier 1 ${tier1Status}`)
          : tier2.detail,
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    };
  }
  return results;
}

function coverageForVersions(versions, program = loadProgram(), root = ROOT) {
  return programCoverage(program, versions, root);
}

module.exports = {
  REPAIR_PLAYBOOK,
  beginRevalidation,
  coverageForVersions,
  finalizeRevalidation,
  nextDailyAt,
  nextWeeklyAt,
  ownedTargetForHarness,
  ownedTargetsFromEnv,
  runCommandValidations,
  runTier2Definition,
  seedProgramState,
};
