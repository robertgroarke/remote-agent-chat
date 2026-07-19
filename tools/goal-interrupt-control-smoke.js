#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { ExactlyOnceControlRegistry } = require('../relay-server/exactly-once-control');
const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const selectors = require('../agent-proxy/selectors');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const sessionStore = require('../agent-proxy/session-store');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function appServerRoundTrip() {
  const connection = new CodexAppServerConnection({ sessionId: 'goal-control-smoke' });
  let goal = { status: 'active', objective: 'Ship exact goal control', tokenBudget: 12345 };
  const writes = [];
  connection.getGoal = async () => ({ goal: { ...goal } });
  connection.setGoal = async (threadId, status, options) => {
    writes.push({ threadId, status, options });
    goal = { ...goal, status };
    return { goal: { ...goal } };
  };
  const paused = await connection.controlGoal('thread-1', 'pause', {
    objective: goal.objective,
    tokenBudget: goal.tokenBudget,
  });
  const resumed = await connection.controlGoal('thread-1', 'resume', {
    objective: goal.objective,
    tokenBudget: goal.tokenBudget,
  });
  assert.equal(paused.before.status, 'active');
  assert.equal(paused.after.status, 'paused');
  assert.equal(resumed.after.status, 'active');
  assert(writes.every(write => write.options.objective === goal.objective && write.options.tokenBudget === 12345));
  assert.equal(writes.length, 2);
  assert.equal(paused.transcript_messages_appended + resumed.transcript_messages_appended, 0);
  return { writes: writes.length };
}

async function domRoundTrip() {
  let totalClicks = 0;
  const surfaces = {};
  for (const agentType of ['codex', 'codex-desktop']) {
    let state = 'active';
    let clicks = 0;
    const objective = `Keep the ${agentType} DOM goal identity stable`;
    const Runtime = {
      _innerContextId: agentType === 'codex' ? 1 : null,
      evaluate: async ({ expression }) => {
        if (expression.includes('function readGoalSurface()')) {
          return { result: { value: JSON.stringify({
            thinking: state === 'active',
            label: state === 'active' ? 'Working' : '',
            goal: {
              state,
              status: state,
              objective,
              token_budget: 9000,
              generation: 7,
              transition_seq: clicks,
              fingerprint: `goal-${state}-${clicks}`,
            },
          }) } };
        }
        if (expression.includes('var wanted = "Pause goal"')) {
          clicks += 1;
          state = 'paused';
          return { result: { value: JSON.stringify({ ok: true }) } };
        }
        if (expression.includes('var wanted = "Resume goal"')) {
          clicks += 1;
          state = 'active';
          return { result: { value: JSON.stringify({ ok: true }) } };
        }
        throw new Error(`Unexpected ${agentType} Runtime.evaluate payload: ${expression.slice(0, 100)}`);
      },
    };
    const pause = await selectors.controlCodexGoal(Runtime, agentType, 'pause', {
      objective,
      tokenBudget: 9000,
    });
    const resume = await selectors.controlCodexGoal(Runtime, agentType, 'resume', {
      objective,
      tokenBudget: 9000,
    });
    assert.equal(pause.ok, true, JSON.stringify(pause));
    assert.equal(resume.ok, true, JSON.stringify(resume));
    assert.equal(clicks, 2, `${agentType} must click exactly once per native transition`);
    assert.equal(pause.after.token_budget, pause.before.token_budget);
    assert.equal(resume.after.generation, resume.before.generation);
    surfaces[agentType] = { clicks };
    totalClicks += clicks;
  }
  return { clicks: totalClicks, surfaces };
}

