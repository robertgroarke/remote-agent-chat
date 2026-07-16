#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('../frontend/node_modules/pngjs');
const {
  directorySnapshot,
  processAlive,
  workspaceSnapshot,
} = require('./cursor-cli-native-thinking-e2e');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const CURSOR_CHAT_ROOT = path.resolve(process.env.USERPROFILE || process.env.HOME || '', '.cursor', 'chats');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

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
  const source = JSON.parse(sourceBytes.toString('utf8'));
  assert.equal(source.ok, true, 'Source native thinking result is not green');
  assert.equal(source.agent, 'cursor_cli');
  assert.equal(source.native_surface, 'thinking');
  assert.equal(source.mode, 'ask');
  assert.match(source.marker, /^RAC_CURSOR_CLI_THINKING_[0-9a-f]{8}$/);
  assert.match(source.selected_frame_text, /\bWorking\b/);
  assert(source.settled_frame_text.includes(source.marker), 'Settled frame is missing the exact final marker');
  assert.match(source.settled_frame_text, /(?:Add|Ask) a follow-up/i);
  assert.equal(source.safety.owned_disposable_sends, 1);
  assert.equal(source.safety.tools_invoked, 0);
  assert.equal(source.safety.shell_commands_invoked_by_agent, 0);
  assert.equal(source.safety.workspace_mutations, 0);
  assert.equal(source.safety.visible_windows_opened, 0);
  assert.equal(source.safety.focus_actions, 0);
  assert.equal(source.safety.terminal_host_windows_opened, 0);
  assert.equal(source.safety.cleanup_method, 'ctrl_d');
  assert.equal(source.safety.process_alive_after_cleanup, false);
  assert.equal(source.safety.exit_code, 0);
  assert.equal(processAlive(source.safety.conpty_pid), false, 'Owned ConPTY PID is still alive');

  const workspaceNow = workspaceSnapshot(path.resolve('C:/temp/cursor-test'));
  assert.deepStrictEqual(workspaceNow, source.workspace_before, 'Disposable workspace no longer matches preflight');
  assert.deepStrictEqual(workspaceNow, source.workspace_after, 'Disposable workspace no longer matches cleanup');

  const nativeDirectory = path.resolve(source.native_chat_directory);
  const nativeRelative = path.relative(CURSOR_CHAT_ROOT, nativeDirectory);
  assert(nativeRelative && !nativeRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(nativeRelative),
    'Native chat directory escapes the Cursor chat root');
  assert.equal(path.basename(nativeDirectory).toLowerCase(), source.chat_id.toLowerCase());
  const nativeNow = directorySnapshot(nativeDirectory);
  assert.deepStrictEqual(nativeNow, source.native_archive, 'Native Cursor archive changed after clean EOF');
  const nativeMeta = JSON.parse(fs.readFileSync(path.join(nativeDirectory, 'meta.json'), 'utf8'));
  assert.equal(nativeMeta.hasConversation, true, 'Native Cursor chat lost its retained conversation');
  assert.deepStrictEqual(nativeMeta, source.native_meta, 'Native Cursor metadata changed after clean EOF');

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
    chat_id: source.chat_id,
    marker: source.marker,
    native_archive_sha256: nativeNow.sha256,
    capture: source.capture,
    workspace_sha256: workspaceNow.sha256,
    cleanup: {
      method: source.safety.cleanup_method,
      exit_code: source.safety.exit_code,
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
    console.error(`Cursor CLI native thinking verification: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
