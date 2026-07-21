#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertCanonicalRegistryReady,
  assertProxyLineageAvailable,
  buildProxyAppServerOwner,
} = require('../agent-proxy/codex-live-owner');
const {
  acquireLineageLease,
  clearLiveOwner,
  markRegistryAuthorityReady,
  publishLiveOwner,
  releaseLineageLease,
  rolloutFileIdentity,
  updateOwnerRegistry,
} = require('../shared/codex-live-owner-registry');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-proxy-owner-'));
const registryPath = path.join(root, 'owners.json');
const rolloutPath = path.join(root, 'rollout.jsonl');
const sessionId = '019f7333-1111-7111-8111-111111111111';
const nowMs = Date.now();
const stamp = new Date(nowMs).toISOString();
fs.writeFileSync(rolloutPath, '{"type":"session_meta"}\n', 'utf8');

assert.throws(
  () => assertCanonicalRegistryReady({ registryPath, nowMs }),
  error => error.code === 'codex_owner_registry_missing',
);
updateOwnerRegistry(registryPath, registry => registry, { nowMs });
assert.throws(
  () => assertCanonicalRegistryReady({ registryPath, nowMs }),
  error => error.code === 'codex_owner_registry_not_ready',
);
markRegistryAuthorityReady({
  producer_id: 'proxy-owner-smoke',
  producer_pid: process.pid,
  process_epoch: 'proxy-owner-smoke-epoch',
  manifest_path: rolloutPath,
  manifest_identity: rolloutFileIdentity(rolloutPath),
  runtime_generation: 'smoke',
  scanned_lineages: 1,
  proof: 'fixture_process_inventory',
}, { registryPath, nowMs });
assert.equal(assertProxyLineageAvailable(sessionId, { registryPath, nowMs }).state, 'none');
assert.equal(assertProxyLineageAvailable(null, { registryPath, nowMs }).state, 'new_thread');

const interactive = publishLiveOwner({
  session_id: sessionId,
  owner_id: 'interactive_tui:61001:fixture',
  owner_kind: 'interactive_tui',
  state: 'active',
  root_pid: 61001,
  native_pid: 61002,
  connection_id: null,
  rac_session_id: null,
  thread_id: sessionId,
  turn_id: null,
  process_epoch: 'fixture-interactive',
  rollout_path: fs.realpathSync(rolloutPath),
  rollout_identity: rolloutFileIdentity(rolloutPath),
  logical_name: 'fixture',
  started_at: stamp,
  heartbeat_at: stamp,
  terminal_at: null,
  proof: 'fixture_exact_resume_uuid',
}, { registryPath, nowMs });
assert.throws(
  () => assertProxyLineageAvailable(sessionId, { registryPath, nowMs }),
  error => error.code === 'codex_lineage_owned' && error.reason === 'interactive_tui_active',
);
clearLiveOwner(sessionId, interactive.owner_id, { registryPath, processEpoch: interactive.process_epoch, nowMs });

const lease = acquireLineageLease(sessionId, {
  registryPath,
  nowMs,
  leaseId: 'shortcut-fixture-lease',
  holderId: 'shortcut-fixture',
  holderPid: 62001,
});
assert.throws(
  () => assertProxyLineageAvailable(sessionId, { registryPath, nowMs }),
  error => error.code === 'codex_lineage_lease_active',
);
assert.equal(assertProxyLineageAvailable(sessionId, {
  registryPath,
  nowMs,
  leaseId: lease.lease_id,
}).state, 'none');
releaseLineageLease(sessionId, lease.lease_id, { registryPath, nowMs });

const owner = buildProxyAppServerOwner({
  threadId: sessionId,
  turnId: 'turn-fixture-1',
  racSessionId: 'rac-session-fixture',
  processEpoch: 'proxy-process-epoch',
  connectionId: 'connection-fixture',
  rootPid: 63001,
  nativePid: 63002,
  rolloutPath,
  logicalName: 'fixture',
  now: new Date(nowMs),
});
assert.equal(owner.owner_kind, 'proxy_app_server');
assert.equal(owner.rac_session_id, 'rac-session-fixture');
assert.equal(owner.thread_id, sessionId);
assert.equal(owner.turn_id, 'turn-fixture-1');

console.log(JSON.stringify({
  result: 'PASS',
  missing_registry_failed_closed: true,
  not_ready_registry_failed_closed: true,
  interactive_owner_failed_closed: true,
  foreign_lease_failed_closed: true,
  exact_thread_turn_epoch_owner: true,
  protected_sessions_touched: 0,
  goal_mutations: 0,
  visible_windows_opened: 0,
}, null, 2));
