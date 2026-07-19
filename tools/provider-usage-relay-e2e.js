#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require(process.env.RAC_WS_MODULE || '../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const port = 37400 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-provider-usage-relay-'));
const secretCanary = 'Bearer provider-usage-secret-canary-0123456789';

function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function openSocket(pathname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace(/^http/, 'ws') + pathname);
    const messages = [];
    ws.on('message', data => {
      try { messages.push(JSON.parse(String(data))); } catch {}
    });
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out: ${pathname}`)), 10000);
    ws.once('open', () => { clearTimeout(timer); resolve({ ws, messages }); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function fixture() {
  const capturedAt = new Date().toISOString();
  return {
    schema_version: 2,
    generation: 1,
    generated_at: capturedAt,
    poll_interval_ms: 300000,
    in_flight: false,
    snapshots: [{
      schema_version: 2,
      provider_id: 'openai-codex',
      provider_name: 'OpenAI Codex',
      quota_domain: 'codex-plan',
      dashboard_url: 'https://chatgpt.com/codex/settings/usage',
      account_fingerprint: 'acct_0123456789abcdef0123',
      account_label: 'op***@example.invalid',
      plan: 'ChatGPT Pro',
      account_metadata: null,
      source: 'app_server',
      source_history: [{ source: 'app_server', status: 'ok', captured_at: capturedAt }],
      status: 'fresh',
      captured_at: capturedAt,
      stale_after: new Date(Date.now() + 600000).toISOString(),
      windows: [{
        id: 'codex-primary', label: '5-hour', scope: 'Codex',
        used_percent: 100, remaining_percent: 0, duration_minutes: 300,
        starts_at: new Date(Date.now() - 4 * 3600000).toISOString(),
        resets_at: new Date(Date.now() + 3600000).toISOString(), reset_description: null,
        window_kind: 'rolling', model_scope: null, source: 'app_server', provenance: 'fixture',
        freshness_status: 'fresh', status: 'available', error: null, visual_percent: 100,
        thresholds: { warning_percent: 75, critical_percent: 90 }, pace: null,
      }],
      credits: null,
      reset_credits: null,
      error: null,
      request_count: 1,
      latency_ms: 25,
      session_count: 2,
      mapped_harness_types: ['codex', 'codex_cli'],
    }],
    estimated_cost: {
      schema_version: 1, catalog_version: 'wincodexbar-0.42.0-0303e423-2026-07-14',
      label: 'Local estimated API-equivalent cost', status: 'ready', generated_at: capturedAt,
      range: { days: 365, since: capturedAt.slice(0, 10), until: capturedAt.slice(0, 10) },
      tokens: { input: 1000, cached: 200, output: 100 }, cost_usd: 0.01, records: 1,
      by_provider: [], by_model: [], by_project: [], by_day: [], by_speed: [],
      daily_breakdown: [{ day: capturedAt.slice(0, 10), provider_id: 'openai-codex', model: 'gpt-5.6-sol', project: 'Fixture', speed: 'standard', input: 1000, cached: 200, output: 100, cost_usd: 0.01, records: 1 }],
      unknown_models: [],
      scan: { files_total: 1, files_complete: 1, bytes_read: 0, malformed_lines: 0, checkpoint_hash: 'b'.repeat(64) },
    },
  };
}

function dataDirContains(value) {
  const needle = Buffer.from(value);
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true }).some(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(target);
    return fs.readFileSync(target).includes(needle);
  });
  return visit(dataDir);
}

async function main() {
  const logs = [];
  const relay = spawn(process.execPath, [path.join(root, 'relay-server', 'index.js')], {
    cwd: path.join(root, 'relay-server'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: origin,
      SESSION_SECRET: 'provider-usage-session-secret-0123456789',
      JWT_SECRET: 'provider-usage-jwt-secret-0123456789012345',
      PROXY_SECRET: '', ALLOW_LOOPBACK_BYPASS: 'true', ALLOW_LAN_BYPASS: 'true',
      RAC_DATA_DIR: dataDir, GOOGLE_CLIENT_ID: 'provider-usage-client',
      GOOGLE_CLIENT_SECRET: 'provider-usage-secret', FIREBASE_SERVICE_ACCOUNT: '',
    },
  });
  relay.stdout.on('data', chunk => logs.push(String(chunk)));
  relay.stderr.on('data', chunk => logs.push(String(chunk)));
  let proxy;
  let observer;
  let watcher;
  let watchReconnectProxy;
  let reconnect;
  let linkAudit;
  let replacementProxy;
  let foreignProxy;
  try {
    await waitFor(() => {
      if (relay.exitCode != null) throw new Error(logs.join('').slice(-4000));
      return logs.some(line => line.includes('[relay] Listening'));
    }, 15000, 'relay listening');

    proxy = await openSocket('/proxy-ws');
    observer = await openSocket('/client-ws');
    proxy.ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'provider-usage-proxy-runtime-1', machine_label: 'provider-usage-machine',
    }));
    proxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot', protocol_version: 1, proxy_id: 'provider-usage-proxy-runtime-1',
      sessions: [
        { session_id: 'provider-codex-ui', agent_type: 'codex', status: 'healthy' },
        { session_id: 'provider-codex-cli', agent_type: 'codex_cli', status: 'healthy' },
      ],
    }));
    await waitFor(() => observer.messages.find(message => (
      message.type === 'session_list' && message.sessions?.length === 2
    )), 10000, 'session registration');
    watcher = await openSocket('/client-ws');
    watcher.ws.send(JSON.stringify({ type: 'provider_usage_watch', protocol_version: 1, active: true }));
    await waitFor(() => proxy.messages.find(message => (
      message.type === 'provider_usage_watch' && message.active === true && message.watcher_count === 1
    )), 10000, 'usage watch activation');

    const snapshot = fixture();
    proxy.ws.send(JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot }));
    const publicFrame = await waitFor(() => observer.messages.find(message => message.type === 'provider_usage_snapshot'), 10000, 'provider snapshot');
    assert.deepStrictEqual(publicFrame.snapshot, snapshot);
    const threshold = await waitFor(() => observer.messages.find(message => message.type === 'provider_usage_threshold'), 10000, 'provider threshold');
    assert.deepStrictEqual(threshold.affected_session_ids, ['provider-codex-cli', 'provider-codex-ui']);
    assert.strictEqual(threshold.hard_limited, true);
    const semanticThreshold = await waitFor(() => observer.messages.find(message => (
      message.type === 'semantic_notification'
      && message.event_type === 'provider_usage_threshold'
    )), 10000, 'semantic provider threshold');
    assert.strictEqual(semanticThreshold.category, 'provider_usage_warning');
    assert.match(semanticThreshold.dedupe_key, /^provider-usage-threshold:[a-f0-9]{32}:100$/);
    assert.deepStrictEqual(semanticThreshold.affected_session_ids, ['provider-codex-cli', 'provider-codex-ui']);
    const linkedSessionPatch = await waitFor(() => observer.messages.find(message => (
      message.type === 'session_patch'
      && message.session_id === 'provider-codex-cli'
      && message.patch?.usage_account_fingerprint === snapshot.snapshots[0].account_fingerprint
    )), 10000, 'provider account session link');
    assert.strictEqual(linkedSessionPatch.patch.usage_billing_provider_id, 'openai-codex');
    assert.strictEqual(linkedSessionPatch.patch.usage_quota_domain, 'codex-plan');
    assert.strictEqual(linkedSessionPatch.patch.usage_mapping_ambiguous, false);
    watchReconnectProxy = await openSocket('/proxy-ws');
    watchReconnectProxy.ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'provider-usage-watch-reconnect', machine_label: 'provider-usage-machine',
    }));
    await waitFor(() => watchReconnectProxy.messages.find(message => (
      message.type === 'provider_usage_watch' && message.active === true && message.watcher_count === 1
    )), 10000, 'usage watch proxy reconnect restore');
    watchReconnectProxy.ws.close();
    watcher.ws.close();
    await waitFor(() => proxy.messages.find(message => (
      message.type === 'provider_usage_watch' && message.active === false && message.watcher_count === 0
    )), 10000, 'usage watch disconnect cleanup');

    proxy.ws.send(JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot }));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.strictEqual(observer.messages.filter(message => message.type === 'provider_usage_threshold').length, 1, 'threshold must dedupe by provider/window/reset cycle');
    assert.strictEqual(observer.messages.filter(message => (
      message.type === 'semantic_notification' && message.event_type === 'provider_usage_threshold'
    )).length, 1, 'semantic threshold must dedupe by provider/account/window/reset cycle');

    const preferenceResponse = await fetch(`${origin}/api/preferences/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { provider_usage_warning: false } }),
    });
    assert.strictEqual(preferenceResponse.status, 200);
    const savedPreferences = await preferenceResponse.json();
    assert.strictEqual(savedPreferences.preferences.provider_usage_warning, false);
    const restoredPreferenceResponse = await fetch(`${origin}/api/preferences/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { provider_usage_warning: true } }),
    });
    assert.strictEqual(restoredPreferenceResponse.status, 200);
    assert.strictEqual((await restoredPreferenceResponse.json()).preferences.provider_usage_warning, true);

    observer.ws.send(JSON.stringify({ type: 'provider_usage_refresh', protocol_version: 1, force: true, request_id: 'refresh-e2e' }));
    const refresh = await waitFor(() => proxy.messages.find(message => message.type === 'provider_usage_refresh'), 10000, 'refresh forwarding');
    assert.strictEqual(refresh.force, true);
    const acceptedReceipt = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_refresh_receipt' && message.request_id === 'refresh-e2e' && message.status === 'accepted'
    )), 10000, 'accepted refresh receipt');
    assert.strictEqual(acceptedReceipt.status, 'accepted');
    observer.ws.send(JSON.stringify({ type: 'provider_usage_refresh', protocol_version: 1, force: true, request_id: 'refresh-e2e-2' }));
    await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_refresh_receipt' && message.request_id === 'refresh-e2e-2' && message.status === 'coalesced'
    )), 10000, 'coalesced refresh receipt');
    assert.strictEqual(proxy.messages.filter(message => message.type === 'provider_usage_refresh').length, 1,
      'concurrent manual refreshes must forward exactly once');
    proxy.ws.send(JSON.stringify({
      type: 'provider_usage_refresh_receipt', protocol_version: 1,
      request_id: refresh.request_id, status: 'completed', coalesced: false,
      generation: 2, cost_status: 'ready',
    }));
    for (const requestId of ['refresh-e2e', 'refresh-e2e-2']) {
      const completed = await waitFor(() => observer.messages.find(message => (
        message.type === 'provider_usage_refresh_receipt' && message.request_id === requestId && message.status === 'completed'
      )), 10000, `completed receipt ${requestId}`);
      assert.strictEqual(completed.generation, 2);
    }
    observer.ws.send(JSON.stringify({
      type: 'provider_usage_refresh', protocol_version: 1, force: true,
      provider_id: 'cursor', request_id: 'refresh-card-e2e',
    }));
    const cardRefresh = await waitFor(() => proxy.messages.find(message => (
      message.type === 'provider_usage_refresh' && message.provider_id === 'cursor'
    )), 10000, 'per-card refresh forwarding');
    proxy.ws.send(JSON.stringify({
      type: 'provider_usage_refresh_receipt', protocol_version: 1,
      request_id: cardRefresh.request_id, provider_id: 'cursor', status: 'completed',
      generation: 3, cost_status: 'ready',
    }));
    const cardCompleted = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_refresh_receipt'
      && message.request_id === 'refresh-card-e2e' && message.status === 'completed'
    )), 10000, 'per-card refresh completion');
    assert.strictEqual(cardCompleted.provider_id, 'cursor');
    observer.ws.send(JSON.stringify({
      type: 'provider_usage_refresh', protocol_version: 1, force: true,
      provider_id: 'cursor', request_id: 'refresh-card-rate-limit-e2e',
    }));
    const cardRateRequest = await waitFor(() => proxy.messages.find(message => (
      message.type === 'provider_usage_refresh' && message.provider_id === 'cursor'
      && message.request_id !== cardRefresh.request_id
    )), 10000, 'per-card rate-limit forwarding');
    proxy.ws.send(JSON.stringify({
      type: 'provider_usage_refresh_receipt', protocol_version: 1,
      request_id: cardRateRequest.request_id, provider_id: 'cursor', status: 'error',
      code: 'manual_refresh_rate_limited', retry_after_ms: 30_000,
    }));
    const cardRateLimited = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_refresh_receipt'
      && message.request_id === 'refresh-card-rate-limit-e2e' && message.status === 'error'
    )), 10000, 'per-card rate-limit receipt');
    assert.strictEqual(cardRateLimited.provider_id, 'cursor');
    assert.strictEqual(cardRateLimited.retry_after_ms, 30_000);

    observer.ws.send(JSON.stringify({
      type: 'provider_usage_reset_credit_consume', protocol_version: 1,
      request_id: 'reset-rejected-e2e', approved: false,
    }));
    const rejectedReset = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_reset_credit_receipt'
      && message.request_id === 'reset-rejected-e2e' && message.status === 'error'
    )), 10000, 'unapproved reset rejection');
    assert.strictEqual(rejectedReset.code, 'operator_approval_required');

    observer.ws.send(JSON.stringify({
      type: 'provider_usage_reset_credit_consume', protocol_version: 1,
      request_id: 'reset-approved-e2e', approved: true,
    }));
    const acceptedReset = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_reset_credit_receipt'
      && message.request_id === 'reset-approved-e2e' && message.status === 'accepted'
    )), 10000, 'approved reset acceptance');
    assert.strictEqual(acceptedReset.status, 'accepted');
    const resetRequest = await waitFor(() => proxy.messages.find(message => (
      message.type === 'provider_usage_reset_credit_consume'
    )), 10000, 'reset forwarding');
    assert.strictEqual(resetRequest.approved, true);
    assert.match(resetRequest.request_id, /^[0-9a-f-]{36}$/i);
    assert.notStrictEqual(resetRequest.request_id, 'reset-approved-e2e');

    observer.ws.send(JSON.stringify({
      type: 'provider_usage_reset_credit_consume', protocol_version: 1,
      request_id: 'reset-concurrent-e2e', approved: true,
    }));
    const concurrentReset = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_reset_credit_receipt'
      && message.request_id === 'reset-concurrent-e2e' && message.status === 'error'
    )), 10000, 'concurrent reset rejection');
    assert.strictEqual(concurrentReset.code, 'reset_in_progress');
    proxy.ws.send(JSON.stringify({
      type: 'provider_usage_reset_credit_receipt', protocol_version: 1,
      request_id: resetRequest.request_id, status: 'completed', outcome: 'reset',
      reset_credits_available: 2,
    }));
    const completedReset = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_reset_credit_receipt'
      && message.request_id === 'reset-approved-e2e' && message.status === 'completed'
    )), 10000, 'completed reset receipt');
    assert.strictEqual(completedReset.outcome, 'reset');
    assert.strictEqual(completedReset.reset_credits_available, 2);

    observer.ws.send(JSON.stringify({
      type: 'provider_usage_cost_detail_request', protocol_version: 1,
      request_id: 'cost-detail-e2e', days: 365, page_size: 2, cursor: '0',
      provider_id: null, project: null,
    }));
    const detailRequest = await waitFor(() => proxy.messages.find(message => (
      message.type === 'provider_usage_cost_detail_request'
    )), 10000, 'cost detail request forwarding');
    const detailRows = [snapshot.estimated_cost.daily_breakdown[0], {
      ...snapshot.estimated_cost.daily_breakdown[0], project: 'Fixture two', cost_usd: 0.02,
    }];
    const detailPayload = {
      schema_version: 1, status: 'ready', generated_at: snapshot.generated_at,
      query: { days: 365, provider_id: null, project: null },
      summary: {
        range: snapshot.estimated_cost.range,
        tokens: { input: 2000, cached: 400, output: 200 }, cost_usd: 0.03, records: 2,
        by_model: [{ provider_id: 'openai-codex', model: 'gpt-5.6-sol', input: 2000, cached: 400, output: 200, cost_usd: 0.03, records: 2 }],
        by_day: [{ day: snapshot.generated_at.slice(0, 10), input: 2000, cached: 400, output: 200, cost_usd: 0.03, records: 2 }],
      },
      rows: detailRows,
      pagination: { cursor: '0', next_cursor: null, page_size: 2, returned_rows: 2, total_rows: 2 },
    };
    proxy.ws.send(JSON.stringify({
      type: 'provider_usage_cost_detail', protocol_version: 1, request_id: detailRequest.request_id,
      detail: detailPayload,
    }));
    const detailResponse = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_cost_detail' && message.request_id === 'cost-detail-e2e'
    )), 10000, 'cost detail response');
    assert.strictEqual(detailResponse.detail.rows.length, 2);
    assert.strictEqual(detailResponse.detail.summary.cost_usd, 0.03);

    observer.ws.send(JSON.stringify({
      type: 'provider_usage_cost_detail_request', protocol_version: 1,
      request_id: 'cost-detail-mismatch-e2e', days: 365, page_size: 2, cursor: '0',
      provider_id: null, project: null,
    }));
    const mismatchRequest = await waitFor(() => {
      const requests = proxy.messages.filter(message => message.type === 'provider_usage_cost_detail_request');
      return requests.length >= 2 ? requests.at(-1) : null;
    }, 10000, 'cost detail mismatch request forwarding');
    proxy.ws.send(JSON.stringify({
      type: 'provider_usage_cost_detail', protocol_version: 1, request_id: mismatchRequest.request_id,
      detail: {
        ...detailPayload,
        query: { ...detailPayload.query, days: 30 },
        summary: { ...detailPayload.summary, range: { ...detailPayload.summary.range, days: 30 } },
      },
    }));
    const mismatchError = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_cost_detail_error'
      && message.request_id === 'cost-detail-mismatch-e2e'
    )), 10000, 'cost detail mismatch error');
    assert.strictEqual(mismatchError.code, 'cost_detail_query_mismatch');

    reconnect = await openSocket('/client-ws');
    const reconnectAck = await waitFor(() => reconnect.messages.find(message => message.type === 'connection_ack'), 10000, 'reconnect ack');
    assert.deepStrictEqual(reconnectAck.provider_usage, snapshot, 'memory cache must restore on reconnect');

    const rows172 = Array.from({ length: 172 }, (_, index) => ({
      ...snapshot.estimated_cost.daily_breakdown[0],
      project: `Relay fixture ${index}`,
    }));
    const completedCost = {
      ...snapshot,
      generation: 2,
      estimated_cost: { ...snapshot.estimated_cost, daily_breakdown: rows172, records: 172 },
    };
    let publicCount = observer.messages.filter(message => message.type === 'provider_usage_snapshot').length;
    proxy.ws.send(JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot: completedCost }));
    const accepted172 = await waitFor(() => {
      const frames = observer.messages.filter(message => message.type === 'provider_usage_snapshot');
      return frames.length > publicCount ? frames.at(-1) : null;
    }, 10000, '172-row provider snapshot');
    assert.strictEqual(accepted172.snapshot.snapshots.length, 1,
      'a completed 172-row cost scan must not erase valid provider quota');
    assert.strictEqual(accepted172.snapshot.estimated_cost.daily_breakdown.length, 172);

    const oversizedCost = {
      ...completedCost,
      generation: 3,
      estimated_cost: {
        ...completedCost.estimated_cost,
        daily_breakdown: Array.from({ length: 257 }, (_, index) => ({
          ...snapshot.estimated_cost.daily_breakdown[0], project: `Oversized fixture ${index}`,
        })),
      },
    };
    publicCount = observer.messages.filter(message => message.type === 'provider_usage_snapshot').length;
    proxy.ws.send(JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot: oversizedCost }));
    const degradedCost = await waitFor(() => {
      const frames = observer.messages.filter(message => message.type === 'provider_usage_snapshot');
      return frames.length > publicCount ? frames.at(-1) : null;
    }, 10000, 'quota-preserving degraded cost snapshot');
    assert.strictEqual(degradedCost.snapshot.snapshots.length, 1);
    assert.strictEqual(degradedCost.snapshot.estimated_cost.status, 'stale');
    assert.strictEqual(degradedCost.snapshot.estimated_cost.daily_breakdown.length, 172,
      'a rejected cost refresh must retain the last-good bounded cost page');
    assert(logs.join('').includes('$.estimated_cost.daily_breakdown:array_length'),
      'relay logs must include the exact safe structural path');

    const generationZero = {
      schema_version: 2, generation: 0, generated_at: new Date().toISOString(),
      poll_interval_ms: 300000, in_flight: false, snapshots: [], estimated_cost: null,
    };
    const linkedPatchCountBeforeGenerationZero = observer.messages.filter(message => (
      message.type === 'session_patch' && message.session_id === 'provider-codex-cli'
    )).length;
    publicCount = observer.messages.filter(message => message.type === 'provider_usage_snapshot').length;
    proxy.ws.send(JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot: generationZero }));
    const retainedGeneration = await waitFor(() => {
      const frames = observer.messages.filter(message => message.type === 'provider_usage_snapshot');
      return frames.length > publicCount ? frames.at(-1) : null;
    }, 10000, 'last-good quota retention');
    assert.strictEqual(retainedGeneration.snapshot.snapshots.length, 1,
      'generation-0 empty from the same active proxy must not replace last-good quota');
    assert.strictEqual(retainedGeneration.snapshot.generation, 3);
    await new Promise(resolve => setTimeout(resolve, 50));
    const generationZeroLinkPatches = observer.messages.filter(message => (
      message.type === 'session_patch' && message.session_id === 'provider-codex-cli'
    )).slice(linkedPatchCountBeforeGenerationZero);
    assert(generationZeroLinkPatches.every(message => (
      message.patch?.usage_account_fingerprint !== null
      && message.patch?.usage_billing_provider_id !== null
      && message.patch?.usage_mapping_ambiguous !== true
    )), 'generation-0 empty refresh emitted an account-link removal or ambiguity');
    linkAudit = await openSocket('/client-ws');
    const linkAuditAck = await waitFor(() => linkAudit.messages.find(message => message.type === 'connection_ack'), 10000, 'account link reconnect audit');
    const linkedSession = linkAuditAck.sessions.find(session => session.session_id === 'provider-codex-cli');
    assert.strictEqual(linkedSession.usage_account_fingerprint, snapshot.snapshots[0].account_fingerprint,
      'generation-0 empty refresh regressed a known account link to unavailable');
    assert.strictEqual(linkedSession.usage_billing_provider_id, 'openai-codex');
    assert.strictEqual(linkedSession.usage_mapping_ambiguous, false);
    linkAudit.ws.close();
    linkAudit = null;

    const malformed = { ...snapshot, token: secretCanary };
    publicCount = observer.messages.filter(message => message.type === 'provider_usage_snapshot').length;
    proxy.ws.send(JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot: malformed }));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.strictEqual(observer.messages.filter(message => message.type === 'provider_usage_snapshot').length, publicCount, 'credential-shaped frame must be rejected');
    assert.strictEqual(dataDirContains(secretCanary), false, 'credential canary must not enter relay storage');
    assert.strictEqual(logs.join('').includes(secretCanary), false, 'credential canary must not enter relay logs');

    observer.ws.send(JSON.stringify({
      type: 'provider_usage_refresh', protocol_version: 1, force: true, request_id: 'refresh-disconnect-e2e',
    }));
    observer.ws.send(JSON.stringify({
      type: 'provider_usage_cost_detail_request', protocol_version: 1,
      request_id: 'cost-detail-disconnect-e2e', days: 365, page_size: 2, cursor: '0',
      provider_id: null, project: null,
    }));
    await waitFor(() => proxy.messages.filter(message => message.type === 'provider_usage_refresh').length >= 2,
      10000, 'disconnect refresh forwarding');
    await waitFor(() => proxy.messages.filter(message => message.type === 'provider_usage_cost_detail_request').length >= 3,
      10000, 'disconnect cost detail forwarding');
    proxy.ws.close();
    const disconnectedRefresh = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_refresh_receipt'
      && message.request_id === 'refresh-disconnect-e2e' && message.status === 'error'
    )), 10000, 'disconnect refresh receipt');
    const disconnectedDetail = await waitFor(() => observer.messages.find(message => (
      message.type === 'provider_usage_cost_detail_error'
      && message.request_id === 'cost-detail-disconnect-e2e'
    )), 10000, 'disconnect cost detail receipt');
    assert.strictEqual(disconnectedRefresh.code, 'proxy_disconnected');
    assert.strictEqual(disconnectedDetail.code, 'proxy_disconnected');

    replacementProxy = await openSocket('/proxy-ws');
    replacementProxy.ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'provider-usage-proxy-runtime-2', machine_label: 'provider-usage-machine',
    }));
    replacementProxy.ws.send(JSON.stringify({
      type: 'proxy_session_snapshot', protocol_version: 1, proxy_id: 'provider-usage-proxy-runtime-2',
      sessions: [
        { session_id: 'provider-codex-ui', agent_type: 'codex', status: 'healthy' },
        { session_id: 'provider-codex-cli', agent_type: 'codex_cli', status: 'healthy' },
      ],
    }));
    await waitFor(() => replacementProxy.messages.some(message => message.type === 'connection_ack'),
      10000, 'replacement proxy acknowledgement');
    publicCount = observer.messages.filter(message => message.type === 'provider_usage_snapshot').length;
    replacementProxy.ws.send(JSON.stringify({
      type: 'provider_usage_snapshot', protocol_version: 1,
      snapshot: {
        ...generationZero,
        generated_at: new Date().toISOString(),
        in_flight: true,
        snapshots: [{
          schema_version: 2,
          provider_id: 'google-antigravity',
          provider_name: 'Google Antigravity',
          quota_domain: 'google-ai-plan',
          dashboard_url: null,
          account_fingerprint: 'unavailable_google-antigravity',
          account_label: 'Local machine',
          plan: null,
          account_metadata: null,
          source: null,
          source_history: [],
          status: 'unavailable',
          captured_at: new Date().toISOString(),
          stale_after: new Date(Date.now() + 600000).toISOString(),
          windows: [],
          credits: null,
          reset_credits: null,
          error: { code: 'local_quota_unavailable', message: 'Local quota is unavailable.', retry_after_ms: 0 },
          request_count: 0,
          latency_ms: 0,
          session_count: 1,
          mapped_harness_types: ['antigravity-v2'],
        }],
        estimated_cost: {
          schema_version: 1, status: 'scanning', generated_at: new Date().toISOString(),
          range: snapshot.estimated_cost.range,
          tokens: { input: 0, cached: 0, output: 0 }, cost_usd: 0, records: 0,
          by_provider: [], by_model: [], by_project: [], by_day: [], by_speed: [],
          daily_breakdown: [], unknown_models: [],
          scan: { files_total: 0, files_complete: 0, bytes_read: 0, malformed_lines: 0, checkpoint_hash: null },
        },
      },
    }));
    const replacementRetained = await waitFor(() => {
      const frames = observer.messages.filter(message => message.type === 'provider_usage_snapshot');
      return frames.length > publicCount ? frames.at(-1) : null;
    }, 10000, 'replacement-process last-good retention');
    assert.strictEqual(replacementRetained.snapshot.snapshots.length, 1,
      'generation-0 partial data from a replacement process on the same machine must retain quota');
    assert.strictEqual(replacementRetained.snapshot.snapshots[0].provider_id, 'openai-codex',
      'a partial startup provider must not displace the complete last-good quota set');
    assert.strictEqual(replacementRetained.snapshot.generation, 3);
    assert.strictEqual(replacementRetained.snapshot.estimated_cost.status, 'stale');
    assert.strictEqual(replacementRetained.snapshot.estimated_cost.records, 172,
      'replacement-process startup scan must retain last-good cost records');
    assert.strictEqual(replacementRetained.snapshot.estimated_cost.reason_code, 'proxy_restarting');

    replacementProxy.ws.close();
    await waitFor(() => replacementProxy.ws.readyState === WebSocket.CLOSED,
      10000, 'replacement proxy close');
    foreignProxy = await openSocket('/proxy-ws');
    foreignProxy.ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'provider-usage-proxy-runtime-3', machine_label: 'different-provider-usage-machine',
    }));
    await waitFor(() => foreignProxy.messages.some(message => message.type === 'connection_ack'),
      10000, 'different-machine proxy acknowledgement');
    publicCount = observer.messages.filter(message => message.type === 'provider_usage_snapshot').length;
    foreignProxy.ws.send(JSON.stringify({
      type: 'provider_usage_snapshot', protocol_version: 1,
      snapshot: {
        ...generationZero,
        generated_at: new Date().toISOString(),
        estimated_cost: null,
      },
    }));
    const foreignEmpty = await waitFor(() => {
      const frames = observer.messages.filter(message => message.type === 'provider_usage_snapshot');
      return frames.length > publicCount ? frames.at(-1) : null;
    }, 10000, 'different-machine isolation');
    assert.strictEqual(foreignEmpty.snapshot.snapshots.length, 0,
      'a different machine must not inherit another proxy machine\'s quota cache');
    assert.strictEqual(foreignEmpty.snapshot.generation, 0);
    assert.strictEqual(foreignEmpty.snapshot.estimated_cost, null,
      'a different machine must not inherit another proxy machine\'s cost cache');

    const result = {
      ok: true,
      snapshot_cached_in_memory: true,
      reconnect_ack_restored: true,
      completed_cost_rows_accepted: 172,
      oversized_cost_preserved_quota: true,
      last_good_cost_retained: true,
      generation_zero_empty_retained_quota: true,
      generation_zero_preserved_session_account_link: true,
      replacement_process_retained_quota_and_cost: true,
      partial_generation_zero_retained_complete_quota: true,
      different_machine_cache_isolated: true,
      safe_violation_path_logged: '$.estimated_cost.daily_breakdown:array_length',
      refresh_forwarded_to_authenticated_proxy: true,
      refresh_receipts: ['accepted', 'coalesced', 'completed'],
      concurrent_refreshes_forwarded: 1,
      usage_watch_activation_and_disconnect_cleanup: true,
      usage_watch_proxy_reconnect_restore: true,
      per_card_refresh_provider_id: cardCompleted.provider_id,
      per_card_rate_limit_receipt: cardRateLimited.code,
      reset_credit_approval_required: true,
      reset_credit_idempotency_uuid: true,
      reset_credit_receipts: ['accepted', 'completed'],
      concurrent_reset_rejected: true,
      paginated_cost_detail_rows: 2,
      cost_detail_query_mismatch_rejected: true,
      proxy_disconnect_receipts: true,
      affected_sessions: threshold.affected_session_ids,
      duplicate_threshold_events: 0,
      semantic_threshold_category: semanticThreshold.category,
      semantic_threshold_dedupe: true,
      provider_usage_preference_round_trip: true,
      android_semantic_transport_enabled: false,
      session_account_linked_by_relay: true,
      credential_canary_in_relay_storage: false,
      credential_canary_in_relay_logs: false,
      visible_windows_opened: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    try { watcher?.ws.close(); } catch {}
    try { watchReconnectProxy?.ws.close(); } catch {}
    try { foreignProxy?.ws.close(); } catch {}
    try { replacementProxy?.ws.close(); } catch {}
    try { reconnect?.ws.close(); } catch {}
    try { linkAudit?.ws.close(); } catch {}
    try { observer?.ws.close(); } catch {}
    try { proxy?.ws.close(); } catch {}
    if (relay.exitCode == null) {
      const exited = new Promise(resolve => relay.once('exit', resolve));
      relay.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`provider usage relay e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
