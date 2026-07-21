#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync, execFileSync } = require('child_process');
const { makeContactSheet } = require('./operator-dogfood-contact-sheet');
const { publishEntry, resolveRelay } = require('./nightly-validation-ledger');
const { acquirePidLock } = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const MODES = new Set(['source', 'canary', 'post-deploy', 'full', 'weekly']);
const OPERATION_LOCK_PATH = path.resolve(process.env.RAC_OPERATION_LOCK_FILE
  || path.join(os.tmpdir(), 'remote-agent-chat-operation.lock'));
const DOGFOOD_LOCK_PATH = path.join(ROOT, 'data', 'operator-dogfood.lock');
const DEFAULT_STATE_PATH = path.join(ROOT, 'data', 'operator-dogfood-state.json');
const DEFAULT_LEDGER_PATH = path.join(ROOT, 'data', 'operator-dogfood-ledger.jsonl');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const startedAt = new Date();
  const options = {
    mode: 'source',
    readOnly: false,
    list: false,
    maxMinutes: 0,
    runId: `operator-dogfood-${startedAt.toISOString().replace(/[:.]/g, '-')}`,
    outputDir: '',
    sourceRoot: ROOT,
    envRoot: ROOT,
    triggerSource: 'interactive',
    publish: true,
    stateFile: DEFAULT_STATE_PATH,
    ledger: DEFAULT_LEDGER_PATH,
    temporalDurationMs: 0,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--mode' && argv[index + 1]) options.mode = argv[++index];
    else if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--max-minutes' && argv[index + 1]) options.maxMinutes = Number(argv[++index]);
    else if (arg === '--run-id' && argv[index + 1]) options.runId = argv[++index];
    else if (arg === '--output-dir' && argv[index + 1]) options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--source-root' && argv[index + 1]) options.sourceRoot = path.resolve(argv[++index]);
    else if (arg === '--env-root' && argv[index + 1]) options.envRoot = path.resolve(argv[++index]);
    else if (arg === '--trigger-source' && argv[index + 1]) options.triggerSource = String(argv[++index]);
    else if (arg === '--no-publish') options.publish = false;
    else if (arg === '--state-file' && argv[index + 1]) options.stateFile = path.resolve(argv[++index]);
    else if (arg === '--ledger' && argv[index + 1]) options.ledger = path.resolve(argv[++index]);
    else if (arg === '--temporal-duration-ms' && argv[index + 1]) options.temporalDurationMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!MODES.has(options.mode)) throw new Error(`--mode must be one of ${[...MODES].join(', ')}`);
  if (!/^[a-zA-Z0-9._-]+$/.test(options.runId)) throw new Error('--run-id must be filesystem safe');
  if (options.mode !== 'source' && !options.readOnly) {
    throw new Error(`${options.mode} mode requires --read-only; production navigation is inspect-only`);
  }
  if (!options.maxMinutes) {
    options.maxMinutes = options.mode === 'source' ? 10
      : options.mode === 'canary' ? 5
        : options.mode === 'post-deploy' ? 25 : 150;
  }
  if (!(options.maxMinutes > 0 && options.maxMinutes <= 240)) throw new Error('--max-minutes must be between 1 and 240');
  const defaultTemporal = options.mode === 'source' ? 5_000
    : options.mode === 'weekly' ? 2 * 60 * 60 * 1000 : 120_000;
  if (!options.temporalDurationMs) options.temporalDurationMs = defaultTemporal;
  if (!Number.isInteger(options.temporalDurationMs) || options.temporalDurationMs < 5_000) {
    throw new Error('--temporal-duration-ms must be an integer >=5000');
  }
  if (options.mode === 'weekly' && options.temporalDurationMs < 2 * 60 * 60 * 1000
    && process.env.RAC_OPERATOR_DOGFOOD_ALLOW_SHORT !== '1') {
    throw new Error('weekly temporal duration must be >=2 hours');
  }
  if (options.mode === 'source') options.publish = false;
  if (!options.outputDir) {
    options.outputDir = path.join(
      ROOT, 'evidence', 'harness-maturity', startedAt.toISOString().slice(0, 10),
      'operator-dogfood', 'runs', options.runId,
    );
  }
  options.startedAt = startedAt;
  return options;
}

