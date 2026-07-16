#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const esbuild = require('../frontend/node_modules/esbuild');

const source = path.join(__dirname, '..', 'frontend', 'delivery-tracking.js');
const built = esbuild.buildSync({
  entryPoints: [source],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
}).outputFiles[0].text;
const moduleRecord = { exports: {} };
vm.runInNewContext(`(function(module, exports) { ${built}\n})(module, module.exports);`, {
  module: moduleRecord,
});
const { resolveDeliverySession, updateDeliveryMessage } = moduleRecord.exports;

const untouched = [{ role: 'user', _cid: 'cid-other', content: 'other' }];
const target = [{ role: 'user', _cid: 'cid-target', content: 'target' }];
const transcripts = { 'session-other': untouched, 'session-target': target };

assert.strictEqual(resolveDeliverySession(transcripts, 'cid-target', 'session-target'), 'session-target');
const updated = updateDeliveryMessage(
  transcripts,
  'cid-target',
  'session-target',
  message => ({ ...message, _delivered: true }),
);
assert.notStrictEqual(updated, transcripts);
assert.notStrictEqual(updated['session-target'], target);
assert.strictEqual(updated['session-other'], untouched, 'unrelated cached transcript was cloned');
assert.strictEqual(updated['session-target'][0]._delivered, true);

assert.strictEqual(resolveDeliverySession(transcripts, 'cid-target', 'stale-session'), 'session-target');
assert.strictEqual(
  updateDeliveryMessage(transcripts, 'missing', 'session-target', message => ({ ...message })),
  transcripts,
  'missing delivery message forced a store update',
);

console.log('PASS frontend delivery lifecycle updates only the owning transcript');
