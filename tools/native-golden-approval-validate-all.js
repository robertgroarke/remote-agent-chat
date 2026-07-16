#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('../frontend/node_modules/pngjs');
const { AGENTS, BLOCKS, LIVE_STATUS_AGENTS, LIVE_STATUS_CASES, SIDEBAR_CASES, LAYOUT_AGENTS, LAYOUT_CASES, COMPOSER_AGENTS, COMPOSER_CASES, THEMES, VIEWPORTS } = require('./visual-regression');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'evidence', 'harness-maturity', 'native-golden-approvals.json');
const DOC_PATH = path.join(ROOT, 'docs', 'NATIVE_GOLDEN_APPROVALS.md');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveRepoPath(relativePath, label) {
  assert.equal(typeof relativePath, 'string', `${label} path must be a string`);
  assert(relativePath.trim(), `${label} path must not be empty`);
  assert(!path.isAbsolute(relativePath), `${label} path must be repository-relative: ${relativePath}`);
  const absolute = path.resolve(ROOT, relativePath);
  const fromRoot = path.relative(ROOT, absolute);
  assert(fromRoot && !fromRoot.startsWith(`..${path.sep}`) && fromRoot !== '..' && !path.isAbsolute(fromRoot),
    `${label} path escapes the repository: ${relativePath}`);
  return absolute;
}

function parseArgs(argv) {
  const options = { readOnly: false, resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.readOnly) throw new Error('Native golden approval validation is read-only; pass --read-only explicitly');
  return options;
}

function goldenName(agent, theme, block, viewport) {
  return `${agent}-${block}-${viewport}${theme === 'light' ? '-light' : ''}.png`;
}

function liveGoldenName(agent, theme, liveCase, viewport) {
  return goldenName(agent, theme, `live_${liveCase}`, viewport);
}

function layoutGoldenName(agent, theme, layoutCase, viewport) {
  return goldenName(agent, theme, `layout_${layoutCase}`, viewport);
}

function composerGoldenName(agent, theme, composerCase, viewport) {
  return goldenName(agent, theme, `composer_${composerCase}`, viewport);
}

function approvedGoldenRows(manifest, harness) {
  const goldenRoot = resolveRepoPath(manifest.golden_root, 'golden root');
  const blockRows = THEMES.flatMap(theme => [...harness.approved_blocks[theme]].sort().flatMap(block =>
    harness.approved_viewports.map(viewport => {
      const name = goldenName(harness.agent, theme, block, viewport);
      const absolute = path.join(goldenRoot, name);
      assert(fs.existsSync(absolute), `${harness.agent}: approved golden missing: ${name}`);
      return `${name}:${sha256(fs.readFileSync(absolute))}`;
    })));
  const liveRows = LIVE_STATUS_AGENTS.includes(harness.agent)
    ? THEMES.flatMap(theme => [...harness.approved_live_status[theme]].sort().flatMap(liveCase =>
      harness.approved_viewports.map(viewport => {
        const name = liveGoldenName(harness.agent, theme, liveCase, viewport);
        const absolute = path.join(goldenRoot, name);
        assert(fs.existsSync(absolute), `${harness.agent}: approved live-status golden missing: ${name}`);
        return `${name}:${sha256(fs.readFileSync(absolute))}`;
      })))
    : [];
  const layoutRows = LAYOUT_AGENTS.includes(harness.agent)
    ? THEMES.flatMap(theme => [...harness.approved_layouts[theme]].sort().flatMap(layoutCase =>
      harness.approved_viewports.map(viewport => {
        const name = layoutGoldenName(harness.agent, theme, layoutCase, viewport);
        const absolute = path.join(goldenRoot, name);
        assert(fs.existsSync(absolute), `${harness.agent}: approved layout golden missing: ${name}`);
        return `${name}:${sha256(fs.readFileSync(absolute))}`;
      })))
    : [];
  const composerRows = COMPOSER_AGENTS.includes(harness.agent)
    ? THEMES.flatMap(theme => [...harness.approved_composer[theme]].sort().flatMap(composerCase =>
      harness.approved_viewports.map(viewport => {
        const name = composerGoldenName(harness.agent, theme, composerCase, viewport);
        const absolute = path.join(goldenRoot, name);
        assert(fs.existsSync(absolute), `${harness.agent}: approved composer golden missing: ${name}`);
        return `${name}:${sha256(fs.readFileSync(absolute))}`;
      })))
    : [];
  return [...blockRows, ...liveRows, ...layoutRows, ...composerRows];
}

