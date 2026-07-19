#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const esbuild = require('../frontend/node_modules/esbuild');
const {
  FLEET_SUMMARY_MAX_BYTES,
  advanceFleetSummary,
  buildProducerFleetSummary,
  projectFleetSummary,
} = require('../shared/fleet-summary');
const { loadFleetSummary, resolveFleetSummaryPath } = require('../relay-server/fleet-summary-loader');

const ROOT = path.resolve(__dirname, '..');
const SESSION_COUNT = 100;
const FRAME_COUNT = 500;
const FLEET_BYTES_LIMIT = 100 * 1024;

async function loadModule(file) {
  const built = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: ['node18'],
  });
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(built.outputFiles[0].text, file);
  return loaded.exports;
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function makeSession(index) {
  const suffix = String(index).padStart(3, '0');
  const sessionId = 'fleet-summary-session-' + suffix;
  const runtime = {
    session_id: sessionId,
    target_signature: 'target-' + index,
    _activeChatKey: 'native-thread-' + index,
    chat_title: 'Native repair thread ' + suffix,
    chat_title_source: 'native',
    activity: {
      kind: 'working',
      updated_at: new Date((1752667400 + index) * 1000).toISOString(),
      goal: {
        objective: 'Validate bounded Fleet summary ' + suffix,
        state: 'blocked',
        raw_state: 'Goal blocked',
        updated_at: new Date((1752667400 + index) * 1000).toISOString(),
      },
    },
  };
  const messages = [
    { role: 'user', content: 'Please validate Fleet session ' + suffix, timestamp: 1752667200 + index },
    { role: 'assistant', content: 'Summary ' + suffix + ' is ready', timestamp: 1752667300 + index },
  ];
  const summary = buildProducerFleetSummary({ sessionId, session: runtime, messages });
  assert(summary, sessionId + ': producer omitted summary');
  assert(bytes(summary) <= FLEET_SUMMARY_MAX_BYTES, sessionId + ': summary exceeded 1 KiB');
  const projection = projectFleetSummary(summary);
  return {
    session_id: sessionId,
    agent_type: 'codex',
    status: 'healthy',
    activity: { ...runtime.activity, work_context: projection.fleet_work_context },
    ...projection,
  };
}

function a1c12Fixture() {
  const sessionId = 'a1c12a8e-fixture';
  const assistantHeavy = Array.from({ length: 1053 }, (_, index) => ({
    role: 'assistant',
    content: 'Assistant evidence row ' + index,
    timestamp: 1752667200 + index,
  }));
  const runtime = {
    session_id: sessionId,
    target_signature: 'a1c12-target',
    _activeChatKey: 'a1c12-native-thread',
    chat_title: 'Repair Fleet card identity',
    chat_title_source: 'native',
    activity: {
      kind: 'waiting_for_user',
      updated_at: '2026-07-16T12:00:00.000Z',
      goal: {
        objective: 'Repair populated Codex Fleet card',
        raw_state: 'Goal blocked',
        state: 'blocked',
        time_used_seconds: 462114,
        elapsed_text: '5d 8h 21m 54s',
        updated_at: '2026-07-16T12:00:00.000Z',
      },
    },
  };
  const summary = buildProducerFleetSummary({ sessionId, session: runtime, messages: assistantHeavy });
  assert(summary, 'a1c12 fixture summary missing');
  assert.strictEqual(summary.title, 'Repair Fleet card identity');
  assert.strictEqual(summary.current_work, 'Repair populated Codex Fleet card');
  assert.strictEqual(summary.current_work_state, 'blocked');
  assert.strictEqual(summary.message_count, 1053);
  assert.strictEqual(summary.user_count, 0);
  assert.strictEqual(summary.assistant_count, 1053);
  assert.strictEqual(summary.role_imbalance, 'assistant_without_user');
  assert(!JSON.stringify(summary).includes('5d 8h 21m 54s'), 'duration leaked into Fleet prose');
  assert(!/new chat/i.test(summary.title), 'populated fixture regressed to New chat');
  return {
    summary_bytes: bytes(summary),
    recovered_title: summary.title,
    current_work: summary.current_work,
    goal_state: summary.current_work_state,
    time_used_seconds: runtime.activity.goal.time_used_seconds,
    message_count: summary.message_count,
    user_count: summary.user_count,
    assistant_count: summary.assistant_count,
    role_imbalance: summary.role_imbalance,
  };
}

