#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const claudeCli = require('../agent-proxy/claude-cli');
const codexCli = require('../agent-proxy/codex-cli');
const cursorCli = require('../agent-proxy/cursor-cli');

const root = path.resolve(__dirname, '..');

function runtimeFor(agentType) {
  const calls = [];
  const Runtime = {
    ...(agentType === 'codex-desktop' ? {} : { _innerContextId: 1 }),
    evaluate: async payload => {
      calls.push(payload.expression);
      const isContinueSpecial = payload.expression.includes('GeneratingStop Terminal');
      if (agentType === 'continue' || agentType === 'continue_yolo') {
        return { result: { value: isContinueSpecial ? 'clicked' : 'no-btn' } };
      }
      return { result: { value: 'clicked' } };
    },
  };
  return { Runtime, calls };
}

async function main() {
  const domHarnesses = [
    'antigravity-v2', 'claude', 'claude-desktop', 'codex', 'codex-desktop',
    'gemini', 'continue', 'continue_yolo', 'roo_code', 'cline',
  ];
  const methods = {};
  for (const agentType of domHarnesses) {
    const fixture = runtimeFor(agentType);
    const result = await selectors.interruptAgent(fixture.Runtime, agentType, `stop-${agentType}`);
    assert.equal(result.ok, true, `${agentType}: ${JSON.stringify(result)}`);
    assert.equal(fixture.calls.length, 1, `${agentType} used a fallback after its native fixture matched`);
    if (agentType === 'continue' || agentType === 'continue_yolo') {
      assert(fixture.calls[0].includes('GeneratingStop Terminal'), `${agentType} missed the Continue 2.0 native stop adapter`);
    }
    methods[agentType] = result.method || 'native_selector_click';
  }

  assert.deepEqual(claudeCli.stopNativeClaudeWindow(null), {
    ok: false,
    detail: 'No owned Claude CLI process to stop',
  });
  assert.deepEqual(codexCli.stopCodexExecSession(null), {
    ok: false,
    detail: 'No owned Codex CLI process to stop',
  });
  assert.deepEqual(cursorCli.stopCursorExecSession(null), {
    ok: false,
    detail: 'No owned Cursor CLI process to stop',
  });

  const cursorFixturePath = path.join(root, 'tests', 'fixtures', 'harness-revalidation', 'cursor', '3.5.33.json');
  const cursorFixture = JSON.parse(fs.readFileSync(cursorFixturePath, 'utf8'));
  const cursorSource = fs.readFileSync(path.join(root, 'agent-proxy', 'cursor-selectors.js'), 'utf8');
  assert.equal(cursorFixture.installed_version, '3.5.33');
  assert.match(cursorFixture.captured_contract, /cancel control/);
  for (const marker of [
    "source: 'submit-stop'", "source: 'native-stop'", "source: 'stop-button'",
    "Input.dispatchMouseEvent({ type: 'mousePressed'", 'waitForSettledTranscript()',
    "code: 'interrupt_not_confirmed'",
  ]) assert(cursorSource.includes(marker), `Cursor installed-version stop contract lost ${marker}`);

  const proxySource = fs.readFileSync(path.join(root, 'agent-proxy', 'proxy-engine.js'), 'utf8');
  assert(proxySource.includes('consecutiveIdleObservations >= 2'), 'DOM stop success no longer requires two idle reads');
  assert(proxySource.includes("code: 'interrupt_unavailable'"), 'unowned CLI turns no longer fail closed');
  const interruptHandlerStart = proxySource.indexOf("if (type === 'agent_interrupt')");
  const nextHandlerStart = proxySource.indexOf("if (type === 'permission_response')", interruptHandlerStart);
  assert(interruptHandlerStart >= 0 && nextHandlerStart > interruptHandlerStart,
    'agent_interrupt handler boundary is unavailable');
  const interruptHandler = proxySource.slice(interruptHandlerStart, nextHandlerStart);
  assert(interruptHandler.includes('const interruptCapability = this._buildCapabilities(sessionData.agentType'),
    'interrupt capability gate escaped the relay control handler');
  const pollStart = proxySource.indexOf('async _pollSession(sessionId)');
  const pollEnd = proxySource.indexOf('async _pollCodexVsCodeQuestionBounded', pollStart);
  assert(pollStart >= 0 && pollEnd > pollStart, 'general poll boundary is unavailable');
  const pollSource = proxySource.slice(pollStart, pollEnd);
  assert(!pollSource.includes('interruptCapability'), 'relay interrupt capability gate leaked into the general poll loop');
  assert(!pollSource.includes('proto.agentControlResult'), 'relay control receipt leaked into the general poll loop');

  console.log(JSON.stringify({
    ok: true,
    dom_selector_round_trips: domHarnesses.length,
    dom_methods: methods,
    cursor_installed_fixture: cursorFixture.installed_version,
    cursor_trusted_click_and_settle_contract: true,
    owned_cli_stop_adapters: ['claude_cli', 'codex_cli', 'cursor_cli'],
    unowned_cli_fail_closed: true,
    consecutive_idle_observations: 2,
    interrupt_gate_scoped_to_control_handler: true,
    general_poll_control_variable_free: true,
    explicit_gates: ['antigravity', 'antigravity_panel'],
    supported_total: domHarnesses.length + 1 + 3,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
