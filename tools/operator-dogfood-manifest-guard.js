#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'tools', 'operator-dogfood-manifest.json');
const WEB_SOURCE_PATH = path.join(ROOT, 'frontend', 'app.jsx');
const ANDROID_APP_PATH = path.join(ROOT, 'android-app', 'App.jsx');
const ANDROID_SOURCE_ROOTS = [
  path.join(ROOT, 'android-app', 'screens'),
  path.join(ROOT, 'android-app', 'components'),
];
const DISCOVERED_GROUPS = Object.freeze([
  'web_components',
  'web_toggles',
  'web_testids',
  'android_routes',
  'android_components',
  'android_toggles',
]);
const COMPONENT_SUFFIX = /(?:Panel|View|Dashboard|Modal|Overlay|Viewer|Browser|Palette|Popover|Drawer|Sheet|Banner|Prompt|Bar|ToastStack)$/;
const SURFACE_TEST_ID = /(?:view|dashboard|modal|panel|overlay|browser|settings|switcher|search)/i;

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function walkSourceFiles(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkSourceFiles(filePath));
    else if (/\.(?:js|jsx)$/.test(entry.name)) output.push(filePath);
  }
  return output;
}

function functionNames(source) {
  const names = [];
  const patterns = [
    /^(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm,
    /^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.)?(?:memo\s*\()?\s*\(?[^=\n]*=>/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.push(match[1]);
  }
  return names;
}

function visibilityToggles(source) {
  return [...source.matchAll(
    /const\s+\[\s*(show[A-Z][A-Za-z0-9_]*)\s*,\s*setShow[A-Z][A-Za-z0-9_]*\s*\]\s*=\s*(?:React\.)?useState\s*\(/g,
  )].map(match => match[1]);
}

function testIds(source) {
  return [...source.matchAll(/data-testid=["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(value => SURFACE_TEST_ID.test(value));
}

function androidRoutes(source) {
  return [...source.matchAll(/<Stack\.Screen\b[\s\S]{0,500}?\bname=["']([^"']+)["']/g)]
    .map(match => match[1]);
}

function readAndroidSources(overrides = {}) {
  if (overrides.androidSources) return overrides.androidSources;
  return Object.fromEntries(ANDROID_SOURCE_ROOTS.flatMap(root => walkSourceFiles(root))
    .map(filePath => [path.relative(ROOT, filePath).replace(/\\/g, '/'), fs.readFileSync(filePath, 'utf8')]));
}

function discoverSources(overrides = {}) {
  const webSource = overrides.webSource ?? fs.readFileSync(WEB_SOURCE_PATH, 'utf8');
  const androidAppSource = overrides.androidAppSource ?? fs.readFileSync(ANDROID_APP_PATH, 'utf8');
  const androidSources = readAndroidSources(overrides);
  const androidEntries = Object.entries(androidSources);
  const androidComponentNames = androidEntries.flatMap(([file, source]) => {
    const names = functionNames(source).filter(name => COMPONENT_SUFFIX.test(name));
    const fileStem = path.basename(file).replace(/\.(?:js|jsx)$/, '');
    if (COMPONENT_SUFFIX.test(fileStem)) names.push(fileStem);
    return names;
  });
  androidComponentNames.push(
    ...functionNames(androidAppSource).filter(name => COMPONENT_SUFFIX.test(name)),
  );
  return {
    web_components: sortedUnique(functionNames(webSource).filter(name => COMPONENT_SUFFIX.test(name))),
    web_toggles: sortedUnique(visibilityToggles(webSource)),
    web_testids: sortedUnique(testIds(webSource)),
    android_routes: sortedUnique(androidRoutes(androidAppSource)),
    android_components: sortedUnique(androidComponentNames),
    android_toggles: sortedUnique(androidEntries.flatMap(([, source]) => visibilityToggles(source))),
  };
}

function registeredCoverage(manifest) {
  const registered = Object.fromEntries(DISCOVERED_GROUPS.map(group => [group, []]));
  for (const surface of manifest.surfaces || []) {
    for (const group of DISCOVERED_GROUPS) {
      registered[group].push(...(surface.discovery?.[group] || []));
    }
  }
  for (const group of DISCOVERED_GROUPS) {
    registered[group].push(...(manifest.discovery_ignores?.[group] || []).map(item => item.id));
    registered[group] = sortedUnique(registered[group]);
  }
  return registered;
}

function validateManifest(manifest) {
  assert.strictEqual(manifest.schema_version, 1, 'unsupported operator dogfood manifest schema');
  assert(Array.isArray(manifest.surfaces) && manifest.surfaces.length > 0, 'manifest surfaces are required');
  const ids = new Set();
  const required = [
    'id', 'platform', 'kind', 'owner_component', 'entry_action', 'fixture',
    'mutation_mode', 'parity_partner', 'evidence_status', 'states', 'source_files', 'discovery',
  ];
  for (const surface of manifest.surfaces) {
    for (const field of required) {
      assert(Object.prototype.hasOwnProperty.call(surface, field), `${surface.id || 'surface'} missing ${field}`);
    }
    assert(/^[a-z0-9][a-z0-9._-]+$/.test(surface.id), `invalid surface id ${surface.id}`);
    assert(!ids.has(surface.id), `duplicate surface id ${surface.id}`);
    ids.add(surface.id);
    assert(['web', 'android'].includes(surface.platform), `${surface.id} has invalid platform`);
    assert(['production_read_only', 'disposable_only', 'source_fixture', 'mixed_guarded'].includes(surface.mutation_mode),
      `${surface.id} has invalid mutation mode`);
    assert(['PROVED', 'SOURCE_ONLY', 'PENDING', 'GATED', 'N/A'].includes(surface.evidence_status),
      `${surface.id} has invalid evidence status`);
    assert(Array.isArray(surface.states) && surface.states.length > 0, `${surface.id} has no states`);
    assert(Array.isArray(surface.source_files) && surface.source_files.length > 0, `${surface.id} has no source files`);
    for (const group of DISCOVERED_GROUPS) {
      assert(Array.isArray(surface.discovery[group] || []), `${surface.id} discovery.${group} must be an array`);
    }
  }
  for (const surface of manifest.surfaces) {
    if (surface.parity_partner === null) {
      assert(surface.parity_reason, `${surface.id} needs parity_reason when parity_partner is null`);
    } else {
      assert(ids.has(surface.parity_partner), `${surface.id} parity partner ${surface.parity_partner} is missing`);
    }
  }
  for (const group of DISCOVERED_GROUPS) {
    const ignores = manifest.discovery_ignores?.[group] || [];
    for (const ignore of ignores) {
      assert(ignore.id && ignore.reason, `discovery ignore ${group} needs id and reason`);
    }
  }
  return true;
}

function auditCoverage(manifest, discovered = discoverSources()) {
  validateManifest(manifest);
  const registered = registeredCoverage(manifest);
  const missing = {};
  const stale = {};
  for (const group of DISCOVERED_GROUPS) {
    missing[group] = discovered[group].filter(value => !registered[group].includes(value));
    stale[group] = registered[group].filter(value => !discovered[group].includes(value));
  }
  return {
    ok: DISCOVERED_GROUPS.every(group => missing[group].length === 0 && stale[group].length === 0),
    discovered,
    registered,
    missing,
    stale,
  };
}

function loadManifest(filePath = DEFAULT_MANIFEST) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--inventory')) {
    process.stdout.write(`${JSON.stringify(discoverSources(), null, 2)}\n`);
    return;
  }
  const manifestIndex = argv.indexOf('--manifest');
  const manifestPath = manifestIndex >= 0 && argv[manifestIndex + 1]
    ? path.resolve(argv[manifestIndex + 1]) : DEFAULT_MANIFEST;
  const result = auditCoverage(loadManifest(manifestPath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  DISCOVERED_GROUPS,
  auditCoverage,
  discoverSources,
  loadManifest,
  registeredCoverage,
  validateManifest,
};
