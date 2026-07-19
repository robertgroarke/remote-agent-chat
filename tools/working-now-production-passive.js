#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const fidelity = require('./run-fidelity-regression');
const {
  acquirePidLock,
  OPERATION_LOCK_PATH,
} = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    readOnlyProduction: false,
    output: '',
    sourceRoot: ROOT,
    envRoot: ROOT,
    durationSeconds: 1800,
    sampleMs: 1000,
    headlessLoopback: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--source-root' && next) options.sourceRoot = path.resolve(argv[++index]);
    else if (arg === '--env-root' && next) options.envRoot = path.resolve(argv[++index]);
    else if (arg === '--duration-seconds' && next) options.durationSeconds = Number(argv[++index]);
    else if (arg === '--sample-ms' && next) options.sampleMs = Number(argv[++index]);
    else if (arg === '--headless-loopback') options.headlessLoopback = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.output, '--output is required');
  assert(Number.isInteger(options.durationSeconds) && options.durationSeconds >= 5,
    '--duration-seconds must be an integer >= 5');
  assert.strictEqual(options.sampleMs, 1000, 'production proof requires exact one-second sampling');
  return options;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Headless Chrome executable not found');
  return executable;
}

async function createProductionLoopbackProxy(options, WebSocket) {
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'agent-proxy', '.env'));
  const configuredRelayUrl = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const upstreamUrl = configuredRelayUrl?.startsWith('http://')
    ? configuredRelayUrl
    : `http://${deployEnv.DEPLOY_HOST || 'tower'}:3500`;
  const upstream = new URL(upstreamUrl);
  assert.strictEqual(upstream.protocol, 'http:', 'headless loopback upstream must be the production LAN HTTP origin');
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT bearer token could not be built for fresh headless production client');
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  const server = http.createServer((request, response) => {
    const headers = { ...request.headers, host: upstream.host, authorization: `Bearer ${token}` };
    delete headers.connection;
    const forwarded = http.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path: request.url,
      method: request.method,
      headers,
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    forwarded.on('error', error => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`production loopback proxy failed: ${error.message}`);
    });
    request.pipe(forwarded);
  });
  const localSockets = new WebSocket.Server({ server });
  localSockets.on('connection', (client, request) => {
    const incoming = new URL(request.url, 'http://localhost');
    if (incoming.pathname !== '/client-ws') return client.close(1008, 'unsupported path');
    incoming.searchParams.set('token', token);
    const upstreamSocket = new WebSocket(`ws://${upstream.host}${incoming.pathname}${incoming.search}`, {
      headers: { Origin: publicOrigin },
    });
    const pending = [];
    client.on('message', (data, isBinary) => {
      if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary: isBinary });
      else pending.push({ data, isBinary });
    });
    upstreamSocket.on('open', () => {
      for (const item of pending.splice(0)) upstreamSocket.send(item.data, { binary: item.isBinary });
    });
    upstreamSocket.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstreamSocket.on('close', () => {
      if (client.readyState === WebSocket.OPEN) client.close();
    });
    upstreamSocket.on('error', () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream websocket failed');
    });
    client.on('close', () => {
      if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(upstreamSocket.readyState)) upstreamSocket.close();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const client of localSockets.clients) client.terminate();
      localSockets.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sessionHash(sessionId) {
  return sha256(`session\0${sessionId}`).slice(0, 16);
}

function redactedActivityState(sessionId, session, state, nowMs) {
  const activity = session?.activity || {};
  const observedAtMs = Math.max(
    Date.parse(activity.observed_at || '') || 0,
    Date.parse(activity.updated_at || activity.updatedAt || '') || 0,
  );
  const goalState = String(activity.goal?.state || activity.goal?.status || '').trim().toLowerCase();
  const lifecycle = lifecycleSnapshot(session);
  return {
    session_hash: sessionHash(sessionId),
    agent_type: String(session?.agent_type || session?.agentType || 'unknown'),
    state: state || 'missing',
    activity_kind: String(activity.kind || 'unknown'),
    goal_state: goalState || null,
    goal_run_lifecycle: lifecycle?.lifecycle || null,
    lease_active: lifecycle?.lease_active === true,
    owner_state: lifecycle?.owner_state || null,
    observation_age_ms: observedAtMs > 0 ? Math.max(0, nowMs - observedAtMs) : null,
  };
}

