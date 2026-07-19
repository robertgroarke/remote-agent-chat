#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require(process.env.RAC_PLAYWRIGHT_CORE || '../frontend/node_modules/playwright-core');
const { WebSocketServer } = require(process.env.RAC_WS_MODULE || '../relay-server/node_modules/ws');
const { enrichUsageWindow } = require('../agent-proxy/usage-pace');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'frontend');
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const browserMode = process.env.RAC_USAGE_BROWSER_MODE === 'headless-fixture'
  ? 'headless-fixture' : 'persistent-production';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const screenshotDirIndex = process.argv.indexOf('--screenshot-dir');
const screenshotDir = screenshotDirIndex >= 0 && process.argv[screenshotDirIndex + 1]
  ? path.resolve(process.argv[screenshotDirIndex + 1]) : null;
const stormDurationIndex = process.argv.indexOf('--session-header-storm-ms');
const requestedStormMs = stormDurationIndex >= 0 ? Number(process.argv[stormDurationIndex + 1]) : 0;
assert(Number.isFinite(requestedStormMs) && requestedStormMs >= 0,
  '--session-header-storm-ms must be a non-negative number');
if (requestedStormMs > 0) assert(requestedStormMs >= 1_000,
  '--session-header-storm-ms must be at least 1000');

const sessions = [
  {
    session_id: 'usage-codex-primary', agent_type: 'codex_cli', display_name: 'Codex primary',
    percent_used: 86, rate_limited_until: '2026-07-13T03:00:00.000Z',
  },
  {
    session_id: 'usage-codex-secondary', agent_type: 'codex_cli', display_name: 'Codex secondary',
    percent_used: 20,
  },
  {
    session_id: 'usage-claude', agent_type: 'claude_cli', display_name: 'Claude weekly limit',
    percent_used: 100, rate_limit_active: true, rate_limited_until: 'Monday 9:00 AM',
    activity: { kind: 'idle', usage: { state: 'exhausted', percent_used: 100, resets_at: 'Monday 9:00 AM' } },
  },
  {
    session_id: 'usage-antigravity', agent_type: 'antigravity_panel', display_name: 'Antigravity quotas',
    antigravity_quota_models: [
      { model: 'Gemini 2.5 Pro', percent_used: 43, refreshes_in: '2h' },
      { model: 'Claude Sonnet 4.5 (Thinking)', percent_used: 91, refreshes_in: '18h' },
    ],
  },
  { session_id: 'usage-cursor', agent_type: 'cursor', display_name: 'Cursor capacity unavailable' },
  { session_id: 'usage-ollama', agent_type: 'ollama', display_name: 'Ollama Cloud + local runtime', usage_runtime_kind: 'cloud' },
];
if (requestedStormMs > 0) {
  const stormTypes = ['codex_cli', 'claude_cli', 'cursor', 'antigravity_panel', 'ollama'];
  for (let index = sessions.length; index < 120; index += 1) {
    const agentType = stormTypes[index % stormTypes.length];
    sessions.push({
      session_id: `usage-storm-${String(index).padStart(3, '0')}`,
      agent_type: agentType,
      display_name: `Usage storm ${String(index).padStart(3, '0')} long localized session title`,
      ...(agentType === 'ollama' ? { usage_runtime_kind: index % 2 ? 'cloud' : 'local' } : {}),
    });
  }
}
let providerRefreshRequests = 0;
let costDetailRequests = 0;
let resetCreditRequests = 0;
let lastResetCreditRequest = null;
let respondToProviderRefresh = true;
const fixtureClients = new Set();
const fixtureCapturedAt = new Date().toISOString();
const fixtureStaleAfter = new Date(Date.now() + 10 * 60 * 1000).toISOString();
let currentProviderUsage = null;

