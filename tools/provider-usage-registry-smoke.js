#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');
const {
  ProviderUsageError,
  ProviderUsageRegistry,
  accountFingerprint,
  bindCodexAppServerInput,
  collectAntigravity,
  collectClaude,
  collectOllama,
  normalizedWindow,
  parseClaudeCliUsage,
  readCursorLocalAuth,
  requestLoopbackJson,
  relativeDurationMs,
} = require('../agent-proxy/provider-usage');
const { LocalUsageCostScanner, aggregateRecords } = require('../agent-proxy/usage-costs');
const {
  MAX_DAILY_BREAKDOWN_ROWS,
  compactProviderUsageSnapshot,
  providerUsageBoundaryAssessment,
  providerUsageBoundaryViolation,
  providerUsageCostDetailViolation,
  sanitizeProviderUsageSnapshot,
} = require('../relay-server/provider-usage-boundary');
const { ProviderUsageAuthority } = require('../relay-server/provider-usage-authority');

const KEY = 'deterministic-provider-usage-smoke-key';
const CAPTURED_AT = '2026-07-14T12:00:00.000Z';

function codexAppServerPipeFixture() {
  const stdin = new EventEmitter();
  stdin.write = () => true;
  let captured = null;
  const send = bindCodexAppServerInput({ stdin }, error => { captured = error; });
  const pipeError = Object.assign(new Error('fixture pipe closed'), { code: 'EPIPE' });
  stdin.emit('error', pipeError);
  assert(captured instanceof ProviderUsageError, 'Codex app-server stdin errors must be handled');
  assert.strictEqual(captured.code, 'app_server_epipe');
  captured = null;
  stdin.write = (_payload, callback) => {
    callback(pipeError);
    return false;
  };
  send({ id: 1, method: 'initialize' });
  assert.strictEqual(captured.code, 'app_server_epipe', 'asynchronous stdin write failures must fail closed');
}

function antigravityResetFixture() {
  assert.strictEqual(relativeDurationMs('4h 30m'), 16_200_000);
  assert.strictEqual(relativeDurationMs('Refreshes in 2 days'), 172_800_000);
  assert.strictEqual(relativeDurationMs('04:30:00'), 16_200_000);
  assert.strictEqual(relativeDurationMs('unknown'), null);
  const before = Date.now();
  const account = collectAntigravity(KEY, {
    models: [{ model: 'Gemini fixture', percent_used: 41, refreshes_in: '4h 30m' }],
  }, 'fixture-machine');
  const resetAt = Date.parse(account.windows[0].resets_at);
  assert(Number.isFinite(resetAt), 'parseable Antigravity relative resets must gain an absolute reset timestamp');
  assert(resetAt >= before + 16_200_000 && resetAt <= Date.now() + 16_200_000,
    'Antigravity absolute reset must preserve the reported relative duration');
  assert.strictEqual(account.windows[0].reset_description, '4h 30m');
}

