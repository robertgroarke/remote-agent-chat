#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  hostCandidatesForPort,
  listCdpTargets,
  connectCdpTarget,
} = require('../agent-proxy/cdp-loopback');

async function main() {
  assert.deepEqual(
    hostCandidatesForPort(9225, null, {}),
    ['::1', '127.0.0.1'],
    'Codex Desktop must probe IPv6 and then IPv4 loopback',
  );
  assert.deepEqual(
    hostCandidatesForPort(9225, null, { CODEX_DESKTOP_CDP_HOST: '127.0.0.1' }),
    ['127.0.0.1'],
    'explicit Codex Desktop host must remain authoritative',
  );
  assert.deepEqual(
    hostCandidatesForPort(9223, null, {}),
    [null],
    'other CDP surfaces must preserve the library default',
  );
  assert.throws(
    () => hostCandidatesForPort(9225, null, { CODEX_DESKTOP_CDP_HOST: '192.0.2.1' }),
    /explicit loopback address/,
    'Codex Desktop host overrides must never widen CDP beyond loopback',
  );

  const listAttempts = [];
  const fakeCdp = async (options) => ({ options });
  fakeCdp.List = async (options) => {
    listAttempts.push(options.host || null);
    if (options.host === '::1') {
      const error = new Error('connect ECONNREFUSED ::1:9225');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    return [{ id: 'codex-target', type: 'page' }];
  };

  const targets = await listCdpTargets(fakeCdp, { port: 9225 });
  assert.deepEqual(listAttempts, ['::1', '127.0.0.1'], 'target listing must fall back once');
  assert.equal(targets[0]._cdpHost, '127.0.0.1', 'resolved host must travel with the target');

  const client = await connectCdpTarget(fakeCdp, {
    port: 9225,
    host: targets[0]._cdpHost,
    target: targets[0].id,
  });
  assert.equal(client.options.host, '127.0.0.1', 'target connection must reuse the resolved host');
  assert.equal(client.options.target, 'codex-target', 'target connection must preserve target identity');

  console.log('Codex Desktop loopback host smoke: PASS');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
