#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { withDiscoveryRetry } = require('./codex-desktop-readonly-controls-e2e');

async function main() {
  let attempts = 0;
  const recovered = await withDiscoveryRetry(async attempt => {
    attempts++;
    if (attempt === 1) throw new Error('transient session snapshot missing');
    return { marker: 'connected' };
  }, 2, 0);
  assert.equal(attempts, 2);
  assert.equal(recovered.marker, 'connected');
  assert.equal(recovered.discovery_attempts, 2);
  assert.deepEqual(recovered.discovery_failures, ['transient session snapshot missing']);

  await assert.rejects(
    () => withDiscoveryRetry(async attempt => {
      throw new Error(`missing-${attempt}`);
    }, 2, 0),
    error => /failed after 2 attempt\(s\): missing-1 \| missing-2/.test(error.message),
  );

  console.log(JSON.stringify({
    ok: true,
    transient_failure_retried: true,
    attempts_to_recover: recovered.discovery_attempts,
    exhaustion_is_fatal: true,
  }, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

module.exports = { main };
