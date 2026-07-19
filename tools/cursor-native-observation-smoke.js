#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require(require.resolve('esbuild', {
  paths: [path.join(__dirname, '..', 'frontend')],
}));
const {
  ProxyEngine,
  CURSOR_NATIVE_OBSERVED_SOURCE,
  CURSOR_WORKING_CONTINUITY_LEASE_MS,
  cursorNativeActivity,
} = require('../agent-proxy/proxy-engine');

const ROOT = path.resolve(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cursor-observation-'));
const AGENT_ID = '77777777-7777-4777-8777-777777777777';
const SESSION_ID = 'cursor-native-observation-fixture';
const OBSERVED_AT_MS = Date.parse('2026-07-19T18:00:00.000Z');

function compileRecentChats() {
  const output = path.join(SCRATCH, 'recent-chats.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'android-app', 'lib', 'recent-chats.js')],
    outfile: output,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return require(output);
}

function user(content) { return { role: 'user', content }; }
function assistant(content) { return { role: 'assistant', content }; }

try {
  const engine = Object.create(ProxyEngine.prototype);
  const recent = compileRecentChats();

  const legacy = engine._prepareCursorMessageObservations(AGENT_ID, [
    user('Legacy retained request'),
    assistant('Legacy retained answer'),
  ], { sequence: 0, observeCurrent: false, observedAtMs: OBSERVED_AT_MS });
  assert.strictEqual(legacy.newlyObserved, 0, 'legacy migration must not create a Recent edge');
  assert.strictEqual(new Set(legacy.messages.map(message => message.source_message_id)).size, 2);
  assert(legacy.messages.every(message => message.source === CURSOR_NATIVE_OBSERVED_SOURCE));
  assert(legacy.messages.every(message => message.ts === 0));
  assert.strictEqual(recent.normalizeLatestVisibleMessage({
    session_id: SESSION_ID,
    last_message_id: legacy.messages[1].source_message_id,
    last_message_at: legacy.messages[1].ts,
    last_message_kind: legacy.messages[1].role,
    last_message_source: legacy.messages[1].source,
  }), null, 'baseline-only archives must remain outside Recent chats');

  const appended = engine._prepareCursorMessageObservations(AGENT_ID, [
    ...legacy.messages,
    user('Genuinely new native Cursor request'),
    assistant('Working'),
  ], {
    sequence: legacy.sequence,
    observeCurrent: true,
    observedAtMs: OBSERVED_AT_MS,
  });
  assert.strictEqual(appended.newlyObserved, 2);
  const firstAssistant = appended.messages[3];
  assert(firstAssistant.source_message_id.startsWith(`${CURSOR_NATIVE_OBSERVED_SOURCE}:${AGENT_ID}:4:`));
  assert.strictEqual(firstAssistant.ts, OBSERVED_AT_MS / 1000);

  const streamed = engine._mergeCursorTranscriptWindow(appended.messages.slice(), [
    user('Genuinely new native Cursor request'),
    assistant('Working through the requested producer-to-sidebar verification now.'),
  ]).messages;
  const grownAssistant = streamed[streamed.length - 1];
  assert.strictEqual(grownAssistant.source_message_id, firstAssistant.source_message_id,
    'streaming growth must preserve the first semantic observation identity');
  assert.strictEqual(grownAssistant.ts, firstAssistant.ts,
    'streaming growth must preserve the first-observed timestamp');
  const replay = engine._prepareCursorMessageObservations(AGENT_ID, streamed, {
    sequence: appended.sequence,
    observeCurrent: true,
    observedAtMs: OBSERVED_AT_MS + 60_000,
  });
  assert.strictEqual(replay.newlyObserved, 0);
  assert.strictEqual(replay.messages[replay.messages.length - 1].ts, firstAssistant.ts,
    'poll replay must not refresh an old message timestamp');

  const restartedEngine = Object.create(ProxyEngine.prototype);
  const restarted = restartedEngine._prepareCursorMessageObservations(AGENT_ID, replay.messages, {
    sequence: replay.sequence,
    observeCurrent: false,
    observedAtMs: OBSERVED_AT_MS + 120_000,
  });
  assert.strictEqual(restarted.changed, false);
  assert.strictEqual(restarted.messages[restarted.messages.length - 1].source_message_id, firstAssistant.source_message_id);
  assert.strictEqual(restarted.messages[restarted.messages.length - 1].ts, firstAssistant.ts);

  const cursorSession = {
    session_id: SESSION_ID,
    latest_visible_message: {
      id: firstAssistant.source_message_id,
      at: new Date(firstAssistant.ts * 1000).toISOString(),
      kind: firstAssistant.role,
      source: firstAssistant.source,
    },
  };
  let ownership = recent.projectRecentChatOwnership([cursorSession], {
    workingSessionIds: new Set([SESSION_ID]),
  });
  assert.strictEqual(ownership.ownership[SESSION_ID], 'working');
  ownership = recent.projectRecentChatOwnership([cursorSession], { workingSessionIds: new Set() });
  assert.strictEqual(ownership.ownership[SESSION_ID], 'recent');

  let structuralMoves = 0;
  let previousOwner = ownership.ownership[SESSION_ID];
  for (let sample = 0; sample < 600; sample += 1) {
    const projected = recent.projectRecentChatOwnership([cursorSession], { workingSessionIds: new Set() });
    if (projected.ownership[SESSION_ID] !== previousOwner) structuralMoves += 1;
    previousOwner = projected.ownership[SESSION_ID];
  }
  assert.strictEqual(structuralMoves, 0, 'identical inventory replay must not move the card');

  const newer = Array.from({ length: 5 }, (_, index) => ({
    session_id: `newer-${index}`,
    latest_visible_message: {
      id: `newer-message-${index}`,
      at: new Date(OBSERVED_AT_MS + ((index + 1) * 1000)).toISOString(),
      kind: 'assistant',
      source: 'fixture_stream',
    },
  }));
  ownership = recent.projectRecentChatOwnership([cursorSession, ...newer], { workingSessionIds: new Set() });
  assert.strictEqual(ownership.ownership[SESSION_ID], 'workspace');

  const working = cursorNativeActivity({ native_status: 'working' }, null, { nowMs: OBSERVED_AT_MS });
  const dead = cursorNativeActivity({}, working, {
    nowMs: OBSERVED_AT_MS + CURSOR_WORKING_CONTINUITY_LEASE_MS + 1,
  });
  assert.strictEqual(dead.kind, 'idle');

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    cursor_agent_id: AGENT_ID,
    session_id: SESSION_ID,
    legacy_rows_suppressed: legacy.messages.length,
    durable_message_id: firstAssistant.source_message_id,
    durable_message_at: new Date(firstAssistant.ts * 1000).toISOString(),
    streaming_identity_stable: true,
    restart_identity_stable: true,
    replay_samples: 600,
    structural_moves: structuralMoves,
    transitions: ['working', 'recent', 'workspace'],
    dead_owner_lease_ms: CURSOR_WORKING_CONTINUITY_LEASE_MS,
  }, null, 2)}\n`);
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}
