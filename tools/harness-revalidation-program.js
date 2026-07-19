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
    fixture_diff: passed ? null : (entry.fixture_diff || previous.fixture_diff || null),
    repair_playbook: REPAIR_PLAYBOOK,
    last_validated_version: passed ? String(change.app_version) : (previous.last_validated_version || null),
    last_tier2_pass: passed ? entry.completed_at : (previous.last_tier2_pass || null),
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
  const targets = options.ownedTargets || ownedTargetsFromEnv(options.env);
  const target = targets[harness];
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
  ownedTargetsFromEnv,
  runTier2Definition,
  seedProgramState,
};