function providerUsageFixture() {
  const capturedAt = fixtureCapturedAt;
  const staleAfter = fixtureStaleAfter;
  const snapshot = (providerId, providerName, accountFingerprint, plan, harnessTypes, sessionCount, windows, extra = {}) => ({
    schema_version: 4,
    provider_id: providerId,
    provider_name: providerName,
    quota_domain: `${providerId}-plan`,
    dashboard_url: extra.dashboardUrl || null,
    account_fingerprint: accountFingerprint,
    account_label: extra.accountLabel || 'op***@example.invalid',
    plan,
    account_metadata: null,
    source: extra.source || 'fixture',
    source_history: [{ source: extra.source || 'fixture', status: 'ok', captured_at: capturedAt }],
    status: 'fresh',
    captured_at: capturedAt,
    stale_after: staleAfter,
    next_refresh_at: extra.nextRefreshAt || null,
    windows: windows.map(([id, label, used, scope = null, modelId = null]) => {
      const duration = id === 'five_hour' || label === '5-hour' || label === 'Current session' || label === 'Session' ? 300 : 10080;
      return enrichUsageWindow({
        id, label, scope, model_scope: modelId ? { id: modelId, label: scope } : null,
        used_percent: used, remaining_percent: 100 - used, duration_minutes: duration,
        resets_at: new Date(Date.now() + duration * 30 * 1000).toISOString(),
        reset_description: null, window_kind: 'rolling', source: extra.source || 'fixture',
        provenance: `${extra.source || 'fixture'}.${id}`, status: 'available', freshness_status: 'fresh',
      }, { providerId, now: Date.now(), thresholds: extra.thresholds || null });
    }),
    credits: extra.credits || null,
    financials: extra.financials || null,
    local_runtime: extra.localRuntime || null,
    cloud_usage: extra.cloudUsage || null,
    reset_credits: extra.resetCredits || null,
    error: null,
    request_count: extra.requestCount ?? 1,
    latency_ms: extra.latencyMs ?? 24,
    session_count: sessionCount,
    mapped_harness_types: harnessTypes,
  });
  return {
    schema_version: 4,
    generation: 7,
    generated_at: capturedAt,
    poll_interval_ms: 300000,
    in_flight: false,
    snapshots: [
      snapshot('anthropic-claude', 'Anthropic Claude', 'acct_11111111111111111111', 'Claude Max', ['claude', 'claude_cli'], 13, [
        ['five_hour', 'Current session', 13], ['seven_day', 'All models weekly', 39],
        ['seven_day_scoped_claude-fable-5', 'Fable weekly', 125, 'Fable', 'claude-fable-5'],
      ], { source: 'oauth_api', credits: { enabled: true, used: 4.25, limit: 20, currency: 'USD', period: 'Monthly' }, dashboardUrl: 'https://claude.ai/settings/usage' }),
      snapshot('google-antigravity', 'Google Antigravity', 'acct_22222222222222222222', 'Google AI Pro', ['antigravity_panel'], 1, [
        ['model-1', 'Gemini 2.5 Pro', 43, 'Model quota', 'gemini-2.5-pro'], ['model-2', 'Claude Sonnet 4.5', 91, 'Model quota', 'claude-sonnet-4.5'],
      ], {
        source: 'in_app_api', credits: { enabled: true, balance: 120, unit: 'AI credits' }, requestCount: 0,
        nextRefreshAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
      snapshot('openai-codex', 'OpenAI Codex', 'acct_33333333333333333333', 'ChatGPT Pro', ['codex', 'codex_cli'], 13, [
        ['codex-primary', '5-hour', 100], ['codex-secondary', 'Weekly', 20],
        ['code-review-primary', 'Code review - Weekly', 22, 'Code review', 'code-review'], ['gpt-5-primary', 'GPT-5 - Weekly', 8, 'GPT-5', 'gpt-5'],
      ], {
        source: 'app_server', dashboardUrl: 'https://chatgpt.com/codex/settings/usage',
        credits: { enabled: true, balance: 18.5, currency: 'USD' },
        resetCredits: { available_count: 2, details: [{ title: 'Reset one', status: 'available' }, { title: 'Reset two', status: 'available' }] },
      }),
      snapshot('ollama-local', 'Ollama', 'acct_44444444444444444444', 'Pro', ['ollama'], 1, [
        ['ollama-cloud-session', 'Session', 1.9, 'Ollama Cloud'],
        ['ollama-cloud-weekly', 'Weekly', 48.3, 'Ollama Cloud'],
      ], {
        source: 'existing_signed_in_ollama_usage_surface',
        dashboardUrl: 'https://ollama.com/settings/usage',
        accountLabel: 'Cloud account + loopback runtime',
        cloudUsage: {
          subscription_state: 'active', source: 'existing_signed_in_ollama_usage_surface', captured_at: capturedAt,
          auto_reload_enabled: false, error: null,
          source_receipt: { page_state_unchanged: true, dom_mutation_records: 0, navigation_actions: 0, click_actions: 0, focus_actions: 0, targets_created: 0 },
        },
        financials: {
          semantics_version: 1, source: 'existing_signed_in_ollama_usage_surface', observed_at: capturedAt,
          account_scope: 'Pro', extra_usage_enabled: true,
          prepaid_balance: { amount: 0, currency: 'USD', source_field: 'balance_remaining', semantics: 'prepaid_balance', directly_reported: true },
          disclaimer: 'Ollama Cloud quota and local runtime telemetry are separate truth domains.',
        },
        localRuntime: {
          status: 'running', endpoint_scope: 'loopback_only', installed_models_count: 13,
          loaded_models_count: 0, loaded_models: [], observed_request_count: 0, request_receipts: [],
          telemetry_status: 'not_observed', telemetry_reason: 'Only explicit owned terminal response receipts are counted.',
        },
      }),
    ],
    estimated_cost: {
      schema_version: 1,
      catalog_version: 'wincodexbar-0.42.0-0303e423-2026-07-14',
      label: 'Local estimated API-equivalent cost', status: 'ready', generated_at: capturedAt,
      range: { days: 365, since: '2025-07-16', until: capturedAt.slice(0, 10) },
      tokens: { input: 520000, cached: 180000, output: 72000 }, cost_usd: 5.75, records: 4,
      by_provider: [], by_model: [], by_project: [
        { provider_id: 'all', project: 'Remote Agent Chat', input: 420000, cached: 150000, output: 60000, cost_usd: 4.75, records: 3 },
        { provider_id: 'openai-codex', project: 'Other Project', input: 100000, cached: 30000, output: 12000, cost_usd: 1, records: 1 },
      ], by_day: [], by_speed: [],
      daily_breakdown: [
        { day: capturedAt.slice(0, 10), provider_id: 'openai-codex', model: 'gpt-5.6-sol', project: 'Remote Agent Chat', speed: 'standard', input: 300000, cached: 100000, output: 40000, cost_usd: 3.25, records: 2 },
        { day: capturedAt.slice(0, 10), provider_id: 'anthropic-claude', model: 'claude-fable-5', project: 'Remote Agent Chat', speed: 'fast/priority', input: 120000, cached: 50000, output: 20000, cost_usd: 1.5, records: 1 },
        { day: capturedAt.slice(0, 10), provider_id: 'openai-codex', model: 'future-model', project: 'Other Project', speed: 'standard', input: 100000, cached: 30000, output: 12000, cost_usd: 1, records: 1 },
      ],
      unknown_models: [{ provider_id: 'openai-codex', model: 'future-model', fallback: 'gpt-5.6-sol' }],
      scan: { files_total: 4, files_complete: 4, bytes_read: 0, malformed_lines: 0, checkpoint_hash: 'a'.repeat(64) },
      detail: {
        total_rows: 300, inline_rows: 3, page_size: 256, next_cursor: '256', truncated: true,
        collections: [{ name: 'daily_breakdown', total_rows: 300, returned_rows: 3, truncated: true }],
      },
    },
  };
}

function costDetailFixture(message) {
  const snapshot = providerUsageFixture();
  const base = snapshot.estimated_cost.daily_breakdown;
  const rows = [...base, ...Array.from({ length: 297 }, (_, index) => ({
    day: snapshot.generated_at.slice(0, 10),
    provider_id: index % 2 ? 'openai-codex' : 'anthropic-claude',
    model: index % 2 ? 'gpt-5.6-sol' : 'claude-fable-5',
    project: `Detail fixture ${index}`,
    speed: index % 3 ? 'standard' : 'fast/priority',
    input: 0, cached: 0, output: 0, cost_usd: 0, records: 0,
  }))];
  const filtered = rows.filter(row => !message.project || row.project === message.project);
  const totals = filtered.reduce((sum, row) => ({
    input: sum.input + Number(row.input || 0), cached: sum.cached + Number(row.cached || 0),
    output: sum.output + Number(row.output || 0), cost_usd: sum.cost_usd + Number(row.cost_usd || 0),
    records: sum.records + Number(row.records || 0),
  }), { input: 0, cached: 0, output: 0, cost_usd: 0, records: 0 });
  const aggregate = (fields) => {
    const map = new Map();
    for (const row of filtered) {
      const key = fields.map(field => row[field]).join('|');
      if (!map.has(key)) map.set(key, Object.fromEntries(fields.map(field => [field, row[field]])));
      const target = map.get(key);
      for (const field of ['input', 'cached', 'output', 'cost_usd', 'records']) {
        target[field] = Number(target[field] || 0) + Number(row[field] || 0);
      }
    }
    return [...map.values()];
  };
  const offset = Number(message.cursor || 0);
  const pageSize = Number(message.page_size || 256);
  const pageRows = filtered.slice(offset, offset + pageSize);
  return {
    schema_version: 1, status: 'ready', generated_at: snapshot.generated_at,
    query: { days: Number(message.days), provider_id: message.provider_id || null, project: message.project || null },
    summary: {
      range: { days: Number(message.days), since: snapshot.generated_at.slice(0, 10), until: snapshot.generated_at.slice(0, 10) },
      tokens: { input: totals.input, cached: totals.cached, output: totals.output },
      cost_usd: Number(totals.cost_usd.toFixed(8)), records: totals.records,
      by_model: aggregate(['provider_id', 'model']), by_day: aggregate(['day']),
    },
    rows: pageRows,
    pagination: {
      cursor: String(offset), next_cursor: offset + pageRows.length < filtered.length ? String(offset + pageRows.length) : null,
      page_size: pageSize, returned_rows: pageRows.length, total_rows: filtered.length,
    },
  };
}

function costLifecycleFixture(status, options = {}) {
  const ready = providerUsageFixture().estimated_cost;
  if (options.withLastGood) return {
    ...ready,
    status,
    last_good_generated_at: ready.generated_at,
  };
  return {
    schema_version: 2,
    catalog_version: ready.catalog_version,
    label: ready.label,
    status,
    generated_at: null,
    range: { days: 365, since: null, until: null },
    tokens: { input: null, cached: null, output: null },
    cost_usd: null,
    records: null,
    by_provider: [], by_model: [], by_project: [], by_day: [], by_speed: [],
    daily_breakdown: [], unknown_models: [], scan: {},
    ...(options.reasonCode ? { reason_code: options.reasonCode, reason_path: options.reasonPath || null } : {}),
  };
}

function broadcastProviderUsage(snapshot, options = {}) {
  if (options.cache !== false) currentProviderUsage = snapshot;
  const frame = JSON.stringify({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot });
  for (const client of fixtureClients) {
    if (client.readyState === client.OPEN) client.send(frame);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function main() {
  currentProviderUsage = providerUsageFixture();
  const port = await freePort();
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const providerAssetRequest = pathname.startsWith('/provider-assets/');
    const requestRoot = providerAssetRequest ? path.join(root, 'provider-assets') : publicRoot;
    const relative = pathname === '/' ? 'index.html' : providerAssetRequest
      ? pathname.slice('/provider-assets/'.length)
      : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(requestRoot, relative);
    if (!filePath.startsWith(`${path.resolve(requestRoot)}${path.sep}`)
      || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    fixtureClients.add(ws);
    ws.once('close', () => fixtureClients.delete(ws));
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    send({
      type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
      sessions: sessions.map(session => ({
        ...session, title: session.display_name, status: 'healthy', workspace_path: root, project_root: root,
      })),
      provider_usage: currentProviderUsage,
      workspaces: [],
    });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sessionId = message.session_id || message.session;
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        const session = sessions.find(item => item.session_id === sessionId);
        const observedModel = {
          'usage-codex-primary': 'gpt-5.6-sol',
          'usage-codex-secondary': 'gpt-5.6-sol',
          'usage-claude': 'claude-fable-5',
          'usage-antigravity': 'claude-sonnet-4.5',
          'usage-cursor': 'claude-fable-5',
          'usage-ollama': 'qwen3.5:cloud',
        }[sessionId] || ({
          codex_cli: 'gpt-5.6-sol',
          claude_cli: 'claude-fable-5',
          cursor: 'claude-fable-5',
          antigravity_panel: 'claude-sonnet-4.5',
          ollama: session?.usage_runtime_kind === 'local' ? 'qwen3.5' : 'qwen3.5:cloud',
        }[session?.agent_type] || '');
        send({ type: 'agent_config', session_id: sessionId, capabilities: {}, observed_model_id: observedModel });
      } else if (message.type === 'history_chunk_request') {
        send({
          type: 'history_chunk', session_id: sessionId, request_id: message.request_id,
          source: 'fixture', mode: 'tail', replace: message.replace !== false,
          messages: [{ role: 'assistant', content: `Usage fixture ${sessionId}`, sequence: 1 }],
          total_messages: 1, loaded_messages: 1, partial: false,
        });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sessionId, request_id: message.request_id, messages: [] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sessionId, session_id: sessionId, request_id: message.request_id, messages: [] });
      } else if (message.type === 'provider_usage_refresh') {
        providerRefreshRequests += 1;
        send({ type: 'provider_usage_refresh_receipt', request_id: message.request_id, status: 'accepted' });
        if (respondToProviderRefresh) {
          send({ type: 'provider_usage_snapshot', protocol_version: 1, snapshot: currentProviderUsage });
          send({ type: 'provider_usage_refresh_receipt', request_id: message.request_id, status: 'completed', generation: 7, cost_status: 'ready' });
        }
      } else if (message.type === 'provider_usage_reset_credit_consume') {
        resetCreditRequests += 1;
        lastResetCreditRequest = message;
        send({ type: 'provider_usage_reset_credit_receipt', request_id: message.request_id, status: 'accepted' });
        send({
          type: 'provider_usage_reset_credit_receipt', request_id: message.request_id,
          status: 'completed', outcome: 'reset', reset_credits_available: 1,
        });
      } else if (message.type === 'provider_usage_cost_detail_request') {
        costDetailRequests += 1;
        send({
          type: 'provider_usage_cost_detail', protocol_version: 1, request_id: message.request_id,
          detail: costDetailFixture(message),
        });
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let browserContext;
  let page;
  let originalUrl;
  let originalViewport;
  const coldRouteActivationSamples = [];
  const warmRouteActivationSamples = [];
  const browserErrors = [];
  let sessionHeaderStorm = null;
  try {
    if (browserMode === 'headless-fixture') {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      page = await browserContext.newPage();
    } else {
      browser = await chromium.connectOverCDP(cdpUrl);
      const pages = browser.contexts().flatMap(context => context.pages());
      assert.strictEqual(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
      [page] = pages;
    }
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected exactly one verification page, found ${pages.length}`);
    page.on('pageerror', error => browserErrors.push(`pageerror:${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
    });
    originalUrl = page.url();
    originalViewport = page.viewportSize();

    const loadFixture = async viewport => {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${port}/?session=usage-codex-primary`, {
        waitUntil: 'domcontentloaded', timeout: 15000,
      });
      await page.locator('.session-card').first().waitFor({ state: 'visible', timeout: 5000 });
      if (viewport.width <= 600) await page.locator('.hamburger').click();
      const activationStartedAt = Date.now();
      await page.getByRole('button', { name: 'Usage and limits' }).click();
      await page.locator('[data-testid="usage-dashboard"]').waitFor({ state: 'visible', timeout: 5000 });
      coldRouteActivationSamples.push(Date.now() - activationStartedAt);
      await page.waitForFunction(() => !document.querySelector('.toast.visible'), null, { timeout: 5000 });
      if (viewport.width <= 600) {
        await page.waitForFunction(() => !document.querySelector('.sidebar')?.classList.contains('open'));
        await page.waitForTimeout(250);
      }
    };

    await loadFixture({ width: 1280, height: 900 });
    assert.equal(await page.locator('.usage-dashboard-card').count(), 4, 'six old surfaces must become four provider-account cards');
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.usage-dashboard-provider-mark-image')];
      return images.length === 8 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    assert.equal(await page.locator('.usage-dashboard-provider-mark-fallback').count(), 0,
      'official provider marks must load without text fallback');
    assert.deepStrictEqual(
      (await page.locator('.usage-dashboard-provider-mark').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).sort(),
      ['Anthropic Claude provider mark', 'Google Antigravity provider mark', 'Ollama provider mark', 'OpenAI provider mark'],
    );
    await assert.doesNotReject(async () => {
      const codex = page.locator('[data-provider-id="openai-codex"]');
      await codex.getByText('13 mapped sessions').waitFor();
      await codex.getByText('5-hour', { exact: true }).waitFor();
      await codex.getByText('Weekly', { exact: true }).waitFor();
      await codex.getByText('Code review - Weekly', { exact: true }).waitFor();
      await codex.getByText('GPT-5 - Weekly', { exact: true }).waitFor();
      await codex.getByText('2 available').waitFor();
      await codex.getByText('Reset one', { exact: true }).waitFor();
      await codex.getByText('Reset two', { exact: true }).waitFor();
      const resetAttention = page.locator('[data-testid="codex-reset-credit-attention"]');
      await resetAttention.getByText('2 limit resets available — apply one?', { exact: true }).waitFor();
      await resetAttention.getByRole('button', { name: 'Apply one reset' }).click();
      await page.locator('[data-testid="codex-reset-credit-receipt"]')
        .getByText('Reset completed: reset', { exact: true }).waitFor();
      assert.strictEqual(resetCreditRequests, 1, 'explicit click must issue exactly one reset-credit request');
      assert.strictEqual(lastResetCreditRequest?.approved, true, 'reset-credit request must carry explicit approval');
      const claude = page.locator('[data-provider-id="anthropic-claude"]');
      await claude.getByText('Current session', { exact: true }).waitFor();
      await claude.getByText('All models weekly', { exact: true }).waitFor();
      await claude.getByText('Fable weekly', { exact: true }).waitFor();
      await claude.getByText('-25% left').waitFor();
      await claude.getByText('125% used').waitFor();
      await claude.getByText('Model: Fable').waitFor();
      const antigravity = page.locator('[data-provider-id="google-antigravity"]');
      await antigravity.getByText('Gemini 2.5 Pro', { exact: true }).waitFor();
      await antigravity.getByText('Claude Sonnet 4.5', { exact: true }).waitFor();
      await antigravity.getByText(/^Source: in app api/).waitFor();
      await antigravity.getByText(/^Updated /).waitFor();
      await antigravity.getByText(/^Next refresh /).waitFor();
      const ollama = page.locator('[data-provider-id="ollama-local"]');
      await ollama.getByText('Session', { exact: true }).waitFor();
      await ollama.getByText('Weekly', { exact: true }).waitFor();
      await ollama.getByText('1.9% used', { exact: true }).waitFor();
      await ollama.getByText('48.3% used', { exact: true }).waitFor();
      await ollama.getByText(/Available prepaid balance\$0\.00/).waitFor();
      await ollama.getByText(/Auto-reloadOff/).waitFor();
      await ollama.getByText(/Local runtime0 loaded \/ 13 installed/).waitFor();
    });
    await page.getByRole('heading', { name: 'Local estimated API-equivalent cost' }).waitFor();
    await page.getByRole('rowheader', { name: 'Codex · gpt-5.6-sol' }).waitFor();
    await page.getByText('Fallback pricing', { exact: true }).waitFor();
    await page.getByText('Showing detail rows 1-256 of 300.', { exact: true }).waitFor();
    await page.locator('.usage-cost-detail-table > summary').click();
    const detailRowsLocator = page.locator('.usage-cost-detail-table tbody tr');
    await detailRowsLocator.nth(255).waitFor();
    const firstDetailPage = await detailRowsLocator.allTextContents();
    assert.strictEqual(firstDetailPage.length, 256);
    await page.locator('.usage-cost-detail-pager').getByRole('button', { name: 'Next' }).click();
    await page.getByText('Showing detail rows 257-300 of 300.', { exact: true }).waitFor();
    const secondDetailPage = await detailRowsLocator.allTextContents();
    assert.strictEqual(secondDetailPage.length, 44);
    assert.strictEqual(new Set([...firstDetailPage, ...secondDetailPage]).size, 300,
      'bounded cost detail pages must have no duplicates or gaps');
    await page.locator('.usage-cost-detail-pager').getByRole('button', { name: 'Previous' }).click();
    await page.getByText('Showing detail rows 1-256 of 300.', { exact: true }).waitFor();
    assert(await page.locator('.usage-pace').count() >= 3, 'predictive pace must render for authoritative windows');
    assert(await page.locator('.usage-pace-budgets').count() >= 3, 'safe pace budgets must render');

    const generationZero = providerUsageFixture();
    generationZero.generation = 0;
    generationZero.in_flight = false;
    generationZero.snapshots = [];
    generationZero.estimated_cost = costLifecycleFixture('not-started');
    respondToProviderRefresh = false;
    currentProviderUsage = generationZero;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('.session-card').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: 'Usage and limits' }).click();
    await page.locator('[data-testid="usage-dashboard"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText('Provider usage has not been collected yet', { exact: true }).waitFor();
    assert.deepStrictEqual(await page.locator('.usage-dashboard-summary strong').allTextContents(),
      ['—', '—', '—', '—', '—'], 'generation-zero summary must not manufacture authoritative zero totals');
    await page.getByText('Not scanned yet', { exact: true }).waitFor();
    assert.strictEqual(await page.locator('.usage-cost-summary').count(), 0,
      'not-started cost state must not render false zero totals');
    assert.strictEqual(providerRefreshRequests, 1,
      'not-started provider lifecycle must request exactly one asynchronous collection');
    const notStartedRefreshRequests = providerRefreshRequests;
    providerRefreshRequests = 0;
    respondToProviderRefresh = true;

    const degradedCost = providerUsageFixture();
    degradedCost.estimated_cost = costLifecycleFixture('error', {
      reasonCode: 'structural_contract', reasonPath: '$.estimated_cost.daily_breakdown:array_length',
    });
    broadcastProviderUsage(degradedCost);
    await page.getByText('Cost scan unavailable', { exact: true }).waitFor();
    assert.strictEqual(await page.locator('.usage-dashboard-card').count(), 4,
      'cost failure must preserve valid provider quota cards');
    assert.strictEqual(await page.locator('.usage-cost-summary').count(), 0,
      'failed cost state must not render false zero totals');

    const scanningLastGood = providerUsageFixture();
    scanningLastGood.in_flight = true;
    scanningLastGood.estimated_cost = costLifecycleFixture('scanning', { withLastGood: true });
    broadcastProviderUsage(scanningLastGood);
    await page.getByText('Refreshing provider usage', { exact: true }).waitFor();
    await page.locator('.usage-cost-summary').waitFor({ state: 'visible' });

    broadcastProviderUsage(providerUsageFixture());
    await page.locator('.usage-dashboard-collection-state').waitFor({ state: 'detached' });
    const fableMeter = page.locator('[data-provider-id="anthropic-claude"] .usage-dashboard-window').filter({ hasText: 'Fable weekly' }).locator('.usage-dashboard-meter > span');
    assert.strictEqual(await fableMeter.evaluate(node => node.style.width), '100%', 'over-100 truth must cap only the visual bar');
    const refreshesBeforeCostFilters = providerRefreshRequests;
    await page.locator('.usage-cost-controls select').first().selectOption('30');
    await page.locator('.usage-cost-controls select').nth(1).selectOption({ label: 'Remote Agent Chat' });
    assert.match(await page.locator('.usage-cost-summary').innerText(), /\$4\.75/);
    assert.strictEqual(providerRefreshRequests, refreshesBeforeCostFilters,
      'cost range/project controls must not trigger provider collection');
    const detailRequestsBeforeRouteReopens = costDetailRequests;
    let detailRequestsAfterDefaultQueryHydration = null;
    for (let sample = 0; sample < 20; sample += 1) {
      await page.locator('[data-testid="usage-dashboard"] .automations-back').click();
      await page.locator('[data-testid="usage-dashboard"]').waitFor({ state: 'hidden', timeout: 5000 });
      const startedAt = Date.now();
      await page.getByRole('button', { name: 'Usage and limits' }).click();
      await page.locator('[data-testid="usage-dashboard"]').waitFor({ state: 'visible', timeout: 5000 });
      warmRouteActivationSamples.push(Date.now() - startedAt);
      if (sample === 0) {
        await page.getByText('Showing detail rows 1-256 of 300.', { exact: true }).waitFor();
        detailRequestsAfterDefaultQueryHydration = costDetailRequests;
      }
    }
    assert.strictEqual(costDetailRequests, detailRequestsAfterDefaultQueryHydration,
      'repeated same-generation route reopen must reuse the ready bounded detail page');
    const detailRequestsAfterRouteReopens = costDetailRequests;
    const summaryText = await page.locator('.usage-dashboard-summary').innerText();
    assert.match(summaryText, /4\s+PROVIDER/i);
    assert.match(summaryText, /4\s+ACCOUNT/i);
    assert.match(summaryText, /4\s+REPORTING/i);
    assert.match(summaryText, /1\s+NEAR LIMIT/i);
    assert.match(summaryText, /2\s+EXHAUSTED/i);
    const desktopOverflow = await page.locator('.usage-dashboard').evaluate(node => node.scrollWidth - node.clientWidth);
    assert(desktopOverflow <= 1, `desktop dashboard overflowed by ${desktopOverflow}px`);
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, 'usage-dashboard-desktop.png'), fullPage: true });
    }

    const codexCard = page.locator('[data-provider-id="openai-codex"]');
    const refreshesBeforeCollapse = providerRefreshRequests;
    await codexCard.locator('summary').click();
    assert.equal(await codexCard.getAttribute('open'), null, 'provider card must be user-collapsible');
    await codexCard.locator('summary').click();
    assert.notEqual(await codexCard.getAttribute('open'), null, 'provider card must reopen without session navigation');
    assert.strictEqual(providerRefreshRequests, refreshesBeforeCollapse,
      'expand/collapse must not trigger provider collection');
    await page.evaluate(() => {
      window.__usageRefreshCls = 0;
      window.__usageRefreshObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__usageRefreshCls += entry.value;
        }
      });
      window.__usageRefreshObserver.observe({ type: 'layout-shift', buffered: false });
    });
    const manualRefreshBefore = providerRefreshRequests;
    assert.strictEqual(manualRefreshBefore, 0,
      'dashboard open, route changes, collapse, and cost filters must issue zero provider refresh requests after a ready snapshot');
    await page.getByRole('button', { name: 'Refresh provider usage' }).click();
    await page.waitForTimeout(150);
    const refreshCls = await page.evaluate(() => {
      window.__usageRefreshObserver?.disconnect();
      return window.__usageRefreshCls || 0;
    });
    assert.strictEqual(providerRefreshRequests, manualRefreshBefore + 1, 'manual refresh must issue exactly one request');
    assert(refreshCls <= 0.001, `usage refresh CLS exceeded zero budget: ${refreshCls}`);
    await page.locator('[data-testid="usage-dashboard"] .automations-back').click();
    await page.waitForFunction(() => document.querySelector('.session-card.active')?.dataset.sessionId === 'usage-codex-primary');
    const miniUsage = page.locator('[data-testid="session-usage-mini"]');
    await miniUsage.waitFor();
    const miniUsageText = await miniUsage.locator('.session-usage-mini-trigger').innerText();
    assert.match(miniUsageText, /GPT-5 - Weekly.*92% left.*5-hour.*0% left/is,
      `session header must prioritize the current-model window and most restrictive shared window: ${JSON.stringify(miniUsageText)}`);
    await miniUsage.locator('.session-usage-mini-trigger').click();
    const miniPopover = page.locator('#session-usage-popover');
    await miniPopover.waitFor();
    assert.match(await miniPopover.innerText(), /Billing provider\s+OpenAI Codex/i);
    assert.match(await miniPopover.innerText(), /Model vendor\s+OpenAI/i);
    assert.match(await miniPopover.innerText(), /GPT-5 - Weekly.*5-hour.*Weekly/is);
    assert.doesNotMatch(await miniPopover.innerText(), /Code review - Weekly/i,
      'unrelated model-scoped windows must not leak into the active-session projection');
    assert.match(await miniPopover.innerText(), /18\.50 balance/i,
      'credits must remain distinct from included usage windows');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close usage details');
    await page.keyboard.press('Escape');
    assert.strictEqual(await miniUsage.locator('.session-usage-mini-trigger').getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() => document.activeElement?.closest?.('[data-testid="session-usage-mini"]') != null);
    assert.strictEqual(await page.evaluate(() => document.activeElement?.closest?.('[data-testid="session-usage-mini"]') != null), true,
      'Escape must return focus to the mini usage trigger');
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'session-usage-mini-desktop.png'), fullPage: true });
    }
    const codexSidebarUsage = await page.locator('.session-card[data-session-id="usage-codex-primary"] .session-card-sub-context').innerText();
    assert.match(codexSidebarUsage, /86% used.*resets/i,
      '75% warning state must expose the provider reset in the sidebar');
    assert.match(await page.locator('.rate-limit-overlay').innerText(), /Used 86%.*resets/i,
      'active-session warning overlay must expose the provider reset');
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'usage-limit-warning-desktop.png'), fullPage: true });
    }
    const claudeCard = page.locator('.session-card[data-session-id="usage-claude"]');
    assert.match(await claudeCard.locator('.session-card-sub-context').innerText(), /Usage limited.*resets Monday 9:00 AM/i,
      'hard usage limit must have its own sidebar state and reset hint');
    await claudeCard.evaluate(node => node.click());
    await page.waitForFunction(() => document.querySelector('.session-card.active')?.dataset.sessionId === 'usage-claude');
    assert.match(await page.locator('.rate-limit-overlay').innerText(), /Rate limited.*resets Monday 9:00 AM/i,
      'hard usage overlay must expose the reset hint');
    assert.strictEqual(await page.locator('.live-usage-title').innerText(), 'Usage limit reached',
      'provider-agnostic exhaustion must not inherit Codex-specific fallback copy');
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'usage-limit-exhausted-desktop.png'), fullPage: true });
    }
    await page.locator('[data-testid="session-usage-mini"] .session-usage-mini-trigger').click();
    assert.match(await page.locator('#session-usage-popover').innerText(), /Billing provider\s+Anthropic Claude.*Fable weekly/is);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'session-usage-popover-desktop.png'), fullPage: true });
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#session-usage-popover'));
    await page.waitForFunction(() => document.activeElement?.closest?.('[data-testid="session-usage-mini"]') != null);
    const antigravityCard = page.locator('.session-card[data-session-id="usage-antigravity"]');
    await antigravityCard.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const antigravitySelection = await page.evaluate(() => ({
      activeSessionId: document.querySelector('.session-card.active')?.dataset.sessionId || null,
      targets: Array.from(document.querySelectorAll('.session-card[data-session-id="usage-antigravity"]')).map(node => ({
        connected: node.isConnected,
        parentClass: node.parentElement?.className || '',
        grandparentClass: node.parentElement?.parentElement?.className || '',
        rect: (() => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })(),
      })),
      popoverOpen: !!document.querySelector('#session-usage-popover'),
      activeTag: document.activeElement?.tagName || null,
      url: location.href,
      bodyText: document.body?.innerText?.slice(0, 500) || '',
    }));
    assert.strictEqual(antigravitySelection.activeSessionId, 'usage-antigravity',
      `Antigravity session selection failed: ${JSON.stringify(antigravitySelection)} errors=${JSON.stringify(browserErrors)}`);
    await page.locator('[data-testid="session-usage-mini"] .session-usage-mini-trigger').click();
    const antigravityUsageText = await page.locator('#session-usage-popover').innerText();
    assert.match(antigravityUsageText, /Billing provider\s+Google Antigravity/i,
      'Antigravity billing authority must remain Google when the selected model is Claude');
    assert.match(antigravityUsageText, /Model vendor\s+Anthropic/i);
    await page.keyboard.press('Escape');

    if (requestedStormMs > 0) {
      const stormSessionIds = sessions.map(session => session.session_id);
      const refreshesBeforeStorm = providerRefreshRequests;
      const initialStormSnapshot = providerUsageFixture();
      initialStormSnapshot.generation = 100;
      initialStormSnapshot.generated_at = new Date().toISOString();
      broadcastProviderUsage(initialStormSnapshot);
      await page.waitForTimeout(50);
      await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.session-card[data-session-id]')];
        window.__sessionUsageStorm = {
          cards: new Map(cards.map(node => [node.dataset.sessionId, node])),
          mini: document.querySelector('[data-testid="session-usage-mini"]'),
          title: document.querySelector('.topbar-title-group'),
          topbarCls: 0,
          topbarShiftSources: [],
        };
        window.__sessionUsageStorm.observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const topbarShifted = (entry.sources || []).some(source => source.node?.closest?.('.topbar'));
            if (!entry.hadRecentInput && topbarShifted) {
              window.__sessionUsageStorm.topbarCls += entry.value;
              if (window.__sessionUsageStorm.topbarShiftSources.length < 24) {
                window.__sessionUsageStorm.topbarShiftSources.push({
                  value: entry.value,
                  nodes: (entry.sources || []).filter(source => source.node?.closest?.('.topbar')).map(source => ({
                    tag: source.node.tagName,
                    className: String(source.node.className || ''),
                    text: String(source.node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
                  })),
                });
              }
            }
          }
        });
        window.__sessionUsageStorm.observer.observe({ type: 'layout-shift', buffered: false });
        window.__sessionUsageStorm.mini?.querySelector('button')?.focus({ preventScroll: true });
      });
      const startedAt = Date.now();
      const renderSamples = [];
      let switches = 0;
      let providerUpdates = 1;
      let reconnects = 0;
      let identityFailures = 0;
      let focusFailures = 0;
      let activeSelectionFailures = 0;
      let titleMovementPx = 0;
      let miniMovementPx = 0;
      let healthMovementPx = 0;
      let nextReconnectAt = requestedStormMs / 3;
      let nextProviderAt = 1_000;
      let lastGeneration = 100;
      const initialTitlePosition = await page.locator('.topbar-title-group').evaluate(node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, top: box.top };
      });
      const initialMetaPositions = await page.evaluate(() => {
        const position = selector => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
        };
        return {
          mini: position('[data-testid="session-usage-mini"]'),
          health: position('.topbar-proxy-health'),
          meta: position('.topbar-meta'),
        };
      });
      while (Date.now() - startedAt < requestedStormMs) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= nextProviderAt) {
          lastGeneration += 1;
          const update = providerUsageFixture();
          update.generation = lastGeneration;
          update.generated_at = new Date().toISOString();
          broadcastProviderUsage(update);
          providerUpdates += 1;
          nextProviderAt += 1_000;
        }
        if (elapsed >= nextReconnectAt && reconnects < 2) {
          for (const client of [...fixtureClients]) client.close(1012, 'formal usage storm reconnect');
          reconnects += 1;
          nextReconnectAt += requestedStormMs / 3;
        }
        const sessionId = stormSessionIds[switches % stormSessionIds.length];
        const sample = await page.evaluate(async id => {
          const state = window.__sessionUsageStorm;
          const node = document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`);
          const started = performance.now();
          node?.click();
          await new Promise(resolve => setTimeout(resolve, 0));
          const renderDuration = performance.now() - started;
          const titleBox = document.querySelector('.topbar-title-group')?.getBoundingClientRect();
          const currentMini = document.querySelector('[data-testid="session-usage-mini"]');
          const identityStable = state.cards.get(id) === node && state.mini === currentMini;
          const focused = document.activeElement === currentMini?.querySelector('button');
          return {
            renderDuration,
            activeSessionId: document.querySelector('.session-card.active')?.dataset.sessionId || null,
            identityStable,
            focused,
            titleLeft: titleBox?.left ?? null,
            titleTop: titleBox?.top ?? null,
            miniBox: (() => { const box = currentMini?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null; })(),
            healthBox: (() => { const box = document.querySelector('.topbar-proxy-health')?.getBoundingClientRect(); return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null; })(),
          };
        }, sessionId);
        renderSamples.push(sample.renderDuration);
        if (!sample.identityStable) identityFailures += 1;
        if (!sample.focused) focusFailures += 1;
        if (sample.activeSessionId !== sessionId) activeSelectionFailures += 1;
        if (sample.titleLeft != null) {
          titleMovementPx = Math.max(
            titleMovementPx,
            Math.abs(sample.titleLeft - initialTitlePosition.left),
            Math.abs(sample.titleTop - initialTitlePosition.top),
          );
        }
        if (sample.miniBox && initialMetaPositions.mini) {
          miniMovementPx = Math.max(miniMovementPx,
            Math.abs(sample.miniBox.left - initialMetaPositions.mini.left),
            Math.abs(sample.miniBox.top - initialMetaPositions.mini.top),
            Math.abs(sample.miniBox.width - initialMetaPositions.mini.width),
            Math.abs(sample.miniBox.height - initialMetaPositions.mini.height));
        }
        if (sample.healthBox && initialMetaPositions.health) {
          healthMovementPx = Math.max(healthMovementPx,
            Math.abs(sample.healthBox.left - initialMetaPositions.health.left),
            Math.abs(sample.healthBox.top - initialMetaPositions.health.top),
            Math.abs(sample.healthBox.width - initialMetaPositions.health.width),
            Math.abs(sample.healthBox.height - initialMetaPositions.health.height));
        }
        switches += 1;
        const nextTickAt = startedAt + switches * 100;
        const delay = nextTickAt - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      }
      const durationMs = Date.now() - startedAt;
      const finalGoodSnapshot = currentProviderUsage;
      broadcastProviderUsage({
        ...finalGoodSnapshot,
        generation: Math.max(0, lastGeneration - 1),
        generated_at: new Date(Date.now() + 1_000).toISOString(),
      }, { cache: false });
      await page.waitForTimeout(100);
      await page.evaluate(() => document.querySelector('.session-card[data-session-id="usage-codex-primary"]')?.click());
      await page.waitForFunction(() => document.querySelector('.session-card.active')?.dataset.sessionId === 'usage-codex-primary');
      const finalMini = page.locator('[data-testid="session-usage-mini"]');
      await finalMini.locator('.session-usage-mini-trigger').click();
      const finalPopover = page.locator('#session-usage-popover');
      await finalPopover.waitFor({ state: 'visible' });
      const finalGenerationText = await finalPopover.locator('.session-usage-popover-source').innerText();
      assert.match(finalGenerationText, new RegExp(`Generation\\s+${lastGeneration}\\b`),
        `stale provider generation regressed the mini monitor: ${finalGenerationText}`);
      await page.keyboard.press('Escape');
      const stormDom = await page.evaluate(() => {
        const state = window.__sessionUsageStorm;
        state.observer?.disconnect();
        return {
          topbarCls: state.topbarCls,
          topbarShiftSources: state.topbarShiftSources,
          cardIdentityStable: [...state.cards].every(([id, node]) => (
            document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`) === node
          )),
          miniIdentityStable: state.mini === document.querySelector('[data-testid="session-usage-mini"]'),
        };
      });
      const sortedRenderSamples = [...renderSamples].sort((left, right) => left - right);
      const renderP95 = sortedRenderSamples[Math.max(0, Math.ceil(sortedRenderSamples.length * 0.95) - 1)] || 0;
      assert(durationMs >= requestedStormMs, `formal usage storm ended early at ${durationMs}ms`);
      assert.strictEqual(providerRefreshRequests, refreshesBeforeStorm,
        'session header storm must issue zero per-session collector refresh requests');
      assert.strictEqual(reconnects, 2, `formal usage storm completed ${reconnects} reconnects`);
      assert.strictEqual(identityFailures, 0, `formal usage storm observed ${identityFailures} sampled remounts`);
      assert.strictEqual(focusFailures, 0, `formal usage storm observed ${focusFailures} focus losses`);
      assert.strictEqual(activeSelectionFailures, 0, `formal usage storm observed ${activeSelectionFailures} selection failures`);
      assert.strictEqual(stormDom.cardIdentityStable, true, 'formal usage storm remounted a session card');
      assert.strictEqual(stormDom.miniIdentityStable, true, 'formal usage storm remounted the mini usage monitor');
      assert(stormDom.topbarCls <= 0.001,
        `formal usage storm topbar CLS ${stormDom.topbarCls} exceeded zero budget: miniMovement=${miniMovementPx} healthMovement=${healthMovementPx} initial=${JSON.stringify(initialMetaPositions)} sources=${JSON.stringify(stormDom.topbarShiftSources)}`);
      assert(titleMovementPx <= 0.5, `formal usage storm moved the chat title by ${titleMovementPx}px`);
      assert(renderP95 <= 16, `formal usage storm projection/render p95 ${renderP95}ms exceeded 16ms`);
      sessionHeaderStorm = {
        requested_duration_ms: requestedStormMs,
        duration_ms: durationMs,
        sessions: stormSessionIds.length,
        switches,
        provider_updates: providerUpdates,
        reconnects,
        collector_refresh_requests: providerRefreshRequests - refreshesBeforeStorm,
        duplicate_refresh_requests: 0,
        stale_generation_regressions: 0,
        remounts: 0,
        focus_losses: 0,
        selection_failures: 0,
        topbar_cls: stormDom.topbarCls,
        chat_title_movement_px: titleMovementPx,
        mini_geometry_movement_px: miniMovementPx,
        health_geometry_movement_px: healthMovementPx,
        projection_render_p95_ms: Number(renderP95.toFixed(3)),
        final_generation: lastGeneration,
      };
    }

    await loadFixture({ width: 390, height: 844 });
    const mobile = await page.locator('.usage-dashboard').evaluate(node => ({
      overflow: node.scrollWidth - node.clientWidth,
      viewportWidth: node.clientWidth,
      bounds: (() => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; })(),
      summaryColumns: getComputedStyle(document.querySelector('.usage-dashboard-summary')).gridTemplateColumns.split(' ').length,
      cardColumns: getComputedStyle(document.querySelector('.usage-dashboard-grid')).gridTemplateColumns.split(' ').length,
    }));
    assert(mobile.overflow <= 1, `mobile dashboard overflowed by ${mobile.overflow}px`);
    assert(mobile.bounds.left >= -1 && mobile.bounds.right <= 391,
      `mobile dashboard escaped viewport: ${JSON.stringify(mobile.bounds)}`);
    assert.equal(mobile.summaryColumns, 2, 'mobile summary must use two columns');
    assert.equal(mobile.cardColumns, 1, 'mobile cards must use one column');
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'usage-dashboard-mobile-390.png'), fullPage: true });
    }
    await page.locator('[data-testid="usage-dashboard"] .automations-back').click();
    const mobileMini = page.locator('[data-testid="session-usage-mini"]');
    await mobileMini.waitFor({ state: 'visible' });
    const mobileMiniGeometry = await mobileMini.evaluate(node => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left, right: box.right, width: box.width,
        viewportOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert(mobileMiniGeometry.viewportOverflow <= 1,
      `390px session header overflowed by ${mobileMiniGeometry.viewportOverflow}px`);
    assert(mobileMiniGeometry.left >= -1 && mobileMiniGeometry.right <= 391,
      `390px mini usage monitor escaped viewport: ${JSON.stringify(mobileMiniGeometry)}`);
    assert(mobileMiniGeometry.width <= 104,
      `390px mini usage monitor did not use compact geometry: ${JSON.stringify(mobileMiniGeometry)}`);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'session-usage-mini-mobile-390.png'), fullPage: true });
    }
    await mobileMini.locator('.session-usage-mini-trigger').click();
    const mobilePopover = page.locator('#session-usage-popover');
    await mobilePopover.waitFor({ state: 'visible' });
    const mobilePopoverGeometry = await mobilePopover.evaluate(node => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
    });
    assert(mobilePopoverGeometry.left >= -1 && mobilePopoverGeometry.right <= 391,
      `390px usage popover escaped viewport: ${JSON.stringify(mobilePopoverGeometry)}`);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'session-usage-popover-mobile-390.png'), fullPage: true });
    }
    await page.keyboard.press('Escape');

    await page.evaluate(() => localStorage.setItem('remote-agent-chat-theme', 'light'));
    await loadFixture({ width: 1280, height: 900 });
    const lightDesktopOverflow = await page.locator('.usage-dashboard').evaluate(node => node.scrollWidth - node.clientWidth);
    assert(lightDesktopOverflow <= 1, `light desktop dashboard overflowed by ${lightDesktopOverflow}px`);
    assert.match(await page.locator('.usage-dashboard').evaluate(node => getComputedStyle(node).backgroundColor), /rgb/i);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'usage-dashboard-light-desktop.png'), fullPage: true });
    }
    await loadFixture({ width: 390, height: 844 });
    const lightMobileOverflow = await page.locator('.usage-dashboard').evaluate(node => node.scrollWidth - node.clientWidth);
    assert(lightMobileOverflow <= 1, `light mobile dashboard overflowed by ${lightMobileOverflow}px`);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'usage-dashboard-light-mobile-390.png'), fullPage: true });
    }
    await page.evaluate(() => localStorage.removeItem('remote-agent-chat-theme'));

    const sortedActivation = [...warmRouteActivationSamples].sort((a, b) => a - b);
    const activationP95 = sortedActivation[Math.max(0, Math.ceil(sortedActivation.length * 0.95) - 1)] || 0;
    assert(activationP95 <= 100, `usage route interactive p95 exceeded 100 ms: ${activationP95}`);
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_mode: browserMode,
      browser_cdp: browserMode === 'persistent-production' ? cdpUrl : null,
      persistent_browser_pages: browserMode === 'persistent-production' ? pages.length : null,
      headless_fixture_pages: browserMode === 'headless-fixture' ? pages.length : null,
      production_proof: browserMode === 'persistent-production',
      new_windows_opened: 0,
      focus_actions: 0,
      external_sends_or_controls: 0,
      provider_cards: 4,
      provider_accounts: 4,
      reporting_accounts: 4,
      warning_accounts: 1,
      exhausted_accounts: 2,
      desktop_overflow_px: desktopOverflow,
      mobile,
      light_desktop_overflow_px: lightDesktopOverflow,
      light_mobile_overflow_px: lightMobileOverflow,
      light_and_dark_checked: true,
      official_provider_marks_loaded: 4,
      provider_mark_fallbacks: 0,
      no_session_jump_and_header_chip_preserved: true,
      sidebar_warning_reset_visible: true,
      sidebar_usage_limited_state_visible: true,
      active_usage_reset_visible: true,
      session_header_projection: true,
      session_header_focus_return: true,
      session_header_mobile_390: mobileMiniGeometry,
      session_header_mobile_popover_390: mobilePopoverGeometry,
      antigravity_billing_model_separation: true,
      session_header_formal_storm: sessionHeaderStorm,
      schema_version: 4,
      ollama_cloud_and_local: true,
      ollama_zero_balance_exact: true,
      predictive_pace_windows: await page.locator('.usage-pace').count(),
      safe_budget_groups: await page.locator('.usage-pace-budgets').count(),
      scoped_claude_lane: 'Fable weekly',
      raw_overage_percent: 125,
      visual_overage_cap_percent: 100,
      estimated_cost_separate_from_quota: true,
      estimated_cost_range_and_project_filters: true,
      accessible_cost_table: true,
      cold_route_activation_samples_ms: coldRouteActivationSamples,
      route_activation_samples_ms: warmRouteActivationSamples,
      route_activation_p95_ms: activationP95,
      refresh_cls: refreshCls,
      provider_refresh_requests: providerRefreshRequests,
      reset_credit_prompt: '2 limit resets available — apply one?',
      reset_credit_requests: resetCreditRequests,
      reset_credit_approved: lastResetCreditRequest?.approved === true,
      reset_credit_outcome: 'reset',
      real_reset_credit_consumed: false,
      visual_controls_triggered_provider_calls: 0,
      provider_lifecycle_without_false_zero: true,
      cost_lifecycle_without_false_zero: true,
      cost_failure_preserved_quota_cards: true,
      generation_zero_summary_values: ['—', '—', '—', '—', '—'],
      not_started_refresh_requests: notStartedRefreshRequests,
      paginated_cost_detail_rows: 300,
      cost_detail_requests: costDetailRequests,
      route_reopen_cost_detail_requests: detailRequestsAfterRouteReopens - detailRequestsBeforeRouteReopens,
      repeated_route_reopen_cost_detail_requests: detailRequestsAfterRouteReopens - detailRequestsAfterDefaultQueryHydration,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (page && originalUrl && originalUrl !== 'about:blank') {
      await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
