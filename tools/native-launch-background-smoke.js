'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const claudeCli = require('../agent-proxy/claude-cli');
const codexCli = require('../agent-proxy/codex-cli');
const cursorCli = require('../agent-proxy/cursor-cli');
const { nativeLaunchState } = require('../agent-proxy/native-launch-mode');

const cases = [
  ['Claude', () => claudeCli.startNativeClaudeWindow({ launchMode: 'background' })],
  ['Codex', () => codexCli.startNativeCodexWindow({ launchMode: 'background' })],
  ['Cursor', () => cursorCli.startNativeCursorWindow({ launchMode: 'background' })],
];

for (const [name, launch] of cases) {
  const result = launch();
  assert.strictEqual(result.backgroundMode, true, `${name} background launch must return the no-window sentinel`);
  assert.strictEqual(result.nativeCliWindowOpened, false, `${name} background launch must not report a native window`);
  assert.strictEqual(result.pid, null, `${name} background launch must not spawn a process`);
  assert.deepStrictEqual(nativeLaunchState(result), {
    mode: 'background',
    status: 'background_ready',
    windowOpened: false,
  });
}

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
const backgroundCalls = engineSource.match(/launchMode:\s*'background'/g) || [];
const foregroundCalls = engineSource.match(/launchMode:\s*'foreground'/g) || [];
assert.strictEqual(backgroundCalls.length, 6, 'new_chat and launch_session must use background mode for all three CLI agents');
assert.strictEqual(foregroundCalls.length, 4,
  'only the three CLI branches and the explicit Claude error-prompt action may request foreground mode');
assert((engineSource.match(/operatorActionProof:\s*msg\.operator_action_proof/g) || []).length >= 4,
  'every foreground branch must forward its relay-stamped operator proof');
assert.match(engineSource, /trusted Claude workspace[\s\S]*?native window remains operator-action-only/,
  'workspace trust must not implicitly reopen a native window');
assert.match(engineSource, /nativeCliStatus:\s*'background_ready'/, 'background sessions must expose truthful ready state');

console.log('native launch background smoke: PASS');