async function claudeCliFallbackFixture() {
  const now = Date.parse('2026-02-11T20:00:00.000Z');
  const windows = parseClaudeCliUsage(`
    Settings: Status Config Usage
    Current session
    6% used
    Resets 4:29am (Asia/Calcutta)
    Current week (all models)
    4% used
    Resets Feb 12 at 1:29pm (Asia/Calcutta)
    Current week (Opus only)
    1% used
    Resets Feb 12 at 1:29pm (Asia/Calcutta)
    What's contributing to your limits usage?
    Approximate, based on local sessions on this machine.
  `, now);
  assert.deepStrictEqual(windows.map(window => [window.id, window.used_percent]), [
    ['five_hour', 6], ['seven_day', 4], ['seven_day_opus', 1],
  ]);
  assert.strictEqual(windows[0].resets_at, '2026-02-11T22:59:30.000Z');
  assert.strictEqual(windows[1].resets_at, '2026-02-12T07:59:30.000Z');
  assert.strictEqual(windows[2].reset_description, 'Feb12at1:29pm(Asia/Calcutta)',
    'Claude reset descriptions must stop before the following /usage help section');
  assert.throws(() => parseClaudeCliUsage('Overview Models Total tokens: 263.3k Sessions: 6', now),
    /did not return plan limit percentages/);

  let receivedHistory;
  const fallback = await collectClaude(KEY, {
    oauthCollector: async () => {
      throw new ProviderUsageError('limited', { code: 'http_429', status: 'rate_limited', retryAfterMs: 42000 });
    },
    cliCollector: async (fingerprintKey, history) => {
      receivedHistory = history;
      return account('claude', 'cli-fallback', {
        source: 'hidden_cli', windows: [window('five_hour', '5-hour', 7)], requestCount: 0,
      });
    },
  });
  assert.strictEqual(fallback.source, 'hidden_cli');
  assert.strictEqual(fallback.request_count, 0);
  assert.strictEqual(receivedHistory[0].source, 'oauth_api');
  assert.strictEqual(receivedHistory[0].status, 'failed');

  await assert.rejects(collectClaude(KEY, {
    oauthCollector: async () => {
      throw new ProviderUsageError('limited', { code: 'http_429', status: 'rate_limited', retryAfterMs: 42000 });
    },
    cliCollector: async () => { throw new ProviderUsageError('no cli', { code: 'cli_not_installed' }); },
  }), error => error.status === 'rate_limited' && error.retryAfterMs === 42000);
}

async function hiddenPtyTransportFixture() {
  const modulePath = require.resolve('node-pty', { paths: [path.join(__dirname, '..', 'agent-proxy')] });
  const pty = require(modulePath);
  const output = await new Promise((resolve, reject) => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
    const terminal = pty.spawn('cmd.exe', '/d /s /c "echo RAC_PTY_PASS"', {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: __dirname, env: environment, useConpty: true,
    });
    let text = '';
    let settled = false;
    const finish = (error = null, alreadyExited = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!alreadyExited) try { terminal.kill(); } catch {}
      if (error) reject(error); else resolve(text);
    };
    const timer = setTimeout(() => {
      finish(new Error('hidden ConPTY transport smoke timed out'));
    }, 5000);
    terminal.onData(data => { text += data; });
    terminal.onExit(() => finish(null, true));
  });
  assert.match(output, /RAC_PTY_PASS/, 'node-pty must capture a hidden child process without a console window');
}

async function cursorPythonSqliteFallbackFixture() {
  const auth = await readCursorLocalAuth({ forcePython: true });
  assert(auth.token && auth.token.length >= 8, 'hidden Python sqlite fallback must recover Cursor local auth');
  assert(auth.email && auth.email.includes('@'), 'hidden Python sqlite fallback must recover the Cursor account label');
}

function account(provider, suffix, options = {}) {
  return {
    account_fingerprint: accountFingerprint(`${provider}-${suffix}`, KEY),
    account_label: `${suffix.slice(0, 2)}***@example.invalid`,
    plan: options.plan || `${provider} test plan`,
    source: options.source || 'fixture',
    source_history: [{ source: options.source || 'fixture', status: 'ok', captured_at: CAPTURED_AT }],
    captured_at: CAPTURED_AT,
    windows: options.windows || [],
    credits: options.credits || null,
    reset_credits: options.resetCredits || null,
    request_count: options.requestCount ?? 1,
  };
}

function window(id, label, usedPercent, options = {}) {
  return normalizedWindow({
    id,
    label,
    usedPercent,
    scope: options.scope || null,
    durationMinutes: options.durationMinutes || null,
    resetsAt: options.resetsAt || '2026-07-15T12:00:00.000Z',
    resetDescription: options.resetDescription || null,
  });
}

function sessions(agentType, count) {
  return Array.from({ length: count }, (_, index) => ({
    session_id: `${agentType}-${index + 1}`,
    agentType,
  }));
}