function compileClassifier(sourceRoot) {
  const esbuild = require(require.resolve('esbuild', {
    paths: [path.join(sourceRoot, 'frontend')],
  }));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-working-now-production-'));
  const output = path.join(scratch, 'fleet-activity.cjs');
  const source = path.join(sourceRoot, 'frontend', 'fleet-activity.js');
  esbuild.buildSync({
    entryPoints: [source],
    outfile: output,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return {
    module: require(output),
    sourceSha256: sha256(fs.readFileSync(source)),
    dispose() {
      try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
    },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function symmetricEdges(previous, next) {
  const edges = [];
  for (const value of previous) if (!next.has(value)) edges.push([value, 'exit']);
  for (const value of next) if (!previous.has(value)) edges.push([value, 'enter']);
  return edges;
}

function applyRemovedFields(target, fields) {
  for (const field of Array.isArray(fields) ? fields : []) {
    if (typeof field === 'string' && !['__proto__', 'prototype', 'constructor'].includes(field)) delete target[field];
  }
}

function lifecycleSnapshot(session) {
  const run = session?.activity?.goal_run;
  if (!run || typeof run !== 'object') return null;
  return {
    goal_fingerprint_hash: sha256(String(run.goal_fingerprint || '')).slice(0, 16),
    goal_generation: Number.isFinite(Number(run.goal_generation)) ? Number(run.goal_generation) : null,
    lifecycle: String(run.lifecycle || '').slice(0, 64),
    lease_active: run.lease_active === true,
    owner_state: String(run.owner_state || '').slice(0, 32),
    evidence_type: String(run.evidence_type || '').slice(0, 64),
    transition_seq: Number.isFinite(Number(run.transition_seq)) ? Number(run.transition_seq) : null,
    source_sequence: Number.isFinite(Number(run.source_sequence)) ? Number(run.source_sequence) : null,
  };
}

function goalEdgeExplained(edge, state, lifecycle) {
  if (!lifecycle) return { explained: true, reason: 'ordinary_turn_classifier_edge' };
  const workingLifecycles = new Set([
    'starting', 'running_turn', 'checkpoint_pending_continuation', 'verifying',
  ]);
  const exitLifecycles = new Set([
    'waiting_for_user', 'blocked_limited', 'paused',
    'completed_cancelled_failed', 'unknown_disconnected',
  ]);
  if (edge === 'enter' && lifecycle.lease_active && workingLifecycles.has(lifecycle.lifecycle)) {
    return { explained: true, reason: 'canonical_goal_lease_acquired' };
  }
  if (edge === 'exit' && (!lifecycle.lease_active || exitLifecycles.has(lifecycle.lifecycle)
      || state === 'needs_attention' || state === 'idle' || state === 'stale')) {
    return { explained: true, reason: 'canonical_goal_exit_evidence' };
  }
  return { explained: false, reason: 'goal_edge_without_authoritative_lifecycle' };
}

function openRelayInventory(options, onMessage) {
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  assert(relayIp, 'explicit environment root is missing RELAY_IP');
  assert(token, 'JWT bearer token could not be built from the explicit environment root');
  const WebSocket = require(path.join(options.envRoot, 'relay-server', 'node_modules', 'ws'));
  const ws = new WebSocket(`ws://${relayIp}:${relayPort}/client-ws?token=${encodeURIComponent(token)}`, {
    headers: { Origin: 'http://127.0.0.1:3500' },
  });
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const readyTimer = setTimeout(() => readyReject(new Error('passive production relay connection timed out')), 15_000);
  ws.once('error', error => readyReject(error));
  ws.on('open', () => ws.send(JSON.stringify({
    type: 'connection_hello',
    protocol_version: 1,
    peer_role: 'browser',
    client_name: 'working-now-production-passive',
  })));
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    onMessage(message, Date.now());
    if (message.type === 'connection_ack') {
      clearTimeout(readyTimer);
      readyResolve(message);
    }
  });
  return { ws, ready, WebSocket };
}

async function samplePage(page) {
  return page.evaluate(() => {
    const stableElementKey = node => {
      if (!node) return '';
      return [node.tagName || '', node.id || '', String(node.className || '').slice(0, 120)].join('|');
    };
    const sessionList = document.querySelector('.session-list');
    const listRect = sessionList?.getBoundingClientRect();
    const visibleCards = sessionList && listRect
      ? [...sessionList.querySelectorAll('.session-card[data-session-id]')].map(node => ({
          id: node.dataset.sessionId || '',
          rect: node.getBoundingClientRect(),
        })).filter(row => row.rect.bottom > listRect.top && row.rect.top < listRect.bottom)
      : [];
    visibleCards.sort((left, right) => Math.abs(left.rect.top - listRect.top) - Math.abs(right.rect.top - listRect.top));
    const anchor = visibleCards[0];
    const rectFor = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100) : null;
    };
    const layoutShiftEntries = typeof performance.getEntriesByType === 'function'
      ? performance.getEntriesByType('layout-shift') : [];
    const fleetCards = [...document.querySelectorAll('.fleet-card[data-session-id]')];
    const fleetSummary = Object.fromEntries(
      [...document.querySelectorAll('.fleet-summary > div')].map(row => [
        String(row.querySelector('span')?.textContent || '').trim().toLowerCase(),
        Number(row.querySelector('strong')?.textContent || 0),
      ]).filter(([label, value]) => label && Number.isFinite(value)),
    );
    const fleetElapsedById = Object.fromEntries(fleetCards.map(card => [
      card.dataset.sessionId || '',
      String(card.querySelector('.fleet-card-status time')?.textContent || '').trim(),
    ]).filter(([id, value]) => id && value));
    const workingActivityPlaceholderIds = fleetCards.filter(card => (
      ['working', 'working_goal'].includes(card.dataset.activityState || '')
      && /activity\s+(?:awaiting live update|unknown|not reported)/i.test(
        String(card.querySelector('.fleet-freshness')?.textContent || ''),
      )
    )).map(card => card.dataset.sessionId || '').filter(Boolean);
    return {
      url: location.href,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      active_element: stableElementKey(document.activeElement),
      selected_session: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      loaded_build: ([...document.scripts].map(script => script.src)
        .find(src => src.includes('/dist/bundle.js')) || '').match(/v=(build-[0-9a-f]+)/)?.[1] || '',
      sidebar_working_ids: [...document.querySelectorAll('.working-session-group .session-card[data-session-id]')]
        .map(node => node.dataset.sessionId || '').filter(Boolean),
      fleet_present: !!document.querySelector('[data-testid="fleet-view"]'),
      fleet_working_ids: [...document.querySelectorAll('.fleet-card[data-session-id][data-activity-state="working"], .fleet-card[data-session-id][data-activity-state="working_goal"]')]
        .map(node => node.dataset.sessionId || '').filter(Boolean),
      fleet_summary: fleetSummary,
      fleet_elapsed_by_id: fleetElapsedById,
      stale_working_ids: fleetCards.filter(card => (
        ['working', 'working_goal'].includes(card.dataset.activityState || '')
        && !!card.querySelector('.fleet-state-badge.stale')
      )).map(card => card.dataset.sessionId || '').filter(Boolean),
      working_activity_placeholder_ids: workingActivityPlaceholderIds,
      codex_config_placeholder_count: fleetCards.filter(card => (
        /observed unknown\s*\/\s*unknown/i.test(card.textContent || '')
        && /next unset\s*\/\s*unset/i.test(card.textContent || '')
      )).length,
      sidebar_scroll_top: sessionList ? Math.round(sessionList.scrollTop * 100) / 100 : null,
      anchor_id: anchor?.id || '',
      anchor_offset_px: anchor && listRect ? Math.round((anchor.rect.top - listRect.top) * 100) / 100 : null,
      layout_shift_sum: layoutShiftEntries.reduce((sum, entry) => sum + Number(entry.value || 0), 0),
      rects: {
        topbar: rectFor('.topbar'),
        sidebar: rectFor('.sidebar'),
        working_group: rectFor('.working-session-group'),
        active_session: rectFor('.session-card.active'),
        fleet: rectFor('[data-testid="fleet-view"]'),
      },
      duplicate_proxy_banners: document.querySelectorAll('.duplicate-proxy-banner').length,
      session_cards: document.querySelectorAll('.session-card[data-session-id]').length,
    };
  });
}

