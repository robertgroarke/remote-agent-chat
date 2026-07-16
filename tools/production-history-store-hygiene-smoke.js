#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const skipBackup = args.includes('--skip-backup');

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert(token, 'JWT bearer token could not be built');

  const anonymous = await fetch(`${origin}/api/maintenance/history`, { cache: 'no-store' });
  assert.equal(anonymous.status, 401);
  const statsResponse = await fetch(`${origin}/api/maintenance/history?retention_days=90`, { headers, cache: 'no-store' });
  const statsBody = await statsResponse.json();
  assert.equal(statsResponse.status, 200);
  for (const key of ['db_bytes', 'wal_bytes', 'message_count', 'session_count', 'inactive_candidate_sessions'])
    assert.equal(typeof statsBody.stats[key], 'number', `stats.${key} must be numeric`);

  const rejectedPrune = await fetch(`${origin}/api/maintenance/history/prune`, {
    method: 'POST', headers, body: JSON.stringify({ retention_days: 90, confirm: 'NO' }),
  });
  assert.equal(rejectedPrune.status, 400, 'prune without exact confirmation must fail');

  let backup = null;
  let backupReused = false;
  if (!skipBackup) {
    const backupResponse = await fetch(`${origin}/api/maintenance/history/backup`, {
      method: 'POST', headers, body: JSON.stringify({ reuse_recent: true }),
    });
    assert([200, 202].includes(backupResponse.status));
    let backupBody = await backupResponse.json();
    const deadline = Date.now() + 15 * 60 * 1000;
    while (backupBody.job?.status === 'running' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const statusResponse = await fetch(`${origin}/api/maintenance/history/backup`, { headers, cache: 'no-store' });
      backupBody = await statusResponse.json();
    }
    assert.equal(backupBody.job?.status, 'complete', 'background backup must complete');
    backup = backupBody.job.backup;
    backupReused = !!backupBody.job.reused;
    assert(backup.bytes > 0, 'backup must contain bytes');
    assert.match(backup.path, /^\/data\/backups\/messages-/);
  }

  const result = {
    ok: true,
    anonymous_status: anonymous.status,
    stats: statsBody.stats,
    policy: statsBody.policy,
    rejected_unconfirmed_prune_status: rejectedPrune.status,
    backup,
    backup_reused: backupReused,
    backup_skipped: skipBackup,
    production_prune_invoked: false,
    generated_at: new Date().toISOString(),
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error('production history-store hygiene smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
