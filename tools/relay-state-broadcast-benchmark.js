#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] || 'before';
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;
assert(['before', 'after'].includes(mode), '--mode must be before or after');

const sessionCount = 60;
const snapshotBurst = 20;
const statusTicks = 10;
const port = 37100 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-state-broadcast-bench-'));
const relayLogs = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function openSocket(route, peerRole, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin });
    const messages = [];
    ws.on('message', data => {
      try {
        messages.push({ message: JSON.parse(data.toString()), bytes: Buffer.byteLength(data) });
      } catch { /* ignore malformed fixture output */ }
    });
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: peerRole,
      ...(peerRole === 'proxy'
        ? { proxy_id: name, machine_label: 'state-broadcast-benchmark' }
        : { client_name: name }),
    })));
    ws.once('error', reject);
    waitFor(
      () => messages.some(entry => entry.message.type === 'connection_ack'),
      8000,
      `${peerRole} connection ack`,
    ).then(() => resolve({ ws, messages }), reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, sleep(3000)]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const relaySource = fs.readFileSync(path.join(root, 'relay-server', 'index.js'), 'utf8');
  if (mode === 'before') {
    assert(!relaySource.includes('queueStatusBroadcast(statusMsg)'),
      'baseline source already coalesces status broadcasts');
  } else {
    assert(relaySource.includes('queueStatusBroadcast(statusMsg)'),
      'final source does not coalesce status broadcasts');
  }

  const relay = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: origin,
      SESSION_SECRET: 'state-broadcast-benchmark-secret-0123456789',
      JWT_SECRET: 'state-broadcast-benchmark-jwt-secret-0123456789',
      PROXY_SECRET: '',
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      RAC_DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: 'state-broadcast-benchmark-client',
      GOOGLE_CLIENT_SECRET: 'state-broadcast-benchmark-secret',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => relayLogs.push(String(chunk)));
  relay.stderr.on('data', chunk => relayLogs.push(String(chunk)));
  let proxy;
  let browser;
  try {
    await waitFor(async () => {
      if (relay.exitCode != null) throw new Error(relayLogs.join('').slice(-4000));
      try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
    }, 15_000, 'relay health');
    proxy = await openSocket('/proxy-ws', 'proxy', 'state-broadcast-benchmark-proxy');
    browser = await openSocket('/client-ws', 'browser', 'state-broadcast-benchmark-browser');

    const sessions = Array.from({ length: sessionCount }, (_, index) => ({
      session_id: `state-bench-${String(index).padStart(2, '0')}`,
      agent_type: index % 2 ? 'codex_cli' : 'claude_cli',
      display_name: `State session ${index}`,
      workspace_path: root,
      status: 'healthy',
      activity: { kind: 'idle', label: '' },
    }));
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      proxy_id: 'state-broadcast-benchmark-proxy',
      sessions,
    }));
    await waitFor(
      () => browser.messages.some(entry => entry.message.type === 'session_list'
        && entry.message.sessions?.length === sessionCount),
      5000,
      'initial 60-session inventory',
    );

    const measurementStart = browser.messages.length;
    const startedAt = Date.now();
    for (let revision = 0; revision < snapshotBurst; revision += 1) {
      proxy.ws.send(JSON.stringify({
        type: 'proxy_session_snapshot',
        proxy_id: 'state-broadcast-benchmark-proxy',
        sessions: sessions.map(session => ({ ...session, chat_title: `Snapshot ${revision}` })),
      }));
    }
    for (let tick = 0; tick < statusTicks; tick += 1) {
      for (const session of sessions) {
        proxy.ws.send(JSON.stringify({
          type: 'proxy_status',
          session_id: session.session_id,
          session: session.session_id,
          status: 'healthy',
          thinking: true,
          label: `Tick ${tick}`,
          activity: {
            kind: tick % 2 ? 'running_command' : 'reading_files',
            label: `Tick ${tick}`,
            step: { index: tick + 1, total: statusTicks, label: `Tick ${tick}` },
          },
        }));
      }
    }

    await sleep(900);
    const measured = browser.messages.slice(measurementStart);
    const stateEvents = measured.filter(entry => ['session_list', 'session_patch', 'status', 'session_summary'].includes(entry.message.type));
    const sessionLists = stateEvents.filter(entry => entry.message.type === 'session_list');
    const sessionPatches = stateEvents.filter(entry => entry.message.type === 'session_patch');
    const statuses = stateEvents.filter(entry => entry.message.type === 'status');
    const summaries = stateEvents.filter(entry => entry.message.type === 'session_summary');
    const latestPatchBySession = new Map();
    sessionPatches.forEach(entry => latestPatchBySession.set(entry.message.session_id, entry.message));
    const latestStatusBySession = new Map();
    [...statuses, ...summaries].forEach(entry => latestStatusBySession.set(entry.message.session, entry.message));
    const latestSessionList = sessionLists[sessionLists.length - 1]?.message;
    const stateSeqs = stateEvents.map(entry => Number(entry.message.state_seq)).filter(Number.isFinite);
    const stateEpochs = new Set(stateEvents.map(entry => entry.message.state_epoch).filter(Boolean));

    if (mode === 'before') {
      assert(latestSessionList, 'baseline burst must publish a final session list');
      assert(latestSessionList.sessions.every(session => session.chat_title === 'Snapshot 19'),
        'final session-list payload must be latest-wins');
    }
    assert.strictEqual(latestStatusBySession.size, sessionCount,
      'every session must retain its final status');
    assert([...latestStatusBySession.values()].every(message => (message.label || message.activity?.label) === 'Tick 9'),
      'final status payloads must be latest-wins');
    if (mode === 'after') {
      assert.strictEqual(sessionLists.length, 0, `metadata-only burst emitted ${sessionLists.length} full inventories`);
      assert.strictEqual(sessionPatches.length, sessionCount,
        `metadata-only burst emitted ${sessionPatches.length} patches instead of one per session`);
      assert.strictEqual(latestPatchBySession.size, sessionCount, 'session patches did not cover every changed session');
      assert([...latestPatchBySession.values()].every(message => message.patch?.chat_title === 'Snapshot 19'),
        'final session patches were not latest-wins');
      assert.strictEqual(statuses.length, 0, 'summary-only browser received full status frames');
      assert.strictEqual(summaries.length, sessionCount,
        `status burst emitted ${summaries.length} summaries instead of one per session`);
      assert.strictEqual(stateSeqs.length, stateEvents.length, 'coalesced state events must carry state_seq');
      assert.strictEqual(stateEpochs.size, 1, 'coalesced state events must share one state_epoch');
      assert(stateSeqs.every((seq, index) => index === 0 || seq > stateSeqs[index - 1]),
        'state_seq must increase monotonically in browser delivery order');
    }

    const compactSummaryStart = browser.messages.length;
    proxy.ws.send(JSON.stringify({
      type: 'proxy_status',
      session_id: sessions[0].session_id,
      session: sessions[0].session_id,
      status: 'healthy',
      thinking: true,
      label: 'Large goal fixture',
      activity: {
        kind: 'working',
        label: 'Large goal fixture',
        goal: {
          state: 'active',
          label: 'Pursuing goal',
          objective: 'x'.repeat(6000),
          text: 'x'.repeat(6000),
          updated_at: new Date().toISOString(),
        },
      },
    }));
    const compactSummary = await waitFor(
      () => browser.messages.slice(compactSummaryStart)
        .find(entry => entry.message.type === 'session_summary' && entry.message.session_id === sessions[0].session_id),
      5000,
      'compact large-goal summary',
    );
    assert(compactSummary.bytes <= 1024, `compact summary was ${compactSummary.bytes} bytes`);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(compactSummary.message, 'goal'), false,
      'summary duplicated activity.goal at top level');
    assert((compactSummary.message.activity?.goal?.objective || '').length <= 240,
      'summary goal objective was not bounded');

    const membershipStart = browser.messages.length;
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot',
      proxy_id: 'state-broadcast-benchmark-proxy',
      sessions: [...sessions, {
        session_id: 'state-bench-added',
        agent_type: 'codex_cli',
        display_name: 'Added session',
        workspace_path: root,
        status: 'healthy',
      }],
    }));
    await waitFor(
      () => browser.messages.slice(membershipStart).find(entry => entry.message.type === 'session_list'
        && entry.message.sessions?.length === sessionCount + 1),
      5000,
      'membership-changing inventory',
    );
    const membershipInventoryFrames = browser.messages.slice(membershipStart)
      .filter(entry => entry.message.type === 'session_list');
    assert.strictEqual(membershipInventoryFrames.length, 1,
      `membership change emitted ${membershipInventoryFrames.length} inventories`);

    const result = {
      ok: true,
      mode,
      generated_at: new Date().toISOString(),
      sessions: sessionCount,
      snapshot_updates: snapshotBurst,
      status_updates: sessionCount * statusTicks,
      logical_state_updates: snapshotBurst + (sessionCount * statusTicks),
      browser_session_list_frames: sessionLists.length,
      browser_session_patch_frames: sessionPatches.length,
      browser_status_frames: statuses.length,
      browser_session_summary_frames: summaries.length,
      browser_state_frames: stateEvents.length,
      browser_state_bytes: stateEvents.reduce((sum, entry) => sum + entry.bytes, 0),
      latest_session_snapshot_revision: 19,
      latest_status_tick: 9,
      final_status_sessions: latestStatusBySession.size,
      compact_large_goal_summary_bytes: compactSummary.bytes,
      compact_goal_objective_chars: compactSummary.message.activity?.goal?.objective?.length || 0,
      duplicate_top_level_goal: Object.prototype.hasOwnProperty.call(compactSummary.message, 'goal'),
      membership_change_inventory_frames: membershipInventoryFrames.length,
      elapsed_ms: Date.now() - startedAt,
      state_sequence_values: stateSeqs.length,
      state_epoch_values: stateEpochs.size,
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    await closeSocket(browser?.ws);
    await closeSocket(proxy?.ws);
    await stopChild(relay);
    const resolvedDataDir = path.resolve(dataDir);
    const expectedPrefix = path.resolve(os.tmpdir(), 'rac-state-broadcast-bench-');
    assert(resolvedDataDir.startsWith(expectedPrefix), `refusing to remove unexpected fixture path ${resolvedDataDir}`);
    fs.rmSync(resolvedDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  console.error(relayLogs.join('').slice(-4000));
  process.exit(1);
});