function step(id, script, args, output, modes, timeoutMinutes) {
  return { id, script, args, output, modes, timeoutMinutes };
}

function buildPlan(options) {
  const out = options.outputDir;
  const steps = [
    step('manifest_guard', 'tools/operator-dogfood-manifest-guard.js', [], null,
      ['source', 'canary', 'post-deploy', 'full', 'weekly'], 1),
    step('manifest_guard_adversarial', 'tools/operator-dogfood-manifest-guard-smoke.js',
      ['--output', path.join(out, 'screen-state-manifest-guard.json')], 'screen-state-manifest-guard.json',
      ['source', 'canary', 'post-deploy', 'full', 'weekly'], 1),
    step('manifest_snapshot', 'tools/operator-dogfood-manifest-snapshot.js',
      ['--output', path.join(out, 'screen-state-manifest.json')], 'screen-state-manifest.json',
      ['source', 'canary', 'post-deploy', 'full', 'weekly'], 1),
    step('seeded_discovery', 'tools/operator-dogfood-seed-pack.js',
      ['--output-dir', path.join(out, 'seeded-discovery')], 'seeded-discovery/seeded-defect-pack.json',
      ['source', 'post-deploy', 'full'], 2),
    step('android_parity', 'tools/android-parity-audit.js',
      ['--output', path.join(out, 'android-parity.json')], 'android-parity.json',
      ['source', 'post-deploy', 'full'], 2),
    step('chat_stability_seed_contract', 'tools/chat-stability-sentinel-smoke.js', [], null,
      ['source', 'canary', 'post-deploy', 'full', 'weekly'], 1),
    step('chat_stability_prompt_lifecycle', 'tools/escape-interrupt-browser-e2e.js', [
      '--headless-isolated', '--output', path.join(out, 'chat-stability-prompt-lifecycle.json'),
    ], 'chat-stability-prompt-lifecycle.json', ['source', 'canary', 'post-deploy', 'full', 'weekly'], 2),
    step('chat_stability_health_projection', 'tools/operator-dogfood-relay-e2e.js', [], null,
      ['source', 'canary', 'post-deploy', 'full', 'weekly'], 1),
    step('chat_stability_temporal', 'tools/chat-stability-temporal-canary.js', [
      '--duration-ms', String(options.temporalDurationMs),
      '--output', path.join(out, 'chat-stability-temporal.json'),
    ], 'chat-stability-temporal.json', ['source', 'canary', 'post-deploy', 'full', 'weekly'],
    Math.ceil(options.temporalDurationMs / 60_000) + 2),
    step('production_asset_identity', 'tools/production-asset-smoke.js',
      ['--source-root', options.sourceRoot, '--env-root', options.envRoot,
        '--output', path.join(out, 'production-asset.json')], 'production-asset.json',
      ['canary', 'post-deploy', 'full', 'weekly'], 3),
    step('production_passive_surface', 'tools/operator-dogfood-production-passive-e2e.js',
      ['--read-only-production', '--env-root', options.envRoot, '--source-root', options.sourceRoot,
        '--output', path.join(out, 'production-passive-surface.json')], 'production-passive-surface.json',
      ['post-deploy', 'full'], 3),
    step('route_render_desktop', 'tools/p0-route-render-e2e.js', [
      '--phase', 'operator-dogfood', '--public-root', path.join(ROOT, 'relay-server', 'public'),
      '--width', '1440', '--height', '900', '--output', path.join(out, 'route-render-desktop.json'),
    ], 'route-render-desktop.json', ['full'], 10),
    step('route_render_mobile', 'tools/p0-route-render-e2e.js', [
      '--phase', 'operator-dogfood', '--public-root', path.join(ROOT, 'relay-server', 'public'),
      '--width', '390', '--height', '844', '--output', path.join(out, 'route-render-mobile.json'),
    ], 'route-render-mobile.json', ['full'], 10),
    step('visual_regression', 'tools/visual-regression.js', [
      '--output-dir', path.join(out, 'visual-regression'),
      '--result-file', path.join(out, 'visual-regression', 'visual-regression-result.json'),
    ], 'visual-regression/visual-regression-result.json', ['full'], 90),
  ];
  return steps.filter(candidate => candidate.modes.includes(options.mode));
}

