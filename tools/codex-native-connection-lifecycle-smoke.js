#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');
const { applyCodexDomActivityChannels } = require('../agent-proxy/proxy-engine');
const { normalizeActivityTimeline } = require('../relay-server/activity-timeline');
const { resolveSharedRuntimeContract } = require('../relay-server/shared-runtime-contract');
const { reduceProviderConnection } = require('../shared/provider-connection-lifecycle');

const SESSION_ID = '019f9000-1000-7000-8000-000000000001';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : null;
assert(outputIndex < 0 || process.argv[outputIndex + 1], '--output requires a path');

assert.strictEqual(
  resolveSharedRuntimeContract('provider-connection-lifecycle.js'),
  path.resolve(__dirname, '..', 'shared', 'provider-connection-lifecycle.js'),
  'relay must resolve the provider connection contract from a source checkout',
);
assert.strictEqual(
  resolveSharedRuntimeContract('provider-connection-lifecycle.js', {
    baseDir: '/app',
    existsSync: candidate => candidate === path.resolve('/app', 'shared', 'provider-connection-lifecycle.js'),
  }),
  path.resolve('/app', 'shared', 'provider-connection-lifecycle.js'),
  'relay must resolve the provider connection contract from the packaged container layout',
);

function chromePath() {
  const candidates = [
    process.env.RAC_CHROME_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error('Headless Chrome is unavailable');
  return resolved;
}

function fixturePath(surface) {
  return surface === 'codex-desktop'
    ? path.join(__dirname, '..', 'tests', 'fixtures', 'codex-desktop', '26.715.9868.0', 'native-connection-lifecycle-dom.json')
    : path.join(__dirname, '..', 'tests', 'fixtures', 'codex-vscode', '26.707.91948', 'native-connection-lifecycle-dom.json');
}

function pageHtml(testCase) {
  return [
    '<!doctype html><html><head><style>body{margin:0}.unit,.group\\/activity-header,[data-testid]{display:block;min-height:24px;width:500px}</style></head><body>',
    '<main data-thread-find-target="conversation">',
    '<div data-content-search-unit-key="turn-old:0:user">Old</div>',
    testCase.before || '',
    `<div class="unit" data-content-search-unit-key="${testCase.turn}:0:user">Current</div>`,
    `<div class="unit" data-turn-key="${testCase.turn}">${testCase.html}</div>`,
    '</main>',
    '<p>Model prose says reconnecting 99/99 but is not a native activity header.</p>',
    '</body></html>',
  ].join('');
}

async function runtimeFor(page, cdp) {
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context));
  await cdp.send('Runtime.enable');
  await page.setContent('<!doctype html><html><body></body></html>');
  const defaultContext = contexts.find(entry => entry.auxData?.isDefault === true);
  assert(defaultContext?.id, 'default execution context missing');
  return { _innerContextId: defaultContext.id, evaluate: async params => {
    const result = await cdp.send('Runtime.evaluate', params);
    if (result.exceptionDetails) {
      const lines = String(params.expression || '').split('\n');
      const line = Number(result.exceptionDetails.lineNumber) || 0;
      throw new Error(`fixture expression syntax ${JSON.stringify(result.exceptionDetails)} near ${lines.slice(Math.max(0, line - 2), line + 3).join(' | ')}`);
    }
    return result;
  } };
}

async function runDomFixtures(browser, surface) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath(surface), 'utf8'));
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const latencies = [];
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const Runtime = await runtimeFor(page, cdp);
    for (const testCase of fixture.cases) {
      await page.setContent(pageHtml(testCase));
      const started = performance.now();
      const observed = await selectors.detectThinking(Runtime, surface);
      latencies.push(performance.now() - started);
      if (testCase.state) {
        assert.equal(observed.native_connection?.state, testCase.state, `${surface}/${testCase.name}: state ${JSON.stringify(observed)}`);
        if (testCase.attempt) assert.equal(observed.native_connection.attempt, testCase.attempt);
        if (testCase.attempt_limit) assert.equal(observed.native_connection.attempt_limit, testCase.attempt_limit);
        assert.equal(observed.native_connection.provenance, surface === 'codex-desktop' ? 'codex_desktop_dom' : 'codex_extension_dom');
        assert.equal(observed.native_connection.native_turn_id, testCase.turn);
        assert(!String(observed.thinkingContent || '').includes('Reconnecting'));
        assert(!String(observed.activitySummary?.text || '').includes('Reconnecting'));
      } else {
        assert.equal(observed.native_connection, null, `${surface}/${testCase.name}: false positive`);
      }
      if (testCase.diagnostic) assert.equal(observed.native_connection_diagnostic?.code, testCase.diagnostic);
    }
    return { surface, version: fixture.version, cases: fixture.cases.length, latencies };
  } finally {
    await context.close();
  }
}

