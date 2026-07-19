#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  codexPackageVersion,
  extensionVersion,
  packageVersion,
  resolvedInstallVersion,
} = require('./app-version-inventory');
const {
  TRIAGE_HEADING,
  appendDriftTriage,
  detectVersionChanges,
  loadSentinelState,
  saveSentinelState,
} = require('./app-update-drift');
const {
  missingValidatorEntry,
  parseArgs,
  scanForUpdates,
  settleUnavailableChanges,
} = require('./app-update-drift-sentinel');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-app-update-drift-smoke-'));
const statePath = path.join(tempRoot, 'state.json');
const ledgerPath = path.join(tempRoot, 'ledger.jsonl');
const backlogPath = path.join(tempRoot, 'backlog.md');
const extensionRoot = path.join(tempRoot, 'extensions');
const testProgram = {
  schema_version: 1,
  harnesses: {
    cursor: {
      fixture_gate: 'fixture smoke supplies synthetic versions',
      tier1: ['node', 'tools/cursor-validate-all.js', '--read-only'],
      tier2: { mode: 'owned_disposable', command: ['node', 'tools/cursor-validate-all.js', '--send-live'], weekday: 1 },
      capability_gate: true,
    },
    'codex-cli': {
      fixture_gate: 'fixture smoke supplies synthetic versions',
      tier1: ['node', 'tools/codex-cli-validate-all.js', '--read-only'],
      tier2: { mode: 'owned_disposable', command: ['node', 'tools/codex-cli-validate-all.js', '--read-only'], weekday: 2 },
      capability_gate: true,
    },
  },
};
const passTier2 = () => ({ status: 'pass', duration_ms: 1, detail: 'fixture tier-2 pass' });

