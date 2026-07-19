#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');
const goalLifecycle = require('../agent-proxy/goal-lifecycle');
const titlePolicy = require('../agent-proxy/session-title-policy');
const fleetWork = require('../relay-server/fleet-work-context');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_SESSION_ID = 'a1c12a8e-0e6d-4f26-974e-e182b29d0912';
const FIXTURE_TITLE = 'Repair Fleet card identity and work-context truth';
const FIXTURE_OBJECTIVE = 'Restore truthful Fleet identity and current work';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return executablePath;
}

function stable(value) {
  if (value === undefined) return '<undefined>';
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function comparable(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(comparable);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparable(value[key])]));
}

function createRecorder() {
  const checks = [];
  function equal(name, actual, expected) {
    const left = comparable(actual);
    const right = comparable(expected);
    const ok = JSON.stringify(left) === JSON.stringify(right);
    checks.push({ name, ok, actual, expected });
    return ok;
  }
  function truthy(name, actual, detail) {
    const ok = !!actual;
    checks.push({ name, ok, actual, expected: detail || true });
    return ok;
  }
  return { checks, equal, truthy };
}

function pageRuntime(cdp) {
  return {
    evaluate(params) {
      return cdp.send('Runtime.evaluate', params);
    },
  };
}

async function setGoalFixture(page, label, objective, duration) {
  await page.setContent(`<!doctype html>
    <html><head><style>
      body { font-family: sans-serif; margin: 30px; }
      #goal-row { display: flex; gap: 12px; min-height: 28px; align-items: center; }
      .ProseMirror { width: 600px; height: 60px; margin-top: 20px; border: 1px solid #aaa; }
    </style></head><body>
      <div id="goal-row"><span>${label}</span><span>${objective}</span><span>${duration}</span></div>
      <div class="ProseMirror" contenteditable="true"></div>
    </body></html>`);
}

async function nativeMatrices(recorder) {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const Runtime = pageRuntime(cdp);

    const durationCases = [
      ['5d 8h 21m 54s', 462114],
      ['2d 3h', 183600],
      ['45m 9s', 2709],
      ['7h 2s', 25202],
      ['3d 4m', 259440],
      ['19s', 19],
      ['7h', 25200],
    ];
    for (const [duration, expected] of durationCases) {
      await setGoalFixture(page, 'Goal blocked', FIXTURE_OBJECTIVE, duration);
      const observed = await selectors.detectThinking(Runtime, 'codex-desktop');
      recorder.equal(`duration:${duration}`, observed.goal?.time_used_seconds, expected);
      recorder.equal(`duration-not-objective:${duration}`, observed.goal?.objective, FIXTURE_OBJECTIVE);
    }
    const malformedDurationCases = [
      '5d 8h surprise',
      '8h 5d',
      '-1h',
      '5d 8h 21m 54',
    ];
    for (const duration of malformedDurationCases) {
      await setGoalFixture(page, 'Goal blocked', FIXTURE_OBJECTIVE, duration);
      const observed = await selectors.detectThinking(Runtime, 'codex-desktop');
      recorder.equal(`malformed-duration:${duration}`, observed.goal?.time_used_seconds, 0);
      recorder.equal(`malformed-duration-not-objective:${duration}`, observed.goal?.objective, FIXTURE_OBJECTIVE);
    }

    const labelCases = [
      ['Pursuing goal', 'active'],
      ['Paused goal', 'paused'],
      ['Goal blocked', 'blocked'],
      ['Goal usage limited', 'usageLimited'],
      ['Goal rate limited', 'usageLimited'],
      ['Goal limited', 'budgetLimited'],
      ['Goal budget limited', 'budgetLimited'],
      ['Goal achieved', 'complete'],
      ['Goal cancelled', 'cancelled'],
      ['Goal canceled', 'cancelled'],
      ['Goal stopped', 'cancelled'],
      ['Goal failed', 'failed'],
    ];
    for (const [label, expected] of labelCases) {
      await setGoalFixture(page, label, FIXTURE_OBJECTIVE, '1m 2s');
      const observed = await selectors.detectThinking(Runtime, 'codex-desktop');
      recorder.equal(`native-label:${label}`, observed.goal?.state, expected);
      recorder.equal(`normalize-label:${label}`, goalLifecycle.normalizeGoalState(label), expected);
    }

    return {
      duration_cases: durationCases.length,
      malformed_duration_cases: malformedDurationCases.length,
      label_cases: labelCases.length,
    };
  } finally {
    await browser.close();
  }
}