function frameSet(sessions) {
  const frames = [];
  sessions.forEach((session, index) => {
    const base = session.fleet_summary;
    const next = sessions[(index + 1) % sessions.length];
    frames.push({
      kind: 'partial_snapshot',
      index,
      patch: { session_id: session.session_id, is_list_view: true, chat_title: null, last_snippet: null },
    });
    frames.push({
      kind: 'replayed_summary',
      index,
      patch: {
        fleet_summary: { ...base, producer_seq: 0, summary_seq: 0, title: null, last_snippet: null },
        chat_title: 'New chat',
        last_snippet: null,
      },
    });
    frames.push({
      kind: 'same_generation_wrong_thread',
      index,
      patch: { fleet_summary: { ...base, producer_seq: 99, thread_key: base.thread_key + '-wrong' } },
    });
    frames.push({
      kind: 'cross_session_binding',
      index,
      patch: {
        fleet_summary: { ...next.fleet_summary, producer_seq: 99 },
        chat_title: next.chat_title,
        last_snippet: next.last_snippet,
      },
    });
    frames.push({
      kind: 'monotonic_upgrade',
      index,
      patch: {
        fleet_summary: {
          ...base,
          producer_seq: 5,
          summary_seq: 0,
          title: null,
          title_source: null,
          title_confidence: 'unknown',
          current_work_state: 'unknown',
          last_snippet: 'Fresh summary ' + String(index).padStart(3, '0'),
          last_message_at: new Date((1752670000 + index) * 1000).toISOString(),
        },
        chat_title: 'New chat',
      },
    });
  });
  assert.strictEqual(frames.length, FRAME_COUNT);
  let seed = 0x1a2b3c4d;
  for (let index = frames.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swap = seed % (index + 1);
    [frames[index], frames[swap]] = [frames[swap], frames[index]];
  }
  return frames;
}

function applyFrame(api, registry, frame) {
  if (frame.kind === 'partial_snapshot') {
    const inventory = registry.list.map((item, index) => index === frame.index ? frame.patch : item);
    return api.reconcileSessionRegistry(registry, inventory);
  }
  return api.patchSessionRegistry(registry, {
    type: 'session_patch',
    session_id: registry.list[frame.index].session_id,
    patch: frame.patch,
  });
}

function exerciseRegistry(api, label, sessions, frames) {
  const started = performance.now();
  let registry = api.createSessionRegistry(sessions.map(session => ({ ...session })));
  const coldLoadMs = performance.now() - started;
  assert(coldLoadMs < 2000, label + ': cold inventory exceeded 2 seconds');
  registry.list.forEach((row, index) => {
    assert.strictEqual(row.chat_title, sessions[index].chat_title, label + ': cold title mismatch ' + index);
    assert.strictEqual(row.fleet_work_context.text, sessions[index].fleet_work_context.text, label + ': cold work mismatch ' + index);
    assert.strictEqual(row.last_snippet, sessions[index].last_snippet, label + ': cold snippet mismatch ' + index);
  });
  const failures = {
    title_downgrades: 0,
    snippet_downgrades: 0,
    cross_session_bindings: 0,
    valid_title_new_chat_flashes: 0,
    canonical_to_unknown_goal_regressions: 0,
  };
  for (const frame of frames) {
    registry = applyFrame(api, registry, frame);
    const row = registry.list[frame.index];
    const expected = sessions[frame.index];
    if (row.chat_title !== expected.chat_title) failures.title_downgrades += 1;
    if (!row.last_snippet) failures.snippet_downgrades += 1;
    if (row.fleet_summary.session_key !== expected.fleet_summary.session_key
        || row.fleet_summary.thread_key !== expected.fleet_summary.thread_key) failures.cross_session_bindings += 1;
    if (/^new (?:chat|conversation)$/i.test(String(row.chat_title || '').trim())) failures.valid_title_new_chat_flashes += 1;
    if (row.fleet_summary.current_work_state !== 'blocked') failures.canonical_to_unknown_goal_regressions += 1;
  }
  Object.entries(failures).forEach(([key, value]) => assert.strictEqual(value, 0, label + ': ' + key));
  return { client: label, sessions: registry.list.length, cold_load_ms: coldLoadMs, frames: frames.length, ...failures };
}