async function main() {
  fs.writeFileSync(backlogPath, '# Fixture backlog\n', 'utf8');
  fs.mkdirSync(path.join(extensionRoot, 'anthropic.claude-code-2.1.100'), { recursive: true });
  fs.mkdirSync(path.join(extensionRoot, 'anthropic.claude-code-2.1.207'), { recursive: true });
  fs.writeFileSync(path.join(extensionRoot, 'anthropic.claude-code-2.1.100', 'package.json'), '{"version":"2.1.100"}\n');
  fs.writeFileSync(path.join(extensionRoot, 'anthropic.claude-code-2.1.207', 'package.json'), '{"version":"2.1.207"}\n');
  assert.equal(extensionVersion(['anthropic.claude-code-'], [extensionRoot]), '2.1.207');
  assert.equal(extensionVersion(['not.installed-'], [extensionRoot]), null);
  assert.equal(packageVersion(path.join(extensionRoot, 'anthropic.claude-code-2.1.207', 'package.json')), '2.1.207');
  assert.equal(resolvedInstallVersion({
    command: path.join(tempRoot, 'cursor-agent', 'versions', '2026.07.09-a3815c0', 'node.exe'),
    argsPrefix: [path.join(tempRoot, 'cursor-agent', 'versions', '2026.07.09-a3815c0', 'index.js')],
  }), '2026.07.09-a3815c0');
  const codexRoot = path.join(tempRoot, 'codex');
  const codexPlatformRoot = path.join(codexRoot, 'node_modules', '@openai', 'codex-win32-x64');
  const codexExecutable = path.join(codexPlatformRoot, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  fs.mkdirSync(path.dirname(codexExecutable), { recursive: true });
  fs.writeFileSync(path.join(codexRoot, 'package.json'), '{"version":"0.144.4"}\n');
  fs.writeFileSync(path.join(codexPlatformRoot, 'package.json'), '{"version":"0.144.4-win32-x64"}\n');
  assert.equal(codexPackageVersion(codexRoot, 'win32', 'x64'), null,
    'Codex package metadata must not become authoritative before its native executable exists');
  fs.writeFileSync(codexExecutable, 'fixture');
  assert.equal(codexPackageVersion(codexRoot, 'win32', 'x64'), 'codex-cli 0.144.4');

  const firstUnavailable = settleUnavailableChanges(
    [{ harness: 'codex-cli', previous_version: 'codex-cli 0.144.1', app_version: 'unavailable' }],
    { versions: { 'codex-cli': 'codex-cli 0.144.1' }, pending_unavailable: {} },
    90_000,
    Date.parse('2026-07-15T09:14:00.000Z'),
  );
  assert.equal(firstUnavailable.changes.length, 0);
  assert.equal(firstUnavailable.deferred.length, 1);
  const persistentUnavailable = settleUnavailableChanges(
    [{ harness: 'codex-cli', previous_version: 'codex-cli 0.144.1', app_version: 'unavailable' }],
    { versions: { 'codex-cli': 'codex-cli 0.144.1' }, pending_unavailable: firstUnavailable.pendingUnavailable },
    90_000,
    Date.parse('2026-07-15T09:15:31.000Z'),
  );
  assert.equal(persistentUnavailable.changes.length, 1,
    'A persistently unavailable install must still fail closed after the settle window');

  assert.deepStrictEqual(detectVersionChanges({}, { cursor: '2.0.0' }), [], 'first inventory must establish a baseline');
  assert.deepStrictEqual(detectVersionChanges({ cursor: '1.0.0' }, { cursor: '2.0.0' }), [{
    harness: 'cursor', previous_version: '1.0.0', app_version: '2.0.0',
  }]);
  assert.equal(missingValidatorEntry({ harness: 'roo_code', previous_version: '3.53.0', app_version: '3.54.0' }, 'fixture').status, 'fail');
  assert.deepStrictEqual(parseArgs(['--revalidate', 'codex']).revalidate, 'codex');
  assert.equal(parseArgs(['--revalidate', 'codex']).once, true,
    'targeted update recovery must be a one-shot scan');

  saveSentinelState(statePath, { versions: { cursor: '1.0.0' }, observed_at: new Date().toISOString(), last_changes: [] });
  const published = [];
  const options = {
    state: statePath,
    ledger: ledgerPath,
    backlog: backlogPath,
    timeoutMs: 60_000,
    publish: true,
  };
  const pass = await scanForUpdates(options, {
    program: testProgram,
    runTier2: passTier2,
    collectVersions: () => ({ cursor: '2.0.0' }),
    validators: [{ harness: 'cursor', script: 'cursor-validate-all.js' }],
    relay: { origin: 'fixture', token: 'fixture' },
    runValidator: (validator, appVersion, timeoutMs, runId) => ({
      schema_version: 1, kind: 'nightly_validation', run_id: runId,
      harness: validator.harness, status: 'pass', app_version: appVersion,
      validator: `tools/${validator.script}`, read_only: true, runtime_budget_ms: timeoutMs,
      budget_exhausted: false, duration_ms: 12, exit_code: 0,
      completed_at: new Date().toISOString(), detail: 'fixture pass',
    }),
    publishEntry: async (_relay, entry) => published.push(entry),
  });
  assert.equal(pass.failures, 0);
  assert.equal(pass.changes.length, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].kind, 'app_update_validation');
  assert.equal(loadSentinelState(statePath).versions.cursor, '2.0.0');
  assert(!fs.readFileSync(backlogPath, 'utf8').includes(TRIAGE_HEADING), 'passing update must not append triage');

  saveSentinelState(statePath, {
    versions: { 'codex-cli': 'codex-cli 0.144.1' },
    observed_at: new Date().toISOString(),
    last_changes: [],
    revalidation_program: loadSentinelState(statePath).revalidation_program,
  });
  const deferredUnavailable = await scanForUpdates({ ...options, unavailableGraceMs: 90_000 }, {
    program: testProgram,
    runTier2: passTier2,
    collectVersions: () => ({ 'codex-cli': 'unavailable' }),
    validators: [{ harness: 'codex-cli', script: 'codex-cli-validate-all.js' }],
    relay: { origin: 'fixture', token: 'fixture' },
    now: () => Date.parse('2026-07-15T09:14:00.000Z'),
    runValidator: () => { throw new Error('deferred unavailable transition must not run a validator'); },
    publishEntry: async () => { throw new Error('deferred unavailable transition must not publish'); },
  });
  assert.equal(deferredUnavailable.changes.length, 0);
  assert.equal(deferredUnavailable.deferred.length, 1);
  assert.equal(loadSentinelState(statePath).versions['codex-cli'], 'codex-cli 0.144.1');
  assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).length, 1,
    'deferred availability gaps must not append a validation row');

  const recoveredInstall = await scanForUpdates({ ...options, unavailableGraceMs: 90_000 }, {
    program: testProgram,
    runTier2: passTier2,
    collectVersions: () => ({ 'codex-cli': 'codex-cli 0.144.4' }),
    validators: [{ harness: 'codex-cli', script: 'codex-cli-validate-all.js' }],
    relay: { origin: 'fixture', token: 'fixture' },
    now: () => Date.parse('2026-07-15T09:14:30.000Z'),
    runValidator: (validator, appVersion, timeoutMs, runId) => ({
      schema_version: 1, kind: 'nightly_validation', run_id: runId,
      harness: validator.harness, status: 'pass', app_version: appVersion,
      validator: `tools/${validator.script}`, read_only: true, runtime_budget_ms: timeoutMs,
      budget_exhausted: false, duration_ms: 18, exit_code: 0,
      completed_at: new Date().toISOString(), detail: 'settled Codex update pass',
    }),
    publishEntry: async (_relay, entry) => published.push(entry),
  });
  assert.equal(recoveredInstall.failures, 0);
  assert.equal(recoveredInstall.changes[0].previous_app_version, 'codex-cli 0.144.1');
  assert.equal(recoveredInstall.changes[0].app_version, 'codex-cli 0.144.4');
  assert.deepEqual(loadSentinelState(statePath).pending_unavailable, {});

  saveSentinelState(statePath, {
    versions: { cursor: '2.0.0' },
    observed_at: new Date().toISOString(),
    last_changes: [],
    revalidation_program: loadSentinelState(statePath).revalidation_program,
  });
  const fail = await scanForUpdates(options, {
    program: testProgram,
    runTier2: passTier2,
    collectVersions: () => ({ cursor: '3.0.0' }),
    validators: [{ harness: 'cursor', script: 'cursor-validate-all.js' }],
    relay: { origin: 'fixture', token: 'fixture' },
    runValidator: (validator, appVersion, timeoutMs, runId) => ({
      schema_version: 1, kind: 'nightly_validation', run_id: runId,
      harness: validator.harness, status: 'fail', app_version: appVersion,
      validator: `tools/${validator.script}`, read_only: true, runtime_budget_ms: timeoutMs,
      budget_exhausted: false, duration_ms: 19, exit_code: 1,
      completed_at: new Date().toISOString(), detail: 'fixture validator failed',
    }),
    publishEntry: async () => ({ ok: true }),
  });
  assert.equal(fail.failures, 1);
  const backlog = fs.readFileSync(backlogPath, 'utf8');
  assert(backlog.includes(TRIAGE_HEADING) && backlog.includes('1.0.0') === false);
  assert(backlog.includes('2.0.0 -> 3.0.0') && backlog.includes('fixture validator failed'));
  assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).length, 3);

  saveSentinelState(statePath, {
    versions: { cursor: '3.0.0' },
    observed_at: new Date().toISOString(),
    last_changes: [],
    revalidation_program: loadSentinelState(statePath).revalidation_program,
  });
  options.revalidate = 'cursor';
  const recovery = await scanForUpdates(options, {
    program: testProgram,
    runTier2: passTier2,
    collectVersions: () => ({ cursor: '3.0.0' }),
    validators: [{ harness: 'cursor', script: 'cursor-validate-all.js' }],
    relay: { origin: 'fixture', token: 'fixture' },
    runValidator: (validator, appVersion, timeoutMs, runId) => ({
      schema_version: 1, kind: 'nightly_validation', run_id: runId,
      harness: validator.harness, status: 'pass', app_version: appVersion,
      validator: `tools/${validator.script}`, read_only: true, runtime_budget_ms: timeoutMs,
      budget_exhausted: false, duration_ms: 14, exit_code: 0,
      completed_at: new Date().toISOString(), detail: 'fixture recovery pass',
    }),
    publishEntry: async (_relay, entry) => published.push(entry),
  });
  assert.equal(recovery.failures, 0);
  assert.equal(recovery.changes[0].revalidation, true);
  assert.equal(recovery.changes[0].previous_app_version, '2.0.0',
    'revalidation must preserve the durable ledger transition after an idle scan clears last_changes');
  assert.equal(loadSentinelState(statePath).versions.cursor, '3.0.0');
  assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).length, 4);
  options.revalidate = null;

  const sentinelSource = fs.readFileSync(path.join(root, 'tools', 'app-update-drift-sentinel.js'), 'utf8');
  assert(sentinelSource.includes('fs.watch(watchRoot') && sentinelSource.includes('setInterval(requestScan, options.pollMs)'),
    'sentinel must combine event-driven file watches with a bounded fallback poll');
  assert(sentinelSource.includes('appVersionEventWatchRoots()')
    && sentinelSource.includes('{ recursive: false }'),
  'sentinel event watches must stay non-recursive on stable parent directories');

  console.log(JSON.stringify({
    ok: true,
    baseline_without_false_positive: true,
    codex_static_version_requires_native_binary: true,
    transient_unavailable_deferred: true,
    settled_codex_update_validated: true,
    persistent_unavailable_fails_closed: true,
    version_change_detected: true,
    targeted_validator: 'cursor-validate-all.js',
    pass_published: true,
    failure_triage_appended: true,
    persistent_state: true,
    event_watch_plus_poll: true,
    external_scheduler_compatible: true,
    fail_closed_without_validator: true,
    targeted_revalidation: true,
  }, null, 2));
}

main().finally(() => {
  const resolved = path.resolve(tempRoot);
  const expectedPrefix = path.resolve(os.tmpdir(), 'rac-app-update-drift-smoke-');
  assert(resolved.startsWith(expectedPrefix), `refusing to remove unexpected fixture path ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
