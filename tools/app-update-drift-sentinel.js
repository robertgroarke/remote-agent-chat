#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  appVersionEventWatchRoots,
  collectAppVersions,
} = require('./app-version-inventory');
const {
  appendLedger,
  discoverValidators,
  publishEntry,
  resolveRelay,
  runValidator,
  VALIDATOR_RUNTIME_BUDGET_MS,
} = require('./nightly-validation-ledger');
const {
  appendDriftTriage,
  detectVersionChanges,
  loadSentinelState,
  saveSentinelState,
  validatorForHarness,
} = require('./app-update-drift');
const { loadProgram } = require('../agent-proxy/harness-revalidation');
const {
  REPAIR_PLAYBOOK,
  beginRevalidation,
  coverageForVersions,
  finalizeRevalidation,
  runCommandValidations,
  runTier2Definition,
  seedProgramState,
} = require('./harness-revalidation-program');

const root = path.resolve(__dirname, '..');
const DEFAULT_STATE = path.join(root, 'data', 'app-update-drift-state.json');
const DEFAULT_LEDGER = path.join(root, 'data', 'app-update-drift-ledger.jsonl');
const DEFAULT_LOCK = path.join(root, 'data', 'app-update-drift-sentinel.lock');
const DEFAULT_BACKLOG = path.join(root, 'HARNESS_MATURITY_PHASE2_BACKLOG.md');
const DEFAULT_UNAVAILABLE_GRACE_MS = 90_000;
const PROTECTED_REVALIDATION_CDP_PORTS = new Set([9223, 9225, 9240]);