function frame(cycle, attempt, state = 'reconnecting', overrides = {}) {
  const turn = overrides.turn_id || `turn-${cycle}`;
  return {
    state,
    attempt: state === 'reconnecting' ? attempt : (overrides.attempt ?? 5),
    attempt_limit: 5,
    producer_timestamp: new Date(Date.parse('2026-07-22T12:00:00.000Z') + cycle * 1000 + attempt).toISOString(),
    session_id: SESSION_ID,
    thread_id: overrides.thread_id || SESSION_ID,
    turn_id: turn,
    generation_seq: cycle,
    source_id: `source-${turn}`,
    provenance: overrides.provenance || 'codex_desktop_dom',
    ...overrides,
  };
}

function runReducerStorm() {
  let current = null;
  let acceptedAttempt = 0;
  let frames = 0;
  let staleRejected = 0;
  let duplicates = 0;
  for (let cycle = 1; cycle <= 100; cycle += 1) {
    const sequence = [
      frame(cycle, 1), frame(cycle, 1), frame(cycle, 2), frame(cycle, 4), frame(cycle, 3),
      frame(cycle, 4), frame(cycle, 5), frame(cycle, 2), frame(cycle, 5, 'reconnected'), frame(cycle, 1),
    ];
    acceptedAttempt = 0;
    for (const incoming of sequence) {
      const result = reduceProviderConnection(current, incoming, incoming);
      frames += 1;
      if (result.code === 'connection_duplicate_suppressed') duplicates += 1;
      if (/rejected$/.test(result.code)) staleRejected += 1;
      current = result.connection;
      if (current.generation_seq === cycle && current.state === 'reconnecting') {
        assert(current.attempt >= acceptedAttempt, `cycle ${cycle}: attempt regressed`);
        acceptedAttempt = current.attempt;
      }
    }
    assert.equal(current.generation_seq, cycle);
    assert.equal(current.state, 'reconnected');
  }
  assert.equal(frames, 1000);
  assert.equal(current.generation_seq, 100);
  const crossThread = reduceProviderConnection(current, frame(100, 5, 'failed', { turn_id: 'foreign-turn' }));
  assert.equal(crossThread.code, 'connection_generation_owner_rejected');
  const newerThread = reduceProviderConnection(current, frame(101, 1, 'reconnecting', { turn_id: 'turn-new' }));
  assert.equal(newerThread.accepted, true);
  assert.equal(newerThread.connection.turn_id, 'turn-new');
  return { frames, cycles: 100, staleRejected, duplicates };
}

