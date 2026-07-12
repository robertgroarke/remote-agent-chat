#!/usr/bin/env node
'use strict';

const assert = require('assert');
const vm = require('vm');
const selectors = require('../agent-proxy/selectors');

function makeButton({ label = '', pathD = '', disabled = false }) {
  let clicks = 0;
  const path = { getAttribute: name => name === 'd' ? pathD : null };
  const button = {
    innerText: '',
    textContent: '',
    disabled,
    getAttribute(name) {
      if (name === 'aria-label') return label;
      if (name === 'aria-disabled') return disabled ? 'true' : null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'svg path' && pathD ? [path] : [];
    },
    click() { clicks += 1; },
  };
  return { button, clicks: () => clicks };
}

function makeRuntime(button, terminalControl = null) {
  return {
    _innerContextId: 1,
    async evaluate({ expression }) {
      const document = {
        querySelector(selector) {
          return /aria-label|data-testid\*=|class\*=/.test(selector) && /stop|cancel/i.test(button.getAttribute('aria-label') || '')
            ? button
            : null;
        },
        querySelectorAll(selector) {
          if (selector === 'span' && terminalControl) return [terminalControl.label];
          if (selector === '[data-testid="submit-input-button"]' || selector === 'button') return [button];
          return [];
        },
      };
      const value = vm.runInNewContext(expression, { document });
      return { result: { value } };
    },
  };
}

async function run() {
  let terminalClicks = 0;
  const toolbar = { textContent: 'GeneratingStop TerminalCtrl⌫' };
  const terminalControl = {
    className: 'text-2xs cursor-pointer px-1.5',
    parentElement: toolbar,
    click() { terminalClicks += 1; },
  };
  const terminalLabel = { textContent: 'Stop Terminal', parentElement: terminalControl };
  const terminalResult = await selectors.interruptAgent(
    makeRuntime(makeButton({}).button, { label: terminalLabel }),
    'continue',
    'terminal-stop'
  );
  assert.deepEqual(terminalResult, { ok: true });
  assert.equal(terminalClicks, 1, 'exact Continue Stop Terminal toolbar control must be clicked once');

  const iconStop = makeButton({ pathD: 'M6 6h12v12H6 18z' });
  assert.deepEqual(await selectors.detectThinking(makeRuntime(iconStop.button), 'continue'), { thinking: true, label: 'Generating' });
  assert.deepEqual(await selectors.interruptAgent(makeRuntime(iconStop.button), 'continue', 'icon-stop'), { ok: true });
  assert.equal(iconStop.clicks(), 1, 'icon-only Continue stop control must be clicked once');

  const labelledStop = makeButton({ label: 'Stop generating' });
  assert.deepEqual(await selectors.interruptAgent(makeRuntime(labelledStop.button), 'continue', 'label-stop'), { ok: true });
  assert.equal(labelledStop.clicks(), 1, 'labelled Continue stop control must be clicked once');

  const idleSend = makeButton({ pathD: 'M12 4l8 8-8 8z' });
  assert.deepEqual(await selectors.detectThinking(makeRuntime(idleSend.button), 'continue'), { thinking: false, label: '' });
  const idleResult = await selectors.interruptAgent(makeRuntime(idleSend.button), 'continue', 'idle-send');
  assert.equal(idleResult.ok, false);
  assert.equal(idleResult.code, 'agent_not_active');
  assert.equal(idleSend.clicks(), 0, 'ordinary Continue Send button must never be clicked by interrupt');

  console.log('Continue interrupt selector smoke: PASS');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