function runStep(spec, options, deadlineMs) {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw new Error(`runner budget exhausted before ${spec.id}`);
  const stepTimeoutMs = Math.min(remainingMs, spec.timeoutMinutes * 60 * 1000);
  const startedAt = new Date();
  const result = spawnSync(process.execPath, [path.join(ROOT, spec.script), ...spec.args], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: stepTimeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const completedAt = new Date();
  const row = {
    id: spec.id,
    script: spec.script,
    args: spec.args.map(value => path.isAbsolute(value) ? path.relative(ROOT, value).replace(/\\/g, '/') : value),
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    elapsed_ms: completedAt - startedAt,
    timeout_ms: stepTimeoutMs,
    exit_code: result.status,
    signal: result.signal || null,
    error: result.error?.message || null,
    stdout_tail: String(result.stdout || '').slice(-4000),
    stderr_tail: String(result.stderr || '').slice(-4000),
    evidence: spec.output,
  };
  if (result.status !== 0 || result.error) {
    const error = new Error(`${spec.id} failed: ${row.error || row.stderr_tail || `exit ${result.status}`}`);
    error.stepResult = row;
    throw error;
  }
  return row;
}

function readJson(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
}

function findPngs(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...findPngs(absolute));
    else if (entry.name.toLowerCase().endsWith('.png') && entry.name !== 'contact-sheet.png') output.push(absolute);
  }
  return output.sort();
}

