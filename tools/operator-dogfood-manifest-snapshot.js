#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  DISCOVERED_GROUPS,
  auditCoverage,
  loadManifest,
} = require('./operator-dogfood-manifest-guard');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'tools', 'operator-dogfood-manifest.json');
const GUARD_PATH = path.join(ROOT, 'tools', 'operator-dogfood-manifest-guard.js');
const DEFAULT_EVIDENCE_PATH = freshEvidencePath(
  ROOT,
  path.join('operator-dogfood', 'screen-state-manifest.json'),
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

function countBy(values) {
  return Object.fromEntries([...new Set(values)].sort().map(value => [
    value,
    values.filter(candidate => candidate === value).length,
  ]));
}

function main(argv = process.argv.slice(2)) {
  const { outputPath } = parseArgs(argv);
  const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = loadManifest(MANIFEST_PATH);
  const audit = auditCoverage(manifest);
  if (!audit.ok) {
    process.stderr.write(`${JSON.stringify(audit, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const declaredSourceFiles = [...new Set(manifest.surfaces.flatMap(surface => surface.source_files))].sort();
  const sourceHashes = {};
  for (const relativePath of declaredSourceFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`manifest source file is missing: ${relativePath}`);
    sourceHashes[relativePath] = sha256(fs.readFileSync(absolutePath));
  }
  const sourceAggregate = Object.entries(sourceHashes)
    .map(([relativePath, hash]) => `${relativePath}\0${hash}`)
    .join('\n');
  const discoveredCounts = Object.fromEntries(DISCOVERED_GROUPS.map(group => [group, audit.discovered[group].length]));
  const discoveredTotal = Object.values(discoveredCounts).reduce((sum, value) => sum + value, 0);
  const missingTotal = DISCOVERED_GROUPS.reduce((sum, group) => sum + audit.missing[group].length, 0);
  const staleTotal = DISCOVERED_GROUPS.reduce((sum, group) => sum + audit.stale[group].length, 0);
  const evidenceCounts = countBy(manifest.surfaces.map(surface => surface.evidence_status));
  const evidenceProved = evidenceCounts.PROVED || 0;

  const evidence = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    result: 'PASS',
    checkpoint_scope: 'authoritative source inventory and executable discovery guard',
    repository_head_before_checkpoint_commit: execFileSync(
      'git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' },
    ).trim(),
    manifest: {
      path: path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/'),
      sha256: sha256(manifestText),
      schema_version: manifest.schema_version,
      updated_at: manifest.updated_at,
      surfaces: manifest.surfaces.length,
      by_platform: countBy(manifest.surfaces.map(surface => surface.platform)),
      by_kind: countBy(manifest.surfaces.map(surface => surface.kind)),
      evidence_status: evidenceCounts,
      proved_evidence_percent: Number(((evidenceProved / manifest.surfaces.length) * 100).toFixed(2)),
      unique_declared_states: [...new Set(manifest.surfaces.flatMap(surface => surface.states))].sort().length,
      state_declarations: manifest.surfaces.reduce((sum, surface) => sum + surface.states.length, 0),
      parity_mapped: manifest.surfaces.filter(surface => surface.parity_partner !== null).length,
      parity_not_applicable: manifest.surfaces.filter(surface => surface.parity_partner === null).length,
    },
    discovery_guard: {
      path: path.relative(ROOT, GUARD_PATH).replace(/\\/g, '/'),
      sha256: sha256(fs.readFileSync(GUARD_PATH)),
      discovered_counts: discoveredCounts,
      discovered_total: discoveredTotal,
      missing_total: missingTotal,
      stale_total: staleTotal,
      source_discovery_coverage_percent: missingTotal === 0 ? 100 : Number(
        (((discoveredTotal - missingTotal) / discoveredTotal) * 100).toFixed(2),
      ),
    },
    source_identity: {
      declared_file_count: declaredSourceFiles.length,
      declared_source_aggregate_sha256: sha256(sourceAggregate),
      files: sourceHashes,
    },
    required_matrix: manifest.required_matrix,
    open_gates: {
      built_asset_identity: 'PENDING_UNTIL_POST_LANDING_BUILD',
      served_asset_identity: 'PENDING_UNTIL_POST_LANDING_DEPLOY',
      row_visual_evidence: 'PENDING_FIRST_TWO_CIRCUIT_AUDIT',
      two_hour_duration: 'PENDING',
      seed_discovery_pack_12_of_12: 'PENDING',
      android_real_device: 'GATED_USER_ACTION_7',
    },
    safety: {
      production_mutations: 0,
      protected_session_mutations: 0,
      visible_windows: 0,
      focus_actions: 0,
      deploys: 0,
      restarts: 0,
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`PASS operator dogfood manifest snapshot (${manifest.surfaces.length} surfaces, ${discoveredTotal}/${discoveredTotal} discovery tokens)\n`);
  process.stdout.write(`${path.relative(ROOT, outputPath).replace(/\\/g, '/')}\n`);
}

main();

module.exports = { parseArgs };