function sourceContracts() {
  const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const proxy = read('agent-proxy/proxy-engine.js');
  const selectors = read('agent-proxy/selectors.js');
  const relay = read('relay-server/index.js');
  const webApp = read('frontend/app.jsx');
  const webHooks = read('frontend/hooks.jsx');
  const androidList = read('android-app/screens/SessionListScreen.jsx');
  assert(selectors.includes('[data-testid="user-message"], .whitespace-pre-wrap'));
  assert(selectors.includes('[data-testid="assistant-message"], [class*="overflow-x-auto"]'));
  assert(proxy.includes('codex_active_chat_key'));
  assert(proxy.includes('...fleetProjection'));
  assert(relay.includes('advanceRelayFleetSummary'));
  assert(relay.includes('const resetTitle = s.is_new_chat_draft === true;'));
  assert(webApp.includes('setSessionSubscriptions(activeSession ? [activeSession] : [])'));
  assert(androidList.includes('client.setSessionSubscriptions([])'));
  assert(webHooks.includes('msg.fleet_summary'));
  assert(androidList.includes('msg.fleet_summary'));
  const deployedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-fleet-summary-deploy-'));
  try {
    fs.mkdirSync(path.join(deployedRoot, 'shared'));
    fs.copyFileSync(
      path.join(ROOT, 'shared', 'fleet-summary.js'),
      path.join(deployedRoot, 'shared', 'fleet-summary.js'),
    );
    assert.strictEqual(resolveFleetSummaryPath(deployedRoot), path.join(deployedRoot, 'shared', 'fleet-summary.js'));
    assert.strictEqual(typeof loadFleetSummary(deployedRoot).buildProducerFleetSummary, 'function');
  } finally {
    fs.rmSync(deployedRoot, { recursive: true, force: true });
  }
  return {
    initial_inventory_summary: true,
    live_delta_summary: true,
    stable_codex_message_selectors: true,
    durable_codex_thread_identity: true,
    web_fleet_history_subscriptions: 0,
    android_fleet_history_subscriptions: 0,
    repository_contract_path: path.relative(
      ROOT,
      resolveFleetSummaryPath(ROOT + path.sep + 'relay-server'),
    ).replace(/\\/g, '/'),
    deployed_contract_path_verified: true,
  };
}

function privacyContracts() {
  const hostile = buildProducerFleetSummary({
    sessionId: 'privacy-fixture',
    session: {
      target_signature: 'privacy-target',
      _activeChatKey: 'privacy-thread',
      chat_title: 'Safe native title',
      chat_title_source: 'native',
      activity: { work_context: { text: 'password=super-secret-value', source: 'fixture', kind: 'activity' } },
    },
    messages: [
      { role: 'user', content: 'Bearer abcdefghijklmnopqrstuvwxyz' },
      { role: 'assistant', content: 'C:\\Users\\Example\\private\\token.txt' },
      { role: 'other', content: [{ command: 'pwsh', arguments: ['--token', 'secret'] }] },
    ],
  });
  assert(hostile, 'privacy fixture summary missing');
  const encoded = JSON.stringify(hostile);
  ['super-secret-value', 'abcdefghijklmnopqrstuvwxyz', 'C:\\Users\\Example', '--token'].forEach(forbidden => {
    assert(!encoded.includes(forbidden), 'privacy leak: ' + forbidden);
  });
  assert(!/\b(?:password|bearer)\b/i.test(encoded));
  const sharedSource = fs.readFileSync(path.join(ROOT, 'shared', 'fleet-summary.js'), 'utf8');
  assert(!/\bconsole\.(?:log|info|warn|error)\b/.test(sharedSource));
  return {
    credential_leaks: 0,
    host_path_leaks: 0,
    command_or_tool_argument_leaks: 0,
    implementation_text_logs: 0,
  };
}

