#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  expectedWorkspace,
  parseArgs,
  soakEffort,
  soakModel,
} = require('./codex-cli-soak-preflight-reset');

assert.equal(expectedWorkspace, 'c:\\temp\\remote-agent-vscode-test');
assert.equal(soakModel, 'gpt-5.4-mini');
assert.equal(soakEffort, 'low');
assert.throws(() => parseArgs([]), /--send-live/);
assert.throws(() => parseArgs(['--send-live', '--session-id', 'unsafe', '--output', 'x.json']), /explicit UUID/);

const parsed = parseArgs([
  '--send-live',
  '--session-id', '00000000-0000-4000-8000-000000000000',
  '--output', 'evidence/harness-maturity/fixture.json',
]);
assert.equal(parsed.sendLive, true);
assert.equal(parsed.sessionId, '00000000-0000-4000-8000-000000000000');

const source = fs.readFileSync(path.join(__dirname, 'codex-cli-soak-preflight-reset.js'), 'utf8');
for (const marker of [
  'soak.acquirePidLock(',
  "'new_chat'",
  "candidate.role === 'assistant'",
  'idleWithoutAssistant',
  "^reply with exact",
  "type: 'history_chunk_request'",
  'visible_windows_opened: 0',
  'focus_actions: 0',
]) assert(source.includes(marker), `missing preflight safety marker: ${marker}`);

console.log(JSON.stringify({
  ok: true,
  model: soakModel,
  effort: soakEffort,
  explicit_disposable_uuid: true,
  fresh_chat_required: true,
  assistant_role_and_history_required: true,
  terminal_idle_failure: true,
  production_operation_lock: true,
  visible_windows_opened: 0,
  focus_actions: 0,
}, null, 2));