function screenshotCollectors() {
  return {
    codex: async () => account('codex', 'operator', {
      plan: 'ChatGPT Pro',
      source: 'app_server',
      windows: [
        window('codex-primary', '5-hour', 13, { durationMinutes: 300 }),
        window('codex-secondary', 'Weekly', 47, { durationMinutes: 10080 }),
        window('code-review-primary', 'Code review - Weekly', 22, { scope: 'Code review' }),
        window('gpt-5-primary', 'GPT-5 - Weekly', 8, { scope: 'GPT-5' }),
      ],
      credits: { enabled: true, balance: 18.5, currency: 'USD' },
      resetCredits: {
        available_count: 2,
        details: [
          { title: 'Reset one', status: 'available', expires_at: '2026-07-20T12:00:00.000Z' },
          { title: 'Reset two', status: 'available', expires_at: '2026-07-21T12:00:00.000Z' },
        ],
      },
    }),
    claude: async () => account('claude', 'operator', {
      plan: 'Claude Max',
      source: 'oauth_api',
      windows: [
        window('five_hour', '5-hour', 13, { durationMinutes: 300 }),
        window('seven_day', 'Weekly', 39, { durationMinutes: 10080 }),
        window('seven_day_opus', 'Opus weekly', 58, { scope: 'Opus', durationMinutes: 10080 }),
      ],
      credits: { enabled: true, used: 4.25, limit: 20, currency: 'USD', period: 'Monthly' },
      requestCount: 2,
    }),
    antigravity: async () => account('antigravity', 'operator', {
      plan: 'Google AI Pro',
      source: 'local_settings',
      windows: [
        window('model-1', 'Gemini 2.5 Pro', 31, { scope: 'Model quota', resetsAt: null, resetDescription: 'in 4h' }),
        window('model-2', 'Claude Sonnet', 72, { scope: 'Model quota', resetsAt: null, resetDescription: 'in 2d' }),
      ],
      credits: { enabled: true, balance: 120, unit: 'AI credits' },
      requestCount: 0,
    }),
    cursor: async () => account('cursor', 'operator', {
      plan: 'Cursor Pro',
      windows: [window('plan', 'Plan', 24)],
    }),
  };
}

function costScannerFixture() {
  let calls = 0;
  const snapshot = {
    schema_version: 1,
    catalog_version: 'wincodexbar-0.42.0-0303e423-2026-07-14',
    label: 'Local estimated API-equivalent cost', status: 'ready', generated_at: CAPTURED_AT,
    range: { days: 365, since: '2025-07-15', until: '2026-07-14' },
    tokens: { input: 3000, cached: 1000, output: 500 }, cost_usd: 0.12, records: 2,
    by_provider: [], by_model: [], by_project: [], by_day: [], by_speed: [],
    daily_breakdown: [{
      day: '2026-07-14', provider_id: 'openai-codex', model: 'gpt-5.6-sol',
      project: 'Fixture project', speed: 'standard', input: 3000, cached: 1000,
      output: 500, cost_usd: 0.12, records: 2,
    }],
    unknown_models: [],
    scan: { files_total: 1, files_complete: 1, bytes_read: 0, malformed_lines: 0, checkpoint_hash: 'a'.repeat(64) },
  };
  return {
    refresh: async () => { calls += 1; return snapshot; },
    snapshot: () => snapshot,
    get calls() { return calls; },
  };
}