function redactedPageSample(sample) {
  return {
    visibility: sample.visibility,
    has_focus: sample.has_focus,
    active_element: sample.active_element,
    selected_session_hash: sample.selected_session ? sessionHash(sample.selected_session) : '',
    loaded_build: sample.loaded_build,
    sidebar_working: sample.sidebar_working_ids.map(sessionHash).sort(),
      fleet_present: sample.fleet_present,
      fleet_working: sample.fleet_working_ids.map(sessionHash).sort(),
      fleet_summary: sample.fleet_summary,
      stale_working: sample.stale_working_ids.map(sessionHash).sort(),
      working_activity_placeholders: sample.working_activity_placeholder_ids.map(sessionHash).sort(),
      codex_config_placeholder_count: sample.codex_config_placeholder_count,
    sidebar_scroll_top: sample.sidebar_scroll_top,
    anchor_session_hash: sample.anchor_id ? sessionHash(sample.anchor_id) : '',
    anchor_offset_px: sample.anchor_offset_px,
    layout_shift_sum: Number(sample.layout_shift_sum || 0),
    rects: sample.rects,
    duplicate_proxy_banners: sample.duplicate_proxy_banners,
    session_cards: sample.session_cards,
  };
}

function parseClockDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'live') return null;
  const unitSeconds = { d: 86400, h: 3600, m: 60, s: 1 };
  let seconds = 0;
  let matched = false;
  const pattern = /(\d+)\s*([dhms])/g;
  let match;
  while ((match = pattern.exec(text))) {
    seconds += Number(match[1]) * unitSeconds[match[2]];
    matched = true;
  }
  return matched ? seconds : null;
}