function parseArgs(argv) {
  const options = {
    once: false,
    publish: true,
    pollMs: 60_000,
    debounceMs: 2_000,
    unavailableGraceMs: DEFAULT_UNAVAILABLE_GRACE_MS,
    timeoutMs: VALIDATOR_RUNTIME_BUDGET_MS,
    state: DEFAULT_STATE,
    ledger: DEFAULT_LEDGER,
    lock: DEFAULT_LOCK,
    backlog: DEFAULT_BACKLOG,
    versionsJson: null,
    revalidate: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--once') options.once = true;
    else if (arg === '--no-publish') options.publish = false;
    else if (arg === '--poll-ms' && argv[index + 1]) options.pollMs = Math.max(5_000, Number(argv[++index]) || options.pollMs);
    else if (arg === '--debounce-ms' && argv[index + 1]) options.debounceMs = Math.max(100, Number(argv[++index]) || options.debounceMs);
    else if (arg === '--unavailable-grace-ms' && argv[index + 1]) options.unavailableGraceMs = Math.max(1_000, Number(argv[++index]) || options.unavailableGraceMs);
    else if (arg === '--timeout-ms' && argv[index + 1]) options.timeoutMs = Math.min(VALIDATOR_RUNTIME_BUDGET_MS, Math.max(1_000, Number(argv[++index]) || options.timeoutMs));
    else if (arg === '--state' && argv[index + 1]) options.state = path.resolve(argv[++index]);
    else if (arg === '--ledger' && argv[index + 1]) options.ledger = path.resolve(argv[++index]);
    else if (arg === '--lock' && argv[index + 1]) options.lock = path.resolve(argv[++index]);
    else if (arg === '--backlog' && argv[index + 1]) options.backlog = path.resolve(argv[++index]);
    else if (arg === '--versions-json' && argv[index + 1]) options.versionsJson = path.resolve(argv[++index]);
    else if (arg === '--revalidate' && argv[index + 1]) {
      options.revalidate = String(argv[++index]).trim();
      options.once = true;
    }
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stalePid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').split(/\r?\n/, 1)[0], 10);
    let stale = !Number.isInteger(stalePid) || stalePid <= 0;
    if (!stale) {
      try { process.kill(stalePid, 0); } catch (probeError) { stale = probeError.code === 'ESRCH'; }
    }
    if (!stale) throw new Error(`App-update drift sentinel is already running as PID ${stalePid}`);
    fs.unlinkSync(lockPath);
    handle = fs.openSync(lockPath, 'wx');
  }
  fs.writeFileSync(handle, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
  return () => {
    try { fs.closeSync(handle); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  };
}

function collectVersions(options) {
  if (!options.versionsJson) return collectAppVersions();
  return JSON.parse(fs.readFileSync(options.versionsJson, 'utf8'));
}

function stageOwnedCommandRevalidation({
  options,
  priorState,
  programState,
  change,
  context,
  nowMs = Date.now(),
}) {
  const target = context?.target;
  const sessionId = String(target?.session_id || '').trim();
  const cdpPort = Number(target?.cdp_port);
  if (!target || target.disposable !== true || !sessionId) return null;
  if (!Number.isInteger(cdpPort) || cdpPort <= 0 || cdpPort > 65535) return null;
  if (PROTECTED_REVALIDATION_CDP_PORTS.has(cdpPort)) {
    throw new Error(`Refusing owned command revalidation on protected CDP port ${cdpPort}`);
  }
  const record = programState?.harnesses?.[change.harness];
  if (!record || record.status !== 'pending') {
    throw new Error(`Cannot stage owned command revalidation outside pending ${change.harness}`);
  }
  const command = String(context.command || '').trim();
  if (!command || context.tier1Status !== 'pass') {
    throw new Error('Owned command revalidation requires a passing command-scoped tier 1');
  }
  const installedVersion = String(context.installedVersion || '');
  if (!installedVersion || installedVersion !== String(change.app_version)) {
    throw new Error('Owned command revalidation version does not match the pending app version');
  }
  const expiresAt = new Date(
    nowMs + Math.min(11 * 60_000, Math.max(60_000, Number(context.timeoutMs) + 30_000)),
  ).toISOString();
  const scope = {
    command,
    installed_version: installedVersion,
    tier1_status: 'pass',
    disposable: true,
    session_id: sessionId,
    cdp_port: cdpPort,
    staged_at: new Date(nowMs).toISOString(),
    expires_at: expiresAt,
  };
  record.command_revalidation_targets = {
    ...(record.command_revalidation_targets || {}),
    [command]: scope,
  };
  const savePending = () => saveSentinelState(options.state, {
    ...priorState,
    versions: { ...(priorState.versions || {}), [change.harness]: change.app_version },
    observed_at: new Date().toISOString(),
    revalidation_program: programState,
  });
  savePending();

  return () => {
    const targets = record.command_revalidation_targets || {};
    delete targets[command];
    if (Object.keys(targets).length === 0) delete record.command_revalidation_targets;
    else record.command_revalidation_targets = targets;
    savePending();
  };
}

function revalidationPreviousVersion(options, priorState, harness, appVersion) {
  if (fs.existsSync(options.ledger)) {
    const ledgerEntries = fs.readFileSync(options.ledger, 'utf8').trim().split(/\r?\n/).reverse();
    for (const line of ledgerEntries) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.harness === harness
          && String(entry?.app_version) === appVersion
          && entry?.previous_app_version != null
          && String(entry.previous_app_version) !== appVersion) {
          return String(entry.previous_app_version);
        }
      } catch {}
    }
  }
  const priorChange = [...(priorState.last_changes || [])].reverse()
    .find(change => change?.harness === harness
      && change?.previous_app_version != null
      && String(change.previous_app_version) !== appVersion);
  return String(priorChange?.previous_app_version
    || priorState.versions?.[harness]
    || appVersion);
}

function missingValidatorEntry(change, runId) {
  return {
    schema_version: 1,
    kind: 'app_update_validation',
    run_id: runId,
    harness: change.harness,
    status: 'fail',
    previous_app_version: change.previous_version,
    app_version: change.app_version,
    validator: 'unavailable',
    read_only: true,
    runtime_budget_ms: 0,
    budget_exhausted: false,
    duration_ms: 0,
    exit_code: null,
    completed_at: new Date().toISOString(),
    detail: `No validate-all entry point exists for ${change.harness}.`,
  };
}

function coverageFailureEntry(change, runId, coverageRow) {
  const fixtureDiff = (coverageRow?.issues || ['revalidation program coverage missing']).join('; ');
  return {
    schema_version: 1,
    kind: 'app_update_validation',
    run_id: runId,
    harness: change.harness,
    status: 'fail',
    previous_app_version: change.previous_version,
    app_version: change.app_version,
    validator: 'harness-revalidation-program:coverage',
    read_only: true,
    runtime_budget_ms: 0,
    budget_exhausted: false,
    duration_ms: 0,
    exit_code: null,
    completed_at: new Date().toISOString(),
    failure_stage: 'fixture_coverage',
    fixture_diff: fixtureDiff,
    detail: fixtureDiff,
  };
}