async function screenshotFixture() {
  const allSessions = [
    ...sessions('claude', 4),
    ...sessions('claude_cli', 9),
    ...sessions('antigravity_panel', 1),
    ...sessions('codex', 3),
    ...sessions('codex_cli', 10),
  ];
  const registry = new ProviderUsageRegistry({
    getSessions: () => allSessions,
    collectors: screenshotCollectors(),
    fingerprintKey: KEY,
    random: () => 0.5,
    costScanner: costScannerFixture(),
  });
  const payload = await registry.refresh({ force: true, reason: 'fixture' });
  assert.strictEqual(payload.snapshots.length, 3, 'five surface groups must become three provider-account cards');
  const byProvider = Object.fromEntries(payload.snapshots.map(snapshot => [snapshot.provider_id, snapshot]));
  assert.strictEqual(byProvider['anthropic-claude'].session_count, 13);
  assert.deepStrictEqual(byProvider['anthropic-claude'].mapped_harness_types, ['claude', 'claude_cli']);
  assert.strictEqual(byProvider['google-antigravity'].session_count, 1);
  assert.strictEqual(byProvider['openai-codex'].session_count, 13);
  assert.deepStrictEqual(byProvider['openai-codex'].mapped_harness_types, ['codex', 'codex_cli']);
  assert.deepStrictEqual(byProvider['openai-codex'].windows.map(item => item.label), [
    '5-hour', 'Weekly', 'Code review - Weekly', 'GPT-5 - Weekly',
  ]);
  assert.strictEqual(byProvider['openai-codex'].reset_credits.details.length, 2);
  assert.deepStrictEqual(byProvider['anthropic-claude'].windows.map(item => item.label), ['5-hour', 'Weekly', 'Opus weekly']);
  assert.strictEqual(byProvider['google-antigravity'].windows.length, 2);
  assert.strictEqual(payload.estimated_cost.catalog_version, 'wincodexbar-0.42.0-0303e423-2026-07-14');
  assert.strictEqual(payload.estimated_cost.daily_breakdown.length, 1);
  assert.ok(sanitizeProviderUsageSnapshot(payload),
    `relay sanitizer must accept the registry fixture (${providerUsageBoundaryViolation(payload)})`);
  return { registry, payload };
}

async function ollamaFixture() {
  const requests = [];
  const requester = async pathname => {
    requests.push(pathname);
    if (pathname === '/api/ps') return {
      models: [{
        name: 'qwen3.5:fixture',
        size: 4_200_000_000,
        size_vram: 3_100_000_000,
        context_length: 32768,
        expires_at: '2026-07-16T18:00:00.000Z',
      }],
    };
    if (pathname === '/api/tags') return { models: [{ name: 'qwen3.5:fixture' }, { name: 'gemma3:fixture' }] };
    throw new Error(`unexpected fixture path: ${pathname}`);
  };
  const collected = await collectOllama(KEY, {
    requester,
    receiptReader: () => [],
    cloudReader: async () => ({ ok: false, code: 'fixture_unavailable', message: 'Fixture cloud source unavailable.' }),
  });
  assert.deepStrictEqual(requests.sort(), ['/api/ps', '/api/tags']);
  assert.strictEqual(collected.local_runtime.status, 'running');
  assert.strictEqual(collected.local_runtime.loaded_models_count, 1);
  assert.strictEqual(collected.local_runtime.installed_models_count, 2);
  assert.strictEqual(collected.local_runtime.loaded_models[0].context_length, 32768);
  for (const field of [
    'prompt_tokens', 'response_tokens', 'total_duration_ns', 'load_duration_ns',
    'prompt_eval_duration_ns', 'eval_duration_ns',
  ]) {
    assert.strictEqual(collected.local_runtime[field], null,
      `Ollama ${field} must remain unreported without an owned request receipt`);
  }
  const registry = new ProviderUsageRegistry({
    getSessions: () => [],
    collectors: { ollama: async () => collected },
    fingerprintKey: KEY,
  });
  const payload = await registry.refresh({ force: true });
  assert.strictEqual(payload.snapshots.length, 1,
    'an explicitly injected always-on Ollama collector must run without a mapped chat session');
  assert.strictEqual(payload.snapshots[0].provider_id, 'ollama-local');
  assert.strictEqual(payload.snapshots[0].session_count, 0);
  assert.ok(sanitizeProviderUsageSnapshot(payload),
    `relay sanitizer must accept the Ollama runtime fixture (${providerUsageBoundaryViolation(payload)})`);
  const absentRegistry = new ProviderUsageRegistry({
    getSessions: () => [],
    collectors: {
      ollama: async () => {
        throw new ProviderUsageError('Ollama is not running.', { code: 'not_running' });
      },
    },
    fingerprintKey: KEY,
  });
  const absent = await absentRegistry.refresh({ force: true });
  assert.strictEqual(absent.snapshots.length, 1);
  assert.strictEqual(absent.snapshots[0].provider_id, 'ollama-local');
  assert.strictEqual(absent.snapshots[0].status, 'unavailable');
  assert.strictEqual(absent.snapshots[0].error.code, 'not_running');
  await assert.rejects(
    requestLoopbackJson('/api/ps', { baseUrl: `http://${[192, 168, 1, 1].join('.')}:11434` }),
    error => error?.code === 'endpoint_rejected',
    'Ollama collection must reject every non-loopback endpoint before network I/O',
  );
}

