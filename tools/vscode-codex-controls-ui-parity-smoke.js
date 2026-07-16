#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const web = read('frontend/app.jsx');
const hooks = read('frontend/hooks.jsx');
const styles = read('frontend/styles.css');
const android = read('android-app/components/AgentSettingsSheet.jsx');
const androidRelay = read('android-app/lib/relay.js');
const bundle = read('frontend/dist/bundle.js');

const markers = [
  'Next turn model',
  'Next turn effort',
  'Next turn permissions',
  'Approval policy',
  'Access / sandbox',
  'Enable Bypass permissions?',
  'Restore previous safe permissions',
];
markers.forEach(marker => {
  assert(web.includes(marker), `Web settings omitted ${marker}`);
  assert(android.includes(marker), `Android settings omitted ${marker}`);
  assert(bundle.includes(marker), `built Web bundle omitted ${marker}`);
});

for (const capability of [
  'codex_model_change',
  'codex_effort_change',
  'codex_permission_profile_change',
  'codex_bypass_permissions',
]) {
  assert(web.includes(capability), `Web omitted granular capability ${capability}`);
  assert(android.includes(capability), `Android omitted granular capability ${capability}`);
}

assert(web.includes("confirm_bypass: true"), 'Web bypass action omitted explicit confirmation');
assert(android.includes("confirm_bypass: true"), 'Android bypass action omitted explicit confirmation');
assert(hooks.includes('source_revision: config.source_revision'), 'Web transport omitted source revision');
assert(android.includes('source_revision: config.source_revision'), 'Android transport omitted source revision');
assert(androidRelay.includes("type: 'set_codex_config'"), 'Android relay omitted Codex config routing');
assert(styles.includes('.settings-bypass-confirmation'), 'Web bypass confirmation has no bounded visual treatment');
assert(styles.includes('min-height: 44px'), 'Web high-risk actions do not meet the 44 px touch target');
assert(android.includes('minHeight: 44'), 'Android high-risk actions do not meet the 44 px touch target');
assert(!web.includes('Codex model (restart required)'), 'Web still mislabels VS Code next-turn model as restart-scoped');
assert(!web.includes('Reasoning effort (restart required)'), 'Web still mislabels VS Code next-turn effort as restart-scoped');
assert(!web.includes('Access mode (restart required)'), 'Web still mislabels VS Code permissions as restart-scoped');

console.log(JSON.stringify({
  ok: true,
  shared_markers: markers.length,
  granular_capabilities: 4,
  explicit_bypass_confirmation: true,
  safe_restore: true,
  touch_target_px: 44,
}, null, 2));
