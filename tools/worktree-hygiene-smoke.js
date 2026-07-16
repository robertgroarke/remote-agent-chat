#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function gitCheckIgnore(relativePath) {
  const result = spawnSync('git', ['check-ignore', '-q', '--', relativePath], {
    cwd: root,
    windowsHide: true,
  });
  assert([0, 1].includes(result.status), `git check-ignore failed for ${relativePath}`);
  return result.status === 0;
}

const suspiciousRootNames = fs.readdirSync(root).filter(name => (
  name === '-'
  || /^\{if(?:\(|$)/i.test(name)
));
assert.deepStrictEqual(suspiciousRootNames, [], `stray shell artifacts remain: ${suspiciousRootNames.join(', ')}`);

const proxyProbeJson = fs.readdirSync(path.join(root, 'agent-proxy'))
  .filter(name => /^probe-.*\.json$/i.test(name));
assert.deepStrictEqual(proxyProbeJson, [], `raw probe JSON remains in agent-proxy: ${proxyProbeJson.join(', ')}`);

const trackedCursorProbeResult = spawnSync('git', ['ls-files', 'agent-proxy/probe-cursor-*.js'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
});
assert.strictEqual(trackedCursorProbeResult.status, 0, trackedCursorProbeResult.stderr || 'git ls-files failed');
const trackedCursorProbes = new Set(trackedCursorProbeResult.stdout.split(/\r?\n/).filter(Boolean));
const untrackedCursorProbes = fs.readdirSync(path.join(root, 'agent-proxy'))
  .filter(name => /^probe-cursor-.*\.js$/i.test(name))
  .map(name => `agent-proxy/${name}`)
  .filter(name => !trackedCursorProbes.has(name));
assert.deepStrictEqual(untrackedCursorProbes, [],
  `untriaged Cursor probes remain in agent-proxy: ${untrackedCursorProbes.join(', ')}`);

const ignoredScratch = [
  'android-app/dist-hygiene-fixture/metadata.json',
  'data/nightly-visual-regression/actual/hygiene-fixture.png',
  'data/production-overnight-soak.lock',
  'agent-proxy/probe-hygiene-fixture.json',
  'evidence/harness-restoration/2026-07-10/raw-probes/hygiene-fixture.json',
  'evidence/harness-maturity/2026-07-11/visual-regression-hygiene/actual/hygiene-fixture.png',
  'evidence/harness-maturity/2026-07-11/native-layout-visual-hygiene/desktop.png',
  'evidence/harness-maturity/2026-07-11/native-layout-compare-hygiene/mobile.png',
  'evidence/harness-maturity/2026-07-11/native-layout-generate-hygiene/desktop.png',
  'evidence/harness-maturity/2026-07-11/native-layout-golden-update-hygiene/mobile.png',
];
for (const candidate of ignoredScratch) {
  assert(gitCheckIgnore(candidate), `generated scratch path is not ignored: ${candidate}`);
}

const canonicalGolden = 'evidence/harness-maturity/visual-goldens/claude-dark-markdown-desktop.png';
assert(!gitCheckIgnore(canonicalGolden), 'approved visual goldens must remain visible to git');

const result = {
  ok: true,
  suspicious_root_artifacts: suspiciousRootNames.length,
  raw_probe_json_in_source_tree: proxyProbeJson.length,
  untracked_cursor_probes_in_source_tree: untrackedCursorProbes.length,
  ignored_scratch_contracts: ignoredScratch.length,
  approved_goldens_trackable: true,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