function canonicalStateChecks(recorder) {
  const record = goalLifecycle.canonicalGoalRecord({
    raw_state: 'Goal blocked',
    state: 'blocked',
    status: 'blocked',
    objective: FIXTURE_OBJECTIVE,
    time_used_seconds: 462114,
  }, {
    sessionKey: FIXTURE_SESSION_ID,
    source: 'codex_extension_dom',
    observedAt: '2026-07-15T20:00:00.000Z',
  });
  recorder.equal('canonical-state-preserved', record.state, 'blocked');
  recorder.equal('canonical-status-preserved', record.status, 'blocked');
  recorder.equal('raw-state-preserved', record.raw_state, 'Goal blocked');
  recorder.equal('canonical-duration-separate', record.time_used_seconds, 462114);
  recorder.equal('canonical-objective-clean', record.objective, FIXTURE_OBJECTIVE);
  return record;
}

function invalidCandidateChecks(recorder) {
  const invalid = [
    '5d 8h 21m 54s',
    '5d 8h surprise',
    'Goal blocked',
    'Pursuing goal',
    'Codex harness',
  ];
  for (const candidate of invalid) {
    recorder.equal(`invalid-title:${candidate}`, titlePolicy.isLowSignalChatTitle(candidate), true);
    recorder.equal(`invalid-work:${candidate}`, fleetWork.boundedDisplayText(candidate), '');
  }
  recorder.equal('authoritative-native-title-may-match-workspace',
    titlePolicy.selectDurableChatTitle({ nativeTitle: 'Remote Agent Chat' }), 'Remote Agent Chat');
  recorder.equal('workspace-label-not-valid-work', fleetWork.boundedDisplayText('Remote Agent Chat'), '');
  return invalid;
}

function workContextChecks(recorder) {
  const latestRequest = {
    text: 'Repair the populated Fleet card without touching the user session',
    updated_at: '2026-07-15T20:01:00.000Z',
  };
  const durationFallback = fleetWork.projectFleetWorkContext({
    agentType: 'codex',
    activity: {
      kind: 'idle',
      goal: { raw_state: 'Goal blocked', state: 'blocked', objective: '5d 8h 21m 54s' },
    },
    latestUserRequest: latestRequest,
  });
  recorder.equal('duration-goal-falls-back-to-request', {
    kind: durationFallback?.kind,
    text: durationFallback?.text,
    source: durationFallback?.source,
  }, {
    kind: 'request',
    text: latestRequest.text,
    source: 'latest_user_request',
  });

  const unknownFallback = fleetWork.projectFleetWorkContext({
    agentType: 'codex',
    activity: { kind: 'idle', goal: { state: 'unknown', objective: FIXTURE_OBJECTIVE } },
  });
  recorder.equal('unknown-goal-is-unavailable', {
    kind: unknownFallback?.kind,
    text: unknownFallback?.text,
    source: unknownFallback?.source,
    diagnostic_reason: unknownFallback?.diagnostic_reason,
  }, {
    kind: 'empty',
    text: 'Current work unavailable',
    source: 'none',
    diagnostic_reason: 'no_authoritative_work_context',
  });

  const validGoal = fleetWork.projectFleetWorkContext({
    agentType: 'codex',
    activity: {
      kind: 'idle',
      goal: { raw_state: 'Goal blocked', state: 'blocked', objective: FIXTURE_OBJECTIVE, time_used_seconds: 462114 },
    },
  });
  recorder.equal('valid-blocked-goal', {
    kind: validGoal?.kind,
    text: validGoal?.text,
    state: validGoal?.state,
  }, { kind: 'goal', text: FIXTURE_OBJECTIVE, state: 'blocked' });
  return { duration_fallback: durationFallback, unknown_fallback: unknownFallback, valid_goal: validGoal };
}

