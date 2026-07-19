#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');
const {
  collectOllama,
  normalizeOllamaTerminalReceipt,
  readOllamaRequestReceipts,
  writeOllamaRequestReceipt,
} = require('../agent-proxy/provider-usage');
const { sanitizeProviderUsageSnapshot } = require('../relay-server/provider-usage-boundary');
const { loopbackBaseUrl, runCanary } = require('./provider-usage-ollama-canary');

function loadFrontendProviderUsage() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'provider-usage.js'), 'utf8');
  const transformed = esbuild.transformSync(source, {
    loader: 'js', format: 'cjs', target: 'es2020',
  }).code;
  const compiled = { exports: {} };
  new Function('module', 'exports', transformed)(compiled, compiled.exports);
  return compiled.exports;
}

async function withFixtureServer(callback) {
  let loaded = false;
  const bodies = [];
  const server = http.createServer((request, response) => {
    const reply = payload => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (request.method === 'GET' && request.url === '/api/tags') {
      reply({ models: [{ name: 'fixture:e2b', size: 7_162_405_886 }] });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/ps') {
      reply({ models: loaded ? [{ name: 'fixture:e2b', size: 7_162_405_886 }] : [] });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/generate') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        bodies.push(body);
        if (!body.prompt && Number(body.keep_alive) === 0) {
          loaded = false;
          reply({ model: body.model, done: true });
          return;
        }
        loaded = true;
        const content = String(body.prompt || '').split(':').slice(1).join(':').trim();
        reply({
          model: body.model,
          created_at: '2026-07-16T08:30:00.000Z',
          response: content,
          done: true,
          done_reason: 'stop',
          total_duration: 4_000_000_000,
          load_duration: 1_000_000_000,
          prompt_eval_count: 11,
          prompt_eval_duration: 500_000_000,
          eval_count: 5,
          eval_duration: 2_500_000_000,
        });
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await callback({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      bodies,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  assert.throws(
    () => normalizeOllamaTerminalReceipt({ done: false }, { model: 'fixture:e2b', surface: 'fixture' }),
    error => error?.code === 'receipt_not_terminal',
  );
  assert.throws(
    () => normalizeOllamaTerminalReceipt({ done: true, model: 'fixture:e2b' }, { surface: 'fixture' }),
    error => error?.code === 'receipt_metrics_missing',
  );
  assert.throws(() => loopbackBaseUrl(`http://${[192, 168, 1, 5].join('.')}:11434`), /loopback-only/);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-ollama-canary-'));
  const receiptPath = path.join(temporaryRoot, 'receipts.json');
  try {
    const fixture = await withFixtureServer(async ({ baseUrl, bodies }) => ({
      report: await runCanary({
        baseUrl,
        model: 'fixture:e2b',
        surface: 'remote_agent_chat_fixture',
        receiptPath,
        timeoutMs: 10_000,
      }),
      bodies,
    }));
    const report = fixture.report;
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.terminal_response_observed, true);
    assert.strictEqual(report.lifecycle_loaded_model_observed, true);
    assert.strictEqual(report.lifecycle_unloaded_after, true);
    assert.strictEqual(report.receipt.prompt_tokens, 11);
    assert.strictEqual(report.receipt.response_tokens, 5);
    assert.strictEqual(report.receipt.tokens_per_second, 2);
    assert.strictEqual(report.receipt.total_duration_ns, 4_000_000_000);
    assert.strictEqual(report.receipt.load_duration_ns, 1_000_000_000);
    assert.strictEqual(report.receipt.prompt_eval_duration_ns, 500_000_000);
    assert.strictEqual(report.receipt.eval_duration_ns, 2_500_000_000);
    assert.strictEqual(fixture.bodies.length, 2);
    const contentCanary = String(fixture.bodies[0].prompt).split(':').slice(1).join(':').trim();
    const persisted = fs.readFileSync(receiptPath, 'utf8');
    assert.ok(!persisted.includes(contentCanary), 'receipt state persisted canary prompt/response text');
    assert.ok(!persisted.includes('"prompt"'), 'receipt state persisted a prompt field');
    assert.ok(!persisted.includes('"response"'), 'receipt state persisted a response field');

    writeOllamaRequestReceipt({
      done: true,
      model: report.receipt.model,
      prompt_eval_count: report.receipt.prompt_tokens,
      eval_count: report.receipt.response_tokens,
      total_duration: report.receipt.total_duration_ns,
      load_duration: report.receipt.load_duration_ns,
      prompt_eval_duration: report.receipt.prompt_eval_duration_ns,
      eval_duration: report.receipt.eval_duration_ns,
    }, {
      model: report.receipt.model,
      surface: report.receipt.surface,
      capturedAt: report.receipt.captured_at,
    }, { receiptPath });

    const receipts = readOllamaRequestReceipts({ receiptPath });
    assert.strictEqual(receipts.length, 1);
    assert.deepStrictEqual(receipts[0], report.receipt);
    const requests = [];
    const collected = await collectOllama(Buffer.from('fixture-key'), {
      receiptPath,
      cloudReader: async () => ({ ok: false, code: 'fixture_unavailable', message: 'Fixture cloud source unavailable.' }),
      requester: async pathname => {
        requests.push(pathname);
        if (pathname === '/api/ps') return { models: [] };
        if (pathname === '/api/tags') return { models: [{ name: 'fixture:e2b' }] };
        throw new Error(`Unexpected path ${pathname}`);
      },
    });
    assert.deepStrictEqual(requests.sort(), ['/api/ps', '/api/tags']);
    assert.strictEqual(collected.local_runtime.telemetry_status, 'observed_owned_requests');
    assert.strictEqual(collected.local_runtime.observed_request_count, 1);
    assert.strictEqual(collected.local_runtime.request_receipts.length, 1);
    assert.strictEqual(collected.local_runtime.tokens_per_second, 2);

    const snapshot = {
      schema_version: 3,
      generation: 1,
      generated_at: '2026-07-16T08:31:00.000Z',
      poll_interval_ms: 300000,
      in_flight: false,
      snapshots: [{
        schema_version: 3,
        provider_id: 'ollama-local',
        provider_name: 'Ollama',
        quota_domain: 'ollama-local-runtime',
        account_fingerprint: 'acct_cccccccccccccccccccc',
        account_label: 'Loopback runtime',
        plan: 'Local models',
        source: 'loopback_api',
        source_history: [],
        status: 'fresh',
        captured_at: '2026-07-16T08:31:00.000Z',
        stale_after: '2026-07-16T08:41:00.000Z',
        windows: [], credits: null, financials: null,
        local_runtime: collected.local_runtime,
        reset_credits: null, error: null, request_count: 2, latency_ms: 1,
        session_count: 0, mapped_harness_types: [],
      }],
      estimated_cost: null,
    };
    assert.ok(sanitizeProviderUsageSnapshot(snapshot), 'relay boundary rejected safe Ollama receipts');
    const frontend = loadFrontendProviderUsage();
    const normalized = frontend.normalizeProviderUsage(snapshot);
    const runtime = normalized.entries[0].localRuntime;
    assert.strictEqual(runtime.latestRequest.model, 'fixture:e2b');
    assert.strictEqual(runtime.latestRequest.surface, 'remote_agent_chat_fixture');
    assert.strictEqual(frontend.formatOllamaTokenRate(runtime.latestRequest.tokensPerSecond), '2 tokens/s');
    assert.strictEqual(frontend.formatOllamaDuration(runtime.latestRequest.loadDurationNs), '1 s');

    process.stdout.write(`${JSON.stringify({
      ok: true,
      terminal_receipt: true,
      metrics: {
        prompt_tokens: report.receipt.prompt_tokens,
        response_tokens: report.receipt.response_tokens,
        tokens_per_second: report.receipt.tokens_per_second,
        total_duration_ns: report.receipt.total_duration_ns,
        load_duration_ns: report.receipt.load_duration_ns,
        prompt_eval_duration_ns: report.receipt.prompt_eval_duration_ns,
        eval_duration_ns: report.receipt.eval_duration_ns,
      },
      lifecycle_loaded_then_unloaded: true,
      prompt_response_content_persisted: false,
      loopback_rejection: true,
      relay_boundary: true,
      web_normalization: true,
    }, null, 2)}\n`);
  } finally {
    const resolved = path.resolve(temporaryRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
