#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  assertProviderAssetHashes,
  assertProviderAssetMirror,
  canonicalAssetBytes,
  providerAssetDigest,
} = require('./provider-brand-assets');

const root = path.join(__dirname, '..');
const sourceRoot = path.join(root, 'provider-assets');
const androidRoot = path.join(root, 'android-app', 'assets', 'providers');
const publicRoot = path.join(root, 'relay-server', 'public', 'provider-assets');
const { manifest, files } = assertProviderAssetHashes(sourceRoot);
const expectedProviderIds = [
  'anthropic-claude',
  'cursor',
  'google-antigravity',
  'ollama-local',
  'openai-codex',
];

assert.deepStrictEqual(manifest.providers.map(provider => provider.provider_id).sort(), expectedProviderIds);
assert.match(manifest.asset_set_version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
assert.equal(manifest.retrieved_date, '2026-07-16');
assert.match(manifest.policy.brand_use, /no endorsement/i);
assert.match(manifest.policy.network, /No provider mark is hotlinked/i);
assert.match(manifest.policy.svg_safety, /scripts.*external references/i);

const allowedPageOrigins = new Set([
  'https://openai.com',
  'https://www.anthropic.com',
  'https://cursor.com',
  'https://antigravity.google',
  'https://ollama.com',
]);
const renderedFiles = new Set();
for (const provider of manifest.providers) {
  assert(provider.accessible_name, `${provider.provider_id} missing accessible name`);
  assert(provider.brand_use_note, `${provider.provider_id} missing brand-use note`);
  assert(allowedPageOrigins.has(new URL(provider.source.page_url).origin), `${provider.provider_id} source is not first-party`);
  assert(provider.render.monochrome, `${provider.provider_id} missing monochrome treatment`);
  const ownedFiles = new Set(provider.files.map(file => file.file));
  for (const platform of ['web', 'android']) {
    for (const scheme of ['light', 'dark']) {
      const file = provider.render[platform][scheme];
      assert(ownedFiles.has(file), `${provider.provider_id} ${platform}/${scheme} is not a vendored owned file`);
      renderedFiles.add(file);
    }
  }
  for (const file of provider.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.match(file.source_sha256, /^[a-f0-9]{64}$/);
    assert(Array.isArray(file.transformations) && file.transformations.length > 0);
  }
}

for (const file of files) {
  const filePath = path.join(sourceRoot, file);
  if (path.extname(file) === '.svg') {
    const svg = canonicalAssetBytes(filePath).toString('utf8');
    assert(!/<\?(?:xml)?|<!doctype|<!entity/i.test(svg), `${file} retains XML active declarations`);
    assert(!/<\s*(?:script|style|foreignObject|iframe|object|embed|use|animate|set)\b/i.test(svg), `${file} has active SVG elements`);
    assert(!/\bon[a-z]+\s*=|\b(?:href|src)\s*=|url\s*\(|@import|javascript:|data:/i.test(svg), `${file} has active SVG references`);
    const tags = [...svg.matchAll(/<\s*\/?\s*([a-z][a-z0-9:-]*)/gi)].map(match => match[1].toLowerCase());
    assert(tags.length >= 2 && tags.every(tag => tag === 'svg' || tag === 'path'), `${file} has non-static SVG tags`);
  } else if (path.extname(file) === '.png') {
    const png = fs.readFileSync(filePath);
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not PNG`);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert(width > 0 && height > 0 && width <= 2048 && height <= 2048, `${file} has unsafe dimensions`);
    assert(png.length <= 2 * 1024 * 1024, `${file} is unexpectedly large`);
  } else {
    assert.fail(`Unexpected provider asset type: ${file}`);
  }
}

const androidMirror = assertProviderAssetMirror(sourceRoot, androidRoot);
const publicMirror = assertProviderAssetMirror(sourceRoot, publicRoot);
const expectedMirrorFiles = new Set(['manifest.json', ...files]);
for (const mirrorRoot of [androidRoot, publicRoot]) {
  const actual = fs.readdirSync(mirrorRoot).filter(name => fs.statSync(path.join(mirrorRoot, name)).isFile());
  assert.deepStrictEqual(new Set(actual), expectedMirrorFiles, `${mirrorRoot} contains stale or missing assets`);
}

const webComponent = fs.readFileSync(path.join(root, 'frontend', 'provider-marks.jsx'), 'utf8');
const webApp = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const webStyles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const webWorker = fs.readFileSync(path.join(root, 'frontend', 'sw.js'), 'utf8');
assert(webComponent.includes("from '../provider-assets/manifest.json'"));
assert(webComponent.includes('role="img"') && webComponent.includes('provider mark unavailable'));
assert(!/https?:\/\//.test(webComponent), 'Web provider marks must not hotlink');
assert(webApp.includes('<ProviderMark providerId={entry.providerId} providerName={entry.providerName} />'));
assert(!webApp.includes('entry.providerName.slice(0, 2).toUpperCase()'));
assert(webStyles.includes(':root[data-theme="light"] .usage-dashboard-provider-mark-dark'));
assert(webStyles.includes('[data-provider-mark-id="ollama-local"] .usage-dashboard-provider-mark-tinted'));
for (const file of new Set(manifest.providers.flatMap(provider => Object.values(provider.render.web)
  .filter(value => typeof value === 'string' && /\.(?:png|svg)$/.test(value))))) {
  assert(webWorker.includes(`/provider-assets/${file}`), `service worker does not cache ${file}`);
}

const androidComponent = fs.readFileSync(path.join(root, 'android-app', 'components', 'ProviderMark.jsx'), 'utf8');
const androidScreen = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
assert(androidComponent.includes('accessibilityRole="image"'));
assert(androidComponent.includes('provider mark${failed || !mark'));
assert(!/https?:\/\//.test(androidComponent), 'Android provider marks must not hotlink');
assert(androidScreen.includes('<ProviderMark providerId={entry.providerId} providerName={entry.providerName} colorScheme="dark" />'));
assert(!androidScreen.includes('entry.providerName.slice(0, 2).toUpperCase()'));
for (const provider of manifest.providers) {
  for (const file of new Set([provider.render.android.light, provider.render.android.dark])) {
    assert(androidComponent.includes(`require('../assets/providers/${file}')`), `Android mapping missing ${file}`);
  }
}

const buildSource = fs.readFileSync(path.join(root, 'frontend', 'build.js'), 'utf8');
assert(buildSource.includes('providerAssetDigest(providerAssetDir)'));
assert(buildSource.includes("syncProviderAssets(providerAssetDir, path.join(publicDir, 'provider-assets'))"));

const result = {
  ok: true,
  schema_version: manifest.schema_version,
  asset_set_version: manifest.asset_set_version,
  providers: expectedProviderIds.length,
  files: files.length,
  rendered_files: renderedFiles.size,
  svg_files: files.filter(file => file.endsWith('.svg')).length,
  png_files: files.filter(file => file.endsWith('.png')).length,
  android_mirror_files: androidMirror.files,
  public_mirror_files: publicMirror.files,
  digest_sha256: providerAssetDigest(sourceRoot).toString('hex'),
  hotlinks: 0,
  unsafe_svg_findings: 0,
  text_fallbacks: 2,
};
console.log(JSON.stringify(result, null, 2));
