#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('../frontend/node_modules/pngjs');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'evidence', 'harness-maturity', 'question-prompt-native-approvals.json');
const NATIVE_LEDGER_PATH = path.join(ROOT, 'evidence', 'harness-maturity', 'native-golden-approvals.json');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resolveRepoPath(relativePath, label) {
  assert.equal(typeof relativePath, 'string', `${label} path must be a string`);
  assert(relativePath && !path.isAbsolute(relativePath), `${label} path must be repository-relative`);
  const absolute = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, absolute);
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} path escapes the repository`);
  return absolute;
}

function validateFile(row, label, png = false) {
  const absolute = resolveRepoPath(row.path, label);
  assert(fs.existsSync(absolute), `${label} is missing: ${row.path}`);
  const bytes = fs.readFileSync(absolute);
  assert.equal(bytes.length, row.bytes, `${label} byte length drifted`);
  assert.equal(sha256(bytes), row.sha256, `${label} hash drifted`);
  if (png) {
    const image = PNG.sync.read(bytes);
    assert.equal(image.width, row.width, `${label} width drifted`);
    assert.equal(image.height, row.height, `${label} height drifted`);
  }
  return { absolute, bytes };
}

function parseArgs(argv) {
  const options = { readOnly: false, resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnly, 'native approval validation requires explicit --read-only');
  if (options.resultFile) {
    const evidenceRoot = path.join(ROOT, 'evidence');
    const relative = path.relative(evidenceRoot, options.resultFile);
    assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      '--result-file must stay under the evidence tree');
  }
  return options;
}

function captureFromProducer(source, producer) {
  if (source.agent === 'codex_cli') return producer.screenshot;
  return producer.native_capture;
}

function assertProducerContract(source, producer) {
  const capture = captureFromProducer(source, producer);
  assert(capture, `${source.agent}: producer omitted capture metadata`);
  for (const key of ['path', 'bytes', 'sha256', 'width', 'height']) {
    assert.deepEqual(capture[key], source.capture[key], `${source.agent}: producer capture ${key} drifted`);
  }

  if (source.agent === 'codex_cli') {
    assert.equal(producer.result, 'PASS');
    assert.equal(producer.agent, 'codex_cli');
    assert.equal(producer.cli_version, '0.144.4');
    assert.equal(producer.prompt?.kind, 'goal_resume_decision');
    assert.equal(producer.prompt?.title, 'Resume paused goal?');
    assert.deepEqual(producer.prompt?.choices, ['Resume goal', 'Leave paused']);
    assert.equal(producer.native_goal_seed?.status, 'paused');
    assert.equal(producer.native_goal_seed?.model_turns_started, 0);
    assert.deepEqual(producer.workspace_before, producer.workspace_after);
    assert.equal(producer.cleanup?.archived, true);
    assert.equal(producer.cleanup?.deleted, true);
    assert.equal(producer.cleanup?.process_alive, false);
    assert.equal(producer.safety?.owned_disposable_sends, 0);
    assert.equal(producer.safety?.workspace_mutations, 0);
    assert.equal(producer.safety?.visible_windows_opened, 0);
    assert.equal(producer.safety?.focus_actions, 0);
    assert.equal(producer.safety?.terminal_host_windows_opened, 0);
    assert.equal(producer.safety?.update_checks_enabled, false);
  } else if (source.agent === 'codex') {
    assert.equal(producer.ok, true);
    assert.equal(producer.cdp_port, 9230);
    assert.equal(producer.through_relay, true);
    assert.equal(producer.capability_readback?.question_prompts, true);
    assert.equal(producer.native_question_produced, true);
    assert.equal(producer.native_response_callback_invocations, 1);
    assert.equal(producer.native_question_disappeared, true);
    assert.equal(producer.ordinary_answer_user_turns, 0);
    assert.equal(producer.duplicate_native_answers, 0);
    assert.equal(producer.wrong_conversation_answers, 0);
    assert.equal(producer.false_success_receipts, 0);
    assert.equal(producer.focus_actions, 0);
    assert.equal(producer.visible_windows_opened, 0);
    assert.equal(producer.protected_actions, 0);
    assert.equal(producer.protected_target_set_unchanged, true);
  } else if (source.agent === 'codex-desktop') {
    assert.equal(producer.ok, true);
    assert.equal(producer.cdp_port, 9225);
    assert.equal(producer.app_restarted, false);
    assert.equal(producer.native_answer?.native_acknowledged, true);
    assert.equal(producer.native_prompt_disappeared, true);
    assert.equal(producer.same_thread, true);
    assert.equal(producer.ordinary_answer_user_turns, 0);
    assert.equal(producer.original_thread_restored, true);
    assert.equal(producer.focus_actions, 0);
    assert.equal(producer.visible_windows_opened, 0);
  } else {
    assert.fail(`unexpected native producer ${source.agent}`);
  }
}

function validate(manifest) {
  assert.equal(manifest.schema_version, 1);
  assert.equal(typeof manifest.review_method, 'string');
  assert(manifest.review_method.length >= 120, 'manual review method is too weak');
  assert.match(manifest.source_checkpoint, /^[0-9a-f]{40}$/);
  assert.deepEqual(manifest.native_sources.map(row => row.agent), ['codex_cli', 'codex', 'codex-desktop']);
  assert.deepEqual(manifest.presentation_contract?.dark_theme_grounded_by, ['codex_cli', 'codex']);
  assert.deepEqual(manifest.presentation_contract?.light_theme_grounded_by, ['codex-desktop']);
  assert.deepEqual(manifest.presentation_contract?.surfaces, ['web', 'android']);
  assert.deepEqual(manifest.presentation_contract?.themes, ['dark', 'light']);
  assert.deepEqual(manifest.presentation_contract?.viewports, ['desktop', 'mobile']);

  const nativeLedger = JSON.parse(fs.readFileSync(NATIVE_LEDGER_PATH, 'utf8'));
  const producerSummaries = [];
  for (const source of manifest.native_sources) {
    validateFile(source.capture, `${source.agent} native capture`, true);
    const producerFile = validateFile(source.producer_result, `${source.agent} producer result`);
    const producer = JSON.parse(producerFile.bytes.toString('utf8'));
    assertProducerContract(source, producer);

    const ledgerHarness = nativeLedger.harnesses.find(row => row.agent === source.agent);
    assert(ledgerHarness, `${source.agent}: missing from canonical native ledger`);
    assert(ledgerHarness.approved_blocks[source.theme].includes('prompt'),
      `${source.agent}: prompt is not approved in the canonical native ledger`);
    const ledgerSource = ledgerHarness.native_sources.find(row => row.path === source.capture.path);
    assert(ledgerSource, `${source.agent}: native capture is not sealed in the canonical native ledger`);
    assert.equal(ledgerSource.sha256, source.capture.sha256);
    assert(ledgerSource.observed_blocks.includes('prompt'));
    producerSummaries.push({
      agent: source.agent,
      theme: source.theme,
      capture_sha256: source.capture.sha256,
      producer_result_sha256: source.producer_result.sha256,
      native_acknowledged: source.agent === 'codex_cli' ? null : true,
    });
  }

  const expectedCases = [];
  for (const surface of ['android', 'web']) {
    for (const viewport of ['desktop', 'mobile']) {
      for (const theme of ['dark', 'light']) expectedCases.push(`${surface}/${viewport}/${theme}`);
    }
  }
  const actualCases = manifest.goldens.map(row => `${row.surface}/${row.viewport}/${row.theme}`).sort();
  assert.deepEqual(actualCases, expectedCases.sort());
  const goldenHashes = new Map();
  for (const golden of manifest.goldens) {
    validateFile(golden, `golden ${golden.surface}/${golden.viewport}/${golden.theme}`, true);
    assert.equal(golden.width, golden.viewport === 'desktop' ? 1440 : 390);
    assert.equal(golden.height, golden.viewport === 'desktop' ? 900 : 844);
    goldenHashes.set(golden.path, golden.sha256);
  }

  const visualFile = validateFile(manifest.visual_regression_result, 'visual regression result');
  const visual = JSON.parse(visualFile.bytes.toString('utf8'));
  assert.equal(visual.ok, true);
  assert.equal(visual.mode, 'compare');
  assert.equal(visual.cases?.length, 8);
  for (const visualCase of visual.cases) {
    assert.equal(visualCase.status, 'pass');
    assert.equal(visualCase.different, 0);
    assert.equal(goldenHashes.get(visualCase.golden?.path), visualCase.golden?.sha256,
      `visual result references an unapproved or drifted golden: ${visualCase.golden?.path}`);
  }
  assert.equal(visual.assertions?.visual_capture_client_mutations, 0);
  assert.equal(visual.assertions?.focus_actions, 0);
  assert.equal(visual.assertions?.visible_windows_opened, 0);
  assert.equal(visual.assertions?.secret_persistence_hits, 0);
  assert.equal(visual.assertions?.horizontal_overflow_cases, 0);
  assert.equal(visual.assertions?.clipped_mobile_prompt_cases, 0);
  assert.equal(visual.assertions?.mobile_touch_target_failures, 0);

  return {
    ok: true,
    schema_version: manifest.schema_version,
    read_only: true,
    manifest: path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/'),
    source_checkpoint: manifest.source_checkpoint,
    native_producers: producerSummaries,
    golden_cases: manifest.goldens.length,
    exact_visual_comparisons: visual.cases.length,
    differing_pixels: visual.cases.reduce((sum, row) => sum + row.different, 0),
    approved_surfaces: manifest.presentation_contract.surfaces,
    approved_themes: manifest.presentation_contract.themes,
    approved_viewports: manifest.presentation_contract.viewports,
    safety: {
      focus_actions: 0,
      visible_windows_opened: 0,
      protected_actions: 0,
      secret_persistence_hits: 0,
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const result = validate(manifest);
  if (options.resultFile) {
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { MANIFEST_PATH, NATIVE_LEDGER_PATH, main, parseArgs, validate };
