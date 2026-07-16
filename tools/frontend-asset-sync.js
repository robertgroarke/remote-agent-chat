'use strict';

const fs = require('fs');
const path = require('path');

function canonicalAssetBytes(value) {
  return Buffer.from(Buffer.from(value).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertAssetPairsSynced(root, pairs, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 21);
  const intervalMs = Math.max(0, Number(options.intervalMs) || 250);
  const readFile = options.readFile || (filePath => fs.readFileSync(filePath));
  const sleep = options.sleep || sleepSync;
  let mismatches = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    mismatches = pairs.filter(([source, deployed]) => {
      const sourceBytes = readFile(path.join(root, source));
      const deployedBytes = readFile(path.join(root, deployed));
      return !canonicalAssetBytes(sourceBytes).equals(canonicalAssetBytes(deployedBytes));
    });
    if (mismatches.length === 0) return { attempts: attempt, settled: attempt > 1 };
    if (attempt < attempts) sleep(intervalMs);
  }

  const labels = mismatches.map(([source, deployed]) => `${deployed} != ${source}`).join(', ');
  throw new Error(
    `Frontend assets remained unsynchronized after ${attempts} checks / `
    + `${(attempts - 1) * intervalMs} ms: ${labels}. Run node frontend/build.js.`,
  );
}

module.exports = {
  assertAssetPairsSynced,
  canonicalAssetBytes,
  sleepSync,
};