function exactlyOnceFaultInjection() {
  let now = 1000;
  const registry = new ExactlyOnceControlRegistry({ now: () => now, ttlMs: 5000 });
  const tab = { id: 'tab' };
  const phone = { id: 'phone' };
  const key = 'session:4:agent_goal_control:pause:7:2:fingerprint';
  const first = registry.claim({ key, requestId: 'tab-request', client: tab, context: { action: 'pause' } });
  const second = registry.claim({ key, requestId: 'phone-request', client: phone });
  assert.equal(first.state, 'claimed');
  assert.equal(second.state, 'coalesced');
  assert.equal(second.upstreamRequestId, first.upstreamRequestId);
  const resolved = registry.resolve(first.upstreamRequestId, {
    type: 'agent_control_result',
    command: 'agent_goal_control',
    result: 'ok',
    native_acknowledged: true,
    details: { native_operations: 1, transcript_messages_appended: 0 },
  });
  assert.equal(resolved.deliveries.length, 2);
  assert.deepEqual(new Set(resolved.deliveries.map(item => item.receipt.request_id)),
    new Set(['tab-request', 'phone-request']));
  assert(resolved.deliveries.every(item => item.receipt.native_acknowledged === true));
  const replay = registry.claim({ key, requestId: 'double-click', client: tab });
  assert.equal(replay.state, 'replay');
  assert.equal(replay.receipt.replayed, true);
  now += 5001;
  const afterTtl = registry.claim({ key, requestId: 'new-generation-request', client: tab });
  assert.equal(afterTtl.state, 'claimed');
  return { upstream_native_operations: 1, correlated_receipts: 3 };
}

function stopCapabilityMatrix() {
  const build = ProxyEngine.prototype._buildCapabilities;
  const receiver = { _isGitWorkspace: () => false };
  const supported = [
    'claude', 'claude_cli', 'codex', 'codex_cli', 'codex-desktop', 'cursor', 'cursor_cli',
    'gemini', 'continue', 'continue_yolo', 'antigravity-v2', 'claude-desktop', 'roo_code', 'cline',
  ];
  for (const harness of supported) {
    const capabilities = build.call(receiver, harness, null);
    assert.equal(capabilities.interrupt, true, `${harness} must advertise a verified stop ladder`);
    assert(capabilities.interrupt_method, `${harness} must name its stop method`);
  }
  for (const harness of ['antigravity', 'antigravity_panel']) {
    const capabilities = build.call(receiver, harness, null);
    assert.equal(capabilities.interrupt, false);
    assert.equal(capabilities.interrupt_gate, 'no_verified_session_scoped_stop');
  }
  for (const harness of ['codex', 'codex_cli', 'codex-desktop']) {
    assert.equal(build.call(receiver, harness, null).goal_pause_resume, true);
  }
  assert.equal(build.call(receiver, 'claude', null).goal_pause_resume, false);
  return { supported: supported.length, gated: 2 };
}

function makeInterruptEngine(sessionId, session) {
  const emitted = [];
  const engine = Object.create(ProxyEngine.prototype);
  engine.sessions = new Map([[sessionId, session]]);
  engine._sendToRelay = message => emitted.push(message);
  engine._log = () => {};
  engine._cancelDomPushSecondaryPoll = () => {};
  engine._isGitWorkspace = () => false;
  return { engine, emitted };
}