function listViewTitleFixture(recorder, canonicalGoal) {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-fleet-identity-'));
  const isolatedStore = path.join(isolatedDir, 'session-store.json');
  const assistants = Array.from({ length: 1053 }, (_, index) => ({
    role: 'assistant',
    content: `Cached assistant row ${index + 1}`,
    timestamp: `2026-07-15T19:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  fs.writeFileSync(isolatedStore, JSON.stringify({
    sessions: {
      [FIXTURE_SESSION_ID]: {
        session_id: FIXTURE_SESSION_ID,
        agent_type: 'codex',
        accumulated_messages: assistants,
      },
    },
    preferences: {},
  }), 'utf8');
  process.env.SESSION_STORE_PATH = isolatedStore;
  const proxyEnginePath = path.join(ROOT, 'agent-proxy', 'proxy-engine.js');
  delete require.cache[require.resolve(proxyEnginePath)];
  const { ProxyEngine } = require(proxyEnginePath);
  const engine = new ProxyEngine({
    cdpPorts: [],
    relayUrl: 'ws://127.0.0.1:1/proxy-ws',
    uploadDir: path.join(isolatedDir, 'uploads'),
  });
  const runtime = {
    session_id: FIXTURE_SESSION_ID,
    agentType: 'codex',
    workspace_name: 'Remote Agent Chat',
    windowTitle: 'Remote Agent Chat - Visual Studio Code',
    _listView: true,
    _activeChatTitle: FIXTURE_TITLE,
    _activeChatId: 'native-thread-fleet-truth',
    _accumulatedMessages: assistants,
    status: 'healthy',
    activity: { kind: 'idle', label: 'Idle', goal: canonicalGoal },
    last_seen_at: '2026-07-15T20:02:00.000Z',
  };
  engine.sessions.set(FIXTURE_SESSION_ID, runtime);
  const metas = engine._buildSessionMetas();
  const meta = metas.find(item => item.session_id === FIXTURE_SESSION_ID);
  recorder.equal('list-view-native-title', meta?.chat_title, FIXTURE_TITLE);
  recorder.equal('list-view-title-source', meta?.chat_title_source, 'native');
  recorder.equal('populated-session-not-new-chat', titlePolicy.isLowSignalChatTitle(meta?.chat_title), false);
  const persisted = JSON.parse(fs.readFileSync(isolatedStore, 'utf8')).sessions[FIXTURE_SESSION_ID];
  recorder.equal('durable-title-persisted', persisted.chat_title, FIXTURE_TITLE);
  recorder.equal('durable-title-source-persisted', persisted.chat_title_source, 'native');
  fs.rmSync(isolatedDir, { recursive: true, force: true });
  return {
    session_id: FIXTURE_SESSION_ID,
    stored_user_rows: 0,
    stored_assistant_rows: assistants.length,
    native_thread_id_sha256: crypto.createHash('sha256').update(runtime._activeChatId).digest('hex'),
    meta,
  };
}

async function main() {
  const recorder = createRecorder();
  const outputPath = option('--output');
  let fatal = null;
  let native = null;
  let canonicalGoal = null;
  let invalidCandidates = null;
  let workContexts = null;
  let fixture = null;
  try {
    native = await nativeMatrices(recorder);
    canonicalGoal = canonicalStateChecks(recorder);
    invalidCandidates = invalidCandidateChecks(recorder);
    workContexts = workContextChecks(recorder);
    fixture = listViewTitleFixture(recorder, canonicalGoal);
  } catch (error) {
    fatal = { name: error.name, message: error.message, stack: String(error.stack || '').split('\n').slice(0, 8) };
  }
  const failures = recorder.checks.filter(check => !check.ok);
  const result = {
    status: fatal || failures.length ? 'FAIL' : 'PASS',
    fixture: 'a1c12-populated-codex-list-view',
    session_id: FIXTURE_SESSION_ID,
    expected_title: FIXTURE_TITLE,
    expected_objective: FIXTURE_OBJECTIVE,
    expected_elapsed_seconds: 462114,
    native,
    canonical_goal: canonicalGoal,
    invalid_candidates: invalidCandidates,
    work_contexts: workContexts,
    fixture_result: fixture,
    checks: recorder.checks,
    failure_count: failures.length + (fatal ? 1 : 0),
    fatal,
    visible_windows_opened: 0,
    focus_actions: 0,
    protected_cdp_connections: 0,
    generated_at: new Date().toISOString(),
  };
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), encoded, 'utf8');
  }
  process.stdout.write(encoded);
  if (result.status !== 'PASS') process.exitCode = 1;
}

main();
