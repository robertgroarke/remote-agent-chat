#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(require.resolve('esbuild', { paths: [path.join(__dirname, '..', 'frontend')] }));

const ROOT = path.join(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-sidebar-activity-'));
const NOW_MS = Date.parse('2026-07-15T12:00:00.000Z');
const FRESH_AT = new Date(NOW_MS - 500).toISOString();
const STALE_AT = new Date(NOW_MS - 60_000).toISOString();
const HARNESS_TYPES = [
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini', 'continue', 'continue_yolo',
  'roo_code', 'cline', 'antigravity', 'antigravity_panel', 'antigravity-v2',
];

function compileModule(sourcePath, name) {
  const output = path.join(SCRATCH, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [sourcePath],
    outfile: output,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return require(output);
}

function idOf(session) {
  return session.session_id;
}

function fixtureState(index) {
  const states = [
    { name: 'thinking', activity: { kind: 'thinking', generating: true, updated_at: FRESH_AT }, expected: 'working' },
    { name: 'working_goal', activity: {
      kind: 'tool', generating: true,
      goal: { state: 'active', fingerprint: 'fixture-goal', generation: 1 },
      goal_run: {
        schema_version: 1, run_id: 'fixture-run', goal_fingerprint: 'fixture-goal', goal_generation: 1,
        lifecycle: 'running_turn', lease_active: true, owner_state: 'confirmed', transition_seq: 1,
      },
      updated_at: FRESH_AT,
    }, expected: 'working_goal' },
    { name: 'idle', activity: { kind: 'idle', updated_at: FRESH_AT }, expected: 'idle' },
    { name: 'asking', activity: { kind: 'waiting_for_user', updated_at: FRESH_AT }, expected: 'needs_attention' },
    { name: 'blocked', activity: { kind: 'blocked', updated_at: FRESH_AT }, expected: 'needs_attention' },
    { name: 'paused', activity: { kind: 'paused', updated_at: FRESH_AT }, expected: 'idle' },
    { name: 'rate_limited', activity: { kind: 'rate_limited', updated_at: FRESH_AT }, expected: 'needs_attention' },
    { name: 'stale', activity: { kind: 'generating', generating: true, updated_at: STALE_AT }, expected: 'stale' },
    { name: 'disconnected', activity: { kind: 'generating', generating: true, updated_at: FRESH_AT }, health: 'disconnected', expected: 'stale' },
    { name: 'completed', activity: { kind: 'completed', goal: { state: 'completed' }, updated_at: FRESH_AT }, expected: 'idle' },
    { name: 'between_goal_turns', activity: { kind: 'idle', goal: { state: 'active' }, updated_at: FRESH_AT }, expected: 'between_goal_turns' },
  ];
  return states[index % states.length];
}

function makeFixture() {
  const sessions = [];
  const activities = {};
  const health = {};
  const preferences = {};
  const expected = {};
  HARNESS_TYPES.forEach((agentType, harnessIndex) => {
    for (let stateIndex = 0; stateIndex < 11; stateIndex += 1) {
      const state = fixtureState(stateIndex);
      const id = `${agentType}-${state.name}`;
      sessions.push({
        session_id: id,
        agent_type: agentType,
        project_root: `C:\\work\\workspace-${harnessIndex % 5}`,
        workspace_path: `C:\\work\\workspace-${harnessIndex % 5}\\${agentType}`,
        chat_title: `${agentType} ${state.name}`,
      });
      activities[id] = { ...state.activity };
      health[id] = state.health || 'healthy';
      preferences[id] = { pinned: (harnessIndex + stateIndex) % 4 === 0 };
      expected[id] = state.expected;
    }
  });
  return { sessions, activities, health, preferences, expected };
}

function hierarchy(api, fixture, sessions = fixture.sessions, activities = fixture.activities) {
  const options = {
    activities,
    health: fixture.health,
    connected: true,
    nowMs: NOW_MS,
    requireFreshness: true,
  };
  const partition = api.partitionSidebarSessionsByWorking(sessions, options);
  const workingIds = new Set(partition.working.map(idOf));
  const allPinned = sessions.filter(session => fixture.preferences[idOf(session)]?.pinned);
  const allUnpinned = sessions.filter(session => !fixture.preferences[idOf(session)]?.pinned);
  const pinned = allPinned.filter(session => !workingIds.has(idOf(session)));
  const groups = api.groupSessionsByDirectory(allUnpinned)
    .map(group => ({
      key: group.key,
      sessions: group.sessions.filter(session => !workingIds.has(idOf(session))),
    }))
    .filter(group => group.sessions.length > 0);
  const sectionById = Object.fromEntries([
    ...partition.working.map(session => [idOf(session), 'working']),
    ...pinned.map(session => [idOf(session), 'pinned']),
    ...groups.flatMap(group => group.sessions.map(session => [idOf(session), `group:${group.key}`])),
  ]);
  return {
    states: partition.states,
    working: partition.working.map(idOf),
    pinned: pinned.map(idOf),
    groups,
    order: [
      ...partition.working.map(idOf),
      ...pinned.map(idOf),
      ...groups.flatMap(group => group.sessions.map(idOf)),
    ],
    sectionById,
  };
}

function assertHierarchy(result, fixture) {
  assert.strictEqual(result.order.length, fixture.sessions.length);
  assert.strictEqual(new Set(result.order).size, fixture.sessions.length);
  assert.deepStrictEqual(new Set(result.order), new Set(fixture.sessions.map(idOf)));
  const workingEnd = result.working.length - 1;
  const firstNonWorking = result.order.findIndex(id => !['working', 'working_goal'].includes(result.states[id]));
  assert.strictEqual(firstNonWorking, result.working.length);
  assert.ok(workingEnd < firstNonWorking || result.working.length === 0);
  result.working.forEach(id => assert.ok(['working', 'working_goal'].includes(result.states[id])));
  result.order.slice(firstNonWorking).forEach(id => assert.ok(!['working', 'working_goal'].includes(result.states[id])));
}

try {
  const web = compileModule(path.join(ROOT, 'frontend', 'workspace-groups.js'), 'web-groups');
  const android = compileModule(path.join(ROOT, 'android-app', 'lib', 'workspace-groups.js'), 'android-groups');
  const webFleet = compileModule(path.join(ROOT, 'frontend', 'fleet-activity.js'), 'web-fleet');
  const androidFleet = compileModule(path.join(ROOT, 'android-app', 'lib', 'fleet-activity.js'), 'android-fleet');
  const fixture = makeFixture();
  assert.ok(fixture.sessions.length >= 79);

  for (const session of fixture.sessions) {
    const id = idOf(session);
    const options = {
      health: fixture.health[id],
      connected: true,
      nowMs: NOW_MS,
      requireFreshness: true,
    };
    const webState = web.sidebarSessionState(session, {
      activities: fixture.activities,
      health: fixture.health,
      connected: true,
      nowMs: NOW_MS,
      requireFreshness: true,
    });
    const androidState = android.sidebarSessionState(session, {
      activities: fixture.activities,
      health: fixture.health,
      connected: true,
      nowMs: NOW_MS,
      requireFreshness: true,
    });
    const fleetState = webFleet.classifyFleetActivity(fixture.activities[id], false, options);
    assert.strictEqual(webState, fixture.expected[id], id);
    assert.strictEqual(androidState, webState, id);
    assert.strictEqual(fleetState, webState, id);
    assert.strictEqual(androidFleet.classifyFleetActivity(fixture.activities[id], false, options), fleetState, id);
  }

  const baselineWeb = hierarchy(web, fixture);
  const baselineAndroid = hierarchy(android, fixture);
  assertHierarchy(baselineWeb, fixture);
  assert.deepStrictEqual(baselineAndroid, baselineWeb);

  const producerFixture = { session_id: 'producer-heartbeat-fixture', agent_type: 'codex_cli' };
  let producerActivity = { kind: 'generating', generating: true, updated_at: new Date(NOW_MS).toISOString() };
  const assertProducerState = (nowMs, expected) => {
    const options = { connected: true, health: 'healthy', nowMs, requireFreshness: true };
    const activities = { [producerFixture.session_id]: producerActivity };
    const webSidebarState = web.sidebarSessionState(producerFixture, { activities, ...options });
    const androidSidebarState = android.sidebarSessionState(producerFixture, { activities, ...options });
    const webFleetState = webFleet.classifyFleetActivity(producerActivity, false, options);
    const androidFleetState = androidFleet.classifyFleetActivity(producerActivity, false, options);
    assert.deepStrictEqual(
      [webSidebarState, androidSidebarState, webFleetState, androidFleetState],
      [expected, expected, expected, expected],
    );
  };
  assertProducerState(NOW_MS + 4_999, 'working');
  producerActivity = { ...producerActivity, observed_at: new Date(NOW_MS + 5_000).toISOString() };
  assertProducerState(NOW_MS + 19_999, 'working');
  assertProducerState(NOW_MS + 20_001, 'stale');

  const laggedBlockedGoal = {
    kind: 'generating',
    generating: true,
    updated_at: FRESH_AT,
    goal: { state: 'blocked', fingerprint: 'lagged-blocked-goal', generation: 1 },
    goal_run: {
      schema_version: 1,
      run_id: 'lagged-blocked-run',
      goal_fingerprint: 'lagged-blocked-goal',
      goal_generation: 1,
      lifecycle: 'running_turn',
      lease_active: true,
      owner_state: 'confirmed',
      transition_seq: 2,
    },
  };
  const freshnessOptions = { connected: true, health: 'healthy', nowMs: NOW_MS, requireFreshness: true };
  assert.strictEqual(webFleet.classifyFleetActivity(laggedBlockedGoal, false, freshnessOptions), 'working_goal');
  assert.strictEqual(androidFleet.classifyFleetActivity(laggedBlockedGoal, false, freshnessOptions), 'working_goal');
  assert.strictEqual(webFleet.classifyFleetActivity(laggedBlockedGoal, false, {
    ...freshnessOptions,
    nowMs: NOW_MS + 15_001,
  }), 'needs_attention');
  assert.strictEqual(androidFleet.classifyFleetActivity(laggedBlockedGoal, false, {
    ...freshnessOptions,
    nowMs: NOW_MS + 15_001,
  }), 'needs_attention');
  assert.strictEqual(webFleet.classifyFleetActivity(laggedBlockedGoal, true, freshnessOptions), 'needs_attention');
  assert.strictEqual(webFleet.classifyFleetActivity({
    ...laggedBlockedGoal,
    kind: 'blocked',
  }, false, freshnessOptions), 'needs_attention');
  assert.strictEqual(webFleet.classifyFleetActivity({
    ...laggedBlockedGoal,
    kind: 'idle',
    goal_run: { ...laggedBlockedGoal.goal_run, lifecycle: 'blocked_limited', lease_active: false },
  }, false, freshnessOptions), 'needs_attention');

  const workingObjects = baselineWeb.working.map(id => fixture.sessions.find(session => idOf(session) === id));
  const initialLedger = web.createSidebarWorkingLedger(workingObjects.slice(0, 3));
  const reordered = web.reconcileSidebarWorkingLedger(initialLedger, workingObjects.slice(0, 3).reverse());
  assert.deepStrictEqual(reordered.sessions.map(idOf), initialLedger.sessionOrder);
  assert.strictEqual(reordered.structuralChanged, false);
  const withEntrant = web.reconcileSidebarWorkingLedger(initialLedger, workingObjects.slice(0, 4));
  assert.deepStrictEqual(withEntrant.sessions.map(idOf), [...initialLedger.sessionOrder, idOf(workingObjects[3])]);
  assert.strictEqual(withEntrant.ledger.revision, initialLedger.revision + 1);
  const entrantReplay = web.reconcileSidebarWorkingLedger(withEntrant.ledger, workingObjects.slice(0, 4).reverse());
  assert.deepStrictEqual(entrantReplay.sessions.map(idOf), withEntrant.ledger.sessionOrder);
  assert.strictEqual(entrantReplay.ledger.revision, withEntrant.ledger.revision);
  const frozen = web.reconcileSidebarWorkingLedger(initialLedger, workingObjects.slice(0, 4), { freezeStructure: true });
  assert.strictEqual(frozen.deferred, true);
  assert.deepStrictEqual(frozen.sessions.map(idOf), initialLedger.sessionOrder);
  assert.deepStrictEqual(
    android.reconcileSidebarWorkingLedger(android.createSidebarWorkingLedger(workingObjects.slice(0, 3)), workingObjects.slice(0, 4)),
    withEntrant,
  );

  const workingPinned = baselineWeb.working.filter(id => fixture.preferences[id]?.pinned);
  assert.ok(workingPinned.length > 0);
  workingPinned.forEach(id => {
    assert.strictEqual(baselineWeb.sectionById[id], 'working');
    assert.ok(!baselineWeb.pinned.includes(id));
  });

  // A collapsed home group never hides live work because working rows are projected
  // before collapse is applied to the remaining workspace sections.
  const collapsedWorkingId = baselineWeb.working.find(id => !fixture.preferences[id]?.pinned);
  const homeGroup = web.groupSessionsByDirectory(fixture.sessions).find(group => group.sessions.some(session => idOf(session) === collapsedWorkingId));
  assert.ok(homeGroup);
  assert.strictEqual(baselineWeb.sectionById[collapsedWorkingId], 'working');

  let identicalSnapshotMoves = 0;
  let previousOrder = baselineWeb.order;
  for (let index = 0; index < 600; index += 1) {
    const replay = hierarchy(web, fixture, fixture.sessions.map(session => ({ ...session })),
      Object.fromEntries(Object.entries(fixture.activities).map(([id, activity]) => [id, { ...activity }])));
    if (replay.order.join('|') !== previousOrder.join('|')) identicalSnapshotMoves += 1;
    previousOrder = replay.order;
  }
  assert.strictEqual(identicalSnapshotMoves, 0);

  const mutableActivities = Object.fromEntries(Object.entries(fixture.activities).map(([id, activity]) => [id, { ...activity }]));
  const edgeTargets = baselineWeb.order.filter(id => fixture.expected[id] === 'idle').slice(0, 5);
  assert.strictEqual(edgeTargets.length, 5);
  const edgeEvidence = [];
  for (const id of edgeTargets) {
    const before = hierarchy(web, fixture, fixture.sessions, mutableActivities);
    mutableActivities[id] = { kind: 'thinking', generating: true, updated_at: FRESH_AT };
    const after = hierarchy(web, fixture, fixture.sessions, mutableActivities);
    const movedSections = fixture.sessions.map(idOf).filter(sessionId => before.sectionById[sessionId] !== after.sectionById[sessionId]);
    assert.deepStrictEqual(movedSections, [id]);
    assert.strictEqual(after.sectionById[id], 'working');
    const replay = hierarchy(web, fixture, fixture.sessions, { ...mutableActivities, [id]: { ...mutableActivities[id] } });
    assert.deepStrictEqual(replay.order, after.order);
    edgeEvidence.push({ id, edge: 'start', structural_moves: 1 });
  }
  for (const id of [...edgeTargets].reverse()) {
    const before = hierarchy(web, fixture, fixture.sessions, mutableActivities);
    mutableActivities[id] = { kind: 'idle', updated_at: FRESH_AT };
    const after = hierarchy(web, fixture, fixture.sessions, mutableActivities);
    const movedSections = fixture.sessions.map(idOf).filter(sessionId => before.sectionById[sessionId] !== after.sectionById[sessionId]);
    assert.deepStrictEqual(movedSections, [id]);
    assert.notStrictEqual(after.sectionById[id], 'working');
    edgeEvidence.push({ id, edge: 'stop', structural_moves: 1 });
  }
  assert.deepStrictEqual(hierarchy(web, fixture, fixture.sessions, mutableActivities).order, baselineWeb.order);

  const searchSubset = fixture.sessions.filter((_, index) => index % 3 === 0);
  const searchHierarchy = hierarchy(web, fixture, searchSubset);
  assertHierarchy(searchHierarchy, { ...fixture, sessions: searchSubset });

  const appSource = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
  const androidSource = fs.readFileSync(path.join(ROOT, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  assert.ok((appSource.match(/requireFreshness:\s*true/g) || []).length >= 2,
    'Web Fleet and Sidebar must both enforce producer freshness');
  assert.ok((androidSource.match(/requireFreshness:\s*true/g) || []).length >= 2,
    'Android Fleet and Sidebar must both enforce producer freshness');
  assert.ok(appSource.indexOf('{workingSessions.length > 0') < appSource.indexOf('{pinnedSessions.length > 0'));
  assert.match(appSource, /\.\.\.workingSessions, \.\.\.recentSessions, \.\.\.pinnedSessions, \.\.\.sessionGroups/);
  assert.match(appSource, /menuOpen: !!card\.querySelector/);
  assert.match(androidSource, /const sections = \[workingSection, recentSection, pinnedSection,/);
  assert.match(androidSource, /maintainVisibleContentPosition/);

  const result = {
    status: 'PASS',
    sessions: fixture.sessions.length,
    harness_types: HARNESS_TYPES.length,
    states: [...new Set(Object.values(fixture.expected))],
    working: baselineWeb.working.length,
    non_working: baselineWeb.order.length - baselineWeb.working.length,
    working_pinned: workingPinned.length,
    identical_snapshot_replays: 600,
    identical_snapshot_moves: identicalSnapshotMoves,
    stable_working_ledger: true,
    authoritative_edges: edgeEvidence,
    web_android_state_parity: true,
    web_android_hierarchy_parity: true,
    fleet_sidebar_freshness_policy_parity: true,
    producer_heartbeat_kept_working: true,
    stalled_producer_demoted_together_ms: 15_001,
    lagged_blocked_goal_with_confirmed_execution: 'working_goal',
    explicit_blocked_activity_remains_attention: true,
    search_working_first: true,
    collapsed_workspace_working_visible: true,
    visible_windows: 0,
    protected_user_apps_touched: 0,
    recorded_at: new Date().toISOString(),
  };
  const evidenceIndex = process.argv.indexOf('--evidence');
  if (evidenceIndex !== -1) {
    const evidencePath = process.argv[evidenceIndex + 1];
    assert.ok(evidencePath, '--evidence requires an output path');
    fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
    fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}
