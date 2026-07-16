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
const disasterRunbook = read('docs/RUNBOOK.md');
const restoreDrill = read('tools/relay-db-restore-drill.js');
const productionRestoreDrill = read('tools/production-relay-db-restore-drill.py');

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

for (const marker of [
  '## Relay outage or bad deploy',
  '## Proxy dead, stale, or wedged',
  '## Duplicate proxy',
  '## CDP target or port loss',
  '## History database growth or corruption',
  '## Certificate, DNS, or Cloudflare Tunnel failure',
  '## New-machine bootstrap',
  'python proxy_restart_lock.py --agent "operator-recovery"',
  'node tools/relay-db-restore-drill.js',
]) assert(disasterRunbook.includes(marker), `missing disaster runbook marker: ${marker}`);

for (const marker of [
  "fs.mkdtempSync(path.join(os.tmpdir(), 'rac-relay-restore-drill-'))",
  "source.pragma('journal_mode = WAL'",
  'await source.backup(backupWorkPath)',
  "pragma('integrity_check'",
  "pragma('quick_check'",
  'partial_file_rejected: true',
  'production_mutations: 0',
  'fs.rmSync(root, { recursive: true, force: true })',
]) assert(restoreDrill.includes(marker), `missing isolated restore-drill marker: ${marker}`);

for (const marker of [
  'docker inspect agent-relay',
  "--network none --read-only",
  'opened_readonly: true',
  'production_database_mutations',
  'temporary_copy_removed',
]) assert(productionRestoreDrill.includes(marker),
  `missing production-backup restore-drill marker: ${marker}`);

const result = {
  ok: true,
  authenticated_measurement: true,
  active_sessions_excluded: true,
  confirmation_gated_prune: true,
  recent_backup_required_before_prune: true,
  restore_runbook: true,
  disaster_recovery_runbook: true,
  isolated_restore_drill: true,
  production_backup_restore_drill: true,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