async function distinctAccountFixture() {
  const collectors = screenshotCollectors();
  collectors.codex = async () => [
    await screenshotCollectors().codex(),
    account('codex', 'second', { plan: 'ChatGPT Team', windows: [window('codex-primary', '5-hour', 66)] }),
  ];
  const registry = new ProviderUsageRegistry({
    getSessions: () => sessions('codex_cli', 2),
    collectors,
    fingerprintKey: KEY,
  });
  const payload = await registry.refresh({ force: true });
  assert.strictEqual(payload.snapshots.length, 2, 'two account fingerprints must remain separate cards');
  assert.strictEqual(new Set(payload.snapshots.map(item => item.account_fingerprint)).size, 2);
}

function costBoundaryMatrixFixture(payload) {
  const baseRow = payload.estimated_cost.daily_breakdown[0];
  const withRows = count => ({
    ...payload,
    estimated_cost: {
      ...payload.estimated_cost,
      daily_breakdown: Array.from({ length: count }, (_, index) => ({
        ...baseRow,
        day: `2026-07-${String((index % 14) + 1).padStart(2, '0')}`,
        project: `Fixture ${index}`,
      })),
    },
  });
  for (const count of [127, 128, 129, 172, MAX_DAILY_BREAKDOWN_ROWS]) {
    const fixture = withRows(count);
    assert.strictEqual(providerUsageBoundaryViolation(fixture), null,
      `${count} daily cost rows must satisfy the explicit path bound`);
    assert.strictEqual(sanitizeProviderUsageSnapshot(fixture).estimated_cost.daily_breakdown.length, count);
  }
  const overLimit = withRows(MAX_DAILY_BREAKDOWN_ROWS + 1);
  assert.strictEqual(providerUsageBoundaryViolation(overLimit), '$.estimated_cost.daily_breakdown:array_length');
  const degraded = sanitizeProviderUsageSnapshot(overLimit);
  assert.strictEqual(degraded.snapshots.length, payload.snapshots.length,
    'an oversized cost section must preserve valid provider quota');
  assert.strictEqual(degraded.estimated_cost.status, 'error');
  assert.strictEqual(degraded.estimated_cost.reason_path, '$.estimated_cost.daily_breakdown:array_length');

  const highCardinality = withRows(1001);
  const compact = compactProviderUsageSnapshot(highCardinality);
  assert.strictEqual(compact.estimated_cost.daily_breakdown.length, MAX_DAILY_BREAKDOWN_ROWS);
  assert.deepStrictEqual(compact.estimated_cost.detail, {
    total_rows: 1001,
    inline_rows: MAX_DAILY_BREAKDOWN_ROWS,
    page_size: MAX_DAILY_BREAKDOWN_ROWS,
    next_cursor: String(MAX_DAILY_BREAKDOWN_ROWS),
    truncated: true,
    collections: compact.estimated_cost.detail.collections,
  });
  assert.strictEqual(compact.estimated_cost.detail.collections.find(row => row.name === 'daily_breakdown').total_rows, 1001);
  assert.strictEqual(providerUsageBoundaryViolation(compact), null,
    'a high-cardinality cost result must become one bounded, explicitly truncated page');

  const costCredential = withRows(172);
  costCredential.estimated_cost.daily_breakdown[50].project = 'provider-usage-secret-canary@example.com';
  const credentialAssessment = providerUsageBoundaryAssessment(costCredential);
  assert.strictEqual(credentialAssessment.cost_violation, '$.estimated_cost.daily_breakdown[50].project:credential_shape');
  assert.strictEqual(sanitizeProviderUsageSnapshot(costCredential).snapshots.length, payload.snapshots.length,
    'credential-shaped cost detail must not erase independently valid quota');
  const nestedCredentialCases = [
    fixture => { fixture.estimated_cost.range.since = 'provider-usage-secret-canary@example.com'; },
    fixture => { fixture.estimated_cost.scan.checkpoint_hash = 'Bearer provider-usage-secret-canary-0123456789'; },
    fixture => { fixture.estimated_cost.tokens.input = 'sk-provider-usage-secret-canary-0123456789'; },
  ];
  for (const mutate of nestedCredentialCases) {
    const fixture = structuredClone(payload);
    mutate(fixture);
    const sanitized = sanitizeProviderUsageSnapshot(fixture);
    assert.strictEqual(sanitized.snapshots.length, payload.snapshots.length,
      'credential-shaped cost metadata must preserve independently valid quota');
    assert(!JSON.stringify(sanitized).includes('provider-usage-secret-canary'),
      'degraded cost metadata must never copy a credential-shaped value');
  }

  const quotaCredential = JSON.parse(JSON.stringify(payload));
  quotaCredential.snapshots[0].account_label = 'provider-usage-secret-canary@example.com';
  assert.strictEqual(sanitizeProviderUsageSnapshot(quotaCredential), null,
    'credential-shaped provider quota remains fail-closed');
  const quotaWithDetailOnlyKey = JSON.parse(JSON.stringify(payload));
  quotaWithDetailOnlyKey.summary = {};
  assert.strictEqual(providerUsageBoundaryViolation(quotaWithDetailOnlyKey), '$.summary:key',
    'cost-detail keys must not weaken the provider snapshot allowlist');
}