function settleUnavailableChanges(changes, priorState, graceMs, nowMs = Date.now()) {
  const ready = [];
  const deferred = [];
  const pendingUnavailable = {};
  const previousPending = priorState?.pending_unavailable || {};
  for (const change of changes) {
    if (change.app_version !== 'unavailable' || change.previous_version === 'unavailable') {
      ready.push(change);
      continue;
    }
    const existing = previousPending[change.harness];
    const existingMatches = existing
      && String(existing.previous_version) === change.previous_version
      && Number.isFinite(Date.parse(existing.first_seen_at));
    const firstSeenAt = existingMatches
      ? existing.first_seen_at
      : new Date(nowMs).toISOString();
    const ageMs = Math.max(0, nowMs - Date.parse(firstSeenAt));
    const pending = {
      previous_version: change.previous_version,
      candidate_version: change.app_version,
      first_seen_at: firstSeenAt,
      last_seen_at: new Date(nowMs).toISOString(),
      observations: existingMatches ? Number(existing.observations || 0) + 1 : 1,
      grace_ms: graceMs,
    };
    if (ageMs < graceMs) {
      pendingUnavailable[change.harness] = pending;
      deferred.push({ ...change, ...pending, age_ms: ageMs });
    } else {
      ready.push(change);
    }
  }
  return { changes: ready, deferred, pendingUnavailable };
}

