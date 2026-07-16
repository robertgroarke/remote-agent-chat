#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computeAssetVersion } = require('../frontend/build');

const ROOT = path.resolve(__dirname, '..');

function withCrLf(value) {
  return Buffer.from(Buffer.from(value).toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
}

function readVersion(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return source.match(/const ASSET_VERSION = '([^']+)'/)?.[1] || '';
}

const styles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'));
const bundle = fs.readFileSync(path.join(ROOT, 'frontend', 'dist', 'bundle.js'));
const version = computeAssetVersion(styles, bundle);
const crlfVersion = computeAssetVersion(withCrLf(styles), withCrLf(bundle));

assert.strictEqual(crlfVersion, version, 'asset identity must be invariant across LF and CRLF checkouts');
assert.strictEqual(readVersion(path.join(ROOT, 'frontend', 'sw.js')), version,
  'frontend service worker must use the compiled content identity');
assert.strictEqual(readVersion(path.join(ROOT, 'relay-server', 'public', 'sw.js')), version,
  'served service worker must use the compiled content identity');

for (const indexPath of [
  path.join(ROOT, 'frontend', 'index.html'),
  path.join(ROOT, 'relay-server', 'public', 'index.html'),
]) {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert(html.includes(`/styles.css?v=${version}`), `${indexPath} has a stale stylesheet identity`);
  assert(html.includes(`/dist/bundle.js?v=${version}`), `${indexPath} has a stale bundle identity`);
}

console.log(JSON.stringify({
  ok: true,
  asset_version: version,
  crlf_asset_version: crlfVersion,
  source_and_served_identity_match: true,
}));
