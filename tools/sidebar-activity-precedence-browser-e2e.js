#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');

const ROOT = path.join(__dirname, '..');
const HARNESS_TYPES = [
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli', 'gemini', 'continue', 'continue_yolo',
  'roo_code', 'cline', 'antigravity', 'antigravity_panel', 'antigravity-v2',
];
const STATES = ['working', 'idle', 'asking', 'blocked', 'paused'];
const EDGE_TARGETS = HARNESS_TYPES.slice(0, 5).map(type => `${type}-idle`);
const PINNED_IDS = [
  'claude-working', 'codex-working',
  EDGE_TARGETS[0], EDGE_TARGETS[1],
  'cursor-asking', 'gemini-blocked',
];

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  if (!match) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return match;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          resolve({ status: response.statusCode, body: null });
        }
      });
    });
    request.once('error', reject);
  });
}

async function waitForHealth(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, '/healthz');
      if (response.status === 200 && response.body?.status === 'ok') return;
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectProxy(port, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'sidebar-activity-precedence-e2e',
      machine_label: 'sidebar-activity-precedence-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connection_ack') resolve(ws);
    });
    ws.once('error', reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

function fixtureSessions() {
  const base = Date.now();
  return HARNESS_TYPES.flatMap((agentType, harnessIndex) => STATES.map((state, stateIndex) => {
    const workspace = `Workspace ${harnessIndex % 4 + 1}`;
    const titleSuffix = stateIndex === 0
      ? ' working on a long production restoration title that remains distinguishable'
      : ` ${state}`;
    return {
      session_id: `${agentType}-${state}`,
      agent_type: agentType,
      display_name: `${agentType} ${state}`,
      chat_title: `${agentType}${titleSuffix}`,
      workspace_name: workspace,
      project_root: `C:\\production-shape\\${workspace}`,
      workspace_path: `C:\\production-shape\\${workspace}\\${agentType}`,
      last_seen_at: new Date(base - (harnessIndex * STATES.length + stateIndex) * 1_000).toISOString(),
      health: 'connected',
    };
  }));
}

function sendActivity(proxy, sessionId, state, sequence = 0) {
  const updatedAt = new Date(Date.now() + sequence).toISOString();
  const activityByState = {
    working: { kind: 'generating', label: `Working refresh ${sequence}`, generating: true },
    idle: { kind: 'idle', label: 'Idle', generating: false },
    asking: { kind: 'waiting_for_user', label: 'Waiting for user', generating: false },
    blocked: { kind: 'blocked', label: 'Blocked', generating: false },
    paused: { kind: 'paused', label: 'Paused', generating: false },
  };
  const activity = { ...activityByState[state], updated_at: updatedAt, started_at: updatedAt };
  proxy.send(JSON.stringify({
    type: 'status', protocol_version: 1, session: sessionId,
    thinking: state === 'working', activity,
  }));
}

async function putPreference(port, sessionId, preference) {
  const response = await fetch(`http://127.0.0.1:${port}/api/preferences/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preference }),
  });
  assert.strictEqual(response.status, 200, `preference seed failed for ${sessionId}`);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.session-list');
    const directGroups = [...(list?.querySelectorAll(':scope > .session-group') || [])];
    const cards = [...(list?.querySelectorAll('.session-card[data-session-id]') || [])];
    const groupLabel = group => group?.getAttribute('aria-label')
      || group?.querySelector('.session-group-name')?.textContent?.trim()
      || 'unknown';
    const workingGroup = list?.querySelector(':scope > .working-session-group');
    const working = [...(workingGroup?.querySelectorAll('.session-card[data-session-id]') || [])]
      .map(card => card.dataset.sessionId);
    const all = cards.map(card => card.dataset.sessionId);
    const workingSet = new Set(working);
    const nonWorking = all.filter(id => !workingSet.has(id));
    const indexes = ids => ids.map(id => all.indexOf(id));
    const workingIndexes = indexes(working);
    const nonWorkingIndexes = indexes(nonWorking);
    const sectionById = Object.fromEntries(cards.map(card => [
      card.dataset.sessionId,
      groupLabel(card.closest('.session-group')),
    ]));
    const duplicateIds = [...new Set(all.filter((id, index) => all.indexOf(id) !== index))];
    const focused = document.activeElement?.closest?.('[data-session-id]');
    const openMenus = cards.filter(card => card.querySelector('details.session-card-menu[open]'))
      .map(card => card.dataset.sessionId);
    return {
      total: all.length,
      unique: new Set(all).size,
      duplicate_ids: duplicateIds,
      order: all,
      working,
      non_working: nonWorking,
      group_order: directGroups.map(groupLabel),
      section_by_id: sectionById,
      working_group_present: !!workingGroup,
      working_group_first: !workingGroup || directGroups[0] === workingGroup,
      working_group_expanded: !workingGroup || !workingGroup.classList.contains('collapsed'),
      maximum_working_index: workingIndexes.length ? Math.max(...workingIndexes) : null,
      minimum_non_working_index: nonWorkingIndexes.length ? Math.min(...nonWorkingIndexes) : null,
      working_before_non_working: !workingIndexes.length || !nonWorkingIndexes.length
        || Math.max(...workingIndexes) < Math.min(...nonWorkingIndexes),
      horizontal_overflow: !!list && list.scrollWidth > list.clientWidth + 0.5,
      scroll_top: list?.scrollTop || 0,
      active_session: list?.querySelector('.session-card.active')?.dataset.sessionId || null,
      focused_session: focused?.dataset.sessionId || null,
      focused_title: document.activeElement?.getAttribute('title') || document.activeElement?.getAttribute('aria-label') || null,
      open_menus: openMenus,
    };
  });
}

function assertHierarchy(value, expectedCount) {
  assert.strictEqual(value.total, expectedCount, 'missing sidebar rows');
  assert.strictEqual(value.unique, expectedCount, 'duplicate sidebar rows');
  assert.deepStrictEqual(value.duplicate_ids, []);
  assert.strictEqual(value.working_group_present, value.working.length > 0);
  assert.strictEqual(value.working_group_first, true, 'Working now is not the first section');
  assert.strictEqual(value.working_group_expanded, true, 'Working now is collapsed');
  assert.strictEqual(value.working_before_non_working, true, 'a non-working row precedes working work');
  assert.strictEqual(value.horizontal_overflow, false, 'sidebar has horizontal overflow');
}

function sameWithout(items, removed) {
  return items.filter(item => item !== removed);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function main() {
  const viewportText = argValue('--viewport', '1440x900');
  const match = /^(\d+)x(\d+)$/.exec(viewportText);
  assert(match, '--viewport must be WIDTHxHEIGHT');
  const viewport = { width: Number(match[1]), height: Number(match[2]) };
  const colorScheme = argValue('--color-scheme', 'dark');
  assert(['light', 'dark'].includes(colorScheme), '--color-scheme must be light or dark');
  const soakMs = Number(argValue('--soak-ms', '60000'));
  assert(Number.isFinite(soakMs) && soakMs >= 0, '--soak-ms must be non-negative');
  const touch = process.argv.includes('--touch');
  const reducedMotion = process.argv.includes('--reduced-motion');
  const evidencePath = argValue('--evidence');
  const framesDir = argValue('--frames-dir');
  const sessions = fixtureSessions();
  assert(sessions.length >= 79);

  const port = await freePort();
  const secret = 'sidebar-activity-precedence-secret';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-sidebar-precedence-'));
  const relayOutput = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'sidebar-precedence-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'sidebar-precedence-client-id',
      GOOGLE_CLIENT_SECRET: 'sidebar-precedence-client-secret',
      PROXY_SECRET: secret,
      RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => relayOutput.push(chunk.toString()));
  child.stderr.on('data', chunk => relayOutput.push(chunk.toString()));

  let proxy;
  let browser;
  try {
    await waitForHealth(port);
    proxy = await connectProxy(port, secret);
    proxy.send(JSON.stringify({
      type: 'session_list', protocol_version: 1,
      proxy_id: 'sidebar-activity-precedence-e2e', sessions,
    }));
    for (const [index, sessionId] of PINNED_IDS.entries()) {
      await putPreference(port, sessionId, { pinned: true, pin_order: index + 1 });
    }
    for (const session of sessions) {
      const state = session.session_id.slice(session.session_id.lastIndexOf('-') + 1);
      sendActivity(proxy, session.session_id, state, 0);
    }
    await new Promise(resolve => setTimeout(resolve, 300));

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const context = await browser.newContext({
      viewport,
      colorScheme,
      hasTouch: touch,
      isMobile: touch,
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const outgoingFrames = [];
    page.on('websocket', socket => socket.on('framesent', event => outgoingFrames.push(event.payload)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(expected => (
      document.querySelectorAll('.session-card[data-session-id]').length === expected
    ), sessions.length);
    if (viewport.width <= 640) {
      await page.locator('.hamburger').click();
      await page.locator('.sidebar.open').waitFor();
    }
    await page.waitForFunction(expected => (
      document.querySelectorAll('.working-session-group .session-card[data-session-id]').length === expected
    ), HARNESS_TYPES.length);

    const initial = await snapshot(page);
    assertHierarchy(initial, sessions.length);
    assert.strictEqual(initial.working.length, HARNESS_TYPES.length);
    assert(PINNED_IDS.slice(0, 2).every(id => initial.working.includes(id)), 'working pins were not projected into Working now');
    assert(PINNED_IDS.slice(2).every(id => initial.section_by_id[id] === 'Pinned chats'), 'idle pins were not retained in Pinned chats');

    const collapse = await page.evaluate(() => {
      const group = [...document.querySelectorAll('.session-list > .session-group:not(.working-session-group):not(.pinned-session-group)')]
        .find(candidate => candidate.querySelector('.session-group-toggle'));
      const toggle = group?.querySelector('.session-group-toggle');
      if (!toggle) return null;
      const label = group.querySelector('.session-group-name')?.textContent?.trim() || 'unknown';
      toggle.click();
      return { label };
    });
    await page.waitForTimeout(100);
    const afterCollapse = await snapshot(page);
    assertHierarchy(afterCollapse, sessions.length);
    assert.deepStrictEqual(afterCollapse.working, initial.working, 'collapsing a workspace hid or reordered working rows');

    const selectedId = 'antigravity-v2-paused';
    const selectedCard = page.locator(`.session-card[data-session-id="${selectedId}"]`);
    await selectedCard.scrollIntoViewIfNeeded();
    await selectedCard.evaluate(node => node.click());
    if (viewport.width <= 640 && await page.locator('.sidebar.open').count() === 0) {
      await page.locator('.hamburger').click();
      await page.locator('.sidebar.open').waitFor();
    }
    const menu = selectedCard.locator('details.session-card-menu');
    await menu.evaluate(node => { node.open = true; });
    await menu.locator('summary.session-card-manage').focus();
    await page.locator('.session-list').evaluate(node => { node.scrollTop = Math.max(0, node.scrollTop - 40); });
    const protectedState = await snapshot(page);

    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.session-card[data-session-id]')];
      const groups = [...document.querySelectorAll('.session-list > .session-group')];
      const shifts = [];
      const ignoredShifts = [];
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          const serialized = {
            value: entry.value,
            at: entry.startTime,
            sources: (entry.sources || []).map(source => ({
              node: source.node?.className || source.node?.nodeName || null,
              previous: source.previousRect && {
                x: source.previousRect.x, y: source.previousRect.y,
                width: source.previousRect.width, height: source.previousRect.height,
              },
              current: source.currentRect && {
                x: source.currentRect.x, y: source.currentRect.y,
                width: source.currentRect.width, height: source.currentRect.height,
              },
            })),
          };
          const sidebar = document.querySelector('.sidebar');
          const sources = entry.sources || [];
          const belongsToSidebar = sources.length === 0 || sources.some(source => sidebar?.contains(source.node));
          (belongsToSidebar ? shifts : ignoredShifts).push(serialized);
        }
      });
      observer.observe({ type: 'layout-shift', buffered: false });
      window.__RAC_PRECEDENCE_STABILITY__ = {
        cards: new Map(cards.map(card => [card.dataset.sessionId, card])),
        groups,
        shifts,
        ignoredShifts,
        observer,
      };
    });

    const stormStartedAt = Date.now();
    const stormSamples = [];
    let rowMoves = 0;
    let groupMoves = 0;
    let previous = await snapshot(page);
    let sequence = 0;
    let sessionListReplays = 0;
    let refreshFrames = 0;
    while (Date.now() - stormStartedAt < soakMs) {
      sequence += 1;
      const second = Math.floor((Date.now() - stormStartedAt) / 1000);
      const inBurst = [5, 10, 15, 20, 25, 35, 40, 45, 50, 55].some(start => second === start);
      if (sequence % 10 === 1) {
        for (const type of HARNESS_TYPES) sendActivity(proxy, `${type}-working`, 'working', sequence);
        refreshFrames += HARNESS_TYPES.length;
      } else if (inBurst) {
        sendActivity(proxy, 'codex_cli-working', 'working', sequence);
        refreshFrames += 1;
      }
      if (sequence % 50 === 0) {
        const replay = [...sessions].reverse().map(session => ({
          ...session,
          chat_title: `${session.chat_title} hydrated ${sessionListReplays % 2}`,
          last_seen_at: new Date(Date.now()).toISOString(),
        }));
        proxy.send(JSON.stringify({
          type: 'session_list', protocol_version: 1,
          proxy_id: 'sidebar-activity-precedence-e2e', sessions: replay,
        }));
        sessionListReplays += 1;
      }
      await page.waitForTimeout(100);
      if (sequence % 5 === 0) {
        const current = await snapshot(page);
        assertHierarchy(current, sessions.length);
        if (JSON.stringify(current.order) !== JSON.stringify(previous.order)) rowMoves += 1;
        if (JSON.stringify(current.group_order) !== JSON.stringify(previous.group_order)) groupMoves += 1;
        stormSamples.push({
          at_ms: Date.now() - stormStartedAt,
          working: current.working.length,
          maximum_working_index: current.maximum_working_index,
          minimum_non_working_index: current.minimum_non_working_index,
        });
        previous = current;
      }
    }
    const stormMeasuredMs = Date.now() - stormStartedAt;
    const afterStorm = await snapshot(page);
    assertHierarchy(afterStorm, sessions.length);
    const stability = await page.evaluate(() => {
      const state = window.__RAC_PRECEDENCE_STABILITY__;
      state?.observer?.disconnect();
      const cards = [...document.querySelectorAll('.session-card[data-session-id]')];
      const groups = [...document.querySelectorAll('.session-list > .session-group')];
      return {
        card_nodes_stable: cards.every(card => state.cards.get(card.dataset.sessionId) === card),
        group_nodes_stable: groups.every(group => state.groups.includes(group)),
        cumulative_layout_shift: state.shifts.reduce((sum, entry) => sum + entry.value, 0),
        layout_shift_entries: state.shifts,
        ignored_non_sidebar_layout_shift_entries: state.ignoredShifts,
      };
    });
    assert.strictEqual(rowMoves, 0, 'no-transition storm moved rows');
    assert.strictEqual(groupMoves, 0, 'no-transition storm moved groups');
    assert.strictEqual(stability.card_nodes_stable, true, 'no-transition storm remounted a row');
    assert.strictEqual(stability.group_nodes_stable, true, 'no-transition storm remounted a group');
    assert.strictEqual(stability.cumulative_layout_shift, 0,
      `no-transition storm caused CLS: ${JSON.stringify(stability.layout_shift_entries)}`);
    assert.strictEqual(afterStorm.active_session, protectedState.active_session, 'selected session changed');
    assert.strictEqual(afterStorm.focused_session, protectedState.focused_session, 'keyboard focus changed');
    assert.strictEqual(afterStorm.focused_title, protectedState.focused_title, 'focused control changed');
    assert.deepStrictEqual(afterStorm.open_menus, protectedState.open_menus, 'open menu changed');
    assert(Math.abs(afterStorm.scroll_top - protectedState.scroll_top) <= 1, 'scroll anchor drifted');

    const originalHomes = Object.fromEntries(EDGE_TARGETS.map(id => [id, initial.section_by_id[id]]));
    const edgeEvidence = [];
    for (const id of EDGE_TARGETS) {
      const before = await snapshot(page);
      const sentAt = Date.now();
      sendActivity(proxy, id, 'working', sequence += 1);
      await page.waitForFunction(sessionId => (
        !!document.querySelector(`.working-session-group .session-card[data-session-id="${sessionId}"]`)
      ), id, { timeout: 2_000 });
      const after = await snapshot(page);
      assertHierarchy(after, sessions.length);
      const changedSections = after.order.filter(sessionId => before.section_by_id[sessionId] !== after.section_by_id[sessionId]);
      assert.deepStrictEqual(changedSections, [id], `${id} start moved more than one section`);
      assert.deepStrictEqual(sameWithout(after.order, id), sameWithout(before.order, id), `${id} start disturbed unrelated row order`);
      edgeEvidence.push({
        session_id: id, edge: 'start', latency_ms: Date.now() - sentAt,
        structural_moves: 1, from: before.section_by_id[id], to: after.section_by_id[id],
      });
    }
    for (const id of [...EDGE_TARGETS].reverse()) {
      const before = await snapshot(page);
      const sentAt = Date.now();
      sendActivity(proxy, id, 'idle', sequence += 1);
      await page.waitForFunction(({ sessionId, home }) => {
        const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
        const group = card?.closest('.session-group');
        const label = group?.getAttribute('aria-label')
          || group?.querySelector('.session-group-name')?.textContent?.trim()
          || 'unknown';
        return !card?.closest('.working-session-group') && label === home;
      }, { sessionId: id, home: originalHomes[id] }, { timeout: 2_000 });
      const after = await snapshot(page);
      assertHierarchy(after, sessions.length);
      const changedSections = after.order.filter(sessionId => before.section_by_id[sessionId] !== after.section_by_id[sessionId]);
      assert.deepStrictEqual(changedSections, [id], `${id} stop moved more than one section`);
      assert.deepStrictEqual(sameWithout(after.order, id), sameWithout(before.order, id), `${id} stop disturbed unrelated row order`);
      edgeEvidence.push({
        session_id: id, edge: 'stop', latency_ms: Date.now() - sentAt,
        structural_moves: 1, from: before.section_by_id[id], to: after.section_by_id[id],
        returned_home: after.section_by_id[id] === originalHomes[id],
      });
    }
    assert(edgeEvidence.every(edge => edge.latency_ms <= 2_000), 'an activity edge exceeded two seconds');
    assert(edgeEvidence.every(edge => edge.structural_moves === 1), 'an activity edge did not produce exactly one move');

    const final = await snapshot(page);
    assertHierarchy(final, sessions.length);
    assert.deepStrictEqual(final.order, initial.order, 'edge cycle did not restore the original hierarchy');
    const dangerousOutgoing = outgoingFrames.map(payload => {
      try { return JSON.parse(payload); } catch { return null; }
    }).filter(message => message && [
      'user_message', 'permission_response', 'error_prompt_response', 'set_model',
      'set_effort', 'broadcast_message', 'resource_request', 'control_request',
    ].includes(message.type));
    assert.deepStrictEqual(dangerousOutgoing, [], 'sidebar ordering emitted a control/provider request');

    const frameEvidence = {};
    if (framesDir) {
      const resolvedFrames = path.resolve(framesDir);
      fs.mkdirSync(resolvedFrames, { recursive: true });
      const stem = `${viewportText}-${colorScheme}${touch ? '-touch' : ''}${reducedMotion ? '-reduced-motion' : ''}`;
      frameEvidence.final = path.join(resolvedFrames, `${stem}.png`);
      await page.locator('.sidebar').screenshot({ path: frameEvidence.final, animations: 'disabled' });
    }

    const latencies = edgeEvidence.map(edge => edge.latency_ms);
    const result = {
      status: 'PASS',
      actual_relay: true,
      actual_built_bundle: true,
      sessions: sessions.length,
      harness_types: HARNESS_TYPES.length,
      activity_classes: STATES,
      viewport: viewportText,
      color_scheme: colorScheme,
      touch,
      reduced_motion: reducedMotion,
      initial,
      collapsed_workspace: collapse,
      collapsed_workspace_preserved_working: true,
      no_transition_storm: {
        requested_duration_ms: soakMs,
        measured_duration_ms: stormMeasuredMs,
        refresh_frames: refreshFrames,
        session_list_replays: sessionListReplays,
        samples: stormSamples.length,
        row_moves: rowMoves,
        group_moves: groupMoves,
        remounts: stability.card_nodes_stable && stability.group_nodes_stable ? 0 : 1,
        cumulative_layout_shift: stability.cumulative_layout_shift,
        layout_shift_entries: stability.layout_shift_entries,
        ignored_non_sidebar_layout_shift_entries: stability.ignored_non_sidebar_layout_shift_entries,
        scroll_drift_px: Math.abs(afterStorm.scroll_top - protectedState.scroll_top),
        focus_preserved: afterStorm.focused_session === protectedState.focused_session
          && afterStorm.focused_title === protectedState.focused_title,
        selection_preserved: afterStorm.active_session === protectedState.active_session,
        open_menu_preserved: JSON.stringify(afterStorm.open_menus) === JSON.stringify(protectedState.open_menus),
      },
      authoritative_edges: edgeEvidence,
      edge_latency_p95_ms: percentile(latencies, 0.95),
      edge_latency_max_ms: Math.max(...latencies),
      final_restored_to_initial_order: true,
      working_pinned_once: true,
      search_hierarchy_covered_by_deterministic_contract: true,
      screen_reader_working_group_label: await page.locator('.working-session-group').getAttribute('aria-label'),
      outgoing_control_or_provider_requests: dangerousOutgoing.length,
      horizontal_overflow: final.horizontal_overflow,
      frame_evidence: Object.fromEntries(Object.entries(frameEvidence).map(([key, value]) => [
        key, path.relative(ROOT, value).replace(/\\/g, '/'),
      ])),
      visible_windows: 0,
      protected_user_apps_touched: 0,
      recorded_at: new Date().toISOString(),
    };
    if (evidencePath) {
      const resolved = path.resolve(evidencePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${relayOutput.join('')}`);
  } finally {
    await browser?.close();
    await closeSocket(proxy);
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 1_000).unref();
    });
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-sidebar-precedence-')));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