async function costDetailPaginationFixture() {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  const records = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => {
    const day = new Date(now - (index % 365) * 86400000).toISOString().slice(0, 10);
    const providerId = index % 2 ? 'openai-codex' : 'anthropic-claude';
    return [`record-${index}`, {
      id: `record-${index}`,
      provider_id: providerId,
      timestamp: `${day}T12:00:00.000Z`,
      day,
      model: providerId === 'openai-codex' ? 'gpt-5.6-sol' : 'claude-sonnet-4-6',
      project: `Fixture ${index}`,
      speed: index % 3 ? 'standard' : 'fast/priority',
      tokens: { input: 100 + index, cached: 20, cacheCreate: 0, output: 10 },
      cost_usd: (index + 1) / 10000,
      pricing_provenance: 'fixture',
      unknown_model: null,
    }];
  }));
  const scanner = new LocalUsageCostScanner({ now: () => now });
  scanner.state = { version: 2, files: {}, records };
  scanner.status = 'ready';
  const oracle = aggregateRecords(Object.values(records), now, 365);
  const received = [];
  let cursor = '0';
  let pages = 0;
  do {
    const detail = await scanner.detailPage({ days: 365, cursor, pageSize: 256 });
    assert.strictEqual(providerUsageCostDetailViolation(detail), null,
      `cost detail page ${pages + 1} must satisfy the credential-safe boundary`);
    received.push(...detail.rows);
    pages += 1;
    if (pages === 1) {
      scanner.state.records['late-mutation'] = {
        ...records['record-0'], id: 'late-mutation', project: 'Late mutation', cost_usd: 99,
      };
    }
    cursor = detail.pagination.next_cursor;
    assert.deepStrictEqual(detail.summary.tokens, oracle.tokens);
    assert.strictEqual(detail.summary.cost_usd, oracle.cost_usd);
    assert.strictEqual(detail.summary.records, oracle.records);
  } while (cursor != null);
  assert.strictEqual(pages, 4);
  assert.strictEqual(received.length, 1001);
  assert.strictEqual(new Set(received.map(row => `${row.day}|${row.provider_id}|${row.model}|${row.project}|${row.speed}`)).size, 1001,
    'cursor pages must contain no duplicates or gaps');
  assert.deepStrictEqual(received, oracle.daily_breakdown,
    'paged detail must equal the offline aggregate oracle exactly even while scanner state changes');
  const project = await scanner.detailPage({ days: 365, project: 'Fixture 777', cursor: '0', pageSize: 50 });
  assert.strictEqual(project.rows.length, 1);
  assert.strictEqual(project.rows[0].project, 'Fixture 777');
  const unknownProject = await scanner.detailPage({ days: 365, project: 'Missing fixture', cursor: '0', pageSize: 50 });
  assert.strictEqual(unknownProject.query.project, 'Missing fixture');
  assert.strictEqual(unknownProject.rows.length, 0,
    'an unknown exact project filter must return no rows instead of widening to all projects');
  await assert.rejects(
    scanner.detailPage({ days: 365, providerId: 'unknown-provider', cursor: '0', pageSize: 50 }),
    error => error?.code === 'invalid_provider_filter',
  );
  const malformedCursorChain = JSON.parse(JSON.stringify(project));
  malformedCursorChain.pagination.next_cursor = '1';
  assert.strictEqual(providerUsageCostDetailViolation(malformedCursorChain), '$.pagination.next_cursor',
    'the boundary must reject a next cursor that would create duplicate or skipped rows');
  const malformedSummary = JSON.parse(JSON.stringify(project));
  malformedSummary.summary.records = null;
  assert.strictEqual(providerUsageCostDetailViolation(malformedSummary), '$.summary.tokens',
    'a page without authoritative aggregate totals must fail closed');
}

