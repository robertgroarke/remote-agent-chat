#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(require.resolve('esbuild', { paths: [path.join(__dirname, '..', 'frontend')] }));

const repoRoot = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-sidebar-ledger-contract-'));

function compileModule(sourcePath, name) {
  const output = path.join(scratch, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [sourcePath], outfile: output, bundle: true, format: 'cjs',
    platform: 'node', target: 'node18', logLevel: 'silent',
  });
  return require(output);
}

function orderShape(groups) {
  return groups.flatMap(group => group.sessions.map(session => session.session_id));
}

function geometry(groups, cardHeight = 55, headerHeight = 36) {
  let top = 0;
  const result = {};
  for (const group of groups) {
    top += headerHeight;
    for (const session of group.sessions) {
      result[session.session_id] = { top, height: cardHeight };
      top += cardHeight;
    }
  }
  return result;
}

try {
  const web = compileModule(path.join(repoRoot, 'frontend', 'workspace-groups.js'), 'web-groups');
  const android = compileModule(path.join(repoRoot, 'android-app', 'lib', 'workspace-groups.js'), 'android-groups');
  const sessions = Array.from({ length: 69 }, (_, index) => ({
    session_id: `sidebar-session-${String(index).padStart(3, '0')}`,
    project_root: `C:\\production-shape\\project-${Math.floor(index / 23) + 1}`,
    workspace_path: `C:\\production-shape\\project-${Math.floor(index / 23) + 1}\\lane-${index}`,
    last_seen_at: new Date(Date.parse('2026-07-13T12:00:00Z') - index * 1_000).toISOString(),
  }));
  const initialActivities = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    `sidebar-session-${String(index).padStart(3, '0')}`,
    { kind: 'working', updated_at: new Date(Date.parse('2026-07-13T12:30:00Z') - index * 1_000).toISOString() },
  ]));
  const refreshedActivities = {
    ...initialActivities,
    'sidebar-session-004': { kind: 'working', updated_at: '2026-07-13T12:45:00Z' },
  };
  const rawWeb = web.groupSessionsByDirectory(sessions);
  const rawAndroid = android.groupSessionsByDirectory(sessions);
  const currentWebPreferred = web.orderSidebarGroups(rawWeb, { activities: refreshedActivities });
  const currentAndroidPreferred = android.orderSidebarGroups(rawAndroid, { activities: refreshedActivities });
  const initialWebPreferred = web.orderSidebarGroups(rawWeb, { activities: initialActivities });
  const initialAndroidPreferred = android.orderSidebarGroups(rawAndroid, { activities: initialActivities });
  const preImplementationMoved = orderShape(initialAndroidPreferred)
    .filter((id, index) => orderShape(currentAndroidPreferred)[index] !== id).length;
  const androidSource = fs.readFileSync(path.join(repoRoot, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');

  const baseline = {
    status: typeof android.reconcileSidebarOrderLedger === 'function' ? 'LEDGER_PRESENT' : 'FAIL',
    production_shape_sessions: sessions.length,
    current_refresh_moved_sessions: preImplementationMoved,
    current_layout_animation_present: /LayoutAnimation(?:\.configureNext|,|\s)/.test(androidSource),
    web_android_preferred_order_parity: JSON.stringify(orderShape(currentWebPreferred)) === JSON.stringify(orderShape(currentAndroidPreferred)),
    stable_ledger_api_present: typeof web.createSidebarOrderLedger === 'function'
      && typeof web.reconcileSidebarOrderLedger === 'function'
      && typeof web.sortSidebarOrderLedger === 'function'
      && typeof android.createSidebarOrderLedger === 'function'
      && typeof android.reconcileSidebarOrderLedger === 'function'
      && typeof android.sortSidebarOrderLedger === 'function',
  };
  console.log(JSON.stringify(baseline, null, 2));

  assert.equal(typeof web.createSidebarOrderLedger, 'function', 'web stable sidebar ledger is required');
  assert.equal(typeof web.reconcileSidebarOrderLedger, 'function', 'web sidebar ledger reconciliation is required');
  assert.equal(typeof android.createSidebarOrderLedger, 'function', 'Android stable sidebar ledger is required');
  assert.equal(typeof android.reconcileSidebarOrderLedger, 'function', 'Android sidebar ledger reconciliation is required');
  assert.equal(typeof web.sortSidebarOrderLedger, 'function', 'web explicit sidebar sort is required');
  assert.equal(typeof android.sortSidebarOrderLedger, 'function', 'Android explicit sidebar sort is required');

  const webLedger = web.createSidebarOrderLedger(rawWeb, { activities: initialActivities });
  const androidLedger = android.createSidebarOrderLedger(rawAndroid, { activities: initialActivities });
  const refreshedWeb = web.reconcileSidebarOrderLedger(webLedger, rawWeb, { activities: refreshedActivities });
  const refreshedAndroid = android.reconcileSidebarOrderLedger(androidLedger, rawAndroid, { activities: refreshedActivities });
  assert.deepStrictEqual(orderShape(refreshedWeb.groups), orderShape(initialWebPreferred), 'web ordinary refresh must preserve placement');
  assert.deepStrictEqual(orderShape(refreshedAndroid.groups), orderShape(initialAndroidPreferred), 'Android ordinary refresh must preserve placement');
  assert.deepStrictEqual(geometry(refreshedAndroid.groups), geometry(initialAndroidPreferred), 'Android virtual card geometry must be unchanged');
  assert.equal(refreshedWeb.orderChanged, true, 'web must expose preferred-order drift');
  assert.equal(refreshedAndroid.orderChanged, true, 'Android must expose preferred-order drift');

  const lateMetadataSessions = sessions.map(session => session.session_id === 'sidebar-session-010'
    ? { ...session, project_root: 'C:\\production-shape\\project-3', workspace_path: 'C:\\production-shape\\project-3\\late' }
    : session);
  const lateWebGroups = web.groupSessionsByDirectory(lateMetadataSessions);
  const lateAndroidGroups = android.groupSessionsByDirectory(lateMetadataSessions);
  const lateWeb = web.reconcileSidebarOrderLedger(refreshedWeb.ledger, lateWebGroups, { activities: refreshedActivities });
  const lateAndroid = android.reconcileSidebarOrderLedger(refreshedAndroid.ledger, lateAndroidGroups, { activities: refreshedActivities });
  assert.equal(lateWeb.ledger.groupBySession['sidebar-session-010'], webLedger.groupBySession['sidebar-session-010']);
  assert.equal(lateAndroid.ledger.groupBySession['sidebar-session-010'], androidLedger.groupBySession['sidebar-session-010']);

  const newSession = {
    session_id: 'sidebar-session-new', project_root: 'C:\\production-shape\\project-2',
    workspace_path: 'C:\\production-shape\\project-2\\new', last_seen_at: '2026-07-13T13:00:00Z',
  };
  const addedWebGroups = web.groupSessionsByDirectory([...lateMetadataSessions, newSession]);
  const addedAndroidGroups = android.groupSessionsByDirectory([...lateMetadataSessions, newSession]);
  const addedWeb = web.reconcileSidebarOrderLedger(lateWeb.ledger, addedWebGroups, { activities: refreshedActivities });
  const addedAndroid = android.reconcileSidebarOrderLedger(lateAndroid.ledger, addedAndroidGroups, { activities: refreshedActivities });
  const newWebGroup = addedWeb.groups.find(group => group.sessions.some(session => session.session_id === newSession.session_id));
  const newAndroidGroup = addedAndroid.groups.find(group => group.sessions.some(session => session.session_id === newSession.session_id));
  assert.equal(newWebGroup.sessions.at(-1).session_id, newSession.session_id, 'new web session must append');
  assert.equal(newAndroidGroup.sessions.at(-1).session_id, newSession.session_id, 'new Android session must append');

  const sortedWebLedger = web.sortSidebarOrderLedger(addedWeb.ledger, addedWebGroups, { activities: refreshedActivities });
  const sortedAndroidLedger = android.sortSidebarOrderLedger(addedAndroid.ledger, addedAndroidGroups, { activities: refreshedActivities });
  const sortedWeb = web.reconcileSidebarOrderLedger(sortedWebLedger, addedWebGroups, { activities: refreshedActivities });
  const sortedAndroid = android.reconcileSidebarOrderLedger(sortedAndroidLedger, addedAndroidGroups, { activities: refreshedActivities });
  assert.deepStrictEqual(orderShape(sortedWeb.groups), orderShape(sortedAndroid.groups), 'explicit sort must have web/Android parity');
  assert.equal(sortedWeb.orderChanged, false);
  assert.equal(sortedAndroid.orderChanged, false);

  assert.doesNotMatch(androidSource, /LayoutAnimation(?:\.configureNext|,|\s)/, 'Android refresh list must not use LayoutAnimation');
  assert.match(androidSource, /maintainVisibleContentPosition/, 'Android must preserve the visible anchor on structural removal');
  assert.match(androidSource, /keyExtractor=\{item => sessionId\(item\)\}/, 'Android cards must keep stable session keys');
  assert.match(androidSource, /Order changed/);
  assert.match(androidSource, /Sort now/);

  console.log(JSON.stringify({
    status: 'PASS', production_shape_sessions: sessions.length,
    refresh_order_stable: true, refresh_geometry_stable: true,
    late_metadata_queued: true, new_session_appended: true,
    explicit_sort_parity: true, layout_animation_removed: true,
  }, null, 2));
} finally {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
}
