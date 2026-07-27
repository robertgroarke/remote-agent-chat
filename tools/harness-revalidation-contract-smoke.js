#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { collectAppVersions } = require('./app-version-inventory');
const { loadProgram, programCoverage } = require('../agent-proxy/harness-revalidation');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const program = loadProgram();
const versions = collectAppVersions();
const coverage = programCoverage(program, versions);
assert.equal(coverage.ok, true, JSON.stringify(coverage.matrix.filter(row => row.issues.length)));
assert(coverage.matrix.length >= 12, 'every tracked/supported harness needs a matrix row');
for (const row of coverage.matrix) {
  assert(row.fixture && row.tier1 && row.tier2 && row.capability_gating,
    `${row.harness} has an empty coverage cell`);
}
const codexDesktopFixture = JSON.parse(read(program.harnesses['codex-desktop'].fixture));
assert.equal(codexDesktopFixture.installed_version, versions['codex-desktop']);
assert.equal(codexDesktopFixture.reader_contract?.unit_selector, '[data-content-search-unit-key]');
assert.equal(typeof codexDesktopFixture.reader_contract?.active_thread_required, 'boolean');
if (codexDesktopFixture.reader_contract.active_thread_required) {
  assert(Number(codexDesktopFixture.reader_contract?.observed_roles?.user) > 0,
    'an active Codex Desktop fixture must prove readable native user units');
} else {
  const threadList = codexDesktopFixture.thread_list_contract;
  assert.equal(codexDesktopFixture.reader_contract?.idle_surface_valid, true,
    'an idle Codex Desktop fixture must explicitly declare the no-thread-selected state');
  assert(Number(threadList?.observed_rows) > 0,
    'an idle Codex Desktop fixture must still prove readable native thread rows');
  assert.equal(threadList?.stable_ids, threadList?.observed_rows,
    'every idle Codex Desktop thread row must retain a stable ID');
  assert.equal(threadList?.visible_titles, threadList?.observed_rows,
    'every idle Codex Desktop thread row must retain a visible title');
  assert.equal(threadList?.active_rows, 0,
    'the exact-version idle fixture must not fabricate an active thread');
}

const sentinel = read('tools/app-update-drift-sentinel.js');
assert(sentinel.includes('beginRevalidation(programState')
  && sentinel.indexOf('beginRevalidation(programState') < sentinel.indexOf('executeValidator('),
'sentinel must persist pending before invoking validation');
assert(sentinel.includes('validation_transition = `validated ${change.harness}'));

const proxy = read('agent-proxy/proxy-engine.js');
assert(proxy.includes('applyWriteCapabilityGate(capabilities, agentType)'));
assert(proxy.includes("code: 'pending_revalidation'"));
assert(proxy.includes("proto.proxySendResult(sessionId, msg.client_message_id, 'failed', { error })"),
  'write fail-close must preserve the structured revalidation error');
const policy = read('agent-proxy/harness-revalidation.js');
assert(policy.includes('read_only_due_to_revalidation'));
assert(policy.includes('WRITE_COMMANDS'));

const relay = read('relay-server/index.js');
assert(relay.includes('harness_revalidation_status'));
assert(relay.includes('revalidation_program_health'));
assert(relay.includes('metadata_json'));

const web = read('frontend/app.jsx');
const android = `${read('android-app/screens/SessionListScreen.jsx')}\n${read('android-app/screens/ChatScreen.jsx')}`;
for (const source of [web, android]) {
  assert(source.includes('Harness validation'));
  assert(source.includes('Harness writes paused'));
  assert(source.includes('next_tier2_at'));
}

const launcher = read('harness-revalidation-weekly-hidden.vbs');
const installer = read('install-harness-revalidation-task.ps1');
assert(launcher.includes('shell.Run command, 0, True'), 'weekly launcher must be hidden and blocking');
assert(installer.includes('MultipleInstances IgnoreNew') && installer.includes("-Daily -At '3:15AM'"));

console.log(JSON.stringify({
  ok: true,
  coverage_rows: coverage.matrix.length,
  tracked_versions: Object.keys(versions).length,
  no_empty_cells: true,
  pending_before_validation: true,
  proxy_write_fail_close: true,
  web_android_health_views: true,
  hidden_weekly_schedule: true,
}, null, 2));
