#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeSourceMap } = require('./android-clean-worktree-export-contract');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'android-app', 'index.js');
const appPath = path.join(root, 'android-app', 'App.jsx');
const assetPath = path.join(root, 'android-app', 'assets', 'providers', 'openai-light.png');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-android-export-contract-'));
const mapPath = path.join(tempRoot, 'fixture.hbc.map');

try {
  fs.writeFileSync(mapPath, JSON.stringify({
    version: 3,
    sources: ['/index.js', '/App.jsx', '/assets/providers/openai-light.png'],
    sourcesContent: [fs.readFileSync(indexPath, 'utf8'), fs.readFileSync(appPath, 'utf8'), null],
    names: [],
    mappings: '',
  }));
  const result = analyzeSourceMap(mapPath);
  assert.equal(result.first_party_source_count, 2);
  assert(result.first_party_sources.some(source => source.path === 'android-app/index.js'));
  assert(result.first_party_sources.some(source => source.path === 'android-app/App.jsx'));
  assert.equal(result.first_party_asset_source_count, 1);
  assert.equal(result.first_party_asset_sources[0].path, 'android-app/assets/providers/openai-light.png');
  assert.equal(result.first_party_asset_sources[0].bytes, fs.statSync(assetPath).size);
  assert.match(result.first_party_asset_sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(result.outside_first_party_sources, []);
  console.log(JSON.stringify({
    ok: true,
    text_sources: result.first_party_source_count,
    binary_asset_sources: result.first_party_asset_source_count,
    outside_sources: result.outside_first_party_sources.length,
  }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
