#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_ROOT = path.join(ROOT, 'android-app');
const {
  assertWorktreeResolution,
  createGuardedResolveRequest,
  isDependency,
  isWithin,
  realPath,
} = require('../android-app/metro-worktree-guard');

function sourceFile(filePath) {
  return { type: 'sourceFile', filePath };
}

function main(argv = process.argv.slice(2)) {
  const localEntry = path.join(ANDROID_ROOT, 'index.js');
  const localApp = path.join(ANDROID_ROOT, 'App.jsx');
  const dependency = require.resolve('expo/package.json', { paths: [ANDROID_ROOT] });
  const outsideApp = path.resolve(ROOT, '..', 'outside-worktree-fixture', 'App.jsx');

  assert(isWithin(ANDROID_ROOT, localEntry));
  assert(isWithin(ANDROID_ROOT, localApp));
  assert(isDependency(dependency));
  assert.strictEqual(assertWorktreeResolution(ANDROID_ROOT, sourceFile(localApp), './App').filePath, localApp);
  assert.strictEqual(assertWorktreeResolution(ANDROID_ROOT, sourceFile(dependency), 'expo').filePath, dependency);
  assert.throws(
    () => assertWorktreeResolution(ANDROID_ROOT, sourceFile(outsideApp), './App'),
    /outside the active worktree/,
  );

  const guarded = createGuardedResolveRequest(ANDROID_ROOT);
  assert.strictEqual(
    guarded({ resolveRequest: () => sourceFile(localEntry) }, './index', 'android').filePath,
    localEntry,
  );
  assert.throws(
    () => guarded({ resolveRequest: () => sourceFile(outsideApp) }, './App', 'android'),
    /outside the active worktree/,
  );

  const metroConfig = require('../android-app/metro.config');
  assert.strictEqual(typeof metroConfig.resolver.resolveRequest, 'function');

  const result = {
    status: 'PASS',
    project_root: realPath(ANDROID_ROOT),
    entrypoint: path.relative(ROOT, localEntry).replace(/\\/g, '/'),
    local_app: path.relative(ROOT, localApp).replace(/\\/g, '/'),
    dependency_resolution_allowed: true,
    outside_first_party_resolution_rejected: true,
    metro_guard_installed: true,
  };
  const outputIndex = argv.indexOf('--output');
  if (outputIndex >= 0) {
    assert(argv[outputIndex + 1], '--output requires a path');
    const outputPath = path.resolve(argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Android worktree resolution smoke: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  }
}

module.exports = { main };
