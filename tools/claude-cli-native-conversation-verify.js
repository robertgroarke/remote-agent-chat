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
  readCompletedTurn,
  workspaceSnapshot,
} = require('./claude-cli-native-conversation-e2e');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const CLAUDE_PROJECT_ROOT = path.resolve(process.env.USERPROFILE || process.env.HOME || '', '.claude/projects');
const DISPOSABLE_WORKSPACE = path.resolve('C:/temp/remote-agent-claude-cli-native-replace-test');
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
  assert.equal(source.ok, true, 'Source native conversation result is not green');
  assert.equal(source.agent, 'claude_cli');
  assert.deepEqual(source.native_surfaces, ['thinking', 'markdown']);
  assert.equal(source.cli_version, '2.1.207');
  assert.equal(source.model, 'sonnet');
  assert.equal(source.effort, 'medium');
  assert.equal(source.permission_mode, 'dontAsk');
  assert.equal(source.tools_available, 0);
  assert.match(source.session_id, /^[0-9a-f-]{36}$/i);
  assert.match(source.marker, /^RAC_CLAUDE_NATIVE_[0-9A-F]{8}$/);
  assert.match(source.thinking_frame_text, /[✻*]\s+[^\n]*(?:…|\.\.\.)/u,
    'Thinking frame is missing Claude CLI native spinner vocabulary');
  assert.match(source.thinking_frame_text, /esc\s+to\s+interrupt/i);
  assert(source.settled_frame_text.includes(source.marker), 'Settled frame is missing the marker');
  assert.match(source.settled_frame_text, /Native parity/i);
  assert.match(source.native_assistant_text, /^## Native parity/m);
  assert.match(source.native_assistant_text, /`alpha`/);
  assert.match(source.native_assistant_text, /\*\*beta\*\*/);
  assert.match(source.native_assistant_text, /^> /m);
  assert.match(source.native_assistant_text, /^\|[^\n]+\|$/m);
  assert(source.native_assistant_text.includes(source.marker));
  assert.equal(source.native_assistant_stop_reason, 'end_turn');
  assert(source.native_turn_duration_ms > 0);

  assert.equal(source.safety.owned_disposable_sends, 1);
  assert.equal(source.safety.tools_invoked, 0);
  assert.equal(source.safety.shell_commands_invoked_by_agent, 0);
  assert.equal(source.safety.workspace_mutations, 0);
  assert.equal(source.safety.visible_windows_opened, 0);
  assert.equal(source.safety.focus_actions, 0);
  assert.equal(source.safety.terminal_host_windows_opened, 0);
  assert(source.safety.cleanup_method.startsWith('native_ctrl_d_exit'));
  assert.equal(source.safety.process_alive_after_cleanup, false);
  assert.equal(source.safety.exit_code, 1);
  assert.equal(source.safety.accepted_windows_conpty_eof_exit, true);
  assert.equal(processAlive(source.safety.conpty_pid), false, 'Owned Claude CLI ConPTY PID is still alive');

  const workspaceNow = workspaceSnapshot(DISPOSABLE_WORKSPACE);
  assert.deepStrictEqual(workspaceNow, source.workspace_before, 'Disposable workspace drifted from preflight');
  assert.deepStrictEqual(workspaceNow, source.workspace_after, 'Disposable workspace drifted from cleanup');

  const archivePath = path.resolve(source.native_archive.path);
  const archiveRelative = path.relative(CLAUDE_PROJECT_ROOT, archivePath);
  assert(archiveRelative && !archiveRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(archiveRelative),
    'Native archive escapes the Claude project root');
  assert.equal(path.basename(archivePath).toLowerCase(), `${source.session_id}.jsonl`.toLowerCase());
  const archiveBytes = fs.readFileSync(archivePath);
  assert.equal(sha256(archiveBytes), source.native_archive.sha256, 'Native archive hash drifted');
  assert.equal(archiveBytes.length, source.native_archive.bytes, 'Native archive byte length drifted');
  const completed = readCompletedTurn(archivePath, source.marker);
  assert(completed, 'Native archive lost its assistant/turn boundary');
  assert.equal(completed.assistantText, source.native_assistant_text);
  assert.equal(completed.assistantStopReason, 'end_turn');

  for (const surface of ['thinking', 'markdown']) {
    const capture = source.captures[surface];
    const capturePath = path.resolve(ROOT, capture.path);
    const captureRelative = path.relative(EVIDENCE_ROOT, capturePath);
    assert(captureRelative && !captureRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(captureRelative),
      `${surface} capture escapes the evidence tree`);
    const bytes = fs.readFileSync(capturePath);
    assert.equal(sha256(bytes), capture.sha256, `${surface} capture hash drifted`);
    assert.equal(bytes.length, capture.bytes, `${surface} capture byte length drifted`);
    const png = PNG.sync.read(bytes);
    assert.equal(png.width, capture.width);
    assert.equal(png.height, capture.height);
  }

  const nativeProject = path.dirname(archivePath);
  const projectNow = directorySnapshot(nativeProject);
  const archiveRow = projectNow.files.find(row => row.path.toLowerCase() === `${source.session_id}.jsonl`.toLowerCase());
  assert(archiveRow, 'Owned archive disappeared from its native project directory');
  assert.equal(archiveRow.sha256, source.native_archive.sha256);

  const output = {
    ok: true,
    generated_at: new Date().toISOString(),
    read_only: true,
    source_result: path.relative(ROOT, options.resultFile).replace(/\\/g, '/'),
    source_result_sha256: sha256(sourceBytes),
    session_id: source.session_id,
    marker: source.marker,
    native_surfaces: source.native_surfaces,
    native_archive_sha256: source.native_archive.sha256,
    captures: source.captures,
    workspace_sha256: workspaceNow.sha256,
    cleanup: {
      method: source.safety.cleanup_method,
      exit_code: source.safety.exit_code,
      accepted_windows_conpty_eof_exit: true,
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
    console.error(`Claude CLI native conversation verification: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