async function failureAndBackoffFixtures() {
  const collectors = screenshotCollectors();
  let now = Date.now();
  const registry = new ProviderUsageRegistry({
    getSessions: () => sessions('codex', 60),
    collectors,
    fingerprintKey: KEY,
    pollIntervalMs: 300000,
    random: () => 0.5,
    now: () => now,
  });
  await registry.refresh({ force: true });
  collectors.codex = async () => { throw new ProviderUsageError('offline', { code: 'network_error' }); };
  registry.collectors.codex = collectors.codex;
  registry.lastCompletedAt = 0;
  await registry.refresh({ force: true });
  const firstMiss = registry.snapshot().snapshots[0];
  assert.strictEqual(firstMiss.status, 'fresh', 'one missed refresh keeps bounded last-good data fresh');
  assert.strictEqual(firstMiss.consecutive_misses, 1);
  assert.strictEqual(firstMiss.error, null);
  now += 16_000;
  await registry.refresh({ force: true });
  const stale = registry.snapshot().snapshots[0];
  assert.strictEqual(stale.status, 'stale');
  assert.strictEqual(stale.stale_reason, 'two_consecutive_misses');
  assert.strictEqual(stale.consecutive_misses, 2);
  assert.ok(stale.windows.length > 0, 'last-known-good windows must survive a fetch failure');
  assert.strictEqual(stale.error.code, 'network_error');
  assert.ok(registry.nextAllowedAt.get('codex') - now > 28000, 'repeated network failure must back off');

  let rateLimitedCalls = 0;
  const limited = new ProviderUsageRegistry({
    getSessions: () => sessions('claude', 1),
    collectors: {
      claude: async () => {
        rateLimitedCalls += 1;
        throw new ProviderUsageError('limited', { code: 'http_429', status: 'rate_limited', retryAfterMs: 42000 });
      },
    },
    fingerprintKey: KEY,
  });
  await limited.refresh({ force: true });
  const blockedUntil = limited.nextAllowedAt.get('claude');
  assert.ok(blockedUntil - Date.now() >= 41000, 'Retry-After must be honored');
  limited.lastCompletedAt = 0;
  await limited.refresh({ force: true });
  assert.strictEqual(rateLimitedCalls, 1, 'manual refresh must not bypass Retry-After');
  assert.strictEqual(limited.snapshot().snapshots[0].status, 'rate_limited');

  const auth = new ProviderUsageRegistry({
    getSessions: () => sessions('claude_cli', 1),
    collectors: { claude: async () => { throw new ProviderUsageError('auth', { code: 'http_401', status: 'auth_required' }); } },
    fingerprintKey: KEY,
  });
  await auth.refresh({ force: true });
  assert.strictEqual(auth.snapshot().snapshots[0].status, 'auth_required');
  assert.strictEqual(auth.snapshot().snapshots[0].error.message, 'Sign in required.');

  const malformed = new ProviderUsageRegistry({
    getSessions: () => sessions('cursor', 1),
    collectors: { cursor: async () => account('cursor', 'broken', { windows: [] }) },
    fingerprintKey: KEY,
  });
  await malformed.refresh({ force: true });
  const unavailable = malformed.snapshot().snapshots[0];
  assert.strictEqual(unavailable.status, 'unavailable');
  assert.deepStrictEqual(unavailable.windows, []);
}

