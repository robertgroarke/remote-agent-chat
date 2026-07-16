'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');
const { pruneDirectory } = require('../relay-server/storage-retention');
const { appendBoundedFileSync } = require('../agent-proxy/bounded-file-log');
const { MessageDeltaGate } = require('../relay-server/message-delta');
const { SendLifecycleTracker } = require('../relay-server/send-lifecycle');
const { UsageThresholdTracker } = require('../relay-server/usage-thresholds');
const { ProviderUsageAuthority } = require('../relay-server/provider-usage-authority');
const { createPrincipalWindowLimiter } = require('../relay-server/request-security');
const { setBoundedMap } = require('../agent-proxy/bounded-map');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-storage-retention-'));

try {
  const uploads = path.join(tempRoot, 'uploads');
  fs.mkdirSync(uploads);
  const now = Date.now();
  for (let index = 0; index < 10; index += 1) {
    const filePath = path.join(uploads, `file-${index}.bin`);
    fs.writeFileSync(filePath, Buffer.alloc(100, index));
    const mtime = new Date(now - index * 1000);
    fs.utimesSync(filePath, mtime, mtime);
  }
  const sizeResult = pruneDirectory(uploads, { now, maxBytes: 350, maxFiles: 10 });
  assert.equal(sizeResult.retained, 3);
  assert(sizeResult.retainedBytes <= 350);
  assert.deepStrictEqual(fs.readdirSync(uploads).sort(), ['file-0.bin', 'file-1.bin', 'file-2.bin']);

  const expiredPath = path.join(uploads, 'expired.bin');
  fs.writeFileSync(expiredPath, 'old');
  const expiredAt = new Date(now - 10_000);
  fs.utimesSync(expiredPath, expiredAt, expiredAt);
  const ageResult = pruneDirectory(uploads, { now, maxAgeMs: 5_000, maxBytes: 1000, maxFiles: 10 });
  assert.equal(fs.existsSync(expiredPath), false);
  assert(ageResult.removed >= 1);

  const diagnosticLog = path.join(tempRoot, 'diagnostic.log');
  for (let index = 0; index < 20; index += 1) appendBoundedFileSync(diagnosticLog, Buffer.alloc(300, index), 1024);
  assert(fs.statSync(diagnosticLog).size <= 1024);
  assert(fs.statSync(`${diagnosticLog}.1`).size <= 512);

  const bundlePath = path.join(tempRoot, 'hooks.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(root, 'frontend', 'hooks.jsx')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  global.React = { useState() {}, useEffect() {}, useRef() {}, useCallback() {} };
  const { boundedRecordWith, CLIENT_RUNTIME_RECORD_LIMIT } = require(bundlePath);
  let record = {};
  for (let index = 0; index < 1000; index += 1) record = boundedRecordWith(record, `key-${index}`, index);
  assert.equal(Object.keys(record).length, CLIENT_RUNTIME_RECORD_LIMIT);
  assert.equal(record['key-999'], 999);
  assert.equal(record['key-0'], undefined);

  const stateSequenceBundle = path.join(tempRoot, 'state-sequence.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(root, 'frontend', 'state-sequence.js')],
    bundle: true, platform: 'node', format: 'cjs', outfile: stateSequenceBundle, logLevel: 'silent',
  });
  const { createStateSequenceGate } = require(stateSequenceBundle);
  const sequenceGate = createStateSequenceGate();
  for (let index = 0; index < 5000; index += 1) {
    sequenceGate.accept({ state_epoch: 'epoch', state_seq: index }, `session-${index}`);
  }
  assert.equal(sequenceGate.size(), 2048);

  const deltaGate = new MessageDeltaGate({ maxStreams: 16, ttlMs: 60_000 });
  for (let index = 0; index < 100; index += 1) {
    deltaGate.accept({
      type: 'message_delta', session_id: `session-${index}`, message_id: `message-${index}`,
      block_index: 0, seq: 0, op: 'block_open', role: 'assistant',
    });
  }
  assert.equal(deltaGate.streams.size, 16);

  let lifecycleNow = 0;
  const lifecycle = new SendLifecycleTracker({ now: () => lifecycleNow, maxSessions: 16, maxPendingMs: 1000 });
  for (let index = 0; index < 100; index += 1) {
    lifecycle.markProxyResult({ session_id: `session-${index}`, client_message_id: `client-${index}`, result: 'delivered' });
    lifecycleNow += 1;
  }
  assert.equal(lifecycle.pending.size, 16);
  lifecycleNow += 2000;
  lifecycle.prune();
  assert.equal(lifecycle.pending.size, 0);

  const thresholds = new UsageThresholdTracker({ maxEntries: 16 });
  for (let index = 0; index < 100; index += 1) thresholds.observe(`cycle-${index}`, { percentUsed: 1 });
  assert.equal(thresholds.sessions.size, 16);

  const authority = new ProviderUsageAuthority({ maxIdentities: 8 });
  for (let index = 0; index < 20; index += 1) {
    authority.observe({ snapshots: [{
      provider_id: `provider-${index}`, account_fingerprint: `account-${index}`,
      quota_domain: 'test', status: 'fresh', stale_after: new Date(Date.now() + 60_000).toISOString(),
      mapped_harness_types: ['codex'], windows: [{ id: 'window', used_percent: 1 }],
    }] }, new Map([['session', { agent_type: 'codex' }]]));
  }
  assert.equal(authority.cyclesByIdentity.size, 8);

  const limiter = createPrincipalWindowLimiter({ limit: 2, windowMs: 60_000, maxPrincipals: 16 });
  for (let index = 0; index < 100; index += 1) limiter.consume(`principal-${index}`);
  assert.equal(limiter.size(), 16);

  const archiveCache = new Map();
  for (let index = 0; index < 100; index += 1) setBoundedMap(archiveCache, `archive-${index}`, index, 32);
  assert.equal(archiveCache.size, 32);
  assert.equal(archiveCache.get('archive-99'), 99);

  const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
  const proxySource = fs.readFileSync(path.join(root, 'agent-proxy', 'proxy-engine.js'), 'utf8');
  const claudeCliSource = fs.readFileSync(path.join(root, 'agent-proxy', 'claude-cli.js'), 'utf8');
  const cursorCliSource = fs.readFileSync(path.join(root, 'agent-proxy', 'cursor-cli.js'), 'utf8');
  const codexCliSource = fs.readFileSync(path.join(root, 'agent-proxy', 'codex-cli.js'), 'utf8');
  const deploySource = fs.readFileSync(path.join(root, 'tools', 'rebuild_unraid_docker.py'), 'utf8');
  const rescueDeploySource = fs.readFileSync(path.join(root, 'tools', 'deploy_rescue.py'), 'utf8');
  const proxyLauncherSource = fs.readFileSync(path.join(root, 'restart-proxy.bat'), 'utf8');
  const rescueLauncherSource = fs.readFileSync(path.join(root, 'restart-rescue-proxy.bat'), 'utf8');
  assert(relaySource.includes('runUploadMaintenance()') && relaySource.includes('RAC_HISTORY_BACKUP_MAX_FILES'));
  assert(relaySource.includes('journal_size_limit = ${SQLITE_JOURNAL_SIZE_LIMIT_BYTES}'));
  assert(relaySource.includes('pruneRuntimeRequestState') && relaySource.includes('clearSessionAuxiliaryState'));
  assert(proxySource.includes('_runLocalUploadMaintenance()'));
  assert(proxySource.includes('_continueRemotePollInProgress'));
  assert([claudeCliSource, cursorCliSource, codexCliSource].every(source => source.includes('setBoundedMap')));
  assert(deploySource.includes('--log-opt max-size=10m --log-opt max-file=3'));
  assert(rescueDeploySource.includes('--log-opt max-size=10m --log-opt max-file=3'));
  assert(!proxyLauncherSource.includes('>>') && !rescueLauncherSource.includes('>>'));

  console.log(JSON.stringify({
    ok: true,
    upload_byte_ceiling: true,
    upload_age_retention: true,
    diagnostic_log_ceiling: true,
    relay_backup_count_ceiling: true,
    sqlite_wal_ceiling: true,
    docker_log_rotation: true,
    browser_runtime_record_limit: CLIENT_RUNTIME_RECORD_LIMIT,
    relay_runtime_map_limits: true,
    proxy_upload_retention: true,
    cli_archive_cache_limits: true,
    non_overlapping_fast_poll: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