function auditFleetTruth(sample, sessions, nowMs, fleetGoalElapsedSeconds) {
  const headerWorking = Number(sample.fleet_summary?.working);
  const sidebarWorking = new Set(sample.sidebar_working_ids).size;
  const fleetWorking = new Set(sample.fleet_working_ids).size;
  const countCoherent = Number.isFinite(headerWorking)
    && headerWorking === sidebarWorking
    && headerWorking === fleetWorking;
  const elapsedEvidenceViolations = [];
  for (const [id, elapsedText] of Object.entries(sample.fleet_elapsed_by_id || {})) {
    const session = sessions.get(id);
    const goal = session?.activity?.goal;
    const goalRun = session?.activity?.goal_run;
    if (!goal || !goalRun) continue;
    const displayed = parseClockDuration(elapsedText);
    const expected = fleetGoalElapsedSeconds(goal, goalRun, nowMs);
    if (displayed == null || expected == null) continue;
    if (Math.abs(displayed - Math.floor(expected)) > 2) elapsedEvidenceViolations.push(id);
  }
  return {
    count_coherent: countCoherent,
    header_working: Number.isFinite(headerWorking) ? headerWorking : null,
    sidebar_working: sidebarWorking,
    fleet_working: fleetWorking,
    stale_working_ids: sample.stale_working_ids || [],
    working_activity_placeholder_ids: sample.working_activity_placeholder_ids || [],
    elapsed_evidence_violation_ids: elapsedEvidenceViolations,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const classifier = compileClassifier(options.sourceRoot);
  const { classifyFleetActivity, fleetStateIsWorking, fleetGoalElapsedSeconds } = classifier.module;
  assert.strictEqual(typeof classifyFleetActivity, 'function');
  assert.strictEqual(typeof fleetStateIsWorking, 'function');
  assert.strictEqual(typeof fleetGoalElapsedSeconds, 'function');
  const localWorker = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'sw.js'), 'utf8');
  const expectedBuild = localWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1] || '';
  assert(expectedBuild, 'source service worker is missing ASSET_VERSION');

  const sessions = new Map();
  const lastRelayMessageAt = new Map();
  let relayMessages = 0;
  let relayDisconnects = 0;
  let duplicateProxyAlarms = 0;
  let subscribedSignature = '';
  let relay;
  let browser;
  let loopback;
  let releaseOperation;
  let page;
  let pageUrl = '';
  let initialPage;
  let latestPage;
  let startedAt = 0;
  let lastSampleAt = 0;
  const sampleIntervals = [];
  const relayEdges = [];
  const domEdges = [];
  const fleetEdges = [];
  const lifecycleTransitions = [];
  const minuteCheckpoints = [];
  const propagationLatencies = [];
  const pendingPropagation = new Map();
  const lifecycleSemantic = new Map();
  const stateBySession = new Map();
  let previousRelayWorking = new Set();
  let previousDomWorking = new Set();
  let previousFleetWorking = new Set();
  let sampleCount = 0;
  let digest = Buffer.alloc(32, 0);
  let maxAnchorDriftPx = 0;
  let maxScrollDriftPx = 0;
  let maxLayoutShift = 0;
  let maxRectDriftPx = 0;
  let focusChanges = 0;
  let selectionChanges = 0;
  let urlChanges = 0;
  let visibilityChanges = 0;
  let countCoherenceViolationSamples = 0;
  let staleWorkingViolationSamples = 0;
  let workingActivityPlaceholderViolationSamples = 0;
  let elapsedEvidenceViolationSamples = 0;
  let maxCodexConfigPlaceholderCount = 0;
  let setupClicks = 0;
  let setupNavigations = 0;
  let freshClientHydrationMs = null;

  const recordFleetTruth = audit => {
    if (!audit.count_coherent) countCoherenceViolationSamples += 1;
    if (audit.stale_working_ids.length) staleWorkingViolationSamples += 1;
    if (audit.working_activity_placeholder_ids.length) workingActivityPlaceholderViolationSamples += 1;
    if (audit.elapsed_evidence_violation_ids.length) elapsedEvidenceViolationSamples += 1;
    maxCodexConfigPlaceholderCount = Math.max(
      maxCodexConfigPlaceholderCount,
      Number(latestPage?.codex_config_placeholder_count || 0),
    );
  };

  const mergeSession = row => {
    const id = typeof row === 'string' ? row : row?.session_id || row?.session;
    if (!id) return;
    const previous = sessions.get(id) || { session_id: id };
    sessions.set(id, typeof row === 'string' ? previous : { ...previous, ...row, session_id: id });
  };
  const handleRelay = (message, receivedAt) => {
    relayMessages += 1;
    if (Array.isArray(message.duplicate_proxy_alarms)) duplicateProxyAlarms = message.duplicate_proxy_alarms.length;
    if (message.type === 'connection_ack' || message.type === 'session_list') {
      for (const row of Array.isArray(message.sessions) ? message.sessions : []) mergeSession(row);
      return;
    }
    if (message.type === 'session_patch') {
      const id = message.session || message.session_id;
      if (!id) return;
      const next = { ...(sessions.get(id) || { session_id: id }), ...(message.patch || {}) };
      applyRemovedFields(next, message.removed_fields);
      sessions.set(id, next);
      lastRelayMessageAt.set(id, receivedAt);
      return;
    }
    if (['status', 'proxy_status', 'session_status', 'session_summary'].includes(message.type)) {
      const id = message.session || message.session_id;
      if (!id) return;
      const previous = sessions.get(id) || { session_id: id };
      const activity = message.activity === undefined ? previous.activity : message.activity;
      sessions.set(id, {
        ...previous,
        session_id: id,
        ...(message.status ? { status: message.status } : {}),
        activity,
      });
      lastRelayMessageAt.set(id, receivedAt);
      return;
    }
    if (message.type === 'session_closed') {
      const id = message.session || message.session_id;
      if (id) sessions.delete(id);
    }
  };

  const writeResult = (status, failure = null) => {
    const now = Date.now();
    const elapsedMs = startedAt ? now - startedAt : 0;
    const unexplainedRelayGoalEdges = relayEdges.filter(edge => edge.goal_run && !edge.explained).length;
    const unexplainedDomEdges = domEdges.filter(edge => !edge.explained).length;
    const unexplainedFleetEdges = fleetEdges.filter(edge => !edge.explained).length;
    const pageBuildCurrent = latestPage?.loaded_build === expectedBuild;
    const durationGate = elapsedMs >= 30 * 60 * 1000 && sampleCount >= 1800;
    const relayLifecyclePass = unexplainedRelayGoalEdges === 0;
    const fleetTruthPass = countCoherenceViolationSamples === 0
      && staleWorkingViolationSamples === 0
      && workingActivityPlaceholderViolationSamples === 0
      && elapsedEvidenceViolationSamples === 0;
    const domContinuityPass = unexplainedDomEdges === 0 && unexplainedFleetEdges === 0
      && focusChanges === 0 && selectionChanges === 0 && urlChanges === 0
      && maxAnchorDriftPx === 0 && maxScrollDriftPx === 0 && maxLayoutShift === 0
      && fleetTruthPass;
    const classifiedSessions = [...sessions.entries()]
      .map(([id, session]) => redactedActivityState(id, session, stateBySession.get(id), now))
      .filter(row => row.state !== 'idle' || row.lease_active)
      .sort((left, right) => left.session_hash.localeCompare(right.session_hash))
      .slice(0, 128);
    let verdict = status;
    if (status === 'complete') {
      verdict = durationGate && relayLifecyclePass && domContinuityPass && pageBuildCurrent
        ? 'PASS'
        : !pageBuildCurrent && !options.headlessLoopback ? 'BLOCKED_STALE_PERSISTENT_PAGE' : 'FAIL';
    }
    const result = {
      schema_version: 1,
      generated_at: new Date(now).toISOString(),
      status: verdict,
      failure,
      source: {
        commit: (() => {
          try { return require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: options.sourceRoot, encoding: 'utf8', windowsHide: true,
          }).trim(); } catch { return ''; }
        })(),
        expected_build: expectedBuild,
        classifier_sha256: classifier.sourceSha256,
      },
      sampling: {
        requested_duration_seconds: options.durationSeconds,
        sample_interval_ms: options.sampleMs,
        samples: sampleCount,
        elapsed_ms: elapsedMs,
        interval_p95_ms: percentile(sampleIntervals, 0.95),
        interval_max_ms: sampleIntervals.length ? Math.max(...sampleIntervals) : null,
        digest_sha256: digest.toString('hex'),
      },
      relay: {
        messages: relayMessages,
        disconnects: relayDisconnects,
        sessions: sessions.size,
        duplicate_proxy_alarms: duplicateProxyAlarms,
        working_count: previousRelayWorking.size,
        goal_leases: [...sessions.values()].filter(row => lifecycleSnapshot(row)?.lease_active).length,
        classified_sessions: classifiedSessions,
        membership_edges: relayEdges,
        lifecycle_transitions: lifecycleTransitions,
        unexplained_goal_edges: unexplainedRelayGoalEdges,
        max_propagation_latency_ms: propagationLatencies.length ? Math.max(...propagationLatencies) : null,
        propagation_latency_p95_ms: percentile(propagationLatencies, 0.95),
      },
      page: {
        pages: page ? 1 : 0,
        loaded_build: latestPage?.loaded_build || '',
        loaded_build_matches_source: pageBuildCurrent,
        fleet_view_present: latestPage?.fleet_present === true,
        fresh_client_hydration_ms: freshClientHydrationMs,
        sidebar_working_count: previousDomWorking.size,
        fleet_working_count: previousFleetWorking.size,
        sidebar_membership_edges: domEdges,
        fleet_membership_edges: fleetEdges,
        unexplained_sidebar_edges: unexplainedDomEdges,
        unexplained_fleet_edges: unexplainedFleetEdges,
        url_changes: urlChanges,
        selection_changes: selectionChanges,
        visibility_changes: visibilityChanges,
        focus_changes: focusChanges,
        max_anchor_drift_px: maxAnchorDriftPx,
        max_scroll_drift_px: maxScrollDriftPx,
        max_rect_drift_px: maxRectDriftPx,
        max_layout_shift: maxLayoutShift,
        count_coherence_violation_samples: countCoherenceViolationSamples,
        stale_working_violation_samples: staleWorkingViolationSamples,
        working_activity_placeholder_violation_samples: workingActivityPlaceholderViolationSamples,
        elapsed_evidence_violation_samples: elapsedEvidenceViolationSamples,
        max_codex_config_placeholder_count: maxCodexConfigPlaceholderCount,
        initial: initialPage ? redactedPageSample(initialPage) : null,
        final: latestPage ? redactedPageSample(latestPage) : null,
      },
      checkpoints: minuteCheckpoints,
      acceptance: {
        thirty_minute_one_second_gate: durationGate,
        relay_goal_lifecycle_continuity: relayLifecyclePass,
        dom_continuity: domContinuityPass,
        fleet_header_sidebar_card_count_coherence: countCoherenceViolationSamples === 0,
        stale_and_working_mutually_exclusive: staleWorkingViolationSamples === 0,
        working_activity_observed: workingActivityPlaceholderViolationSamples === 0,
        elapsed_work_bounded_by_evidence: elapsedEvidenceViolationSamples === 0,
        exact_build_loaded: pageBuildCurrent,
        fresh_headless_client: options.headlessLoopback,
      },
      automation: {
        browser_mode: options.headlessLoopback ? 'fresh_headless_loopback' : 'persistent_cdp',
        operation_lock_kind: 'production-soak',
        operation_lock_held_for_run: !!releaseOperation,
        page_navigations: setupNavigations,
        page_reloads: 0,
        clicks: setupClicks,
        focus_actions: 0,
        sends: 0,
        controls: setupClicks,
        dom_mutations: 0,
        new_pages: options.headlessLoopback ? 1 : 0,
        visible_windows_opened: 0,
        protected_session_mutations: 0,
        read_only_relay_subscription: true,
      },
    };
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    return result;
  };

  try {
    releaseOperation = acquirePidLock(
      OPERATION_LOCK_PATH,
      'Remote Agent Chat production operation lock',
      `${JSON.stringify({
        pid: process.pid,
        acquired_at: new Date().toISOString(),
        agent: 'working-now-production-passive',
        kind: 'production-soak',
      })}\n`,
    );
    relay = openRelayInventory(options, handleRelay);
    const ack = await relay.ready;
    assert(Array.isArray(ack.sessions) && ack.sessions.length > 0, 'production relay inventory is empty');
    relay.ws.on('close', () => { relayDisconnects += 1; });

    const { chromium } = require(path.join(options.envRoot, 'frontend', 'node_modules', 'playwright-core'));
    if (options.headlessLoopback) {
      loopback = await createProductionLoopbackProxy(options, relay.WebSocket);
      browser = await chromium.launch({
        executablePath: findChrome(),
        headless: true,
        args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
      page = await context.newPage();
      await page.goto(loopback.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      setupNavigations = 1;
      await page.locator('#root').waitFor({ state: 'visible', timeout: 10_000 });
      await page.locator('.session-card[data-session-id]').first().waitFor({ state: 'visible', timeout: 20_000 });
      await page.getByRole('button', { name: 'Fleet view', exact: true }).click();
      setupClicks = 1;
      await page.locator('[data-testid="fleet-view"]').waitFor({ state: 'visible', timeout: 10_000 });
      await page.locator('.fleet-summary').waitFor({ state: 'visible', timeout: 10_000 });
      const hydrationStartedAt = Date.now();
      await page.waitForFunction(() => {
        const workingCards = [...document.querySelectorAll(
          '.fleet-card[data-session-id][data-activity-state="working"], .fleet-card[data-session-id][data-activity-state="working_goal"]',
        )];
        const activityReady = workingCards.every(card => !/activity\s+(?:awaiting live update|unknown|not reported)/i.test(
          String(card.querySelector('.fleet-freshness')?.textContent || ''),
        ));
        const headerWorking = Number(
          [...document.querySelectorAll('.fleet-summary > div')]
            .find(row => String(row.querySelector('span')?.textContent || '').trim().toLowerCase() === 'working')
            ?.querySelector('strong')?.textContent || NaN,
        );
        const sidebarWorking = new Set(
          [...document.querySelectorAll('.working-session-group .session-card[data-session-id]')]
            .map(node => node.dataset.sessionId || '').filter(Boolean),
        ).size;
        return activityReady && Number.isFinite(headerWorking)
          && headerWorking === workingCards.length
          && headerWorking === sidebarWorking;
      }, null, { timeout: 20_000 });
      freshClientHydrationMs = Date.now() - hydrationStartedAt;
    } else {
      const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
      browser = await chromium.connectOverCDP(cdpUrl);
      const pages = browser.contexts().flatMap(context => context.pages());
      assert.strictEqual(pages.length, 1, `expected exactly one CDP-9240 page, found ${pages.length}`);
      page = pages[0];
    }
    pageUrl = page.url();
    initialPage = await samplePage(page);
    latestPage = initialPage;
    assert.strictEqual(initialPage.fleet_present, true, 'production Fleet view is not open');
    recordFleetTruth(auditFleetTruth(initialPage, sessions, Date.now(), fleetGoalElapsedSeconds));
    startedAt = Date.now();
    lastSampleAt = startedAt;
    previousDomWorking = new Set(initialPage.sidebar_working_ids);
    previousFleetWorking = new Set(initialPage.fleet_working_ids);
    for (const [id, session] of sessions) {
      const state = classifyFleetActivity(session.activity, false, {
        connected: String(session.status || '').toLowerCase() !== 'disconnected',
        health: session.status,
        nowMs: startedAt,
        requireFreshness: true,
      });
      stateBySession.set(id, state);
      if (fleetStateIsWorking(state)) previousRelayWorking.add(id);
      const lifecycle = lifecycleSnapshot(session);
      if (lifecycle) {
        lifecycleSemantic.set(id, JSON.stringify(lifecycle));
        lifecycleTransitions.push({
          sample: 0,
          at_ms: startedAt,
          session_hash: sessionHash(id),
          ...lifecycle,
        });
      }
    }
    writeResult('running');

    for (let index = 0; index < options.durationSeconds; index += 1) {
      const dueAt = startedAt + ((index + 1) * options.sampleMs);
      await sleep(Math.max(0, dueAt - Date.now()));
      const sampledAt = Date.now();
      sampleIntervals.push(sampledAt - lastSampleAt);
      lastSampleAt = sampledAt;
      assert(relay.ws.readyState === relay.WebSocket.OPEN, 'passive relay WebSocket disconnected');

      const leasedIds = [...sessions.entries()].filter(([, row]) => lifecycleSnapshot(row))
        .map(([id]) => id).sort().slice(0, 128);
      const nextSignature = leasedIds.join('\0');
      if (nextSignature !== subscribedSignature) {
        subscribedSignature = nextSignature;
        relay.ws.send(JSON.stringify({
          type: 'subscribe',
          protocol_version: 1,
          request_id: `working-now-passive-${sampledAt}`,
          sessions: leasedIds,
        }));
      }

      latestPage = await samplePage(page);
      const fleetTruth = auditFleetTruth(latestPage, sessions, sampledAt, fleetGoalElapsedSeconds);
      recordFleetTruth(fleetTruth);
      const relayWorking = new Set();
      const currentStateBySession = new Map();
      for (const [id, session] of sessions) {
        const state = classifyFleetActivity(session.activity, false, {
          connected: String(session.status || '').toLowerCase() !== 'disconnected',
          health: session.status,
          nowMs: sampledAt,
          requireFreshness: true,
        });
        currentStateBySession.set(id, state);
        if (fleetStateIsWorking(state)) relayWorking.add(id);
        const lifecycle = lifecycleSnapshot(session);
        if (lifecycle) {
          const semantic = JSON.stringify(lifecycle);
          if (lifecycleSemantic.get(id) !== semantic) {
            lifecycleSemantic.set(id, semantic);
            lifecycleTransitions.push({
              sample: index + 1,
              at_ms: sampledAt,
              session_hash: sessionHash(id),
              ...lifecycle,
            });
          }
        }
      }

      for (const [id, edge] of symmetricEdges(previousRelayWorking, relayWorking)) {
        const lifecycle = lifecycleSnapshot(sessions.get(id));
        const state = currentStateBySession.get(id) || 'missing';
        const explanation = goalEdgeExplained(edge, state, lifecycle);
        relayEdges.push({
          sample: index + 1,
          at_ms: sampledAt,
          session_hash: sessionHash(id),
          edge,
          state,
          goal_run: lifecycle,
          ...explanation,
        });
        pendingPropagation.set(id, { edge, at: sampledAt });
      }

      const domWorking = new Set(latestPage.sidebar_working_ids);
      for (const [id, edge] of symmetricEdges(previousDomWorking, domWorking)) {
        const relayHas = relayWorking.has(id);
        const explained = edge === 'enter' ? relayHas : !relayHas;
        domEdges.push({
          sample: index + 1,
          at_ms: sampledAt,
          session_hash: sessionHash(id),
          edge,
          relay_state: currentStateBySession.get(id) || 'not_in_relay_inventory',
          goal_run: lifecycleSnapshot(sessions.get(id)),
          explained,
          reason: explained ? 'matches_shared_relay_classifier' : 'dom_edge_without_matching_relay_edge',
        });
      }
      const fleetWorking = new Set(latestPage.fleet_working_ids);
      for (const [id, edge] of symmetricEdges(previousFleetWorking, fleetWorking)) {
        const relayHas = relayWorking.has(id);
        const explained = edge === 'enter' ? relayHas : !relayHas;
        fleetEdges.push({
          sample: index + 1,
          at_ms: sampledAt,
          session_hash: sessionHash(id),
          edge,
          relay_state: currentStateBySession.get(id) || 'not_in_relay_inventory',
          goal_run: lifecycleSnapshot(sessions.get(id)),
          explained,
          reason: explained ? 'matches_shared_relay_classifier' : 'fleet_edge_without_matching_relay_edge',
        });
      }
      for (const [id, pending] of pendingPropagation) {
        const domHas = domWorking.has(id);
        const relayHas = relayWorking.has(id);
        if (domHas === relayHas) {
          propagationLatencies.push(sampledAt - pending.at);
          pendingPropagation.delete(id);
        }
      }

      if (latestPage.url !== initialPage.url || page.url() !== pageUrl) urlChanges += 1;
      if (latestPage.selected_session !== initialPage.selected_session) selectionChanges += 1;
      if (latestPage.visibility !== initialPage.visibility) visibilityChanges += 1;
      if (latestPage.has_focus !== initialPage.has_focus || latestPage.active_element !== initialPage.active_element) focusChanges += 1;
      if (initialPage.anchor_id && latestPage.anchor_id === initialPage.anchor_id
          && Number.isFinite(initialPage.anchor_offset_px) && Number.isFinite(latestPage.anchor_offset_px)) {
        maxAnchorDriftPx = Math.max(maxAnchorDriftPx,
          Math.abs(latestPage.anchor_offset_px - initialPage.anchor_offset_px));
      }
      if (Number.isFinite(initialPage.sidebar_scroll_top) && Number.isFinite(latestPage.sidebar_scroll_top)) {
        maxScrollDriftPx = Math.max(maxScrollDriftPx,
          Math.abs(latestPage.sidebar_scroll_top - initialPage.sidebar_scroll_top));
      }
      maxLayoutShift = Math.max(maxLayoutShift,
        Math.abs(Number(latestPage.layout_shift_sum || 0) - Number(initialPage.layout_shift_sum || 0)));
      for (const key of Object.keys(initialPage.rects)) {
        const before = initialPage.rects[key];
        const after = latestPage.rects[key];
        if (!before || !after) continue;
        for (let coordinate = 0; coordinate < before.length; coordinate += 1) {
          maxRectDriftPx = Math.max(maxRectDriftPx, Math.abs(after[coordinate] - before[coordinate]));
        }
      }

      const digestPayload = JSON.stringify({
        sample: index + 1,
        relay: [...relayWorking].map(sessionHash).sort(),
        dom: [...domWorking].map(sessionHash).sort(),
        fleet: [...fleetWorking].map(sessionHash).sort(),
        lifecycles: [...sessions.entries()].map(([id, row]) => [sessionHash(id), lifecycleSnapshot(row)])
          .filter(([, lifecycle]) => lifecycle).sort(([left], [right]) => left.localeCompare(right)),
        page: redactedPageSample(latestPage),
      });
      digest = crypto.createHash('sha256').update(digest).update(digestPayload).digest();
      sampleCount = index + 1;
      previousRelayWorking = relayWorking;
      previousDomWorking = domWorking;
      previousFleetWorking = fleetWorking;
      stateBySession.clear();
      for (const [id, state] of currentStateBySession) stateBySession.set(id, state);

      if (sampleCount % 60 === 0 || sampleCount === options.durationSeconds) {
        minuteCheckpoints.push({
          sample: sampleCount,
          at: new Date(sampledAt).toISOString(),
          relay_working: relayWorking.size,
          goal_leases: [...sessions.values()].filter(row => lifecycleSnapshot(row)?.lease_active).length,
          sidebar_working: domWorking.size,
          fleet_working: fleetWorking.size,
          fleet_header_working: fleetTruth.header_working,
          count_coherent: fleetTruth.count_coherent,
          stale_working: fleetTruth.stale_working_ids.length,
          working_activity_placeholders: fleetTruth.working_activity_placeholder_ids.length,
          elapsed_evidence_violations: fleetTruth.elapsed_evidence_violation_ids.length,
          relay_edges: relayEdges.length,
          sidebar_edges: domEdges.length,
          fleet_edges: fleetEdges.length,
          max_anchor_drift_px: maxAnchorDriftPx,
          max_scroll_drift_px: maxScrollDriftPx,
          max_layout_shift: maxLayoutShift,
          focus_changes: focusChanges,
          digest_prefix: digest.toString('hex').slice(0, 16),
        });
        writeResult('running');
      }
    }

    const result = writeResult('complete');
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      samples: result.sampling.samples,
      elapsed_ms: result.sampling.elapsed_ms,
      loaded_build: result.page.loaded_build,
      expected_build: result.source.expected_build,
      relay_working: result.relay.working_count,
      goal_leases: result.relay.goal_leases,
      relay_edges: result.relay.membership_edges.length,
      unexplained_goal_edges: result.relay.unexplained_goal_edges,
      sidebar_edges: result.page.sidebar_membership_edges.length,
      unexplained_sidebar_edges: result.page.unexplained_sidebar_edges,
      max_propagation_latency_ms: result.relay.max_propagation_latency_ms,
      max_anchor_drift_px: result.page.max_anchor_drift_px,
      max_scroll_drift_px: result.page.max_scroll_drift_px,
      max_layout_shift: result.page.max_layout_shift,
      focus_changes: result.page.focus_changes,
      count_coherence_violation_samples: result.page.count_coherence_violation_samples,
      stale_working_violation_samples: result.page.stale_working_violation_samples,
      working_activity_placeholder_violation_samples: result.page.working_activity_placeholder_violation_samples,
      elapsed_evidence_violation_samples: result.page.elapsed_evidence_violation_samples,
      browser_mode: result.automation.browser_mode,
      output: options.output,
    }, null, 2)}\n`);
    return result;
  } catch (error) {
    writeResult('failed', String(error?.stack || error?.message || error));
    throw error;
  } finally {
    try { relay?.ws?.close(); } catch {}
    if (browser) await browser.close().catch(() => {});
    if (loopback) await loopback.close().catch(() => {});
    if (releaseOperation) releaseOperation();
    classifier.dispose();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Working-now passive production proof: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
