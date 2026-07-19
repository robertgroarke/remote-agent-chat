#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const policy = require('../relay-server/fleet-work-context');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

const ROOT = path.resolve(__dirname, '..');
const AGENT_TYPES = [
  'claude', 'claude_cli', 'claude-desktop',
  'codex', 'codex_cli', 'codex-desktop',
  'cursor', 'cursor_cli',
  'gemini', 'continue', 'continue_yolo', 'roo_code', 'cline',
  'antigravity', 'antigravity_panel', 'antigravity-v2',
];
const CODEX_TYPES = new Set(['codex', 'codex_cli', 'codex-desktop']);

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function context(agentType, activity, latestUserRequest = null, capabilities = undefined) {
  return policy.projectFleetWorkContext({ agentType, activity, latestUserRequest, capabilities });
}

function main() {
  const relayPolicyPath = path.join(ROOT, 'relay-server', 'fleet-work-context.js');
  const androidPolicyPath = path.join(ROOT, 'android-app', 'lib', 'fleet-work-context.js');
  const relayBytes = fs.readFileSync(relayPolicyPath);
  const androidBytes = fs.readFileSync(androidPolicyPath);
  assert(relayBytes.equals(androidBytes), 'Android Fleet work-context policy drifted from relay/Web policy');

  const capabilityRows = AGENT_TYPES.map(agentType => {
    const expected = CODEX_TYPES.has(agentType);
    const advertised = ProxyEngine.prototype._buildCapabilities.call({}, agentType).goal_lifecycle;
    assert.strictEqual(advertised, expected, `${agentType} proxy capability mismatch`);
    assert.strictEqual(policy.goalLifecycleSupported(agentType), expected, `${agentType} fallback capability mismatch`);
    assert.strictEqual(policy.goalLifecycleSupported(agentType, { goal_lifecycle: expected }), expected);
    assert.strictEqual(policy.goalLifecycleSupported(agentType, { goal_lifecycle: !expected }), !expected,
      `${agentType} explicit capability must override mixed-version fallback`);
    return { agent_type: agentType, goal_lifecycle: expected, proxy_advertised: advertised };
  });

  const mappingRows = AGENT_TYPES.map((agentType, index) => {
    const now = Date.UTC(2026, 6, 15, 17, 0, index);
    const plan = context(agentType, {
      kind: 'working',
      updated_at: new Date(now).toISOString(),
      goal: { status: 'active', objective: `Stray ${agentType} goal`, updated_at: new Date(now).toISOString() },
      task_list: {
        total: 3,
        completed: 1,
        updated_at: new Date(now).toISOString(),
        tasks: [
          { state: 'completed', text: 'Read native state' },
          { state: 'in_progress', text: `Apply ${agentType} work context` },
          { state: 'pending', text: 'Verify parity' },
        ],
      },
    }, { text: `Older ${agentType} request`, updated_at: new Date(now - 60_000).toISOString() });
    if (CODEX_TYPES.has(agentType)) {
      assert.strictEqual(plan.kind, 'goal', `${agentType} must retain a real goal`);
      assert.strictEqual(plan.label, 'Goal');
    } else {
      assert.notStrictEqual(plan.kind, 'goal', `${agentType} rendered a forbidden goal`);
      assert(!/goal/i.test(`${plan.label} ${plan.text}`), `${agentType} leaked goal copy`);
      assert.strictEqual(plan.source, 'task_list');
      assert.deepStrictEqual({ completed: plan.completed, total: plan.total }, { completed: 1, total: 3 });
    }
    return { agent_type: agentType, projection: plan };
  });

  for (const agentType of CODEX_TYPES) {
    const withoutGoal = context(agentType, {
      kind: 'running_command',
      task_list: { tasks: [{ state: 'in_progress', text: 'Run the focused suite' }] },
    });
    assert.notStrictEqual(withoutGoal.kind, 'goal', `${agentType} invented a missing goal`);
    assert.match(withoutGoal.text, /focused suite/);
  }

  const stalePlanCurrent = context('claude', {
    kind: 'generating',
    task_list: {
      updated_at: '2026-07-15T16:00:00.000Z',
      tasks: [{ state: 'in_progress', text: 'Old plan step' }],
    },
    current: { kind: 'response', label: 'Writing the verified result', since: '2026-07-15T16:01:00.000Z' },
  });
  assert.strictEqual(stalePlanCurrent.source, 'current_response');
  assert.strictEqual(stalePlanCurrent.label, 'Current response');

  const planBeatsOlderRequest = context('cursor', {
    kind: 'working',
    task_list: {
      updated_at: '2026-07-15T16:02:00.000Z',
      tasks: [{ state: 'in_progress', text: 'Implement indexed projection' }],
    },
  }, { text: 'Older request', updated_at: '2026-07-15T16:01:00.000Z' });
  assert.strictEqual(planBeatsOlderRequest.source, 'task_list');

  const requestFallback = context('gemini', { kind: 'working', label: 'Working' }, {
    text: 'Review the production screenshot',
    updated_at: '2026-07-15T16:03:00.000Z',
  });
  assert.strictEqual(requestFallback.kind, 'request');
  assert.strictEqual(requestFallback.label, 'Request');

  const terminalCleared = context('continue', {
    kind: 'idle',
    label: 'Idle',
    task_list: { tasks: [{ state: 'completed', text: 'Finished task' }] },
  });
  assert.deepStrictEqual(
    { kind: terminalCleared.kind, text: terminalCleared.text, source: terminalCleared.source },
    { kind: 'empty', text: 'Current work unavailable', source: 'none' },
  );

  const contextCard = context('roo_code', {
    kind: 'working',
    context_card: { mode: 'Architect mode', updated_at: '2026-07-15T16:04:00.000Z' },
  });
  assert.strictEqual(contextCard.kind, 'task');
  assert.strictEqual(contextCard.label, 'Task');

  const sensitive = context('claude_cli', { kind: 'working', label: 'Working' }, {
    text: 'api_key=sk-super-secret-value',
    updated_at: '2026-07-15T16:05:00.000Z',
  });
  assert.strictEqual(sensitive.kind, 'empty');
  assert(!JSON.stringify(sensitive).includes('super-secret'));

  const bounded = context('cursor_cli', { kind: 'working', label: 'x'.repeat(2_000) });
  assert(bounded.text.length <= policy.MAX_CONTEXT_TEXT);
  assert(Buffer.byteLength(JSON.stringify(bounded), 'utf8') < 512);

  const samples = [];
  const started = performance.now();
  for (let update = 0; update < 600; update += 1) {
    const before = performance.now();
    const agentType = AGENT_TYPES[update % AGENT_TYPES.length];
    const projection = context(agentType, {
      kind: update % 3 === 0 ? 'running_command' : 'working',
      updated_at: new Date(Date.UTC(2026, 6, 15, 17, 10, update)).toISOString(),
      task_list: {
        total: 4,
        completed: update % 4,
        tasks: [{ state: 'in_progress', text: `Bounded update ${update} for ${agentType}` }],
      },
    });
    const compactActivity = { kind: 'working', label: 'Working', work_context: projection };
    assert(Buffer.byteLength(JSON.stringify(compactActivity), 'utf8') <= 1_024);
    samples.push(performance.now() - before);
  }
  const elapsedMs = performance.now() - started;
  const sorted = [...samples].sort((left, right) => left - right);
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
  assert(p95Ms < 2, `work-context projection p95 regressed to ${p95Ms.toFixed(3)} ms`);

  const result = {
    ok: true,
    supported_agent_types: AGENT_TYPES.length,
    capability_rows: capabilityRows,
    mapping_rows: mappingRows,
    non_codex_goal_render_count: mappingRows.filter(row => !CODEX_TYPES.has(row.agent_type) && row.projection.kind === 'goal').length,
    codex_goal_rows: mappingRows.filter(row => CODEX_TYPES.has(row.agent_type) && row.projection.kind === 'goal').length,
    priority_cases: {
      newer_current_over_stale_plan: stalePlanCurrent,
      structured_plan_over_older_request: planBeatsOlderRequest,
      latest_request_fallback: requestFallback,
      terminal_data_clears: terminalCleared,
      context_card_mapping: contextCard,
      sensitive_text_redacted: sensitive,
    },
    bounded_update_count: samples.length,
    projection_elapsed_ms: Number(elapsedMs.toFixed(3)),
    projection_p95_ms: Number(p95Ms.toFixed(3)),
    summary_max_bytes: 1024,
    mirror_byte_equal: true,
    mirror_sha256: sha256(relayBytes),
    generated_at: new Date().toISOString(),
  };
  const outputPath = option('--output');
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
