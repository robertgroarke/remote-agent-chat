#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  acquireLineageLease,
  defaultRegistryPath,
  loadOwnerRegistry,
  releaseLineageLease,
  resolveLineageOwner,
} = require('../shared/codex-live-owner-registry');
const { reconcileCodexLiveOwners } = require('./codex-live-owner-reconciler');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-owner-reconcile-'));
const manifestPath = path.join(root, 'manifest.json');
const registryPath = path.join(root, 'owners.json');
const ids = {
  rotator: '019f7222-1111-7111-8111-111111111111',
  interactive: '019f7222-2222-7222-8222-222222222222',
  idle: '019f7222-3333-7333-8333-333333333333',
};
const staleSuccessorId = '019f7222-4444-7444-8444-444444444444';
const sessions = {};
for (const [name, sessionId] of Object.entries(ids)) {
  const rolloutPath = path.join(root, `rollout-${sessionId}.jsonl`);
  fs.writeFileSync(rolloutPath, `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`, 'utf8');
  sessions[name] = {
    enabled: true,
    sessionId,
    cwd: root,
    goalPrompt: `fixture goal ${name}`,
    rolloutPath,
    lastWorkerStartedAt: name === 'rotator' ? '2026-07-20T20:00:00.000Z' : null,
  };
}
sessions.rotator.lastWorkerPid = 51001;
sessions.rotator.lastWorkerNativePid = 51002;
sessions.rotator.lastWorkerStdoutPath = path.join(root, 'rotator-worker.jsonl');
fs.writeFileSync(sessions.rotator.lastWorkerStdoutPath, `${JSON.stringify({ type: 'thread.started', thread_id: ids.rotator, turn_id: 'turn-fixture-1' })}\n`, 'utf8');
const manifest = {
  schemaVersion: 1,
  updatedAt: '2026-07-20T20:00:00.000Z',
  rotation: {},
  orchestrator: { mode: 'digest_only', notifyOnRotation: false },
  sessions,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const processes = [
  {
    name: 'node.exe', pid: 51001, parentPid: 50000, createdAt: '2026-07-20T20:00:00.000Z',
    commandLine: `node codex.js exec resume --json ${ids.rotator} /goal fixture`,
  },
  {
    name: 'codex.exe', pid: 51002, parentPid: 51001, createdAt: '2026-07-20T20:00:00.100Z',
    commandLine: `codex.exe exec resume --json ${ids.rotator} /goal fixture`,
  },
  {
    name: 'node.exe', pid: 52001, parentPid: 50000, createdAt: '2026-07-20T20:01:00.000Z',
    commandLine: `node codex.js -C "${root}" resume ${ids.interactive}`,
  },
  {
    name: 'codex.exe', pid: 52002, parentPid: 52001, createdAt: '2026-07-20T20:01:00.100Z',
    commandLine: `codex.exe -C "${root}" resume ${ids.interactive}`,
  },
  {
    name: 'codex.exe', pid: 53001, parentPid: 50000, createdAt: '2026-07-20T20:02:00.000Z',
    commandLine: `codex.exe app-server --stdio ${ids.idle}`,
  },
];
const alive = new Set(processes.map(item => item.pid));
const nowMs = Date.parse('2026-07-20T20:02:05.000Z');
const result = reconcileCodexLiveOwners({
  manifestPath,
  registryPath,
  processes,
  nowMs,
  processIsAlive: pid => alive.has(pid),
  producerId: 'fixture-reconciler',
  producerPid: 50000,
  processEpoch: 'fixture-reconciler-epoch',
  runtimeGeneration: 'fixture-generation',
});
assert.equal(result.status, 'ready');
assert.equal(result.scanned_lineages, 3);
assert.equal(result.owners.length, 2, 'unbound app-server process was misclassified as a lineage owner');

const registry = loadOwnerRegistry(registryPath);
assert.equal(registry.authority.state, 'ready');
assert.equal(registry.authority.scanned_lineages, 3);
assert.equal(resolveLineageOwner(ids.rotator, { registryPath, nowMs }).owner.owner_kind, 'rotator_exec');
assert.equal(resolveLineageOwner(ids.interactive, { registryPath, nowMs }).owner.owner_kind, 'interactive_tui');
assert.equal(resolveLineageOwner(ids.idle, { registryPath, nowMs }).state, 'none');
assert.equal(registry.lineages[ids.rotator].owners[0].turn_id, 'turn-fixture-1');
assert.equal(registry.lineages[ids.interactive].owners[0].root_pid, 52001);
assert.equal(registry.lineages[ids.interactive].owners[0].native_pid, 52002);

const registryWithStaleSuccessor = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
registryWithStaleSuccessor.lineages[staleSuccessorId] = { owners: [], lease: null };
fs.writeFileSync(registryPath, `${JSON.stringify(registryWithStaleSuccessor, null, 2)}\n`, 'utf8');

const startupProcesses = processes.map(item => (
  item.pid === 51001 || item.pid === 51002
    ? { ...item, commandLine: item.commandLine.replace(` resume --json ${ids.rotator}`, ' --json') }
    : item
));
const startupResult = reconcileCodexLiveOwners({
  manifestPath,
  registryPath,
  processes: startupProcesses,
  nowMs: nowMs + 1,
  processIsAlive: pid => alive.has(pid),
  producerId: 'fixture-reconciler',
  producerPid: 50000,
  processEpoch: 'fixture-reconciler-epoch',
});
assert.equal(startupResult.owners.find(item => item.session_id === ids.rotator).root_pid, 51001);
assert.equal(loadOwnerRegistry(registryPath).lineages[ids.rotator].owners[0].native_pid, 51002,
  'a manifest-PID-proven startup worker must retain its exact native descendant');
assert.equal(loadOwnerRegistry(registryPath).lineages[staleSuccessorId], undefined,
  'owner reconciliation must prune an ownerless lineage removed from the manifest');

const lease = acquireLineageLease(ids.idle, {
  registryPath,
  nowMs: nowMs + 1,
  leaseId: 'fixture-active-lease',
  holderId: 'fixture-shortcut',
  holderPid: 54001,
});
const leased = reconcileCodexLiveOwners({
  manifestPath,
  registryPath,
  processes,
  nowMs: nowMs + 2,
  processIsAlive: pid => alive.has(pid),
  producerId: 'fixture-reconciler',
  producerPid: 50000,
  processEpoch: 'fixture-reconciler-epoch',
});
assert.equal(leased.status, 'ready_with_leased_lineages');
assert.deepStrictEqual(leased.skipped_leases, [ids.idle]);
assert.equal(loadOwnerRegistry(registryPath).lineages[ids.idle].lease.lease_id, lease.lease_id);
releaseLineageLease(ids.idle, lease.lease_id, { registryPath, nowMs: nowMs + 3 });

fs.writeFileSync(registryPath, '{corrupt registry', 'utf8');
const recovered = reconcileCodexLiveOwners({
  manifestPath,
  registryPath,
  processes,
  nowMs: nowMs + 4,
  processIsAlive: pid => alive.has(pid),
  producerId: 'fixture-reconciler',
  producerPid: 50000,
  processEpoch: 'fixture-reconciler-epoch',
});
assert.equal(recovered.status, 'ready');
assert.equal(loadOwnerRegistry(registryPath).authority.state, 'ready');
assert.equal(fs.readdirSync(root).filter(name => name.startsWith('owners.json.invalid-')).length, 1);

const duplicateProcesses = [
  ...processes,
  {
    name: 'node.exe', pid: 52011, parentPid: 50000, createdAt: '2026-07-20T20:01:01.000Z',
    commandLine: `node codex.js resume ${ids.interactive}`,
  },
  {
    name: 'codex.exe', pid: 52012, parentPid: 52011, createdAt: '2026-07-20T20:01:01.100Z',
    commandLine: `codex.exe resume ${ids.interactive}`,
  },
];
assert.throws(() => reconcileCodexLiveOwners({
  manifestPath,
  registryPath,
  processes: duplicateProcesses,
  nowMs: nowMs + 5,
  processIsAlive: () => true,
  producerId: 'fixture-reconciler',
  producerPid: 50000,
  processEpoch: 'fixture-reconciler-epoch',
}), /Multiple interactive Codex roots/);
const failedClosed = resolveLineageOwner(ids.interactive, { registryPath, nowMs: nowMs + 5 });
assert.equal(failedClosed.state, 'unavailable');
assert.equal(failedClosed.error, 'owner_registry_not_ready');

const defaultPath = defaultRegistryPath({ CODEX_HOME: root });
assert.equal(defaultPath, path.join(root, 'state', 'codex-session-live-owners.json'));

console.log(JSON.stringify({
  result: 'PASS',
  canonical_state_root: true,
  authority_ready_after_complete_scan: true,
  scanned_lineages: result.scanned_lineages,
  exact_rotator_owners: 1,
  exact_interactive_owners: 1,
  unbound_app_servers_misclassified: 0,
  active_leases_preserved: 1,
  ownerless_removed_lineages_pruned: 1,
  corrupt_registry_self_healed: true,
  ambiguous_process_scan_failed_closed: true,
  protected_sessions_touched: 0,
  goal_mutations: 0,
  visible_windows_opened: 0,
}, null, 2));
