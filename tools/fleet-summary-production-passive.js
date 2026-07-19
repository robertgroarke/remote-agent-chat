#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function readRelayInventory() {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  assert(relayIp, 'RELAY_IP is required for the passive production inventory');
  assert(token, 'a short-lived relay bearer token could not be built');
  const WebSocket = require('../relay-server/node_modules/ws');
  const wsUrl = `ws://${relayIp}:${relayPort}/client-ws?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('passive production inventory timed out'));
    }, 15_000);
    const finish = (error, value) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    ws.once('error', error => finish(error));
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: 'browser',
      client_name: 'fleet-summary-production-passive',
    })));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type !== 'connection_ack') return;
      finish(null, {
        sessions: Array.isArray(message.sessions) ? message.sessions : [],
        duplicateProxyAlarms: Array.isArray(message.duplicate_proxy_alarms)
          ? message.duplicate_proxy_alarms.length : 0,
      });
    });
  });
}

function distribution(summaries, field) {
  const counts = new Map();
  for (const summary of summaries) {
    const value = String(summary[field] ?? 'null');
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function sessionIsWorking(session) {
  const kind = String(session?.activity?.kind || '').trim().toLowerCase();
  const goalState = String(session?.activity?.goal?.state || session?.activity?.goal?.status || '')
    .trim().toLowerCase().replace(/[^a-z]/g, '');
  if (['active', 'running', 'working', 'pursuinggoal'].includes(goalState)) return true;
  return ['thinking', 'generating', 'working', 'running', 'processing', 'applying_patch', 'tool', 'streaming']
    .includes(kind);
}

function summarizeInventory(inventory) {
  const sessions = inventory.sessions;
  const summaries = sessions.map(row => row?.fleet_summary).filter(Boolean);
  const bytes = summaries.map(summary => Buffer.byteLength(JSON.stringify(summary), 'utf8'));
  const credentialShape = /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i;
  const absolutePath = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)/i;
  const durationOnly = /^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i;
  const statusOnly = /^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i;
  const summaryStrings = summaries.flatMap(summary => Object.values(summary).filter(value => typeof value === 'string'));
  const sessionIds = sessions.map(row => String(row?.session_id || ''));
  const sessionKeys = summaries.map(summary => String(summary.session_key || ''));
  const workingSessions = sessions.filter(sessionIsWorking);
  const populatedSessions = sessions.filter(row => Number(row?.fleet_summary?.message_count) > 0);
  return {
    sessions: sessions.length,
    summaries: summaries.length,
    schema_v1: summaries.filter(summary => summary.schema_version === 1).length,
    parser_v1: summaries.filter(summary => summary.parser_version === 'fleet-summary-v1').length,
    max_summary_bytes: bytes.length ? Math.max(...bytes) : 0,
    total_summary_bytes: bytes.reduce((sum, value) => sum + value, 0),
    summaries_over_1024_bytes: bytes.filter(value => value > 1024).length,
    unique_session_ids: new Set(sessionIds).size,
    duplicate_session_ids: sessionIds.length - new Set(sessionIds).size,
    unique_session_keys: new Set(sessionKeys).size,
    session_identity_collisions: sessionKeys.length - new Set(sessionKeys).size,
    missing_title: summaries.filter(summary => !summary.title).length,
    new_chat_title: summaries.filter(summary => /^new (?:chat|conversation)$/i.test(String(summary.title || '').trim())).length,
    missing_current_work: summaries.filter(summary => !summary.current_work).length,
    missing_last_snippet: summaries.filter(summary => !summary.last_snippet).length,
    working_sessions: workingSessions.length,
    working_missing_title: workingSessions.filter(row => !row.fleet_summary?.title).length,
    working_missing_current_work: workingSessions.filter(row => !row.fleet_summary?.current_work).length,
    working_missing_last_snippet: workingSessions.filter(row => !row.fleet_summary?.last_snippet).length,
    populated_sessions: populatedSessions.length,
    populated_missing_title: populatedSessions.filter(row => !row.fleet_summary?.title).length,
    populated_missing_current_work: populatedSessions.filter(row => !row.fleet_summary?.current_work).length,
    populated_missing_last_snippet: populatedSessions.filter(row => !row.fleet_summary?.last_snippet).length,
    duration_or_status_titles: summaries.filter(summary => durationOnly.test(String(summary.title || '').trim())
      || statusOnly.test(String(summary.title || '').trim())).length,
    duration_or_status_work: summaries.filter(summary => durationOnly.test(String(summary.current_work || '').trim())
      || statusOnly.test(String(summary.current_work || '').trim())).length,
    title_source: distribution(summaries, 'title_source'),
    title_confidence: distribution(summaries, 'title_confidence'),
    role_imbalance: distribution(summaries, 'role_imbalance'),
    rejected_candidate_reason: distribution(summaries, 'rejected_candidate_reason'),
    credential_shaped_leaks: summaryStrings.filter(value => credentialShape.test(value)).length,
    absolute_path_leaks: summaryStrings.filter(value => absolutePath.test(value)).length,
    transcript_arrays_present: sessions.filter(row => Array.isArray(row?.messages)
      || Array.isArray(row?.accumulated_messages)).length,
    original_a1c12_present: sessionIds.some(value => value.startsWith('a1c12a8e')),
    duplicate_proxy_alarms: inventory.duplicateProxyAlarms,
  };
}

async function readSolePage() {
  const { chromium } = require('../frontend/node_modules/playwright-core');
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    const page = pages[0];
    const sample = () => page.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      focus: document.hasFocus(),
      loaded_build: ([...document.scripts].map(script => script.src)
        .find(src => src.includes('/dist/bundle.js')) || '').match(/v=(build-[0-9a-f]+)/)?.[1] || '',
      selected_session: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      fleet_view_present: !!document.querySelector('[data-testid="fleet-view"]'),
      fleet_cards: document.querySelectorAll('.fleet-card').length,
      original_a1c12_card: document.querySelectorAll('.fleet-card[data-session-id^="a1c12a8e"]').length,
      session_cards: document.querySelectorAll('.session-card').length,
      duplicate_proxy_banners: document.querySelectorAll('.duplicate-proxy-banner').length,
    }));
    const before = await sample();
    const after = await sample();
    return {
      pages: pages.length,
      loaded_build: before.loaded_build,
      fleet_view_present: before.fleet_view_present,
      fleet_cards: before.fleet_cards,
      original_a1c12_card: before.original_a1c12_card,
      session_cards: before.session_cards,
      duplicate_proxy_banners: before.duplicate_proxy_banners,
      url_unchanged: before.url === after.url,
      selected_session_unchanged: before.selected_session === after.selected_session,
      visibility_unchanged: before.visibility === after.visibility,
      focus_unchanged: before.focus === after.focus,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const inventory = summarizeInventory(await readRelayInventory());
  const page = await readSolePage();
  assert(inventory.sessions > 0, 'production inventory is empty');
  assert.equal(inventory.summaries, inventory.sessions, 'a production session lacks a compact summary');
  assert.equal(inventory.schema_v1, inventory.sessions, 'a production summary has the wrong schema');
  assert.equal(inventory.parser_v1, inventory.sessions, 'a production summary has the wrong parser version');
  assert.equal(inventory.summaries_over_1024_bytes, 0, 'a production summary exceeds 1 KiB');
  assert.equal(inventory.duplicate_session_ids, 0, 'production inventory contains duplicate session IDs');
  assert.equal(inventory.session_identity_collisions, 0, 'production inventory contains a summary identity collision');
  assert.equal(inventory.credential_shaped_leaks, 0, 'production summary contains a credential-shaped value');
  assert.equal(inventory.absolute_path_leaks, 0, 'production summary contains an absolute host path');
  assert.equal(inventory.transcript_arrays_present, 0, 'unsubscribed production inventory carried transcript arrays');
  assert.equal(inventory.duplicate_proxy_alarms, 0, 'authoritative inventory contains a duplicate-proxy alarm');
  assert(page.url_unchanged && page.selected_session_unchanged && page.visibility_unchanged && page.focus_unchanged,
    'passive verification changed the sole authenticated page');
  const result = {
    status: 'PASS',
    generated_at: new Date().toISOString(),
    relay_inventory: inventory,
    sole_cdp_page: page,
    automation: {
      navigations: 0,
      reloads: 0,
      focus_actions: 0,
      sends: 0,
      controls: 0,
      dom_mutations: 0,
      visible_windows_opened: 0,
      protected_session_mutations: 0,
    },
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`Fleet summary passive production smoke: FAIL (${error.stack || error.message || error})`);
  process.exitCode = 1;
});
