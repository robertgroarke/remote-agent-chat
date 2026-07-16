#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertAssetPairsSynced } = require('./frontend-asset-sync');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-frontend-asset-sync-'));

try {
  fs.mkdirSync(path.join(tempRoot, 'frontend'));
  fs.mkdirSync(path.join(tempRoot, 'public'));
  fs.writeFileSync(path.join(tempRoot, 'frontend', 'bundle.js'), 'candidate\n');
  fs.writeFileSync(path.join(tempRoot, 'public', 'bundle.js'), 'prior\n');

  let settleCalls = 0;
  const settled = assertAssetPairsSynced(tempRoot, [
    ['frontend/bundle.js', 'public/bundle.js'],
  ], {
    attempts: 3,
    intervalMs: 1,
    sleep: () => {
      settleCalls += 1;
      fs.copyFileSync(
        path.join(tempRoot, 'frontend', 'bundle.js'),
        path.join(tempRoot, 'public', 'bundle.js'),
      );
    },
  });
  assert.deepStrictEqual(settled, { attempts: 2, settled: true });
  assert.equal(settleCalls, 1);

  fs.writeFileSync(path.join(tempRoot, 'frontend', 'bundle.js'), 'same\r\ntext\r\n');
  fs.writeFileSync(path.join(tempRoot, 'public', 'bundle.js'), 'same\ntext\n');
  assert.deepStrictEqual(assertAssetPairsSynced(tempRoot, [
    ['frontend/bundle.js', 'public/bundle.js'],
  ], { attempts: 1 }), { attempts: 1, settled: false });

  fs.writeFileSync(path.join(tempRoot, 'public', 'bundle.js'), 'stale\n');
  assert.throws(
    () => assertAssetPairsSynced(tempRoot, [
      ['frontend/bundle.js', 'public/bundle.js'],
    ], { attempts: 2, intervalMs: 1, sleep: () => {} }),
    error => error.message.includes('public/bundle.js != frontend/bundle.js')
      && !error.message.includes('candidate'),
  );

  console.log('frontend asset sync retry smoke: PASS');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
