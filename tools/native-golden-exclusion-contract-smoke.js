#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const { MANIFEST_PATH, validateManifest } = require('./native-golden-approval-validate-all');

const sourceManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

function fixture() {
  return JSON.parse(JSON.stringify(sourceManifest));
}

function harness(manifest, agent) {
  const row = manifest.harnesses.find(candidate => candidate.agent === agent);
  assert(row, `missing ${agent} fixture harness`);
  return row;
}

function addExclusion(row, exclusion) {
  row.native_grounding_exclusions ||= [];
  row.native_grounding_exclusions.push({
    reason: 'Negative contract fixture: an observed native surface must never be classified as natively inapplicable.',
    evidence: ['docs/HARNESS_FIDELITY_CEILINGS.md'],
    ...exclusion,
  });
}

const cases = [
  {
    category: 'block',
    mutate(manifest) {
      const row = harness(manifest, 'claude_cli');
      row.approved_blocks.dark = row.approved_blocks.dark.filter(block => block !== 'terminal');
      addExclusion(row, { theme: 'dark', blocks: ['terminal'] });
    },
    expected: /block terminal cannot be natively inapplicable because a hashed native source observes it/,
  },
  {
    category: 'live-status',
    mutate(manifest) {
      const row = harness(manifest, 'codex-desktop');
      row.approved_live_status.light = row.approved_live_status.light.filter(item => item !== 'current_status');
      addExclusion(row, { theme: 'light', live_status: ['current_status'] });
    },
    expected: /live-status current_status cannot be natively inapplicable because a hashed native source observes it/,
  },
  {
    category: 'layout',
    mutate(manifest) {
      const row = harness(manifest, 'claude');
      row.approved_layouts.dark = [];
      addExclusion(row, { theme: 'dark', layouts: ['message_layout'] });
    },
    expected: /layout message_layout cannot be natively inapplicable because a hashed native source observes it/,
  },
  {
    category: 'composer',
    mutate(manifest) {
      const row = harness(manifest, 'claude');
      row.approved_composer.dark = [];
      addExclusion(row, { theme: 'dark', composer: ['composer_chrome'] });
    },
    expected: /composer composer_chrome cannot be natively inapplicable because a hashed native source observes it/,
  },
];

for (const testCase of cases) {
  const manifest = fixture();
  testCase.mutate(manifest);
  assert.throws(() => validateManifest(manifest), testCase.expected, `${testCase.category} contradiction must fail closed`);
}

const pathCases = [
  {
    category: 'native-source-path',
    mutate(manifest) {
      harness(manifest, 'claude').native_sources[0].path = '../outside-native.png';
    },
    expected: /native source path escapes the repository/,
  },
  {
    category: 'exclusion-evidence-path',
    mutate(manifest) {
      harness(manifest, 'claude_cli').native_grounding_exclusions[0].evidence = ['../outside-evidence.md'];
    },
    expected: /exclusion evidence path escapes the repository/,
  },
  {
    category: 'golden-root-path',
    mutate(manifest) {
      manifest.golden_root = '..';
    },
    expected: /golden root path escapes the repository/,
  },
];

for (const testCase of pathCases) {
  const manifest = fixture();
  testCase.mutate(manifest);
  assert.throws(() => validateManifest(manifest), testCase.expected, `${testCase.category} traversal must fail closed`);
}

const inventoryCases = [
  {
    category: 'unknown-observed-block',
    mutate(manifest) {
      harness(manifest, 'claude').native_sources[0].observed_blocks.push('unknown_surface');
    },
    expected: /unknown observed block unknown_surface/,
  },
  {
    category: 'unsupported-observed-category',
    mutate(manifest) {
      harness(manifest, 'claude').native_sources[0].observed_live_status = ['current_status'];
    },
    expected: /observed live-status is not supported for this harness/,
  },
  {
    category: 'empty-observed-inventory',
    mutate(manifest) {
      harness(manifest, 'antigravity-v2').native_sources[1].observed_blocks = [];
    },
    expected: /native source observes no supported surface/,
  },
  {
    category: 'duplicate-native-source',
    mutate(manifest) {
      const row = harness(manifest, 'claude');
      row.native_sources.push(JSON.parse(JSON.stringify(row.native_sources[0])));
    },
    expected: /duplicate native source path/,
  },
];

for (const testCase of inventoryCases) {
  const manifest = fixture();
  testCase.mutate(manifest);
  assert.throws(() => validateManifest(manifest), testCase.expected, `${testCase.category} must fail closed`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  contradictions_rejected: cases.map(testCase => testCase.category),
  path_traversals_rejected: pathCases.map(testCase => testCase.category),
  inventory_defects_rejected: inventoryCases.map(testCase => testCase.category),
  native_sources_untouched: true,
  production_mutations: 0,
}, null, 2)}\n`);