function assertExclusionsAreUnobserved(agent, theme, category, excluded, observed) {
  for (const item of excluded) {
    assert(!observed.has(item),
      `${agent}/${theme}: ${category} ${item} cannot be natively inapplicable because a hashed native source observes it`);
  }
}

function validateManifest(manifest) {
  assert.equal(manifest.schema_version, 5);
  assert.equal(typeof manifest.review_method, 'string');
  assert(manifest.review_method.length > 40);
  assert.deepEqual(manifest.harnesses.map(row => row.agent), AGENTS);

  const approvedBlocks = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const pendingBlocks = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const notApplicableBlocks = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const approvedLiveStatus = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const pendingLiveStatus = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const notApplicableLiveStatus = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const approvedLayouts = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const pendingLayouts = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const notApplicableLayouts = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const approvedComposer = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const pendingComposer = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  const notApplicableComposer = Object.fromEntries(THEMES.map(theme => [theme, 0]));
  let approvedGoldenCases = 0;
  let nativeSources = 0;
  const harnesses = [];

  for (const harness of manifest.harnesses) {
    const exclusions = harness.native_grounding_exclusions || [];
    assert(Array.isArray(exclusions),
      `${harness.agent}: native_grounding_exclusions must be an array`);
    const excludedByTheme = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    const excludedLiveByTheme = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    const excludedLayoutsByTheme = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    const excludedComposerByTheme = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    for (const exclusion of exclusions) {
      assert(THEMES.includes(exclusion.theme), `${harness.agent}: exclusion theme is invalid`);
      const excludedCount = (exclusion.blocks?.length || 0) + (exclusion.live_status?.length || 0)
        + (exclusion.layouts?.length || 0) + (exclusion.composer?.length || 0);
      assert(excludedCount > 0, `${harness.agent}/${exclusion.theme}: exclusion cases are required`);
      assert.equal(typeof exclusion.reason, 'string');
      assert(exclusion.reason.length > 40, `${harness.agent}/${exclusion.theme}: exclusion reason is too weak`);
      assert(Array.isArray(exclusion.evidence) && exclusion.evidence.length > 0,
        `${harness.agent}/${exclusion.theme}: exclusion evidence is required`);
      for (const evidencePath of exclusion.evidence) {
        const evidenceAbsolute = resolveRepoPath(evidencePath, `${harness.agent}/${exclusion.theme} exclusion evidence`);
        assert(fs.existsSync(evidenceAbsolute),
          `${harness.agent}/${exclusion.theme}: exclusion evidence is missing: ${evidencePath}`);
      }
      for (const block of exclusion.blocks || []) {
        assert(BLOCKS.includes(block), `${harness.agent}/${exclusion.theme}: unknown excluded block ${block}`);
        assert(!excludedByTheme[exclusion.theme].has(block),
          `${harness.agent}/${exclusion.theme}: duplicate excluded block ${block}`);
        excludedByTheme[exclusion.theme].add(block);
      }
      for (const liveCase of exclusion.live_status || []) {
        assert(LIVE_STATUS_AGENTS.includes(harness.agent) && LIVE_STATUS_CASES.includes(liveCase),
          `${harness.agent}/${exclusion.theme}: unknown excluded live-status case ${liveCase}`);
        assert(!excludedLiveByTheme[exclusion.theme].has(liveCase));
        excludedLiveByTheme[exclusion.theme].add(liveCase);
      }
      for (const layoutCase of exclusion.layouts || []) {
        assert(LAYOUT_AGENTS.includes(harness.agent) && LAYOUT_CASES.includes(layoutCase),
          `${harness.agent}/${exclusion.theme}: unknown excluded layout case ${layoutCase}`);
        assert(!excludedLayoutsByTheme[exclusion.theme].has(layoutCase));
        excludedLayoutsByTheme[exclusion.theme].add(layoutCase);
      }
      for (const composerCase of exclusion.composer || []) {
        assert(COMPOSER_AGENTS.includes(harness.agent) && COMPOSER_CASES.includes(composerCase),
          `${harness.agent}/${exclusion.theme}: unknown excluded composer case ${composerCase}`);
        assert(!excludedComposerByTheme[exclusion.theme].has(composerCase));
        excludedComposerByTheme[exclusion.theme].add(composerCase);
      }
    }
    for (const theme of THEMES) {
      const approved = harness.approved_blocks?.[theme];
      const pending = harness.pending_blocks?.[theme];
      assert(Array.isArray(approved) && Array.isArray(pending), `${harness.agent}/${theme}: missing block classifications`);
      const classified = [...approved, ...pending, ...excludedByTheme[theme]];
      assert.equal(new Set(classified).size, BLOCKS.length, `${harness.agent}/${theme}: duplicate/missing block classification`);
      assert.deepEqual([...new Set(classified)].sort(), [...BLOCKS].sort(),
        `${harness.agent}/${theme}: every block must be approved, pending, or natively inapplicable`);
      approvedBlocks[theme] += approved.length;
      pendingBlocks[theme] += pending.length;
      notApplicableBlocks[theme] += excludedByTheme[theme].size;
    }
    for (const viewport of harness.approved_viewports) assert(Object.hasOwn(VIEWPORTS, viewport), `${harness.agent}: unknown viewport ${viewport}`);

    const observed = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    const observedLiveStatus = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    const observedLayouts = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    const observedComposer = Object.fromEntries(THEMES.map(theme => [theme, new Set()]));
    assert(Array.isArray(harness.native_sources), `${harness.agent}: native_sources must be an array`);
    const nativeSourcePaths = new Set();
    for (const source of harness.native_sources) {
      const absolute = resolveRepoPath(source.path, `${harness.agent} native source`);
      const sourceKey = path.relative(ROOT, absolute).toLowerCase();
      assert(!nativeSourcePaths.has(sourceKey), `${harness.agent}: duplicate native source path: ${source.path}`);
      nativeSourcePaths.add(sourceKey);
      assert(fs.existsSync(absolute), `${harness.agent}: native source missing: ${source.path}`);
      const buffer = fs.readFileSync(absolute);
      assert.equal(sha256(buffer), source.sha256, `${harness.agent}: native source hash changed: ${source.path}`);
      const png = PNG.sync.read(buffer);
      assert.equal(png.width, source.width, `${harness.agent}: native source width changed`);
      assert.equal(png.height, source.height, `${harness.agent}: native source height changed`);
      assert.equal(typeof source.review_note, 'string');
      assert(source.review_note.length > 30);
      assert(THEMES.includes(source.theme), `${harness.agent}: native source theme is required`);
      assert(Array.isArray(source.observed_blocks), `${harness.agent}: observed_blocks must be an array`);
      assert.equal(new Set(source.observed_blocks).size, source.observed_blocks.length,
        `${harness.agent}: duplicate observed block in ${source.path}`);
      for (const block of source.observed_blocks) {
        assert(BLOCKS.includes(block), `${harness.agent}: unknown observed block ${block}`);
        observed[source.theme].add(block);
      }
      assert(!source.observed_live_status || LIVE_STATUS_AGENTS.includes(harness.agent),
        `${harness.agent}: observed live-status is not supported for this harness`);
      for (const liveCase of source.observed_live_status || []) {
        assert(LIVE_STATUS_CASES.includes(liveCase), `${harness.agent}: unknown observed live-status case ${liveCase}`);
        observedLiveStatus[source.theme].add(liveCase);
      }
      assert(!source.observed_layouts || LAYOUT_AGENTS.includes(harness.agent),
        `${harness.agent}: observed layout is not supported for this harness`);
      for (const layoutCase of source.observed_layouts || []) {
        assert(LAYOUT_CASES.includes(layoutCase), `${harness.agent}: unknown observed layout case ${layoutCase}`);
        observedLayouts[source.theme].add(layoutCase);
      }
      assert(!source.observed_composer || COMPOSER_AGENTS.includes(harness.agent),
        `${harness.agent}: observed composer is not supported for this harness`);
      for (const composerCase of source.observed_composer || []) {
        assert(COMPOSER_CASES.includes(composerCase), `${harness.agent}: unknown observed composer case ${composerCase}`);
        observedComposer[source.theme].add(composerCase);
      }
      const observationCount = source.observed_blocks.length
        + (source.observed_live_status?.length || 0)
        + (source.observed_layouts?.length || 0)
        + (source.observed_composer?.length || 0);
      assert(observationCount > 0, `${harness.agent}: native source observes no supported surface: ${source.path}`);
      nativeSources += 1;
    }
    for (const theme of THEMES) {
      assertExclusionsAreUnobserved(harness.agent, theme, 'block', excludedByTheme[theme], observed[theme]);
      assertExclusionsAreUnobserved(harness.agent, theme, 'live-status', excludedLiveByTheme[theme], observedLiveStatus[theme]);
      assertExclusionsAreUnobserved(harness.agent, theme, 'layout', excludedLayoutsByTheme[theme], observedLayouts[theme]);
      assertExclusionsAreUnobserved(harness.agent, theme, 'composer', excludedComposerByTheme[theme], observedComposer[theme]);
      for (const block of harness.approved_blocks[theme]) {
        assert(observed[theme].has(block), `${harness.agent}/${theme}: ${block} approved without a matching native observation`);
      }
    }

    if (LIVE_STATUS_AGENTS.includes(harness.agent)) {
      for (const theme of THEMES) {
        const approved = harness.approved_live_status?.[theme];
        const pending = harness.pending_live_status?.[theme];
        assert(Array.isArray(approved) && Array.isArray(pending), `${harness.agent}/${theme}: missing live-status classifications`);
        assert.equal(new Set([...approved, ...pending, ...excludedLiveByTheme[theme]]).size, LIVE_STATUS_CASES.length,
          `${harness.agent}/${theme}: duplicate/missing live-status classification`);
        assert.deepEqual([...new Set([...approved, ...pending, ...excludedLiveByTheme[theme]])].sort(), [...LIVE_STATUS_CASES].sort(),
          `${harness.agent}/${theme}: every live-status case must be approved, pending, or natively inapplicable`);
        for (const liveCase of approved) {
          assert(observedLiveStatus[theme].has(liveCase),
            `${harness.agent}/${theme}: ${liveCase} approved without a matching native live-status observation`);
        }
        approvedLiveStatus[theme] += approved.length;
        pendingLiveStatus[theme] += pending.length;
        notApplicableLiveStatus[theme] += excludedLiveByTheme[theme].size;
      }
    } else {
      assert(!harness.approved_live_status && !harness.pending_live_status,
        `${harness.agent}: live-status classifications are only valid for live-status agents`);
    }

    if (LAYOUT_AGENTS.includes(harness.agent)) {
      for (const theme of THEMES) {
        const approved = harness.approved_layouts?.[theme];
        const pending = harness.pending_layouts?.[theme];
        assert(Array.isArray(approved) && Array.isArray(pending), `${harness.agent}/${theme}: missing layout classifications`);
        assert.equal(new Set([...approved, ...pending, ...excludedLayoutsByTheme[theme]]).size, LAYOUT_CASES.length,
          `${harness.agent}/${theme}: duplicate/missing layout classification`);
        assert.deepEqual([...new Set([...approved, ...pending, ...excludedLayoutsByTheme[theme]])].sort(), [...LAYOUT_CASES].sort(),
          `${harness.agent}/${theme}: every layout case must be approved, pending, or natively inapplicable`);
        for (const layoutCase of approved) {
          assert(observedLayouts[theme].has(layoutCase),
            `${harness.agent}/${theme}: ${layoutCase} approved without a matching native layout observation`);
        }
        approvedLayouts[theme] += approved.length;
        pendingLayouts[theme] += pending.length;
        notApplicableLayouts[theme] += excludedLayoutsByTheme[theme].size;
      }
    } else {
      assert(!harness.approved_layouts && !harness.pending_layouts,
        `${harness.agent}: layout classifications are only valid for layout agents`);
    }

    if (COMPOSER_AGENTS.includes(harness.agent)) {
      for (const theme of THEMES) {
        const approved = harness.approved_composer?.[theme];
        const pending = harness.pending_composer?.[theme];
        assert(Array.isArray(approved) && Array.isArray(pending), `${harness.agent}/${theme}: missing composer classifications`);
        assert.equal(new Set([...approved, ...pending, ...excludedComposerByTheme[theme]]).size, COMPOSER_CASES.length,
          `${harness.agent}/${theme}: duplicate/missing composer classification`);
        assert.deepEqual([...new Set([...approved, ...pending, ...excludedComposerByTheme[theme]])].sort(), [...COMPOSER_CASES].sort(),
          `${harness.agent}/${theme}: every composer case must be approved, pending, or natively inapplicable`);
        for (const composerCase of approved) {
          assert(observedComposer[theme].has(composerCase),
            `${harness.agent}/${theme}: ${composerCase} approved without a matching native composer observation`);
        }
        approvedComposer[theme] += approved.length;
        pendingComposer[theme] += pending.length;
        notApplicableComposer[theme] += excludedComposerByTheme[theme].size;
      }
    } else {
      assert(!harness.approved_composer && !harness.pending_composer,
        `${harness.agent}: composer classifications are only valid for composer agents`);
    }

    const goldenRows = approvedGoldenRows(manifest, harness);
    const approvalCount = THEMES.reduce((count, theme) => count
      + harness.approved_blocks[theme].length
      + (harness.approved_live_status?.[theme]?.length || 0)
      + (harness.approved_layouts?.[theme]?.length || 0)
      + (harness.approved_composer?.[theme]?.length || 0), 0);
    if (approvalCount) {
      assert.deepEqual(harness.approved_viewports, ['desktop', 'mobile']);
      assert.equal(sha256(Buffer.from(goldenRows.join('\n'))), harness.approved_golden_set_sha256,
        `${harness.agent}: approved golden set changed; repeat native review before accepting it`);
      assert.equal(harness.status, 'partial_native_approval');
    } else {
      assert.equal(harness.approved_golden_set_sha256, null);
      assert.equal(harness.status, 'native_source_required');
      assert.equal(harness.native_sources.length, 0);
      assert.equal(typeof harness.blocker, 'string');
    }

    approvedGoldenCases += goldenRows.length;
    harnesses.push({
      agent: harness.agent,
      status: harness.status,
      native_sources: harness.native_sources.length,
      approved_blocks: Object.fromEntries(THEMES.map(theme => [theme, harness.approved_blocks[theme].length])),
      approved_live_status: LIVE_STATUS_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, harness.approved_live_status[theme].length]))
        : null,
      approved_layouts: LAYOUT_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, harness.approved_layouts[theme].length]))
        : null,
      approved_composer: COMPOSER_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, harness.approved_composer[theme].length]))
        : null,
      approved_golden_cases: goldenRows.length,
      pending_blocks: Object.fromEntries(THEMES.map(theme => [theme, harness.pending_blocks[theme].length])),
      not_applicable_blocks: Object.fromEntries(THEMES.map(theme => [theme, excludedByTheme[theme].size])),
      pending_live_status: LIVE_STATUS_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, harness.pending_live_status[theme].length]))
        : null,
      not_applicable_live_status: LIVE_STATUS_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, excludedLiveByTheme[theme].size]))
        : null,
      pending_layouts: LAYOUT_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, harness.pending_layouts[theme].length]))
        : null,
      not_applicable_layouts: LAYOUT_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, excludedLayoutsByTheme[theme].size]))
        : null,
      pending_composer: COMPOSER_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, harness.pending_composer[theme].length]))
        : null,
      not_applicable_composer: COMPOSER_AGENTS.includes(harness.agent)
        ? Object.fromEntries(THEMES.map(theme => [theme, excludedComposerByTheme[theme].size]))
        : null,
    });
  }

  const viewportCount = Object.keys(VIEWPORTS).length;
  const totalVisualCases = (
    (AGENTS.length * BLOCKS.length)
    + (LIVE_STATUS_AGENTS.length * LIVE_STATUS_CASES.length)
    + SIDEBAR_CASES.length
    + (LAYOUT_AGENTS.length * LAYOUT_CASES.length)
    + (COMPOSER_AGENTS.length * COMPOSER_CASES.length)
  ) * viewportCount * THEMES.length;
  const pendingNativeCases = THEMES.reduce((count, theme) => count
    + pendingBlocks[theme]
    + pendingLiveStatus[theme]
    + pendingLayouts[theme]
    + pendingComposer[theme], 0) * viewportCount;
  const notApplicableNativeCases = THEMES.reduce((count, theme) => count
    + notApplicableBlocks[theme]
    + notApplicableLiveStatus[theme]
    + notApplicableLayouts[theme]
    + notApplicableComposer[theme], 0) * viewportCount;
  const sharedSourceCases = totalVisualCases - approvedGoldenCases - pendingNativeCases - notApplicableNativeCases;
  assert(sharedSourceCases >= 0, 'native classification exceeds the complete visual matrix');
  const documentationMarker = `<!-- native-golden-totals approved=${approvedGoldenCases} pending=${pendingNativeCases} inapplicable=${notApplicableNativeCases} shared=${sharedSourceCases} total=${totalVisualCases} -->`;
  assert(fs.readFileSync(DOC_PATH, 'utf8').includes(documentationMarker),
    `native golden documentation totals are stale; expected ${documentationMarker}`);

  return {
    ok: true,
    schema_version: 5,
    read_only: true,
    manifest: path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/'),
    documentation: path.relative(ROOT, DOC_PATH).replace(/\\/g, '/'),
    harnesses,
    totals: {
      harnesses: harnesses.length,
      native_sources: nativeSources,
      approved_blocks: approvedBlocks,
      pending_blocks: pendingBlocks,
      not_applicable_blocks: notApplicableBlocks,
      approved_live_status: approvedLiveStatus,
      pending_live_status: pendingLiveStatus,
      not_applicable_live_status: notApplicableLiveStatus,
      approved_layouts: approvedLayouts,
      pending_layouts: pendingLayouts,
      not_applicable_layouts: notApplicableLayouts,
      approved_composer: approvedComposer,
      pending_composer: pendingComposer,
      not_applicable_composer: notApplicableComposer,
      approved_golden_cases: approvedGoldenCases,
      pending_native_cases: pendingNativeCases,
      not_applicable_native_cases: notApplicableNativeCases,
      shared_source_cases: sharedSourceCases,
      total_visual_cases: totalVisualCases,
      light_cases_pending_native_grounding: (
        pendingBlocks.light + pendingLiveStatus.light + pendingLayouts.light + pendingComposer.light
      ) * viewportCount,
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const result = validateManifest(manifest);
  if (options.resultFile) {
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { DOC_PATH, MANIFEST_PATH, approvedGoldenRows, assertExclusionsAreUnobserved, goldenName, layoutGoldenName, liveGoldenName, main, parseArgs, resolveRepoPath, validateManifest };