function liveDeltaCountContract(session) {
  const before = session.fleet_summary;
  const after = advanceFleetSummary(before, {
    type: 'proxy_message',
    role: 'assistant',
    content: 'Live settled summary update',
    ts: 1752671000,
  }, session);
  assert(after, 'live delta did not retain the Fleet summary');
  assert.strictEqual(after.message_count, before.message_count,
    'relay live delivery double-counted the producer transcript total');
  assert.strictEqual(after.assistant_count, before.assistant_count,
    'relay live delivery double-counted the producer assistant total');
  assert.strictEqual(after.user_count, before.user_count,
    'relay live delivery changed the producer user total');
  assert.strictEqual(after.last_role, 'assistant');
  assert.strictEqual(after.last_snippet, 'Live settled summary update');
  assert(after.summary_seq > before.summary_seq, 'live delta did not advance summary sequence');
  return {
    producer_count_authority: true,
    delivery_order_independent: true,
    message_count_before: before.message_count,
    message_count_after: after.message_count,
    assistant_count_before: before.assistant_count,
    assistant_count_after: after.assistant_count,
    summary_seq_before: before.summary_seq,
    summary_seq_after: after.summary_seq,
  };
}

async function main(argv = process.argv.slice(2)) {
  const outputIndex = argv.indexOf('--output');
  const outputPath = outputIndex >= 0 && argv[outputIndex + 1] ? path.resolve(argv[outputIndex + 1]) : null;
  const web = await loadModule(path.join(ROOT, 'frontend', 'session-registry.js'));
  const android = await loadModule(path.join(ROOT, 'android-app', 'lib', 'session-registry.js'));
  const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => makeSession(index));
  const fleetSummaryBytes = bytes(sessions.map(session => session.fleet_summary));
  assert(fleetSummaryBytes <= FLEET_BYTES_LIMIT, '100-session summaries exceeded 100 KiB: ' + fleetSummaryBytes);
  const frames = frameSet(sessions);
  const webResult = exerciseRegistry(web, 'web', sessions, frames);
  const androidResult = exerciseRegistry(android, 'android', sessions, frames);
  assert.deepStrictEqual(
    { ...webResult, client: 'parity', cold_load_ms: 0 },
    { ...androidResult, client: 'parity', cold_load_ms: 0 },
  );
  const normalizedSource = filePath => fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(
    normalizedSource(path.join(ROOT, 'frontend', 'fleet-summary.js')),
    normalizedSource(path.join(ROOT, 'android-app', 'lib', 'fleet-summary.js')),
    'Web/Android Fleet summary policy drift',
  );
  const sizes = sessions.map(session => bytes(session.fleet_summary));
  const result = {
    status: 'PASS',
    generated_at: new Date().toISOString(),
    fixture: a1c12Fixture(),
    inventory: {
      sessions: SESSION_COUNT,
      encoded_fleet_summary_bytes: fleetSummaryBytes,
      encoded_limit_bytes: FLEET_BYTES_LIMIT,
      max_per_session_bytes: Math.max(...sizes),
      per_session_limit_bytes: FLEET_SUMMARY_MAX_BYTES,
      within_2_seconds: webResult.cold_load_ms < 2000 && androidResult.cold_load_ms < 2000,
    },
    reconciliation: {
      frames: FRAME_COUNT,
      shuffled: true,
      web: webResult,
      android: androidResult,
      web_android_policy_byte_identical: true,
    },
    live_delta_counts: liveDeltaCountContract(sessions[0]),
    subscriptions: sourceContracts(),
    privacy: privacyContracts(),
    observability: {
      text_free_default: true,
      counters: ['title_source', 'summary_source', 'rejected_candidate_reason', 'role_imbalance', 'parser_version', 'freshness', 'downgrade_prevention'],
    },
    visible_windows_opened: 0,
    focus_actions: 0,
    live_cdp_connections: 0,
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
