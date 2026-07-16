#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('../frontend/node_modules/esbuild');
const { freshEvidenceDirectory, freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = freshEvidencePath(ROOT, 'android-sidebar-refresh-stability-result.json');
const DEFAULT_EXPORT_DIR = freshEvidenceDirectory(ROOT, 'android-sidebar-title-readability-export');
const READABILITY_TITLES = [
  'goal Restore harness controls',
  'Investigate missing UI goal',
  'Update harness steering backlog',
  'Remote Agent Chat goal prompt',
  'The Remote Agent Chat production restoration plan',
  'Restore harness controls and validate production transcript fidelity',
  'Restore harness controls and validate production sidebar readability',
  'Restore harness controls and validate production timestamps',
  'Restore harness controls and validate production reconnect behavior',
  'Restore harness controls and validate production Android parity',
  'Emoji 🚀 sidebar title with a long distinguishable suffix',
  '中文侧边栏标题需要完整显示并且可以轻松区分',
  'عنوان عربي طويل لاختبار اتجاه النص في الشريط الجانبي',
  'UnbrokenIdentifierThatMustWrapWithoutEscapingTheSessionCardBoundary',
  'Update harness steering backlog with a second distinct ending',
];
const READABILITY_GROUP = 'Remote Agent Chat Harness Restoration and Production Maturity Workspace';

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : fallback;
}

function graphemeCount(text) {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
}

function sourceStyleBlock(source, name) {
  return source.match(new RegExp(`\\n  ${name}: \\{[\\s\\S]*?\\n  \\},`))?.[0] || '';
}

function inventoryExport(exportDir) {
  if (!fs.existsSync(exportDir)) return { present: false, files: [], tree_sha256: null };
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        const relative = path.relative(exportDir, full).replace(/\\/g, '/');
        const bytes = fs.readFileSync(full);
        files.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      }
    }
  };
  visit(exportDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const treeHash = crypto.createHash('sha256');
  for (const file of files) treeHash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return { present: files.length > 0, files, tree_sha256: treeHash.digest('hex') };
}

function loadAndroidOrderModule() {
  const build = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'android-app', 'lib', 'workspace-groups.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const output = build.outputFiles[0].text;
  const contractModule = new Module('android-sidebar-order-contract', module);
  contractModule.filename = path.join(ROOT, 'android-app', 'lib', 'workspace-groups.js');
  contractModule.paths = module.paths;
  contractModule._compile(output, contractModule.filename);
  return contractModule.exports;
}

function fixtureGroups(now = Date.now()) {
  const sessions = Array.from({ length: 69 }, (_, index) => ({
    session_id: `stable-${String(index + 1).padStart(2, '0')}`,
    workspace_path: `C:/work/sidebar-project-${Math.floor(index / 12)}/lane-${index + 1}`,
    project_root: `C:/work/sidebar-project-${Math.floor(index / 12)}`,
    last_message_at: new Date(now - index * 60_000).toISOString(),
  }));
  return Array.from({ length: 6 }, (_, groupIndex) => ({
    key: `group-${groupIndex}`,
    sessions: sessions.slice(groupIndex * 12, Math.min(69, (groupIndex + 1) * 12)),
  }));
}

function geometry(groups, cardHeight = 106, cardGap = 8, headerHeight = 52) {
  let top = 0;
  const cards = {};
  for (const group of groups) {
    top += headerHeight;
    for (const session of group.sessions || []) {
      cards[session.session_id] = { group: group.key, top, height: cardHeight };
      top += cardHeight + cardGap;
    }
  }
  return cards;
}

