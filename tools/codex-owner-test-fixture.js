'use strict';

const fs = require('fs');
const path = require('path');
const {
  markRegistryAuthorityReady,
  rolloutFileIdentity,
  updateOwnerRegistry,
} = require('../shared/codex-live-owner-registry');

function createReadyOwnerRegistry(root, options = {}) {
  const registryPath = path.join(root, options.name || 'codex-owner-registry.json');
  const authorityFile = path.join(root, options.authorityFile || 'owner-authority.json');
  if (!fs.existsSync(authorityFile)) fs.writeFileSync(authorityFile, '{}\n', 'utf8');
  const nowMs = Number(options.nowMs) || Date.now();
  updateOwnerRegistry(registryPath, registry => registry, { nowMs });
  markRegistryAuthorityReady({
    producer_id: 'owned-test-fixture',
    producer_pid: process.pid,
    process_epoch: options.processEpoch || 'owned-test-fixture-epoch',
    manifest_path: authorityFile,
    manifest_identity: rolloutFileIdentity(authorityFile),
    runtime_generation: 'owned-test-fixture',
    scanned_lineages: Number(options.scannedLineages) || 0,
    proof: 'owned_disposable_fixture',
  }, { registryPath, nowMs });
  return registryPath;
}

module.exports = { createReadyOwnerRegistry };
