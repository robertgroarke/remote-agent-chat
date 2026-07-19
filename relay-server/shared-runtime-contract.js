'use strict';

const fs = require('fs');
const path = require('path');

function resolveSharedRuntimeContract(filename, {
  baseDir = __dirname,
  existsSync = fs.existsSync,
} = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(filename || ''))) {
    throw new TypeError('Shared runtime contract filename must be a basename');
  }
  const candidates = [
    // Packaged relay image: Docker build context copies shared/ under /app.
    path.resolve(baseDir, 'shared', filename),
    // Source checkout: relay-server/ and shared/ are siblings.
    path.resolve(baseDir, '..', 'shared', filename),
  ];
  const resolved = candidates.find(candidate => existsSync(candidate));
  if (!resolved) {
    const error = new Error(`Shared runtime contract unavailable: ${filename}`);
    error.code = 'shared_runtime_contract_unavailable';
    error.candidates = candidates;
    throw error;
  }
  return resolved;
}

function loadSharedRuntimeContract(filename) {
  return require(resolveSharedRuntimeContract(filename));
}

module.exports = { loadSharedRuntimeContract, resolveSharedRuntimeContract };
