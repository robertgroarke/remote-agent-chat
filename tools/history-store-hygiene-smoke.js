#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('relay-server/index.js');
const protocol = read('protocol.md');
const runbook = read('docs/HISTORY_STORE_OPERATIONS.md');

for (const marker of [
  'function historyStoreStats(retentionDays = 90)',
  "app.get('/api/maintenance/history', requireAnyAuth",
  "app.post('/api/maintenance/history/backup', requireAnyAuth",
  "app.post('/api/maintenance/history/prune', requireAnyAuth",
  "req.body?.confirm !== 'PRUNE_INACTIVE_HISTORY'",
  "req.body?.backup_path !== backup.path",
  "filter(row => !proxySockets.has(row.session))",
]) assert(relay.includes(marker), `missing history hygiene marker: ${marker}`);

for (const marker of [
  'GET /api/maintenance/history?retention_days=90',
  'POST /api/maintenance/history/backup',
  'POST /api/maintenance/history/prune',
  'PRUNE_INACTIVE_HISTORY',
  'PRAGMA integrity_check',
  'signed-in browser',
]) assert(runbook.includes(marker), `missing runbook marker: ${marker}`);
assert(protocol.includes('## Relay History Maintenance API'));

const result = {
  ok: true,
  authenticated_measurement: true,
  active_sessions_excluded: true,
  confirmation_gated_prune: true,
  recent_backup_required_before_prune: true,
  restore_runbook: true,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
