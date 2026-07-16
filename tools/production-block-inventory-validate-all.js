#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const inventory = require('./production-block-inventory');

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--read-only') {
  console.error('Production block inventory validate-all only supports explicit --read-only mode.');
  process.exit(2);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-production-block-inventory-'));
const inventoryPath = path.join(tempRoot, 'inventory.json');

inventory.main([...args, '--result-file', inventoryPath])
  .then(() => {
    const coverage = spawnSync(process.execPath, [
      path.join(__dirname, 'structured-producer-coverage-smoke.js'),
      '--inventory', inventoryPath,
    ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    if (coverage.stdout) process.stdout.write(coverage.stdout);
    if (coverage.stderr) process.stderr.write(coverage.stderr);
    if (coverage.status !== 0) {
      throw new Error(`Structured producer coverage failed with exit ${coverage.status}`);
    }
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
