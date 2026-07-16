#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');

function fixture({ clickAvailable }) {
  const state = { clicked: false, shortcutEvents: [] };
  const Runtime = {
    _cdp: {
      Input: {
        async dispatchKeyEvent(event) {
          state.shortcutEvents.push(`${event.type}:${event.key}`);
          if (event.type === 'keyDown' && event.key === 'N') state.clicked = true;
        },
      },
    },
    async evaluate({ expression }) {
      if (expression.includes('var actionRows = Array.from')) {
        return {
          result: {
            value: JSON.stringify([{ id: 'local:fixture', title: 'Fixture', active: !state.clicked, index: 0 }]),
          },
        };
      }
      if (expression.includes('function dispatchPress(el)')) {
        if (clickAvailable) state.clicked = true;
        return { result: { value: clickAvailable ? 'clicked' : 'not-found' } };
      }
      if (expression.includes('blankComposer:')) {
        return { result: { value: JSON.stringify({ body: '', blankComposer: false }) } };
      }
      throw new Error(`Unexpected Runtime.evaluate expression: ${expression.slice(0, 120)}`);
    },
  };
  return { Runtime, state };
}

(async () => {
  const click = fixture({ clickAvailable: true });
  assert.strictEqual(await selectors.newCodexThread(click.Runtime, true), true);
  assert.strictEqual(click.state.clicked, true);
  assert.deepStrictEqual(
    click.state.shortcutEvents,
    [],
    'successful native new-thread click must not be followed by Ctrl+Shift+N',
  );

  const fallback = fixture({ clickAvailable: false });
  assert.strictEqual(await selectors.newCodexThread(fallback.Runtime, true), true);
  assert(fallback.state.shortcutEvents.includes('keyDown:N'), 'missing native control must use the keyboard fallback');
  assert(fallback.state.shortcutEvents.includes('keyUp:N'), 'keyboard fallback must release N');

  console.log('Codex Desktop new-thread control smoke: PASS (native click is single-action; shortcut is fallback-only)');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
