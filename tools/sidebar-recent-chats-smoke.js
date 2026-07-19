#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(require.resolve('esbuild', { paths: [path.join(__dirname, '..', 'frontend')] }));

const ROOT = path.join(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-sidebar-recent-'));
const OUTPUT_ARG = process.argv.indexOf('--output');
const OUTPUT = OUTPUT_ARG >= 0 ? path.resolve(process.argv[OUTPUT_ARG + 1]) : null;
const NOW_MS = Date.parse('2026-07-16T20:00:00.000Z');
const HARNESS_TYPES = [
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini', 'continue', 'continue_yolo',
  'roo_code', 'cline', 'antigravity', 'antigravity_panel', 'antigravity-v2',
];
const VISIBLE_KINDS = ['user', 'assistant', 'tool', 'tool_result', 'permission', 'error', 'system'];

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

function makeFixture() {
  const sessions = [];
  const workingSessionIds = new Set();
  const pinnedSessionIds = new Set();
  const excludedSessionIds = new Set();
  for (let index = 0; index < 96; index += 1) {
    const id = `session-${String(index).padStart(3, '0')}`;
    const messageAt = NOW_MS - ((index - 12) * 60_000);
    const kind = VISIBLE_KINDS[index % VISIBLE_KINDS.length];
    const session = {
      session_id: id,
      agent_type: HARNESS_TYPES[index % HARNESS_TYPES.length],
      project_root: `C:\\work\\workspace-${index % 7}`,
      workspace_path: `C:\\work\\workspace-${index % 7}\\${id}`,
      chat_title: `Fixture ${index}`,
      created_at: new Date(NOW_MS + (index * 10_000)).toISOString(),
      last_seen_at: new Date(NOW_MS + (index * 20_000)).toISOString(),
      activity: { kind: 'idle', updated_at: new Date(NOW_MS + (index * 30_000)).toISOString() },
    };
    if (index >= 12 && index < 88) {
      if (index % 2 === 0) {
        session.latest_visible_message = {
          id: `message-${String(500 - index).padStart(4, '0')}`,
          at: new Date(messageAt).toISOString(),
          kind,
          source: 'relay_persisted',
        };
      } else {
        session.last_message_id = `message-${String(500 - index).padStart(4, '0')}`;
        session.last_message_at = messageAt / 1000;
        session.last_message_kind = kind;
        session.last_message_source = 'relay_persisted';
      }
    }
    if (index < 12) workingSessionIds.add(id);
    if (index % 5 === 0) pinnedSessionIds.add(id);
    if (index === 72 || index === 73) {
      session.archived = true;
      excludedSessionIds.add(id);
    }
    if (index === 74 || index === 75) {
      session.is_test_session = true;
      excludedSessionIds.add(id);
    }
    sessions.push(session);
  }

  // Explicit contract hazards: neither invalid time nor a newer non-message clock is eligible.
  sessions[88].latest_visible_message = {
    id: 'message-invalid-time', at: 'not-a-time', kind: 'assistant', source: 'relay_persisted',
  };
  sessions[89].last_message_at = NOW_MS + 999_000;
  sessions[89].last_message_kind = 'thinking';
  sessions[89].last_message_id = 'message-thinking';
  sessions[90].last_message_at = NOW_MS + 998_000;
  sessions[90].last_message_kind = 'status';
  sessions[90].last_message_id = 'message-status';
  sessions[91].last_message_at = NOW_MS + 997_000;
  sessions[91].last_message_kind = 'heartbeat';
  sessions[91].last_message_id = 'message-heartbeat';

  // Deterministic timestamp tie outside the top five.
  sessions[30].latest_visible_message.at = sessions[31].last_message_at;

  return { sessions, workingSessionIds, pinnedSessionIds, excludedSessionIds };
}

function assertProjection(api, groupsApi, fixture) {
  assert.strictEqual(typeof api.projectRecentChatOwnership, 'function');
  const projected = api.projectRecentChatOwnership(fixture.sessions, {
    workingSessionIds: fixture.workingSessionIds,
    pinnedSessionIds: fixture.pinnedSessionIds,
    excludedSessionIds: fixture.excludedSessionIds,
    limit: 5,
  });
  const visibleIds = fixture.sessions.map(idOf).filter(id => !fixture.excludedSessionIds.has(id));
  const recentIds = projected.recent.map(idOf);
  assert.deepStrictEqual(recentIds, ['session-012', 'session-013', 'session-014', 'session-015', 'session-016']);
  assert.strictEqual(recentIds.length, 5);
  assert.ok(projected.recent.some(session => fixture.pinnedSessionIds.has(idOf(session))), 'recent pinned row missing');
  assert.ok(projected.recent.every(session => !fixture.workingSessionIds.has(idOf(session))));

  const groups = groupsApi.groupSessionsByDirectory(projected.remaining);
  const hierarchy = [
    ...projected.working.map(idOf),
    ...recentIds,
    ...projected.pinned.map(idOf),
    ...groups.flatMap(group => group.sessions.map(idOf)),
  ];
  assert.strictEqual(hierarchy.length, visibleIds.length);
  assert.strictEqual(new Set(hierarchy).size, hierarchy.length);
  assert.deepStrictEqual(new Set(hierarchy), new Set(visibleIds));
  assert.ok(!hierarchy.includes('session-072'));
  assert.ok(!hierarchy.includes('session-073'));
  assert.ok(!hierarchy.includes('session-074'));
  assert.ok(!hierarchy.includes('session-075'));
  assert.ok(!recentIds.includes('session-088'));
  assert.ok(!recentIds.includes('session-089'));
  assert.ok(!recentIds.includes('session-090'));
  assert.ok(!recentIds.includes('session-091'));

  const rankedTie = api.rankRecentChatSessions([fixture.sessions[30], fixture.sessions[31]]).map(idOf);
  assert.deepStrictEqual(rankedTie, ['session-030', 'session-031']);

  const initialOrder = hierarchy.join('|');
  let replayMoves = 0;
  for (let replay = 0; replay < 600; replay += 1) {
    const next = api.projectRecentChatOwnership(fixture.sessions.map(session => ({ ...session })), {
      workingSessionIds: fixture.workingSessionIds,
      pinnedSessionIds: fixture.pinnedSessionIds,
      excludedSessionIds: fixture.excludedSessionIds,
      limit: 5,
    });
    const nextGroups = groupsApi.groupSessionsByDirectory(next.remaining);
    const nextOrder = [
      ...next.working.map(idOf), ...next.recent.map(idOf), ...next.pinned.map(idOf),
      ...nextGroups.flatMap(group => group.sessions.map(idOf)),
    ].join('|');
    if (nextOrder !== initialOrder) replayMoves += 1;
  }
  assert.strictEqual(replayMoves, 0);

  return {
    fixture_sessions: fixture.sessions.length,
    harness_types: new Set(fixture.sessions.map(session => session.agent_type)).size,
    working_sessions: projected.working.length,
    recent_sessions: projected.recent.length,
    visible_sessions: visibleIds.length,
    duplicate_or_missing_visible_sessions: hierarchy.length - new Set(hierarchy).size,
    replay_snapshots: 600,
    replay_moves: replayMoves,
    recent_ids: recentIds,
    hierarchy_sha256: crypto.createHash('sha256').update(initialOrder).digest('hex'),
  };
}

const receipt = {
  schema_version: 1,
  test: 'sidebar-recent-chats-shared-contract',
  generated_at: new Date().toISOString(),
  status: 'FAIL',
};

try {
  const fixture = makeFixture();
  assert.ok(fixture.sessions.length >= 79);
  const webApi = compileModule(path.join(ROOT, 'frontend', 'recent-chats.js'), 'web-recent');
  const androidApi = compileModule(path.join(ROOT, 'android-app', 'lib', 'recent-chats.js'), 'android-recent');
  const webGroups = compileModule(path.join(ROOT, 'frontend', 'workspace-groups.js'), 'web-groups');
  const androidGroups = compileModule(path.join(ROOT, 'android-app', 'lib', 'workspace-groups.js'), 'android-groups');
  const web = assertProjection(webApi, webGroups, fixture);
  const android = assertProjection(androidApi, androidGroups, fixture);
  assert.deepStrictEqual(android, web);
  Object.assign(receipt, { status: 'PASS', web, android, parity: true });
} catch (error) {
  receipt.error = String(error?.stack || error);
}

if (OUTPUT) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (receipt.status !== 'PASS') process.exitCode = 1;
