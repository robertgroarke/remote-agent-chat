#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    readOnlyProduction: false,
    output: '',
    sourceRoot: ROOT,
    envRoot: ROOT,
    durationSeconds: 1800,
    sampleMs: 1000,
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
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.output, '--output is required');
  assert(Number.isInteger(options.durationSeconds) && options.durationSeconds >= 5,
    '--duration-seconds must be an integer >= 5');
  assert.strictEqual(options.sampleMs, 1000, 'production proof requires exact one-second sampling');
  return options;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sessionHash(sessionId) {
  return sha256(`session\0${sessionId}`).slice(0, 16);
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
    sidebar_scroll_top: sample.sidebar_scroll_top,
    anchor_session_hash: sample.anchor_id ? sessionHash(sample.anchor_id) : '',
    anchor_offset_px: sample.anchor_offset_px,
    layout_shift_sum: Number(sample.layout_shift_sum || 0),
    rects: sample.rects,
    duplicate_proxy_banners: sample.duplicate_proxy_banners,
    session_cards: sample.session_cards,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const classifier = compileClassifier(options.sourceRoot);
  const { classifyFleetActivity, fleetStateIsWorking } = classifier.module;
  assert.strictEqual(typeof classifyFleetActivity, 'function');
  assert.strictEqual(typeof fleetStateIsWorking, 'function');
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
    const domContinuityPass = unexplainedDomEdges === 0 && unexplainedFleetEdges === 0
      && focusChanges === 0 && selectionChanges === 0 && urlChanges === 0
      && maxAnchorDriftPx === 0 && maxScrollDriftPx === 0 && maxLayoutShift === 0;
    let verdict = status;
    if (status === 'complete') {
      verdict = durationGate && relayLifecyclePass && domContinuityPass && pageBuildCurrent
        ? 'PASS'
        : !pageBuildCurrent ? 'BLOCKED_STALE_PERSISTENT_PAGE' : 'FAIL';
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
        initial: initialPage ? redactedPageSample(initialPage) : null,
        final: latestPage ? redactedPageSample(latestPage) : null,
      },
      checkpoints: minuteCheckpoints,
      acceptance: {
        thirty_minute_one_second_gate: durationGate,
        relay_goal_lifecycle_continuity: relayLifecyclePass,
        dom_continuity: domContinuityPass,
        exact_build_loaded_in_persistent_page: pageBuildCurrent,
      },
      automation: {
        page_navigations: 0,
        page_reloads: 0,
        clicks: 0,
        focus_actions: 0,
        sends: 0,
        controls: 0,
        dom_mutations: 0,
        new_pages: 0,
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
    relay = openRelayInventory(options, handleRelay);
    const ack = await relay.ready;
    assert(Array.isArray(ack.sessions) && ack.sessions.length > 0, 'production relay inventory is empty');
    relay.ws.on('close', () => { relayDisconnects += 1; });

    const { chromium } = require(path.join(options.envRoot, 'frontend', 'node_modules', 'playwright-core'));
    const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected exactly one CDP-9240 page, found ${pages.length}`);
    page = pages[0];
    pageUrl = page.url();
    initialPage = await samplePage(page);
    latestPage = initialPage;
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
      output: options.output,
    }, null, 2)}\n`);
    return result;
  } catch (error) {
    writeResult('failed', String(error?.stack || error?.message || error));
    throw error;
  } finally {
    try { relay?.ws?.close(); } catch {}
    if (browser) await browser.close().catch(() => {});
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