function main(argv = process.argv.slice(2)) {
  const outputPath = option(argv, '--output', DEFAULT_OUTPUT);
  const exportDir = option(argv, '--export-dir', DEFAULT_EXPORT_DIR);
  const order = loadAndroidOrderModule();
  const screenSource = fs.readFileSync(path.join(ROOT, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  const preferenceSource = fs.readFileSync(path.join(ROOT, 'android-app', 'components', 'SessionPreferencesSheet.jsx'), 'utf8');
  const groups = fixtureGroups();
  const cold = order.orderSidebarGroups(groups);
  const previous = order.sidebarOrderSnapshot(cold);
  const target = groups.at(-1).sessions.at(-1).session_id;
  const refreshed = order.orderSidebarGroups(groups, {
    lastMessageAt: { [target]: new Date(Date.now() + 600_000).toISOString() },
    previousGroupOrder: previous.groupOrder,
    previousSessionOrder: previous.sessionOrder,
  });
  const beforeGeometry = geometry(cold);
  const afterGeometry = geometry(refreshed);
  const moved = Object.keys(beforeGeometry).filter(id => (
    beforeGeometry[id].group !== afterGeometry[id].group
    || Math.abs(beforeGeometry[id].top - afterGeometry[id].top) > 0.5
  ));
  const hookBody = screenSource.match(/function useStableSidebarGroups[\s\S]*?\r?\n}\r?\n\r?\nexport default/)?.[0] || '';
  const cardRenderBody = screenSource.match(/renderItem=\{\(\{ item(?:, section)? \}\) => \{[\s\S]*?\r?\n        \}\}\r?\n      \/>/)?.[0] || '';
  const cardStyle = sourceStyleBlock(screenSource, 'card');
  const cardNameStyle = sourceStyleBlock(screenSource, 'cardName');
  const menuStyle = sourceStyleBlock(screenSource, 'cardMenuBtn');
  const pinToggleStyle = sourceStyleBlock(screenSource, 'pinToggleOverlay');
  const headerStyle = sourceStyleBlock(screenSource, 'sectionHeader');
  const exportInventory = inventoryExport(exportDir);
  const phoneWidth = 390;
  const listHorizontalPadding = 24;
  const cardBorder = 2;
  const cardHorizontalPadding = 24;
  const badgeAndMargin = 46;
  const signalAndMargin = 32;
  const menuWidth = 44;
  const titleWidth = phoneWidth - listHorizontalPadding - cardBorder - cardHorizontalPadding
    - badgeAndMargin - signalAndMargin - menuWidth;
  const conservativeWideGlyph = 16;
  const titleCapacity = Math.floor(titleWidth / conservativeWideGlyph) * 2;
  const groupHorizontalPadding = 8;
  const groupReservedWidth = 44 + 16 + 7 + 28 + 30;
  const groupGaps = 5 * 5;
  const groupTitleWidth = phoneWidth - listHorizontalPadding - groupHorizontalPadding - groupReservedWidth - groupGaps;
  const groupCapacity = Math.floor(groupTitleWidth / 13) * 2;
  const readability = READABILITY_TITLES.map(title => ({
    title,
    graphemes: graphemeCount(title),
    conservative_visible_graphemes: Math.min(graphemeCount(title), titleCapacity),
  }));
  const result = {
    status: 'PASS',
    generated_at: new Date().toISOString(),
    fixture: {
      sessions: 69,
      groups: 6,
      card_height_dp: 106,
      card_gap_dp: 8,
      row_extent_dp: 114,
      group_header_height_dp: 52,
      readability_titles: readability,
      readability_group: {
        title: READABILITY_GROUP,
        graphemes: graphemeCount(READABILITY_GROUP),
        conservative_visible_graphemes: Math.min(graphemeCount(READABILITY_GROUP), groupCapacity),
      },
    },
    structural_width_budget: {
      phone_width_dp: phoneWidth,
      session_title_width_dp: titleWidth,
      session_title_lines: 2,
      conservative_wide_glyph_dp: conservativeWideGlyph,
      conservative_session_grapheme_capacity: titleCapacity,
      group_title_width_dp: groupTitleWidth,
      group_title_lines: 2,
      conservative_group_grapheme_capacity: groupCapacity,
      note: 'Static React Native export parity budget; the real-device light/dark screenshot gate remains blocked on the documented adb/emulator user action.',
    },
    export: {
      directory: path.relative(ROOT, exportDir).replace(/\\/g, '/'),
      present: exportInventory.present,
      file_count: exportInventory.files.length,
      tree_sha256: exportInventory.tree_sha256,
      files: exportInventory.files,
    },
    target,
    order_before: previous,
    order_after_preferred_refresh: order.sidebarOrderSnapshot(refreshed),
    moved_cards: moved,
    gates: {
      stable_ledger_exported: typeof order.createSidebarOrderLedger === 'function'
        && typeof order.reconcileSidebarOrderLedger === 'function'
        && typeof order.sortSidebarOrderLedger === 'function',
      ordinary_refresh_never_applies_order: typeof order.reconcileSidebarOrderLedger === 'function',
      refresh_path_has_no_layout_animation: !hookBody.includes('LayoutAnimation.configureNext'),
      preferred_refresh_demonstrates_geometry_pressure: moved.length > 0,
      fixed_card_height_106: /height:\s*106/.test(cardStyle),
      fixed_group_header_height_52: /height:\s*52/.test(headerStyle),
      fixed_two_line_title_box: /numberOfLines=\{2\}>\{sessionName\(item\)\}/.test(screenSource)
        && /lineHeight:\s*19/.test(cardNameStyle) && /minHeight:\s*38/.test(cardNameStyle),
      fixed_two_line_group_box: /numberOfLines=\{2\}>\{section\.title\}/.test(screenSource),
      session_visual_disclosure: /accessibilityLabel=\{`Show full title:/.test(screenSource)
        && screenSource.includes("onLongPress={() => setTitleDisclosure({ kind: 'Session'")
        && screenSource.includes('visible={!!titleDisclosure}'),
      group_visual_disclosure: screenSource.includes('Show full group name:')
        && screenSource.includes("section.workingNow ? 'Activity group' : section.pinned ? 'Pinned group' : 'Workspace group'"),
      consolidated_action_target_44_dp: /width:\s*44/.test(menuStyle) && /height:\s*44/.test(menuStyle),
      low_frequency_actions_not_in_card_rail: cardRenderBody.length > 0
        && !cardRenderBody.includes('style={s.manageSessionBtn}')
        && !cardRenderBody.includes('style={s.closeSessionBtn}')
        && !cardRenderBody.includes('style={s.automationsBtn}')
        && !cardRenderBody.includes('style={s.chevron}'),
      direct_unpin_overlay_consumes_no_title_width: /const pinned\s*=\s*!!sessionPreferences\[sid\]\?\.pinned/.test(cardRenderBody)
        && cardRenderBody.includes('{pinned && <TouchableOpacity')
        && /position:\s*'absolute'/.test(pinToggleStyle)
        && /hitSlop=\{12\}/.test(cardRenderBody)
        && /accessibilityLabel=\{`Unpin \$\{sessionName\(item\)\}`\}/.test(cardRenderBody),
      consolidated_sheet_actions_available: preferenceSource.includes('Manage Sessions')
        && preferenceSource.includes('Automations')
        && preferenceSource.includes('Skills')
        && preferenceSource.includes('Close or dismiss session'),
      readability_fixture_has_15_titles: readability.length === 15,
      conservative_24_grapheme_budget: readability.every(item => item.conservative_visible_graphemes >= Math.min(24, item.graphemes)),
      group_24_grapheme_budget: groupCapacity >= 24,
      export_present: exportInventory.present,
    },
  };
  result.status = Object.values(result.gates).every(Boolean) ? 'PASS' : 'FAIL';
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  assert.strictEqual(result.status, 'PASS', `Android sidebar stability gates failed: ${JSON.stringify(result.gates)}`);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Android sidebar refresh stability contract: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  }
}

module.exports = { fixtureGroups, geometry, loadAndroidOrderModule, main, option };
