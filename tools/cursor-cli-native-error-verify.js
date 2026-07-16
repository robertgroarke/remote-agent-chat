#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('../frontend/node_modules/pngjs');
const {
  processAlive,
  workspaceSnapshot,
} = require('./cursor-cli-native-thinking-e2e');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const NATIVE_TEXT = '⚠ Warning: The provided API key is invalid.\n'
  + 'Please check you have the right key, create a new one, or authenticate without it.';

function evidencePath(value, extension, label) {
  const output = path.resolve(value || '');
  const relative = path.relative(EVIDENCE_ROOT, output);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} must stay under the evidence tree`);
  assert.equal(path.extname(output).toLowerCase(), extension, `${label} must use ${extension}`);
  return output;
}

function parseArgs(argv) {
  const options = { readOnly: false, resultFile: '', outputFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--result-file') options.resultFile = evidencePath(argv[++index], '.json', 'result-file');
    else if (arg === '--output-file') options.outputFile = evidencePath(argv[++index], '.json', 'output-file');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnly, 'Explicit --read-only is required');
  assert(options.resultFile, '--result-file is required');
  assert(options.outputFile, '--output-file is required');
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const sourceBytes = fs.readFileSync(options.resultFile);
  const sourceText = sourceBytes.toString('utf8');
  const source = JSON.parse(sourceText);
  assert.equal(source.ok, true, 'Source native error result is not green');
  assert.equal(source.agent, 'cursor_cli');
  assert.equal(source.native_surface, 'error');
  assert.equal(source.failure_kind, 'authentication');
  assert.equal(source.native_text, NATIVE_TEXT);
  assert.equal(source.exit_code, 1);
  assert(!sourceText.includes('rac-invalid-'), 'Evidence retained the isolated invalid credential');
  assert.deepStrictEqual(source.native_style_runs.map(row => ({ text: row.text, runs: row.runs })), [
    {
      text: '⚠ Warning: The provided API key is invalid.',
      runs: [{
        text: '⚠ Warning: The provided API key is invalid.',
        fg: 'palette:3', bold: 0, dim: 0, italic: 0, underline: 0, inverse: 0,
      }],
    },
    {
      text: 'Please check you have the right key, create a new one, or authenticate without it.',
      runs: [{
        text: 'Please check you have the right key, create a new one, or authenticate without it.',
        fg: 'default', bold: 0, dim: 0, italic: 0, underline: 0, inverse: 0,
      }],
    },
  ], 'Captured ANSI styles drifted from palette-3 warning plus default remediation text');

  assert.deepStrictEqual(source.workspace_after, source.workspace_before,
    'Source evidence does not prove an unchanged disposable workspace');
  assert.equal(source.native_chat_count_after, source.native_chat_count_before,
    'Source evidence does not prove zero native chat creation');
  for (const key of [
    'model_sends', 'tools_invoked', 'shell_commands_invoked_by_agent', 'workspace_mutations',
    'native_chats_created', 'visible_windows_opened', 'focus_actions', 'terminal_host_windows_opened',
  ]) assert.equal(source.safety[key], 0, `Source safety field ${key} is not zero`);
  assert.equal(source.safety.auth_failure_requests, 1);
  assert.equal(source.safety.cleanup_method, 'native_auth_failure_exit');
  assert.equal(source.safety.process_alive_after_exit, false);
  assert.equal(processAlive(source.safety.conpty_pid), false, 'Owned auth-failure ConPTY PID is still alive');

  const workspaceNow = workspaceSnapshot(path.resolve('C:/temp/cursor-test'));
  assert.deepStrictEqual(workspaceNow, source.workspace_before,
    'Disposable workspace no longer matches the auth-failure preflight');
  const capturePath = path.resolve(ROOT, source.capture.path);
  const captureRelative = path.relative(EVIDENCE_ROOT, capturePath);
  assert(captureRelative && !captureRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(captureRelative),
    'Native capture escapes the evidence tree');
  const captureBytes = fs.readFileSync(capturePath);
  assert.equal(sha256(captureBytes), source.capture.sha256, 'Native capture hash drifted');
  assert.equal(captureBytes.length, source.capture.bytes, 'Native capture byte length drifted');
  const png = PNG.sync.read(captureBytes);
  assert.equal(png.width, source.capture.width);
  assert.equal(png.height, source.capture.height);

  const output = {
    ok: true,
    generated_at: new Date().toISOString(),
    read_only: true,
    source_result: path.relative(ROOT, options.resultFile).replace(/\\/g, '/'),
    source_result_sha256: sha256(sourceBytes),
    native_text: source.native_text,
    native_style_runs: source.native_style_runs,
    capture: source.capture,
    workspace_sha256: workspaceNow.sha256,
    cleanup: {
      method: source.safety.cleanup_method,
      exit_code: source.exit_code,
      conpty_pid_alive: false,
    },
    safety: {
      sends: 0,
      controls: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
    },
  };
  fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
  fs.writeFileSync(options.outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));
  return output;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Cursor CLI native error verification: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