async function scanForUpdates(options, dependencies = {}) {
  const collect = dependencies.collectVersions || (() => collectVersions(options));
  const validators = dependencies.validators || discoverValidators();
  const executeValidator = dependencies.runValidator || runValidator;
  const appendLedgerEntry = dependencies.appendLedger || appendLedger;
  const publishValidation = dependencies.publishEntry || publishEntry;
  const appendTriage = dependencies.appendDriftTriage || appendDriftTriage;
  const currentVersions = collect();
  const program = dependencies.program || loadProgram();
  const coverage = coverageForVersions(currentVersions, program);
  const priorState = loadSentinelState(options.state);
  const hadProgramState = Boolean(priorState?.revalidation_program?.harnesses);
  if (!priorState && !options.revalidate) {
    const revalidationProgram = seedProgramState(null, currentVersions, program,
      dependencies.now ? dependencies.now() : Date.now());
    saveSentinelState(options.state, {
      versions: currentVersions,
      observed_at: new Date().toISOString(),
      last_changes: [],
      revalidation_program: revalidationProgram,
    });
    return { baseline: true, changes: [], failures: 0, coverage };
  }
  if (!priorState) throw new Error('Targeted revalidation requires an existing sentinel state');
  let changes = detectVersionChanges(priorState.versions, currentVersions);
  let deferred = [];
  let pendingUnavailable = {};
  if (options.revalidate) {
    if (!Object.prototype.hasOwnProperty.call(currentVersions, options.revalidate)) {
      throw new Error(`Unknown revalidation harness: ${options.revalidate}`);
    }
    const appVersion = String(currentVersions[options.revalidate]);
    changes = [{
      harness: options.revalidate,
      previous_version: revalidationPreviousVersion(
        options, priorState, options.revalidate, appVersion),
      app_version: appVersion,
      revalidation: true,
    }];
  } else {
    const settled = settleUnavailableChanges(
      changes,
      priorState,
      options.unavailableGraceMs || DEFAULT_UNAVAILABLE_GRACE_MS,
      dependencies.now ? dependencies.now() : Date.now(),
    );
    changes = settled.changes;
    deferred = settled.deferred;
    pendingUnavailable = settled.pendingUnavailable;
  }
  const relay = options.publish ? (dependencies.relay || resolveRelay(options)) : null;
  const programState = seedProgramState(
    priorState,
    currentVersions,
    program,
    dependencies.now ? dependencies.now() : Date.now(),
  );
  const entries = [];
  const publicationFailures = new Set();
  let failures = 0;
  for (const change of changes) {
    const runId = `app-update-${change.harness}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const validator = validatorForHarness(validators, change.harness);
    const definition = program.harnesses[change.harness];
    const coverageRow = coverage.matrix.find(row => row.harness === change.harness);
    beginRevalidation(programState, change, coverageRow,
      dependencies.now ? dependencies.now() : Date.now());
    // Persist pending before any validator runs. A proxy process observing this
    // file immediately fail-closes writes for the changed harness.
    saveSentinelState(options.state, {
      ...priorState,
      versions: { ...(priorState.versions || {}), [change.harness]: change.app_version },
      observed_at: new Date().toISOString(),
      revalidation_program: programState,
    });
    let result;
    if (!definition || !coverageRow || coverageRow.issues.length > 0) {
      result = coverageFailureEntry(change, runId, coverageRow);
    } else if (!validator) {
      result = missingValidatorEntry(change, runId);
      result.failure_stage = 'tier-1';
    } else {
      result = executeValidator(validator, change.app_version, options.timeoutMs, runId);
      result.failure_stage = result.status === 'pass' ? null : 'tier-1';
      if (result.status === 'pass') {
        const tier2 = dependencies.runTier2
          ? dependencies.runTier2(change.harness, definition, change)
          : runTier2Definition(change.harness, definition, { timeoutMs: options.timeoutMs });
        result.tier2_status = tier2.status;
        result.tier2_duration_ms = tier2.duration_ms;
        result.tier2_detail = tier2.detail;
        if (tier2.status !== 'pass') {
          result.status = 'fail';
          result.exit_code = tier2.exit_code ?? result.exit_code;
          result.failure_stage = 'tier-2';
          result.detail = `Tier-1 passed; tier-2 ${tier2.status}: ${tier2.detail}`;
        }
      }
    }
    const commandStates = definition && coverageRow?.issues?.length === 0
      ? (dependencies.runCommandValidations
          ? dependencies.runCommandValidations(change.harness, definition, change.app_version, change)
          : runCommandValidations(change.harness, definition, change.app_version, {
              timeoutMs: options.timeoutMs,
              beforeTier2: context => stageOwnedCommandRevalidation({
                options,
                priorState,
                programState,
                change,
                context,
                nowMs: dependencies.now ? dependencies.now() : Date.now(),
              }),
            }))
      : {};
    const entry = {
      ...result,
      command_states: commandStates,
      kind: 'app_update_validation',
      previous_app_version: change.previous_version,
      change_detected_at: new Date().toISOString(),
      revalidation: change.revalidation === true,
      repair_playbook: REPAIR_PLAYBOOK,
    };
    entry.tier1_status = entry.failure_stage === 'fixture_coverage' ? 'not_run'
      : entry.failure_stage === 'tier-1' ? 'failed'
        : 'pass';
    if (!entry.tier2_status) entry.tier2_status = 'not_run';
    if (entry.tier2_status === 'gated') entry.tier2_status = 'unavailable';
    if (entry.status === 'pass' && entry.tier2_status === 'pass') {
      entry.validation_transition = `validated ${change.harness} ${change.previous_version} -> ${change.app_version}`;
      entry.detail = `${entry.validation_transition}. ${entry.detail || ''}`.trim();
    }
    finalizeRevalidation(
      programState,
      change,
      entry,
      definition,
      dependencies.now ? dependencies.now() : Date.now(),
    );
    entry.program_health = JSON.parse(JSON.stringify({
      ...programState,
      coverage_matrix: coverage.matrix,
    }));
    saveSentinelState(options.state, {
      ...priorState,
      versions: { ...(priorState.versions || {}), [change.harness]: change.app_version },
      observed_at: new Date().toISOString(),
      revalidation_program: programState,
      last_changes: entries.concat(entry).map(item => ({
        harness: item.harness,
        previous_app_version: item.previous_app_version,
        app_version: item.app_version,
        status: item.status,
        failure_stage: item.failure_stage || null,
        completed_at: item.completed_at,
        revalidation: item.revalidation === true,
      })),
    });
    if (options.publish) {
      try {
        await publishValidation(relay, entry);
      } catch (error) {
        entry.publication_error = String(error?.message || error).slice(0, 1000);
        publicationFailures.add(change.harness);
        failures += 1;
      }
    }
    appendLedgerEntry(options.ledger, entry);
    if (entry.status !== 'pass') {
      failures += 1;
      appendTriage(options.backlog, entry, path.relative(root, options.ledger));
    }
    entries.push(entry);
  }
  saveSentinelState(options.state, {
    versions: Object.fromEntries(Object.entries(currentVersions).map(([harness, version]) => (
      publicationFailures.has(harness) || pendingUnavailable[harness]
        ? [harness, priorState.versions[harness]]
        : [harness, version]
    ))),
    observed_at: new Date().toISOString(),
    pending_unavailable: pendingUnavailable,
    last_changes: entries.map(entry => ({
      harness: entry.harness,
      previous_app_version: entry.previous_app_version,
      app_version: entry.app_version,
      status: entry.status,
      completed_at: entry.completed_at,
      revalidation: entry.revalidation === true,
    })),
    revalidation_program: programState,
  });
  if (options.publish && !hadProgramState && changes.length === 0) {
    const completedAt = new Date().toISOString();
    const summary = {
      schema_version: 1,
      kind: 'harness_revalidation_program',
      run_id: `revalidation-program-${completedAt.replace(/[:.]/g, '-')}`,
      harness: 'revalidation-program',
      status: coverage.ok ? 'pass' : 'fail',
      app_version: `program-v${program.schema_version}`,
      validator: 'tools/app-update-drift-sentinel.js:program-coverage',
      read_only: true,
      duration_ms: 0,
      exit_code: coverage.ok ? 0 : 1,
      completed_at: completedAt,
      detail: coverage.ok
        ? `coverage matrix ${coverage.matrix.length}/${coverage.matrix.length}; nightly tier-1 and staggered weekly tier-2 scheduled`
        : coverage.matrix.flatMap(row => row.issues.map(issue => `${row.harness}: ${issue}`)).join('; '),
      program_health: JSON.parse(JSON.stringify({
        ...programState,
        coverage_matrix: coverage.matrix,
      })),
    };
    try {
      await publishValidation(relay, summary);
    } catch (error) {
      failures += 1;
      summary.publication_error = String(error?.message || error).slice(0, 1000);
    }
    appendLedgerEntry(options.ledger, summary);
  }
  return { baseline: false, changes: entries, deferred, failures, coverage };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const releaseLock = acquireLock(options.lock);
  let scanning = false;
  let rescanRequested = false;
  let debounceTimer = null;
  const watchers = [];

  const scan = async () => {
    if (scanning) {
      rescanRequested = true;
      return null;
    }
    scanning = true;
    try {
      const result = await scanForUpdates(options);
      for (const entry of result.changes) {
        console.log(`${entry.status.toUpperCase()} ${entry.harness} ${entry.previous_app_version} -> ${entry.app_version} ${entry.duration_ms}ms`);
      }
      for (const entry of result.deferred || []) {
        console.log(`DEFERRED ${entry.harness} ${entry.previous_version} -> unavailable ${entry.age_ms}/${entry.grace_ms}ms`);
      }
      return result;
    } finally {
      scanning = false;
      if (rescanRequested) {
        rescanRequested = false;
        setImmediate(() => scan().catch(error => console.error(error.stack || error.message)));
      }
    }
  };

  try {
    const initial = await scan();
    if (options.once) {
      process.exitCode = initial?.failures ? 1 : 0;
      return;
    }
    const requestScan = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => scan().catch(error => console.error(error.stack || error.message)), options.debounceMs);
    };
    for (const watchRoot of appVersionEventWatchRoots()) {
      try {
        watchers.push(fs.watch(watchRoot, { recursive: false }, requestScan));
      } catch (error) {
        console.warn(`Unable to watch ${watchRoot}: ${error.message}`);
      }
    }
    const pollTimer = setInterval(requestScan, options.pollMs);
    console.log(`App-update drift sentinel watching ${watchers.length} roots; fallback poll ${options.pollMs} ms.`);
    const shutdown = () => {
      clearInterval(pollTimer);
      clearTimeout(debounceTimer);
      watchers.forEach(watcher => watcher.close());
      releaseLock();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await new Promise(() => {});
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  acquireLock,
  DEFAULT_UNAVAILABLE_GRACE_MS,
  main,
  missingValidatorEntry,
  coverageFailureEntry,
  parseArgs,
  revalidationPreviousVersion,
  scanForUpdates,
  stageOwnedCommandRevalidation,
  settleUnavailableChanges,
};
