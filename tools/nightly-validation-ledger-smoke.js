#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  VALIDATOR_RUNTIME_BUDGET_MS,
  appendLedger,
  discoverValidators,
  parseArgs,
  verifyRelayAuth,
} = require('./nightly-validation-ledger');
const { collectAppVersions } = require('./app-version-inventory');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const expectedAppHarnesses = [
  'antigravity-v2', 'claude', 'claude-cli', 'codex', 'codex-cli', 'codex-desktop',
  'cursor-cli', 'continue', 'cursor', 'gemini', 'roo_code',
];
const expectedValidators = [
  'antigravity-v2', 'claude-cli', 'claude', 'codex-cli', 'codex-desktop', 'codex', 'continue',
  'cursor-cli', 'cursor', 'native-golden-approval', 'performance-budgets', 'production-block-inventory',
  'production-overnight-runner', 'scheduled-send', 'visual-regression',
];

assert.deepEqual(discoverValidators().map(item => item.harness), expectedValidators);
for (const { script } of discoverValidators()) {
  const source = read(`tools/${script}`);
  assert(source.includes("'--read-only'"), `${script} must expose explicit --read-only mode`);
}

const cursor = read('tools/cursor-validate-all.js');
assert(cursor.includes('const scripts = readOnly ? readOnlyScripts : [...readOnlyScripts, ...liveScripts]'));
assert(cursor.includes('if (i < attempts - 1)'));
assert(cursor.includes('if (sendLive) {'));
const readOnlyStageSource = cursor.slice(
  cursor.indexOf('const readOnlyScripts = ['),
  cursor.indexOf('const liveScripts = ['),
);
assert(!readOnlyStageSource.includes('cursor-web-e2e.js'));
const cursorCliValidator = read('tools/cursor-cli-validate-all.js');
assert(cursorCliValidator.includes("...(readOnly ? ['--read-only'] : [])"));
const cursorCliParser = read('tools/cursor-cli-parser-smoke.js');
assert(cursorCliParser.includes('if (readOnly) {'));
assert(cursorCliParser.indexOf('if (readOnly) {') < cursorCliParser.indexOf("console.log('--- live send/resume ---')"));
const codexDesktopValidator = read('tools/codex-desktop-validate-all.js');
assert(codexDesktopValidator.includes('if (!readOnly) {'));
assert(codexDesktopValidator.includes("['notice, goal, queue, and action fixture'"));
assert(codexDesktopValidator.includes("...(!readOnly ? ['--allow-active'] : [])"));
const codexValidator = read('tools/codex-validate-all.js');
assert(codexValidator.includes("['live updated extension passive probe'"));
assert(codexValidator.includes("['tools/codex-vscode-readonly-update-e2e.js', '--read-only']"));
const codexUpdateProbe = read('tools/codex-vscode-readonly-update-e2e.js');
assert(codexUpdateProbe.includes('transcript_content_captured: false'));
assert(codexUpdateProbe.includes('focus_actions: 0'));

const parsed = parseArgs(['--no-publish', '--only', 'cursor,codex-cli', '--timeout-ms', '5000']);
assert.equal(parsed.publish, false);
assert.deepEqual(parsed.only, ['cursor', 'codex-cli']);
assert.equal(parsed.timeoutMs, 5000);
assert.equal(VALIDATOR_RUNTIME_BUDGET_MS, 60000);
assert.equal(parseArgs([]).timeoutMs, VALIDATOR_RUNTIME_BUDGET_MS);
assert.equal(parseArgs(['--timeout-ms', '120000']).timeoutMs, VALIDATOR_RUNTIME_BUDGET_MS,
  'read-only validator budget must not be raised above 60 seconds');
assert.equal(parseArgs(['--auth-only']).authOnly, true);
assert(read('tools/nightly-validation-ledger.js').includes('runtime_budget_ms: timeoutMs'));
assert(read('tools/nightly-validation-ledger.js').includes("budget_exhausted: status === 'timed_out'"));
assert(read('tools/nightly-validation-ledger.js').includes('attempt <= 3'));

const mockHeaders = location => ({ get: name => name.toLowerCase() === 'location' ? location : null });
const authResponses = [
  { status: 302, headers: mockHeaders('/auth/google') },
  { status: 200, headers: mockHeaders(null), text: async () => '<div id="root"></div>' },
];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-nightly-ledger-'));
const ledger = path.join(temp, 'ledger.jsonl');
appendLedger(ledger, { harness: 'fixture', status: 'pass' });
assert.deepEqual(JSON.parse(fs.readFileSync(ledger, 'utf8')), { harness: 'fixture', status: 'pass' });

const versions = collectAppVersions();
assert.deepEqual(Object.keys(versions), expectedAppHarnesses);
for (const harness of expectedAppHarnesses) {
  assert.equal(typeof versions[harness], 'string');
  assert(versions[harness].length > 0, `missing version result for ${harness}`);
}

const relay = read('relay-server/index.js');
for (const marker of [
  'CREATE TABLE IF NOT EXISTS nightly_validation_status',
  "app.get('/api/maintenance/validation', requireAnyAuth",
  "app.put('/api/maintenance/validation', requireAnyAuth",
  "type: 'nightly_validation_status'",
  'nightly_validation_failures: nightlyValidationFailures',
]) assert(relay.includes(marker), `missing relay marker: ${marker}`);
const allowlistStart = relay.indexOf('const NIGHTLY_VALIDATION_HARNESSES = new Set([');
const allowlistEnd = relay.indexOf(']);', allowlistStart);
assert(allowlistStart >= 0 && allowlistEnd > allowlistStart, 'nightly validation allowlist not found');
const allowlistSource = relay.slice(allowlistStart, allowlistEnd);
const relayAllowlist = [...allowlistSource.matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepEqual(relayAllowlist, expectedValidators,
  'relay nightly validation allowlist must exactly match discovered validators');

const webHooks = read('frontend/hooks.jsx');
const webApp = read('frontend/app.jsx');
const android = read('android-app/screens/SessionListScreen.jsx');
for (const source of [webHooks, webApp, android]) {
  assert(source.includes('nightlyValidationFailures'));
}
assert(webApp.includes('Nightly validation failed.'));
assert(android.includes('Nightly validation failed'));

const installer = read('install-nightly-validation-task.ps1');
const launcher = read('nightly-validation-hidden.vbs');
assert(installer.includes('-MultipleInstances IgnoreNew'));
assert(installer.includes('wscript.exe'));
assert(launcher.includes('shell.Run(command, 0, True)'));

assert(read('protocol.md').includes('## Nightly Validation Status API'));

verifyRelayAuth({ origin: 'http://fixture', token: 'fixture-token' }, 'fixture-run', async () => authResponses.shift())
  .then(entry => {
    assert.equal(entry.status, 'pass');
    assert.equal(entry.kind, 'nightly_auth_gate');
  })
  .catch(error => { throw error; });

console.log(JSON.stringify({
  ok: true,
  harnesses: expectedAppHarnesses,
  validators: expectedValidators,
  versions,
  append_only_ledger: true,
  explicit_read_only_modes: true,
  hidden_scheduled_task: true,
  relay_persistence_and_broadcast: true,
  web_warning: true,
  android_warning: true,
  relay_auth_ledger_gate: true,
}, null, 2));
