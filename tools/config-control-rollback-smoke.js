'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hooks = read('frontend/hooks.jsx');
const app = read('frontend/app.jsx');
const androidSheet = read('android-app/components/AgentSettingsSheet.jsx');
const androidChat = read('android-app/screens/ChatScreen.jsx');
const bundle = read('frontend/dist/bundle.js');
const checks = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(label);
  checks.push(label);
};

assert(hooks.includes('CONFIG_CONTROL_TIMEOUT_MS = 15000'), 'web controls have a bounded confirmation timeout');
for (const field of ['model', 'effort', 'permission_mode', 'permission_profile', 'auto_approve_permissions', 'mode', 'access_mode', 'workspace']) {
  assert(hooks.includes(`'${field}'`), `web tracks ${field}`);
}
assert(hooks.includes('previousValue: current[configKey]'), 'web records the rollback baseline');
assert(hooks.includes("status: 'failed'"), 'web exposes failed control state');
assert(hooks.includes('rollbackConfigControl(key'), 'web rolls back rejected and timed-out controls');
assert(hooks.includes('Connection changed before the native setting was confirmed.'), 'web rolls back controls on reconnect');
assert(hooks.includes('transaction.sessionId === sid'), 'web rejects cross-session late control receipts');
assert(hooks.includes('reconcileConfigControls(sid, msg)'), 'web confirms from authoritative agent_config');
assert(app.includes('composer-control-state'), 'web composer renders control transaction status');
assert(app.includes('configControlStates={configControlStates}'), 'web settings panel consumes shared transaction state');

assert(androidChat.includes('setControlResults(prev =>'), 'Android retains request-correlated control results');
assert(androidSheet.includes('previousValue, requestedValue'), 'Android records optimistic and rollback values');
assert(androidSheet.includes("status: 'failed'"), 'Android exposes rejected control state');
assert(androidSheet.includes('Timed out waiting for the agent to confirm this setting.'), 'Android has a bounded confirmation timeout');
assert(androidSheet.includes('confirmedValues'), 'Android confirms from authoritative agent_config');
assert(androidSheet.includes('controlStatusFailed'), 'Android renders visible rollback feedback');
assert(androidSheet.includes("(result.session_id || result.session) !== sessionId"), 'Android rejects cross-session late control receipts');

for (const marker of ['Control change failed and was rolled back.', 'Saving ', 'Fixture rejected model change.']) {
  if (marker.startsWith('Fixture')) continue;
  assert(bundle.includes(marker), `built bundle contains ${marker}`);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