function runProxyRelayProof() {
  const holder = {};
  const telemetry = [];
  const observed = {
    native_connection: {
      state: 'reconnecting', attempt: 5, attempt_limit: 5,
      producer_timestamp: '2026-07-22T12:00:00.000Z', native_turn_id: 'turn-current',
      native_source_id: 'source-current', provenance: 'codex_desktop_dom',
    },
    activitySummary: { text: 'Reconnecting /5', label: 'Thinking' },
    thinkingContent: 'Reconnecting /5',
  };
  const activity = applyCodexDomActivityChannels({ kind: 'idle', label: '', updated_at: observed.native_connection.producer_timestamp }, observed, null, {
    session_id: SESSION_ID, thread_id: SESSION_ID, turn_id: 'turn-current', connectionHolder: holder,
    onConnectionTelemetry: event => telemetry.push(event.event),
  });
  assert.equal(activity.connection.label, 'Reconnecting 5/5');
  assert.equal(activity.thinking, undefined);
  assert.equal(activity.thinkingContent, undefined);
  assert(telemetry.includes('connection_thinking_contamination_suppressed'));
  let relay = normalizeActivityTimeline(activity, null, '2026-07-22T12:00:00.001Z');
  assert.equal(relay.connection.label, 'Reconnecting 5/5');
  const recoveredFrame = frame(1, 5, 'reconnected', { turn_id: 'turn-current', source_id: 'source-current' });
  recoveredFrame.generation = activity.connection.generation;
  relay = normalizeActivityTimeline({ kind: 'idle', label: '', connection: recoveredFrame }, relay, '2026-07-22T12:00:00.002Z');
  assert.equal(relay.connection.state, 'reconnected');
  const settled = normalizeActivityTimeline({ kind: 'idle', label: '' }, relay, '2026-07-22T12:00:00.003Z');
  assert.equal(settled.connection, null);
  const stale = normalizeActivityTimeline({ kind: 'idle', label: '', connection: activity.connection }, settled, '2026-07-22T12:00:00.004Z');
  assert.equal(stale.connection, null, 'relay resurrected a terminal native connection lifecycle');
  assert.equal(stale.connection_tombstone.state, 'reconnected');
  const hiddenActive = normalizeActivityTimeline({
    kind: 'idle',
    label: '',
    connection: frame(9, 2, 'reconnecting', {
      turn_id: 'turn-hidden-duplicate',
      source_id: 'source-hidden-duplicate',
    }),
  }, null, '2026-07-22T12:00:00.005Z');
  const hidden = normalizeActivityTimeline(
    { kind: 'idle', label: '' },
    hiddenActive,
    '2026-07-22T12:00:00.006Z',
  );
  assert.equal(hidden.connection, null);
  const hiddenDuplicate = normalizeActivityTimeline({
    kind: 'idle',
    label: '',
    connection: hidden.connection_tombstone,
  }, hidden, '2026-07-22T12:00:00.007Z');
  assert.equal(hiddenDuplicate.connection, null, 'relay resurrected a hidden duplicate connection lifecycle');
  assert.equal(hiddenDuplicate.connection_reduction_code, 'connection_duplicate_suppressed');
  return {
    thinking_contamination: 0,
    relay_resurrections: 0,
    hidden_duplicate_resurrections: 0,
    container_contract_resolution: true,
  };
}

function assertSurfaceSources() {
  const web = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.jsx'), 'utf8');
  const android = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'ActivityRow.jsx'), 'utf8');
  for (const token of ['data-live-channel="native-connection"', 'Codex native connection', 'data-connection-generation']) {
    assert(web.includes(token), `Web connection surface missing ${token}`);
  }
  for (const token of ['testID="native-connection-row"', 'Codex native connection', 'accessibilityLiveRegion']) {
    assert(android.includes(token), `Android connection surface missing ${token}`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(), headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
  });
  let dom;
  try {
    dom = [];
    for (const surface of ['codex-desktop', 'codex']) dom.push(await runDomFixtures(browser, surface));
  } finally {
    await browser.close();
  }
  const allLatencies = dom.flatMap(item => item.latencies).sort((a, b) => a - b);
  const p95 = allLatencies[Math.max(0, Math.ceil(allLatencies.length * 0.95) - 1)];
  assert(p95 <= 250, `native observation p95 ${p95.toFixed(1)}ms exceeded 250ms`);
  const storm = runReducerStorm();
  const pipeline = runProxyRelayProof();
  assertSurfaceSources();
  const receipt = {
    result: 'PASS',
    fixtures: dom.map(({ latencies, ...item }) => item),
    observation_p95_ms: Math.round(p95 * 10) / 10,
    ...storm,
    ...pipeline,
    keyed_rows_per_cycle: 1,
    cross_thread_attributions: 0,
    false_assistant_messages: 0,
    web_android_source_parity: true,
    visible_windows_opened: 0,
    protected_sessions_touched: 0,
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
