#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cursor-multi-agent-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const {
  ProxyEngine,
  resolveCursorWorkspacePath,
  cursorNativeActivity,
  cursorAgentEligible,
  CURSOR_WORKING_CONTINUITY_LEASE_MS,
} = require('../agent-proxy/proxy-engine');
const cursorSelectors = require('../agent-proxy/cursor-selectors');

function mockClient() {
  const client = new EventEmitter();
  client.Runtime = {};
  client.close = async () => {};
  return client;
}

function agent(id, title, workspaceName, workspaceKey, active = false, status = 'done-seen') {
  return {
    id,
    cache_key: id,
    legacy_id: `agent-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    title,
    active,
    source: 'glass-sidebar',
    workspace_name: workspaceName,
    workspace_key: workspaceKey,
    workspace_expanded: true,
    native_status: status,
    native_working: status === 'working',
  };
}

(async () => {
  try {
    const candidates = [
      { title: 'gwa3-private', path: 'C:\\Users\\Robert\\Documents\\gwa3-private' },
      { title: 'GWA Censured X BotsHub', path: 'C:\\Users\\Robert\\Documents\\GWA Censured X BotsHub' },
      { title: 'gwa3', path: 'C:\\Users\\Robert\\Documents\\GWA Censured X BotsHub\\gwa3' },
      { title: 'Remote Agent Chat', path: 'C:\\Users\\Robert\\Documents\\Remote Agent Chat' },
    ];
    assert.strictEqual(
      resolveCursorWorkspacePath({ workspace_name: 'gwa3-private', workspace_key: 'repo:github.com/robertgroarke/gwa3-private' }, candidates).path,
      candidates[0].path,
    );
    assert.strictEqual(
      resolveCursorWorkspacePath({ workspace_name: 'gwa3', workspace_key: 'repo:github.com/robertgroarke/gwa3' }, candidates).path,
      candidates[2].path,
      'nested BotsHub/gwa3 must beat its parent workspace',
    );
    assert.strictEqual(
      resolveCursorWorkspacePath({ workspace_name: 'remote-agent-chat', workspace_key: 'repo:github.com/robertgroarke/remote-agent-chat' }, candidates).path,
      candidates[3].path,
      'hyphen/space workspace forms must normalize together',
    );
    assert.strictEqual(cursorNativeActivity({ native_status: 'working' }).kind, 'generating');
    assert.strictEqual(cursorNativeActivity({ native_status: 'done-seen' }).kind, 'idle');
    assert.notStrictEqual(cursorNativeActivity({ native_status: 'incomplete' }).cursor_evidence_source, 'native_terminal',
      'an incomplete to-do token must not masquerade as a terminal native status');
    assert.strictEqual(cursorNativeActivity({ active: true, native_status: '' }).kind, 'idle',
      'selection alone must never classify an idle Cursor chat as Working');
    const leaseStartMs = 10_000;
    const authoritativeWorking = cursorNativeActivity(
      { native_status: 'status-class-drift', native_working: true },
      null,
      { nowMs: leaseStartMs },
    );
    assert.strictEqual(authoritativeWorking.cursor_evidence_source, 'native_status');
    assert.strictEqual(
      cursorNativeActivity({}, authoritativeWorking, {
        nowMs: leaseStartMs + CURSOR_WORKING_CONTINUITY_LEASE_MS - 1,
      }).kind,
      'generating',
      'a transient native-status gap must retain the bounded Working lease',
    );
    assert.strictEqual(
      cursorNativeActivity({}, authoritativeWorking, {
        nowMs: leaseStartMs + CURSOR_WORKING_CONTINUITY_LEASE_MS + 1,
      }).kind,
      'idle',
      'a dead Working signal must decay at the bounded lease edge',
    );
    const heartbeatRefreshed = {
      ...authoritativeWorking,
      observed_at: new Date(leaseStartMs + CURSOR_WORKING_CONTINUITY_LEASE_MS - 1).toISOString(),
    };
    assert.strictEqual(
      cursorNativeActivity({}, heartbeatRefreshed, {
        nowMs: leaseStartMs + (2 * CURSOR_WORKING_CONTINUITY_LEASE_MS) - 2,
      }).kind,
      'generating',
      'the lease must use the newest authoritative observation heartbeat',
    );
    assert.strictEqual(
      cursorNativeActivity({ native_status: 'done-unseen' }, authoritativeWorking, { nowMs: leaseStartMs + 1 }).kind,
      'idle',
      'an authoritative terminal state must bypass the continuity lease',
    );
    assert.strictEqual(cursorAgentEligible({
      id: '55555555-5555-4555-8555-555555555555',
      active: true,
      workspace_expanded: false,
      native_status: '',
    }), true, 'a selected agent in a collapsed workspace must remain eligible');
    assert.strictEqual(cursorAgentEligible({
      id: '66666666-6666-4666-8666-666666666666',
      active: false,
      workspace_expanded: false,
      native_status: 'done-seen',
    }), false, 'a collapsed finished archive must remain ineligible until already registered');

    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const agents = [
      agent(ids[0], 'GWA3 memory allocation review', 'gwa3-private', 'repo:github.com/robertgroarke/gwa3-private'),
      agent(ids[1], 'Pattern Hunter Codex review', 'gwa3-private', 'repo:github.com/robertgroarke/gwa3-private', true),
    ];
    const firstEngine = new ProxyEngine({ cdpPorts: [9227], relayUrl: 'ws://127.0.0.1:1/proxy-ws', uploadDir: tempRoot });
    firstEngine._readCursorWindowPaths = () => candidates;
    const firstClient = mockClient();
    const firstTarget = { id: 'CURSOR-TARGET-A', title: 'Cursor Agents', url: 'vscode-file://cursor/workbench.html', _cdpPort: 9227 };
    const first = await firstEngine._syncCursorVirtualSessions(firstTarget, firstClient, agents);
    assert.strictEqual(first.count, 2);
    const firstRows = Array.from(firstEngine.sessions.values());
    assert.strictEqual(firstRows.length, 2, 'one page must produce two live sessions');
    assert.strictEqual(new Set(firstRows.map(row => row.session_id)).size, 2);
    assert.deepStrictEqual(new Set(firstRows.map(row => row.targetId)), new Set([firstTarget.id]));
    assert.deepStrictEqual(new Set(firstRows.map(row => row.workspace_path)), new Set([candidates[0].path]));
    const stableIds = new Map(firstRows.map(row => [row.cursorAgentId, row.session_id]));
    const firstOwnerId = firstRows.find(row => row._cursorPageOwner)?.cursorAgentId;
    assert(firstOwnerId, 'one stable DOM observer owner is required');

    await firstEngine._syncCursorVirtualSessions(firstTarget, firstClient, agents.slice().reverse());
    assert.strictEqual(
      Array.from(firstEngine.sessions.values()).find(row => row._cursorPageOwner)?.cursorAgentId,
      firstOwnerId,
      'native list reordering must not churn the shared-page observer owner',
    );

    const collapsedWorker = agent(
      '33333333-3333-4333-8333-333333333333',
      'Collapsed live agent',
      'gwa3',
      'repo:github.com/robertgroarke/gwa3',
      false,
      'working',
    );
    collapsedWorker.workspace_expanded = false;
    const collapsedArchive = agent(
      '44444444-4444-4444-8444-444444444444',
      'Collapsed finished archive',
      'cursor-test',
      'repo:github.com/robertgroarke/cursor-test',
      false,
      'done-seen',
    );
    collapsedArchive.workspace_expanded = false;
    await firstEngine._syncCursorVirtualSessions(firstTarget, firstClient, [...agents, collapsedWorker, collapsedArchive]);
    assert(
      Array.from(firstEngine.sessions.values()).some(row => row.cursorAgentId === collapsedWorker.id),
      'a working agent must remain discoverable even when its native workspace section is collapsed',
    );
    assert(
      !Array.from(firstEngine.sessions.values()).some(row => row.cursorAgentId === collapsedArchive.id),
      'a collapsed finished archive must not become a fresh live session',
    );

    await firstEngine._syncCursorVirtualSessions(firstTarget, firstClient, agents);
    assert(
      !Array.from(firstEngine.sessions.values()).some(row => row.cursorAgentId === collapsedWorker.id),
      'a dead native owner must be removed from the live virtual-session set',
    );

    const secondRuntime = Array.from(firstEngine.sessions.values()).find(row => row.cursorAgentId === ids[1]);
    const originalReadAgentList = cursorSelectors.readCursorAgentList;
    const originalSwitchAgent = cursorSelectors.switchCursorAgent;
    let activeId = ids[0];
    let switchedId = null;
    cursorSelectors.readCursorAgentList = async () => agents.map(item => ({ ...item, active: item.id === activeId }));
    cursorSelectors.switchCursorAgent = async (_runtime, id) => {
      switchedId = id;
      activeId = id;
      return { ok: true, detail: 'fixture-switch' };
    };
    try {
      assert.deepStrictEqual(await firstEngine._ensureCursorVirtualSessionActive(secondRuntime), { ok: true });
      assert.strictEqual(switchedId, ids[1], 'controls must activate the exact native Cursor UUID');
    } finally {
      cursorSelectors.readCursorAgentList = originalReadAgentList;
      cursorSelectors.switchCursorAgent = originalSwitchAgent;
    }

    const inactiveHistory = [{ role: 'assistant', content: 'durable inactive transcript' }];
    secondRuntime._cursorNativeActive = false;
    secondRuntime._accumulatedMessages = inactiveHistory.slice();
    let inactiveRuntimeEvaluations = 0;
    secondRuntime.client.Runtime.evaluate = async () => {
      inactiveRuntimeEvaluations += 1;
      throw new Error('inactive history must not read the active DOM');
    };
    await firstEngine._pollSession(secondRuntime.session_id);
    assert.strictEqual(inactiveRuntimeEvaluations, 0,
      'an inactive virtual row must not compete with the page-owner inventory lane');
    assert.deepStrictEqual(
      JSON.parse(await firstEngine._readSessionMessages(secondRuntime, secondRuntime.session_id)),
      inactiveHistory,
      'relay reconnect must use the inactive agent durable history without copying the active DOM',
    );

    const selectorSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors.js'), 'utf8');
    const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
    assert(selectorSource.includes("[data-agent-status]"), 'Cursor status discovery must retain a structured attribute fallback');
    assert(selectorSource.includes("[aria-busy=\"true\"]"), 'Cursor status discovery must retain a correlated busy-state fallback');
    assert(selectorSource.includes('native_status_signals'), 'Cursor audit data must expose every bounded status signal');
    assert(proxySource.includes("newActivity.cursor_evidence_source !== 'continuity_lease'"),
      'continuity-only Cursor evidence must never self-renew through the generic heartbeat');
    assert(proxySource.includes("session.agentType === 'cursor' && !session._cursorVirtual"),
      'virtual Cursor rows must leave global inventory polling to the page owner');

    let inventoryReads = 0;
    let releaseInventory;
    cursorSelectors.readCursorAgentList = async () => {
      inventoryReads += 1;
      return new Promise(resolve => { releaseInventory = () => resolve(agents); });
    };
    try {
      const firstInventory = firstEngine._readCursorAgentInventory(firstTarget.id, firstClient.Runtime);
      const secondInventory = firstEngine._readCursorAgentInventory(firstTarget.id, firstClient.Runtime);
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(inventoryReads, 1, 'overlapping page-owner inventory reads must coalesce');
      releaseInventory();
      const [firstInventoryResult, secondInventoryResult] = await Promise.all([firstInventory, secondInventory]);
      assert.deepStrictEqual(firstInventoryResult, agents);
      assert.deepStrictEqual(secondInventoryResult, agents);
    } finally {
      cursorSelectors.readCursorAgentList = originalReadAgentList;
    }
    const switchSource = selectorSource.slice(
      selectorSource.indexOf('async function switchCursorAgent'),
      selectorSource.indexOf('async function newCursorAgent'),
    );
    assert(switchSource.includes('nativeAgentId(glassBtns[g])'), 'native UUID switching must share discovery identity');

    firstEngine.sessions.clear();
    const restartedEngine = new ProxyEngine({ cdpPorts: [9227], relayUrl: 'ws://127.0.0.1:1/proxy-ws', uploadDir: tempRoot });
    restartedEngine._readCursorWindowPaths = () => candidates;
    const restartedTarget = { ...firstTarget, id: 'CURSOR-TARGET-B' };
    const restarted = await restartedEngine._syncCursorVirtualSessions(restartedTarget, mockClient(), agents.slice().reverse());
    assert.strictEqual(restarted.count, 2);
    const restartedRows = Array.from(restartedEngine.sessions.values());
    assert.strictEqual(restartedRows.length, 2);
    for (const row of restartedRows) {
      assert.strictEqual(row.session_id, stableIds.get(row.cursorAgentId), 'native UUID must survive target restart and list reordering');
      assert.strictEqual(row.targetId, restartedTarget.id);
    }

    const store = JSON.parse(fs.readFileSync(process.env.SESSION_STORE_PATH, 'utf8'));
    const storedRows = Object.values(store.sessions || {}).filter(row => row.agent_type === 'cursor');
    assert.strictEqual(storedRows.length, 3, 'live same-workspace and collapsed-working agents must remain durable');
    assert.deepStrictEqual(new Set(storedRows.map(row => row.cursor_agent_id)), new Set([...ids, collapsedWorker.id]));

    console.log(JSON.stringify({
      ok: true,
      virtual_sessions: restartedRows.length,
      stable_restart_ids: true,
      same_workspace_not_collapsed: true,
      native_uuid_control_routing: true,
      collapsed_selected_eligible_but_idle: true,
      status_drift_continuity_lease_ms: CURSOR_WORKING_CONTINUITY_LEASE_MS,
      dead_owner_demoted: true,
      inactive_history_isolated: true,
      inactive_virtual_poll_evaluations: inactiveRuntimeEvaluations,
      coalesced_page_owner_inventory: true,
      stable_observer_owner: true,
      path_normalization: ['gwa3-private', 'BotsHub/gwa3', 'remote-agent-chat'],
    }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
