'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const claudeCli = require('../agent-proxy/claude-cli');
const codexCli = require('../agent-proxy/codex-cli');
const cursorCli = require('../agent-proxy/cursor-cli');
const {
  createRelayOperatorActionProof,
  validateOperatorActionProof,
} = require('../agent-proxy/windows-automation-launch-policy');
const { resolveSharedRuntimeContract } = require('../relay-server/shared-runtime-contract');

const ROOT = path.resolve(__dirname, '..');
const proofContract = 'windows-operator-action-proof.js';
assert.strictEqual(resolveSharedRuntimeContract(proofContract), path.join(ROOT, 'shared', proofContract));
const packagedBase = path.join(ROOT, '.packaged-relay-layout');
const packagedContract = path.join(packagedBase, 'shared', proofContract);
assert.strictEqual(resolveSharedRuntimeContract(proofContract, {
  baseDir: packagedBase,
  existsSync: candidate => candidate === packagedContract,
}), packagedContract);
const deniedLaunches = [
  () => claudeCli.startNativeClaudeWindow({ launchMode: 'foreground', requestId: 'missing-claude' }),
  () => codexCli.startNativeCodexWindow({ launchMode: 'foreground', requestId: 'missing-codex' }),
  () => cursorCli.startNativeCursorWindow({ launchMode: 'foreground', requestId: 'missing-cursor' }),
];
for (const launch of deniedLaunches) {
  assert.throws(launch, error => error?.code === 'operator_action_only'
    && /(?:missing_relay_proof|automation_context)/.test(error.message));
}
assert.throws(
  () => claudeCli.startInteractiveClaude(),
  error => error?.code === 'operator_action_only'
    && /(?:existing operator-open terminal|denied in automation)/.test(error.message),
  'headless callers must not turn the existing-terminal helper into a window launcher',
);

const requestId = `operator-smoke-${Date.now()}`;
const proof = createRelayOperatorActionProof({ action: 'open_native_window', requestId, channel: 'android' });
assert.strictEqual(validateOperatorActionProof(proof, { requestId, env: {}, consume: false }).ok, true);
assert.strictEqual(validateOperatorActionProof(proof, {
  requestId,
  env: { RAC_VALIDATOR: '1' },
  consume: false,
}).reason, 'automation_context');

const relay = fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'), 'utf8');
const proxy = fs.readFileSync(path.join(ROOT, 'agent-proxy', 'proxy-engine.js'), 'utf8');
const web = fs.readFileSync(path.join(ROOT, 'frontend', 'hooks.jsx'), 'utf8');
const android = fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'relay.js'), 'utf8');

assert.match(relay, /ws\._appUser\?\.email \|\| req\.user\?\.email \|\| ''/,
  'LAN bypass or configured email alone must not mint an operator proof');
assert.match(relay, /msg\?\.operator_user_gesture !== true/);
assert.match(relay, /rejectOperatorActionOnly\(ws, msg, 'open_native_window'\)/);
assert.match(relay, /rejectOperatorActionOnly\(ws, msg, 'error_prompt_action'\)/);
assert.match(proxy, /validateOperatorActionProof\(msg\.operator_action_proof/);
assert.match(proxy, /native window remains operator-action-only/);
assert.doesNotMatch(proxy.slice(proxy.indexOf("if (msg.action_id === 'trust_workspace')"), proxy.indexOf('const actionPromise')),
  /startNativeClaudeWindow/,
  'trust_workspace must never reopen a visible window');
assert.match(web, /operatorEvent\?\.isTrusted === true/);
assert.match(android, /operator_user_gesture: operatorGesture === true/);

console.log(JSON.stringify({
  status: 'pass',
  missing_proof_launches_denied_before_spawn: deniedLaunches.length,
  headless_interactive_terminal_launch_denied: true,
  relay_requires_real_authenticated_identity: true,
  web_requires_trusted_event: true,
  android_requires_direct_press_marker: true,
  automation_environment_rejected: true,
  workspace_trust_opens_window: false,
}, null, 2));