async function singleFlightAndCadenceFixture() {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const registry = new ProviderUsageRegistry({
    getSessions: () => sessions('codex_cli', 60),
    collectors: {
      codex: async () => {
        calls += 1;
        await gate;
        return account('codex', 'operator', { windows: [window('primary', '5-hour', 12)] });
      },
    },
    fingerprintKey: KEY,
    pollIntervalMs: 300000,
  });
  const first = registry.refresh({ force: true });
  const second = registry.refresh({ force: true });
  release();
  await Promise.all([first, second]);
  assert.strictEqual(calls, 1, '60 sessions and concurrent manual refreshes must share one provider request');
  await registry.refresh();
  assert.strictEqual(calls, 1, 'quick reconnect/open refresh must use the cached interval result');
  registry.start();
  assert(registry.timer?._idleTimeout > 0 && registry.timer?._idleTimeout <= 300000,
    'routine cadence must target the next anchored five-minute wall-clock boundary');
  registry.stop();
}

function authorityFixture(payload) {
  const authority = new ProviderUsageAuthority();
  const sessionsById = new Map([
    ['codex-ui', { agent_type: 'codex', activity: { goal: { objective: 'ship', state: 'active' } } }],
    ['codex-cli', { agent_type: 'codex_cli', activity: { goal: { objective: 'ship', state: 'active' } } }],
  ]);
  const codex = payload.snapshots.find(item => item.provider_id === 'openai-codex');
  codex.windows[0].used_percent = 100;
  codex.windows[0].remaining_percent = 0;
  codex.stale_after = new Date(Date.now() + 60000).toISOString();
  codex.status = 'fresh';
  const first = authority.observe({ snapshots: [codex] }, sessionsById, new Set(sessionsById.keys()));
  const second = authority.observe({ snapshots: [codex] }, sessionsById, new Set(sessionsById.keys()));
  assert.strictEqual(first.length, 1, 'one provider/account/window cycle must produce one threshold event');
  assert.strictEqual(second.length, 0, 'Claude/Codex UI-vs-CLI duplicates must remain suppressed');
  assert.deepStrictEqual(first[0].affectedSessionIds, ['codex-cli', 'codex-ui']);
  assert.strictEqual(authority.isAuthoritative('codex-cli'), true);
}

async function main() {
  codexAppServerPipeFixture();
  antigravityResetFixture();
  await claudeCliFallbackFixture();
  await hiddenPtyTransportFixture();
  await cursorPythonSqliteFallbackFixture();
  const { payload } = await screenshotFixture();
  await ollamaFixture();
  costBoundaryMatrixFixture(payload);
  await costDetailPaginationFixture();
  await distinctAccountFixture();
  await failureAndBackoffFixtures();
  await singleFlightAndCadenceFixture();
  authorityFixture(payload);

  const canary = 'provider-usage-secret-canary@example.com';
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes(canary));
  assert.ok(!/Bearer\s|sk-[a-z0-9]|access_token|refresh_token|cookie|authorization/i.test(serialized));
  console.log('provider usage registry smoke: PASS');
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
