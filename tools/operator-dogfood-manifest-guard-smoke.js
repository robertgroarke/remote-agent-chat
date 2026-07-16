#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  auditCoverage,
  discoverSources,
  loadManifest,
} = require('./operator-dogfood-manifest-guard');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'tools', 'operator-dogfood-manifest.json');
const WEB_PATH = path.join(ROOT, 'frontend', 'app.jsx');
const ANDROID_APP_PATH = path.join(ROOT, 'android-app', 'App.jsx');
const DEFAULT_EVIDENCE_PATH = freshEvidencePath(
  ROOT,
  path.join('operator-dogfood', 'screen-state-manifest-guard.json'),
);

function parseArgs(argv) {
  let outputPath = DEFAULT_EVIDENCE_PATH;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--output' && argv[index + 1]) outputPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { outputPath };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function injectedResult(manifest, overrides, group, expected) {
  const result = auditCoverage(manifest, discoverSources(overrides));
  assert.strictEqual(result.ok, false, `${expected} must make the manifest guard fail`);
  assert.deepStrictEqual(result.missing[group], [expected], `${expected} must be reported in ${group}`);
  return {
    injected: expected,
    discovery_group: group,
    guard_ok: result.ok,
    missing: result.missing[group],
  };
}

function main(argv = process.argv.slice(2)) {
  const { outputPath } = parseArgs(argv);
  const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const webSource = fs.readFileSync(WEB_PATH, 'utf8');
  const androidAppSource = fs.readFileSync(ANDROID_APP_PATH, 'utf8');
  const manifest = loadManifest(MANIFEST_PATH);

  const baselineBefore = auditCoverage(manifest);
  assert.strictEqual(baselineBefore.ok, true, 'baseline manifest coverage must begin green');

  const cases = [
    injectedResult(
      manifest,
      { webSource: `${webSource}\nfunction SurprisePanel() { return null; }\n` },
      'web_components',
      'SurprisePanel',
    ),
    injectedResult(
      manifest,
      { webSource: `${webSource}\nfunction SecretToggleHost() { const [showSecretDrawer, setShowSecretDrawer] = useState(false); return null; }\n` },
      'web_toggles',
      'showSecretDrawer',
    ),
    injectedResult(
      manifest,
      { androidAppSource: `${androidAppSource}\n<Stack.Screen name="SecretRoute" component={SettingsScreen} />\n` },
      'android_routes',
      'SecretRoute',
    ),
    injectedResult(
      manifest,
      { androidAppSource: `${androidAppSource}\nfunction SecretSheet() { return null; }\n` },
      'android_components',
      'SecretSheet',
    ),
  ];

  const baselineAfter = auditCoverage(manifest);
  assert.strictEqual(baselineAfter.ok, true, 'baseline manifest coverage must return green');
  assert.deepStrictEqual(baselineAfter.discovered, baselineBefore.discovered,
    'in-memory discovery injections must not mutate repository sources');

  const evidence = {
    schema_version: 1,
    verified_at: new Date().toISOString(),
    result: 'PASS',
    manifest: path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/'),
    manifest_sha256: sha256(manifestText),
    source_sha256: {
      web: sha256(webSource),
      android_app: sha256(androidAppSource),
    },
    baseline_before: baselineBefore.ok,
    cases,
    baseline_after: baselineAfter.ok,
    repository_source_mutations: 0,
    visible_windows: 0,
    focus_actions: 0,
    production_mutations: 0,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`PASS operator dogfood manifest guard (${cases.length}/${cases.length} injected surfaces rejected)\n`);
  process.stdout.write(`${path.relative(ROOT, outputPath).replace(/\\/g, '/')}\n`);
}

main();

module.exports = { parseArgs };