async function interruptProxyRoundTrips() {
  const originalUpdateSession = sessionStore.updateSession;
  const originalInterruptAgent = selectors.interruptAgent;
  const originalDetectThinking = selectors.detectThinking;
  const persisted = [];
  sessionStore.updateSession = (sessionId, update) => persisted.push({ sessionId, update });
  try {
    const unavailableSession = {
      agentType: 'codex_cli',
      activity: { kind: 'working', goal: { state: 'active', objective: 'Stay intact', token_budget: 88 } },
    };
    const unavailable = makeInterruptEngine('cli-unavailable', unavailableSession);
    unavailable.engine._handleRelayMessage({
      type: 'agent_interrupt', session_id: 'cli-unavailable', request_id: 'unavailable-request',
    });
    const unavailableReceipt = unavailable.emitted.find(item => item.type === 'agent_control_result');
    assert.equal(unavailableReceipt.result, 'failed');
    assert.equal(unavailableReceipt.error.code, 'interrupt_unavailable');
    assert.equal(unavailableReceipt.native_attempted, false);
    assert.equal(unavailableSession.activity.kind, 'working', 'a failed interrupt must not fabricate idle');

    let nativeInterrupts = 0;
    const retainedGoal = {
      state: 'active', objective: 'Preserve this goal', token_budget: 1777,
      generation: 4, fingerprint: 'goal-four',
    };
    const cliSession = {
      agentType: 'codex_cli',
      status: 'healthy',
      activity: { kind: 'working', label: 'Working', goal: retainedGoal },
      waitingForAssistant: true,
      _codexAppServerTurn: {
        interrupt: async () => { nativeInterrupts += 1; },
      },
    };
    const cli = makeInterruptEngine('cli-owned', cliSession);
    cli.engine._handleRelayMessage({
      type: 'agent_interrupt', session_id: 'cli-owned', request_id: 'owned-request',
    });
    await flush();
    await flush();
    const cliReceipt = cli.emitted.find(item => item.type === 'agent_control_result');
    assert.equal(cliReceipt.result, 'ok');
    assert.equal(cliReceipt.native_acknowledged, true);
    assert.equal(cliReceipt.details.native_operations, 1);
    assert.equal(nativeInterrupts, 1, 'one request must produce one native interrupt');
    assert.strictEqual(cliSession.activity.goal, retainedGoal, 'interrupting a turn must preserve its goal');
    assert.equal(cliSession.activity.kind, 'idle');
    assert(!cli.emitted.some(item => item.activity?.kind === 'completed' || item.status === 'completed'),
      'interrupt must never emit a false completion');

    let stopClicks = 0;
    let idleReads = 0;
    selectors.interruptAgent = async () => {
      stopClicks += 1;
      return { ok: true, method: 'fixture_native_stop' };
    };
    selectors.detectThinking = async () => {
      idleReads += 1;
      return { thinking: false };
    };
    const domGoal = {
      state: 'active', objective: 'DOM goal remains live', token_budget: 42,
      generation: 2, fingerprint: 'dom-two',
    };
    const domSession = {
      agentType: 'claude', status: 'healthy',
      activity: { kind: 'working', label: 'Working', goal: domGoal },
      waitingForAssistant: true,
      client: { Runtime: {} },
    };
    const dom = makeInterruptEngine('dom-owned', domSession);
    dom.engine._handleRelayMessage({
      type: 'agent_interrupt', session_id: 'dom-owned', request_id: 'dom-request',
    });
    await new Promise(resolve => setTimeout(resolve, 140));
    const domReceipt = dom.emitted.find(item => item.type === 'agent_control_result');
    assert.equal(domReceipt.result, 'ok');
    assert.equal(domReceipt.native_acknowledged, true);
    assert.equal(stopClicks, 1);
    assert.equal(idleReads, 2, 'native success requires two consecutive idle observations');
    assert.strictEqual(domSession.activity.goal, domGoal);
    assert(!dom.emitted.some(item => item.activity?.kind === 'completed' || item.status === 'completed'));

    return {
      unavailable_fail_closed: true,
      native_operations: nativeInterrupts + stopClicks,
      dom_idle_observations: idleReads,
      false_completions: 0,
      goal_preserved: true,
      persisted_receipts: persisted.length,
    };
  } finally {
    sessionStore.updateSession = originalUpdateSession;
    selectors.interruptAgent = originalInterruptAgent;
    selectors.detectThinking = originalDetectThinking;
  }
}

async function main() {
  const appServer = await appServerRoundTrip();
  const dom = await domRoundTrip();
  const exactlyOnce = exactlyOnceFaultInjection();
  const matrix = stopCapabilityMatrix();
  const interrupts = await interruptProxyRoundTrips();
  console.log(JSON.stringify({
    ok: true,
    app_server_native_writes: appServer.writes,
    dom_native_clicks: dom.clicks,
    dom_surfaces: dom.surfaces,
    exactly_once: exactlyOnce,
    stop_matrix: matrix,
    interrupt_round_trips: interrupts,
    objective_and_budget_preserved: true,
    transcript_messages_appended: 0,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