function representativeImages(images, maximum = 48) {
  if (images.length <= maximum) return images;
  const selected = [];
  for (let index = 0; index < maximum; index++) {
    selected.push(images[Math.floor(index * (images.length - 1) / (maximum - 1))]);
  }
  return [...new Set(selected)];
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function loadState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function temporalFindings(temporal) {
  const contracts = Object.values(temporal?.temporal_contract?.depths || {});
  return contracts.flatMap(contract => Array.isArray(contract?.findings) ? contract.findings : []);
}

function nextDue(mode, completedAt) {
  const milliseconds = mode === 'canary' ? 30 * 60 * 1000
    : mode === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(completedAt.getTime() + milliseconds).toISOString();
}

function updateMachineState(options, result, temporal, productionAsset) {
  const previous = loadState(options.stateFile);
  const findings = { ...(previous.findings || {}) };
  for (const finding of temporalFindings(temporal)) {
    const old = findings[finding.fingerprint] || {};
    findings[finding.fingerprint] = {
      fingerprint: finding.fingerprint,
      detection_class: finding.detection_class,
      severity: finding.severity || 'P0',
      first_seen_at: old.first_seen_at || result.completed_at,
      last_seen_at: result.completed_at,
      count: Number(old.count || 0) + 1,
      open: true,
      evidence_file: path.relative(ROOT, path.join(options.outputDir, 'chat-stability-temporal.json')).replace(/\\/g, '/'),
    };
  }
  const run = {
    run_id: result.run_id,
    mode: result.mode,
    status: result.result,
    started_at: result.started_at,
    completed_at: result.completed_at,
    trigger_source: options.triggerSource,
    source_commit: result.source_commit,
    source_bundle_sha256: temporal?.bundle_sha256 || null,
    served_asset_identity: productionAsset?.cache_key || null,
    duration_ms: result.elapsed_ms,
    scenario_count: temporal ? 1 : 0,
    refresh_count: temporal?.storm?.total_refresh_frames ?? null,
    dropped_samples: temporal
      ? Object.values(temporal.depths || {}).reduce((total, depth) => total + Number(depth.dropped_samples || 0), 0)
      : null,
    next_due_at: nextDue(result.mode, new Date(result.completed_at)),
    scheduler_last_result: options.triggerSource === 'scheduled_task' ? result.result : 'NOT_SCHEDULED_TRIGGER',
    evidence_file: path.relative(ROOT, path.join(options.outputDir, 'operator-dogfood-result.json')).replace(/\\/g, '/'),
  };
  const state = {
    schema_version: 1,
    updated_at: result.completed_at,
    status: result.result,
    latest: run,
    modes: { ...(previous.modes || {}), [result.mode]: run },
    findings,
    open_fingerprints: Object.values(findings).filter(item => item.open).map(item => item.fingerprint).sort(),
    safety: result.safety,
  };
  atomicWriteJson(options.stateFile, state);
  appendJsonLine(options.ledger, run);
  return state;
}

function persistFailureTrace(options, temporal, state) {
  if (!temporal || temporal.ok) return null;
  const compressedPath = path.join(options.outputDir, 'chat-stability-failure-trace.json.gz');
  fs.writeFileSync(compressedPath, zlib.gzipSync(Buffer.from(JSON.stringify(temporal))));
  const failureFrames = [];
  for (const [depth, result] of Object.entries(temporal.depths || {})) {
    if (!Array.isArray(result.events) || result.events.length === 0) continue;
    failureFrames.push({ depth, first: result.events[0], last: result.events.at(-1) });
  }
  const framePath = path.join(options.outputDir, 'chat-stability-failure-frames.json');
  atomicWriteJson(framePath, {
    schema_version: 1,
    run_id: state.latest.run_id,
    open_fingerprints: state.open_fingerprints,
    frames: failureFrames,
  });
  return {
    compressed_trace: path.relative(ROOT, compressedPath).replace(/\\/g, '/'),
    first_last_frames: path.relative(ROOT, framePath).replace(/\\/g, '/'),
  };
}

function acquireDogfoodLocks(mode) {
  const operationPayload = `${JSON.stringify({
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    agent: `operator-dogfood-${mode}`,
    kind: mode === 'weekly' ? 'production-soak' : 'chat-stability-sentinel',
  })}\n`;
  const releaseOperation = acquirePidLock(
    OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    operationPayload,
  );
  try {
    const releaseDogfood = acquirePidLock(
      DOGFOOD_LOCK_PATH,
      'Remote Agent Chat operator dogfood lock',
      `${process.pid}\n`,
    );
    return () => {
      releaseDogfood();
      releaseOperation();
    };
  } catch (error) {
    releaseOperation();
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const plan = buildPlan(options);
  if (options.list) {
    process.stdout.write(`${JSON.stringify({ mode: options.mode, read_only: options.readOnly, max_minutes: options.maxMinutes, plan }, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  let releaseLocks;
  try {
    releaseLocks = acquireDogfoodLocks(options.mode);
  } catch (error) {
    const completedAt = new Date();
    const skipped = {
      schema_version: 2,
      run_id: options.runId,
      mode: options.mode,
      result: 'SKIPPED',
      read_only: options.readOnly,
      trigger_source: options.triggerSource,
      started_at: options.startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      elapsed_ms: completedAt - options.startedAt,
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: options.sourceRoot, encoding: 'utf8', windowsHide: true,
      }).trim(),
      steps: [],
      failure: error.message,
      safety: {
        visible_windows: 0, focus_actions: 0, protected_session_mutations: 0,
        production_mutations: 0, proxy_restarts: 0, deploys: 0,
      },
    };
    const state = updateMachineState(options, skipped, null, null);
    skipped.program_health = state;
    atomicWriteJson(path.join(options.outputDir, 'operator-dogfood-result.json'), skipped);
    process.stdout.write(`${JSON.stringify({ result: skipped.result, reason: skipped.failure,
      result_file: path.relative(ROOT, path.join(options.outputDir, 'operator-dogfood-result.json')).replace(/\\/g, '/') }, null, 2)}\n`);
    process.exitCode = 2;
    return skipped;
  }
  const deadlineMs = options.startedAt.getTime() + options.maxMinutes * 60 * 1000;
  const steps = [];
  let failure = null;
  for (const spec of plan) {
    try {
      steps.push(runStep(spec, options, deadlineMs));
    } catch (error) {
      if (error.stepResult) steps.push(error.stepResult);
      failure = error;
      break;
    }
  }

  const screenshots = findPngs(options.outputDir);
  let contactSheet = null;
  if (screenshots.length) {
    const selected = representativeImages(screenshots);
    const contactPath = path.join(options.outputDir, 'contact-sheet.png');
    await makeContactSheet({
      images: selected.map(filePath => ({
        path: filePath,
        label: path.relative(options.outputDir, filePath).replace(/\\/g, '/'),
      })),
      outputPath: contactPath,
      title: `Operator dogfood ${options.mode} - ${options.runId}`,
    });
    contactSheet = {
      path: path.relative(ROOT, contactPath).replace(/\\/g, '/'),
      sha256: sha256(fs.readFileSync(contactPath)),
      included_images: selected.length,
      available_images: screenshots.length,
    };
  }

  const manifest = readJson(path.join(options.outputDir, 'screen-state-manifest.json'));
  const seeds = readJson(path.join(options.outputDir, 'seeded-discovery', 'seeded-defect-pack.json'));
  const android = readJson(path.join(options.outputDir, 'android-parity.json'));
  const productionAsset = readJson(path.join(options.outputDir, 'production-asset.json'));
  const visual = readJson(path.join(options.outputDir, 'visual-regression', 'visual-regression-result.json'));
  const temporal = readJson(path.join(options.outputDir, 'chat-stability-temporal.json'));
  const completedAt = new Date();
  const temporalDurationMs = Number(temporal?.storm?.actual_duration_ms || temporal?.duration_ms || 0);
  const temporalPassed = temporal?.ok === true && temporal?.temporal_contract?.ok === true;
  const result = {
    schema_version: 2,
    run_id: options.runId,
    mode: options.mode,
    result: failure ? 'FAIL' : 'PASS',
    read_only: options.readOnly,
    trigger_source: options.triggerSource,
    started_at: options.startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    elapsed_ms: completedAt - options.startedAt,
    budget_minutes: options.maxMinutes,
    source_root: options.sourceRoot,
    source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: options.sourceRoot, encoding: 'utf8', windowsHide: true,
    }).trim(),
    steps,
    coverage: {
      manifest_surfaces: manifest?.manifest?.surfaces || null,
      web_surfaces: manifest?.manifest?.by_platform?.web || null,
      android_surfaces: manifest?.manifest?.by_platform?.android || null,
      source_discovery_percent: manifest?.discovery_guard?.source_discovery_coverage_percent || null,
      seeded_discovery: seeds?.score || null,
      android_parity: android?.summary || null,
      visual_cases: visual?.cases?.length || 0,
      temporal_contract: temporal?.temporal_contract?.ok ?? null,
      temporal_refreshes: temporal?.storm?.total_refresh_frames ?? null,
      temporal_dropped_samples: temporal
        ? Object.values(temporal.depths || {}).reduce((total, depth) => total + Number(depth.dropped_samples || 0), 0)
        : null,
      production_asset_identity: productionAsset?.cache_key || null,
      manifest_rows_visited_in_built_ui: 0,
      manifest_row_visit_status: options.mode === 'source'
        ? 'NOT_APPLICABLE_SOURCE_ONLY' : 'UNPROVED_NO_DEDICATED_BUILT_PRODUCT_NAVIGATION_LEDGER',
    },
    contact_sheet: contactSheet,
    failure: failure ? failure.message : null,
    open_gates: {
      two_hour_cumulative_active_navigation: options.mode === 'weekly'
        ? (temporalPassed && temporalDurationMs >= 2 * 60 * 60 * 1000
          ? 'PROVED_FOR_THIS_RUN' : 'FAILED_OR_SHORT_THIS_RUN')
        : 'NOT_APPLICABLE_REQUIRES_WEEKLY_RUN',
      circuit_b_after_fixes: ['post-deploy', 'full'].includes(options.mode)
        ? (failure ? 'FAILED_THIS_RUN' : 'PROVED_FOR_THIS_RUN')
        : `NOT_APPLICABLE_TO_${options.mode.toUpperCase().replace(/-/g, '_')}`,
      row_by_row_built_ui_coverage: 'UNPROVED_NO_DEDICATED_LEDGER',
      production_deploy_identity: productionAsset ? 'PROVED_FOR_THIS_RUN' : 'NOT_RUN',
      android_real_device: 'GATED_USER_ACTION_7',
    },
    safety: {
      visible_windows: 0,
      focus_actions: 0,
      protected_session_mutations: 0,
      production_mutations: 0,
      headless_disposable_steps: steps.filter(row => [
        'seeded_discovery', 'chat_stability_seed_contract', 'chat_stability_prompt_lifecycle',
        'chat_stability_health_projection', 'chat_stability_temporal',
        'route_render_desktop', 'route_render_mobile', 'visual_regression',
      ].includes(row.id)).length,
      persistent_browser_steps: steps.filter(row => row.id === 'production_passive_surface').length,
      proxy_restarts: 0,
      deploys: 0,
    },
  };
  const currentFindingFingerprints = temporalFindings(temporal).map(item => item.fingerprint);
  const previousState = loadState(options.stateFile);
  const publicationHealth = {
    schema_version: 1,
    status: result.result,
    latest: {
      run_id: result.run_id,
      mode: result.mode,
      status: result.result,
      started_at: result.started_at,
      completed_at: result.completed_at,
      trigger_source: options.triggerSource,
      source_commit: result.source_commit,
      source_bundle_sha256: temporal?.bundle_sha256 || null,
      served_asset_identity: productionAsset?.cache_key || null,
      duration_ms: result.elapsed_ms,
      scenario_count: temporal ? 1 : 0,
      refresh_count: temporal?.storm?.total_refresh_frames ?? null,
      dropped_samples: result.coverage.temporal_dropped_samples,
      next_due_at: nextDue(result.mode, completedAt),
      scheduler_last_result: options.triggerSource === 'scheduled_task' ? result.result : 'NOT_SCHEDULED_TRIGGER',
    },
    open_fingerprints: [...new Set([...(previousState.open_fingerprints || []), ...currentFindingFingerprints])].sort(),
  };
  if (options.publish) {
    try {
      const relay = resolveRelay(options);
      result.publication = await publishEntry(relay, {
        schema_version: 1,
        kind: 'operator_dogfood',
        harness: 'operator-dogfood',
        status: result.result === 'PASS' ? 'pass' : 'fail',
        app_version: temporal?.bundle_sha256 || 'unavailable',
        validator: 'tools/operator-dogfood.js',
        run_id: result.run_id,
        duration_ms: result.elapsed_ms,
        exit_code: result.result === 'PASS' ? 0 : 1,
        detail: result.failure || `Operator dogfood ${result.mode} ${result.result}`,
        completed_at: result.completed_at,
        program_health: publicationHealth,
      });
    } catch (error) {
      result.result = 'FAIL';
      result.failure = `${result.failure ? `${result.failure}; ` : ''}program health publication failed: ${error.message}`;
      result.publication = { ok: false, error: error.message };
    }
  } else {
    result.publication = { ok: false, skipped: true, reason: 'explicit_no_publish_or_source_mode' };
  }
  const state = updateMachineState(options, result, temporal, productionAsset);
  result.program_health = state;
  result.failure_evidence = persistFailureTrace(options, temporal, state);
  const resultPath = path.join(options.outputDir, 'operator-dogfood-result.json');
  atomicWriteJson(resultPath, result);
  process.stdout.write(`${JSON.stringify({
    result: result.result,
    mode: result.mode,
    steps: steps.length,
    manifest_surfaces: result.coverage.manifest_surfaces,
    seeded_discovery: result.coverage.seeded_discovery,
    contact_sheet: result.contact_sheet,
    result_file: path.relative(ROOT, resultPath).replace(/\\/g, '/'),
  }, null, 2)}\n`);
  if (result.result !== 'PASS') process.exitCode = 1;
  releaseLocks();
  releaseLocks = null;
  return result;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

module.exports = {
  DOGFOOD_LOCK_PATH,
  OPERATION_LOCK_PATH,
  acquireDogfoodLocks,
  atomicWriteJson,
  buildPlan,
  loadState,
  main,
  parseArgs,
  persistFailureTrace,
  representativeImages,
  temporalFindings,
  updateMachineState,
};
