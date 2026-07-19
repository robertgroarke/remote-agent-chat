#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computeAssetVersion } = require('../frontend/build');
const { providerAssetDigest } = require('./provider-brand-assets');

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
const providerAssets = providerAssetDigest(path.join(ROOT, 'provider-assets'));
const version = computeAssetVersion(styles, bundle, providerAssets);
const crlfVersion = computeAssetVersion(withCrLf(styles), withCrLf(bundle), providerAssets);
const providerVersion = computeAssetVersion(styles, bundle, Buffer.from('provider-assets-v1'));

const appSource = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
const mirroredImports = [...appSource.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)]
  .map(match => match[1])
  .sort();
const canonicalModuleSource = filePath => fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
for (const relativePath of mirroredImports) {
  const sourcePath = path.join(ROOT, 'frontend', relativePath);
  const servedPath = path.join(ROOT, 'relay-server', 'public', relativePath);
  assert(fs.existsSync(servedPath), `served source mirror is missing ${relativePath}`);
  assert.strictEqual(canonicalModuleSource(servedPath), canonicalModuleSource(sourcePath),
    `served source mirror drifted for ${relativePath}`);
}

assert.strictEqual(crlfVersion, version, 'asset identity must be invariant across LF and CRLF checkouts');
assert.notStrictEqual(providerVersion, version, 'provider asset changes must advance the asset identity');
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

const result = {
  ok: true,
  asset_version: version,
  crlf_asset_version: crlfVersion,
  source_and_served_identity_match: true,
  mirrored_import_count: mirroredImports.length,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(result));
