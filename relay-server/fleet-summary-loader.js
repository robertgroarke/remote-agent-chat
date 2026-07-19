'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACT_FILENAME = 'fleet-summary.js';

function resolveFleetSummaryPath(baseDir = __dirname) {
  const candidates = [
    path.join(baseDir, 'shared', CONTRACT_FILENAME),
    path.join(baseDir, '..', 'shared', CONTRACT_FILENAME),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (resolved) return resolved;
  const error = new Error('Fleet summary contract is missing from both relay and repository layouts');
  error.code = 'FLEET_SUMMARY_CONTRACT_MISSING';
  throw error;
}

function loadFleetSummary(baseDir = __dirname) {
  return require(resolveFleetSummaryPath(baseDir));
}

module.exports = {
  CONTRACT_FILENAME,
  loadFleetSummary,
  resolveFleetSummaryPath,
};
