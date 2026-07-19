'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.json', '.svg']);

function canonicalAssetBytes(filePath, value = fs.readFileSync(filePath)) {
  const bytes = Buffer.from(value);
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readProviderAssetManifest(sourceRoot) {
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  const manifest = JSON.parse(canonicalAssetBytes(manifestPath).toString('utf8'));
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.providers)) {
    throw new Error('Provider asset manifest must use schema_version 1 with a providers array');
  }
  return manifest;
}

function collectProviderAssetFiles(manifest) {
  const files = new Map();
  for (const provider of manifest.providers) {
    if (!provider?.provider_id || !Array.isArray(provider.files)) {
      throw new Error('Every provider asset entry requires provider_id and files');
    }
    for (const entry of provider.files) {
      if (!entry?.file || path.basename(entry.file) !== entry.file || entry.file.includes('..')) {
        throw new Error(`Unsafe provider asset filename: ${entry?.file || '<missing>'}`);
      }
      const prior = files.get(entry.file);
      if (prior && prior.sha256 !== entry.sha256) {
        throw new Error(`Conflicting provider asset hashes for ${entry.file}`);
      }
      files.set(entry.file, entry);
    }
  }
  return [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function providerAssetDigest(sourceRoot) {
  const manifest = readProviderAssetManifest(sourceRoot);
  const digest = crypto.createHash('sha256');
  digest.update(canonicalAssetBytes(path.join(sourceRoot, 'manifest.json')));
  for (const [file] of collectProviderAssetFiles(manifest)) {
    digest.update(file);
    digest.update(canonicalAssetBytes(path.join(sourceRoot, file)));
  }
  return digest.digest();
}

function assertProviderAssetHashes(sourceRoot) {
  const manifest = readProviderAssetManifest(sourceRoot);
  const checked = [];
  for (const [file, entry] of collectProviderAssetFiles(manifest)) {
    const filePath = path.join(sourceRoot, file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing provider asset: ${file}`);
    const actual = sha256(canonicalAssetBytes(filePath));
    if (actual !== entry.sha256) {
      throw new Error(`Provider asset hash mismatch for ${file}: ${actual} != ${entry.sha256}`);
    }
    checked.push(file);
  }
  return { manifest, files: checked };
}

function syncProviderAssets(sourceRoot, destinationRoot) {
  const { files } = assertProviderAssetHashes(sourceRoot);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const names = ['manifest.json', ...files];
  for (const file of names) {
    const source = path.join(sourceRoot, file);
    const destination = path.join(destinationRoot, file);
    fs.writeFileSync(destination, canonicalAssetBytes(source));
  }
  return { destinationRoot, files: names };
}

function assertProviderAssetMirror(sourceRoot, destinationRoot) {
  const { files } = assertProviderAssetHashes(sourceRoot);
  for (const file of ['manifest.json', ...files]) {
    const source = canonicalAssetBytes(path.join(sourceRoot, file));
    const destinationPath = path.join(destinationRoot, file);
    if (!fs.existsSync(destinationPath)) throw new Error(`Missing mirrored provider asset: ${destinationPath}`);
    const destination = canonicalAssetBytes(destinationPath);
    if (!source.equals(destination)) throw new Error(`Provider asset mirror drift: ${destinationPath}`);
  }
  return { destinationRoot, files: files.length + 1 };
}

module.exports = {
  assertProviderAssetHashes,
  assertProviderAssetMirror,
  canonicalAssetBytes,
  collectProviderAssetFiles,
  providerAssetDigest,
  readProviderAssetManifest,
  sha256,
  syncProviderAssets,
};
