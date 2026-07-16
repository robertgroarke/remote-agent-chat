#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { makeContactSheet } = require('./operator-dogfood-contact-sheet');

const ROOT = path.resolve(__dirname, '..');
const MODES = new Set(['source', 'post-deploy', 'full']);

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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!MODES.has(options.mode)) throw new Error(`--mode must be one of ${[...MODES].join(', ')}`);
  if (!/^[a-zA-Z0-9._-]+$/.test(options.runId)) throw new Error('--run-id must be filesystem safe');
  if (options.mode !== 'source' && !options.readOnly) {
    throw new Error(`${options.mode} mode requires --read-only; production navigation is inspect-only`);
  }
  if (!options.maxMinutes) options.maxMinutes = options.mode === 'source' ? 10 : options.mode === 'post-deploy' ? 25 : 150;
  if (!(options.maxMinutes > 0 && options.maxMinutes <= 240)) throw new Error('--max-minutes must be between 1 and 240');
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
      ['source', 'post-deploy', 'full'], 1),
    step('manifest_guard_adversarial', 'tools/operator-dogfood-manifest-guard-smoke.js',
      ['--output', path.join(out, 'screen-state-manifest-guard.json')], 'screen-state-manifest-guard.json',
      ['source', 'post-deploy', 'full'], 1),
    step('manifest_snapshot', 'tools/operator-dogfood-manifest-snapshot.js',
      ['--output', path.join(out, 'screen-state-manifest.json')], 'screen-state-manifest.json',
      ['source', 'post-deploy', 'full'], 1),
    step('seeded_discovery', 'tools/operator-dogfood-seed-pack.js',
      ['--output-dir', path.join(out, 'seeded-discovery')], 'seeded-discovery/seeded-defect-pack.json',
      ['source', 'post-deploy', 'full'], 2),
    step('android_parity', 'tools/android-parity-audit.js',
      ['--output', path.join(out, 'android-parity.json')], 'android-parity.json',
      ['source', 'post-deploy', 'full'], 2),
    step('production_asset_identity', 'tools/production-asset-smoke.js',
      ['--source-root', options.sourceRoot, '--env-root', options.envRoot,
        '--output', path.join(out, 'production-asset.json')], 'production-asset.json',
      ['post-deploy', 'full'], 3),
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

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const plan = buildPlan(options);
  if (options.list) {
    process.stdout.write(`${JSON.stringify({ mode: options.mode, read_only: options.readOnly, max_minutes: options.maxMinutes, plan }, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
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
  const completedAt = new Date();
  const result = {
    schema_version: 1,
    run_id: options.runId,
    mode: options.mode,
    result: failure ? 'FAIL' : 'PASS',
    read_only: options.readOnly,
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
      production_asset_identity: productionAsset?.cache_key || null,
      manifest_rows_visited_in_built_ui: 0,
      manifest_row_visit_status: options.mode === 'source'
        ? 'SOURCE_ONLY' : 'PENDING_DEDICATED_BUILT_PRODUCT_NAVIGATION_LEDGER',
    },
    contact_sheet: contactSheet,
    failure: failure ? failure.message : null,
    open_gates: {
      two_hour_cumulative_active_navigation: 'PENDING',
      circuit_b_after_fixes: 'PENDING',
      row_by_row_built_ui_coverage: 'PENDING',
      production_deploy_identity: productionAsset ? 'PROVED_FOR_THIS_RUN' : 'NOT_RUN',
      android_real_device: 'GATED_USER_ACTION_7',
    },
    safety: {
      visible_windows: 0,
      focus_actions: 0,
      protected_session_mutations: 0,
      production_mutations: 0,
      headless_disposable_steps: steps.filter(row => [
        'seeded_discovery', 'route_render_desktop', 'route_render_mobile', 'visual_regression',
      ].includes(row.id)).length,
      persistent_browser_steps: steps.filter(row => row.id === 'production_passive_surface').length,
    },
  };
  const resultPath = path.join(options.outputDir, 'operator-dogfood-result.json');
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    result: result.result,
    mode: result.mode,
    steps: steps.length,
    manifest_surfaces: result.coverage.manifest_surfaces,
    seeded_discovery: result.coverage.seeded_discovery,
    contact_sheet: result.contact_sheet,
    result_file: path.relative(ROOT, resultPath).replace(/\\/g, '/'),
  }, null, 2)}\n`);
  if (failure) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

module.exports = { buildPlan, main, parseArgs, representativeImages };
