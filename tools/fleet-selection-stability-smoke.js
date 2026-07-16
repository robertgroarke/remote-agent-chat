#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
const fleetActivitySource = fs.readFileSync(path.join(ROOT, 'frontend', 'fleet-activity.js'), 'utf8');
const fleetActivity = vm.runInNewContext(`(() => {
  ${fleetActivitySource.replace(/^export\s+/gm, '')}
  return { classifyFleetActivity };
})()`);
const start = app.indexOf('function reconcileFleetSelection');
const end = app.indexOf('function FleetView', start);
assert(start >= 0 && end > start, 'unable to isolate reconcileFleetSelection');
const source = app.slice(start, end);
const reconcile = vm.runInNewContext(`(${source.trim()})`);

const empty = [];
assert.strictEqual(reconcile(empty, {}, 5), empty, 'empty Fleet selection must preserve reference identity');

const stable = ['alpha', 'beta'];
const eligible = {
  alpha: { canReceiveBroadcast: true },
  beta: { canReceiveBroadcast: true },
};
assert.strictEqual(reconcile(stable, eligible, 5), stable,
  'unchanged eligible selection must not schedule a React state update');

const filtered = reconcile(stable, {
  alpha: { canReceiveBroadcast: true },
  beta: { canReceiveBroadcast: false },
}, 5);
assert.notStrictEqual(filtered, stable, 'changed selection must produce a new array');
assert.deepStrictEqual([...filtered], ['alpha']);

const bounded = ['a', 'b', 'c'];
const boundedResult = reconcile(bounded, {
  a: { canReceiveBroadcast: true },
  b: { canReceiveBroadcast: true },
  c: { canReceiveBroadcast: true },
}, 2);
assert.deepStrictEqual([...boundedResult], ['a', 'b']);

assert(app.includes('setSelectedIds(previous => reconcileFleetSelection(previous, entryById));'),
  'Fleet mount must use the reference-stable reconciler');
assert(app.includes('selectedIds.every(id => entryById[id]?.canReceiveBroadcast)) return;'),
  'Fleet must skip the selection setter when every selected session remains eligible');
assert(app.includes('if (Object.keys(broadcastReceipts).length === 0) return;'),
  'Fleet must skip receipt reconciliation when no broadcast receipts exist');
const staleAt = new Date(Date.now() - 60_000).toISOString();
const freshnessOptions = { requireFreshness: true, connected: true, health: 'healthy', freshnessMs: 15_000 };
assert.strictEqual(fleetActivity.classifyFleetActivity({ kind: 'idle', updated_at: staleAt }, false, freshnessOptions), 'idle',
  'an explicit settled idle state must not become stale and reappear in the default Fleet view');
assert.strictEqual(fleetActivity.classifyFleetActivity({ kind: 'working', updated_at: staleAt }, false, freshnessOptions), 'stale',
  'freshness must continue to fail closed for unsupported active-work claims');
assert.strictEqual(fleetActivity.classifyFleetActivity({ kind: 'working', goal: { state: 'complete' }, updated_at: staleAt }, false, freshnessOptions), 'idle',
  'a terminal goal must stay idle after the freshness window');
console.log('PASS Fleet selection identity and stale-idle classification contracts');
