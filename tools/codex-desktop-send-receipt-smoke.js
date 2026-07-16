#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');

function runtimeFixture(state, prompt) {
  return {
    async evaluate({ expression }) {
      if (expression.includes('__REMOTE_AGENT_CODEX_COMPOSER_FOCUS__')) {
        return { result: { value: 'ready' } };
      }
      if (expression.includes('__REMOTE_AGENT_CODEX_COMPOSER_VERIFY__')) {
        return { result: { value: JSON.stringify({ ok: true, code: 'ready' }) } };
      }
      if (expression.includes('var _REMOTE_AGENT_RECENT_TURN_LIMIT')) {
        const matchCount = Number(state.existingMatches || 0) + (state.submitted ? 1 : 0);
        const messages = Array.from({ length: matchCount }, () => ({ role: 'user', content: prompt }));
        return { result: { value: JSON.stringify(messages) } };
      }
      if (expression.includes('function _recentUnitTextSig')) {
        return { result: { value: state.submitted ? 'u|1|fixture:user' : 'r|0' } };
      }
      throw new Error(`Unexpected Runtime.evaluate expression: ${expression.slice(0, 120)}`);
    },
  };
}

function replacementRuntimeFixture(state, prompt) {
  return {
    async evaluate({ expression }) {
      if (expression.includes('var _REMOTE_AGENT_RECENT_TURN_LIMIT')) {
        return { result: { value: JSON.stringify([{ role: 'user', content: prompt }]) } };
      }
      if (expression.includes('function _recentUnitTextSig')) {
        // Reproduce the stale cheap signature that accompanied the production
        // target rotation. The periodic bounded bypass must still confirm.
        return { result: { value: 'stale-after-target-rotation' } };
      }
      throw new Error(`Unexpected replacement Runtime.evaluate expression: ${expression.slice(0, 120)}`);
    },
  };
}

function clientFixture(state, { persistOnEnter }) {
  return {
    Input: {
      async insertText({ text }) {
        state.inserted = text;
      },
      async dispatchKeyEvent(event) {
        state.keys.push(`${event.type}:${event.key}`);
        if (persistOnEnter && event.type === 'keyDown' && event.key === 'Enter') {
          state.submitted = true;
        }
      },
    },
  };
}

async function runCase(name, persistOnEnter, existingMatches = 0) {
  const prompt = `Codex Desktop receipt fixture ${name}`;
  const state = { inserted: '', keys: [], submitted: false, existingMatches };
  const result = await selectors.sendCodexDesktopTrustedInput(
    clientFixture(state, { persistOnEnter }),
    runtimeFixture(state, prompt),
    prompt,
    `codex-desktop-send-${name}`,
    { codexConfirmationAttempts: 2, codexConfirmationIntervalMs: 1 },
  );
  assert.strictEqual(state.inserted, prompt, `${name}: trusted Input.insertText must receive the prompt`);
  assert(state.keys.includes('keyDown:Enter'), `${name}: trusted Enter keyDown must submit`);
  assert(state.keys.includes('keyUp:Enter'), `${name}: trusted Enter keyUp must submit`);
  return result;
}

async function runRotatedClientCase() {
  const prompt = 'Codex Desktop receipt fixture rotated-client';
  const state = { inserted: '', keys: [], submitted: false, currentClient: null };
  const originalRuntime = runtimeFixture(state, prompt);
  const replacementClient = { Runtime: replacementRuntimeFixture(state, prompt) };
  const originalClient = clientFixture(state, { persistOnEnter: true });
  originalClient.Runtime = originalRuntime;
  const dispatch = originalClient.Input.dispatchKeyEvent;
  originalClient.Input.dispatchKeyEvent = async event => {
    await dispatch(event);
    if (event.type === 'keyDown' && event.key === 'Enter') {
      state.currentClient = replacementClient;
    }
  };
  state.currentClient = originalClient;

  const result = await selectors.sendCodexDesktopTrustedInput(
    originalClient,
    originalRuntime,
    prompt,
    'codex-desktop-send-rotated-client',
    {
      codexConfirmationAttempts: 2,
      codexConfirmationIntervalMs: 1,
      codexConfirmationClientProvider: () => state.currentClient,
    },
  );
  assert.deepStrictEqual(result, { ok: true, method: 'cdp_input_enter_confirmed' });
}

(async () => {
  const delivered = await runCase('delivered', true);
  assert.deepStrictEqual(delivered, { ok: true, method: 'cdp_input_enter_confirmed' });

  const repeatedContent = await runCase('repeated-content', true, 1);
  assert.deepStrictEqual(repeatedContent, { ok: true, method: 'cdp_input_enter_confirmed' });

  const ambiguous = await runCase('ambiguous', false);
  assert.strictEqual(ambiguous.ok, false);
  assert.strictEqual(ambiguous.code, 'native_user_turn_not_observed');
  assert.strictEqual(ambiguous.baseline_matches, 0);

  await runRotatedClientCase();

  const unsupported = await selectors.sendCodexDesktopTrustedInput(
    {},
    { evaluate: async () => { throw new Error('DOM evaluation must not run without trusted input'); } },
    'must not be acknowledged',
    'codex-desktop-send-unsupported',
    { codexConfirmationAttempts: 1, codexConfirmationIntervalMs: 1 },
  );
  assert.strictEqual(unsupported.ok, false);
  assert.strictEqual(unsupported.code, 'not_supported');

  const trustedSource = selectors.sendCodexDesktopTrustedInput.toString();
  const dispatcherSource = selectors.sendMessage.toString();
  assert(!trustedSource.includes('.click('), 'trusted Codex Desktop send must not use ambiguous DOM click submission');
  assert(trustedSource.includes('observedMatches > baselineMatches'), 'delivery must require a new persisted user turn');
  assert(trustedSource.includes('codexConfirmationClientProvider'), 'delivery confirmation must survive a Codex Desktop CDP client rotation');
  assert(trustedSource.includes('bypassCache'), 'delivery confirmation must periodically bypass a stale Codex read signature');
  assert(dispatcherSource.includes('sendCodexDesktopTrustedInput'), 'Codex Desktop dispatch must use trusted input');

  console.log('Codex Desktop trusted send receipt smoke: PASS (persisted turn required; ambiguous submit rejected)');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
