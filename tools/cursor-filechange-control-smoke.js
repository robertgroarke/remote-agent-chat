#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/cursor-selectors');

function runtimeReturning(sequence) {
  let index = 0;
  return {
    async evaluate() {
      const value = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return { result: { value } };
    },
    calls: () => index,
  };
}

function trustedInput() {
  const events = [];
  return {
    events,
    async dispatchMouseEvent(event) { events.push(event); },
  };
}

async function main() {
  const acceptRuntime = runtimeReturning([
    JSON.stringify({ status: 'point', detail: 'live:file-readme-md', x: 12, y: 34 }),
  ]);
  const acceptInput = trustedInput();
  const accepted = await selectors.acceptCursorFileChange(
    acceptRuntime, 'file-readme-md', acceptInput,
  );
  assert.deepStrictEqual(accepted, {
    ok: true,
    detail: 'clicked-trusted:live:file-readme-md',
  });
  assert.deepStrictEqual(
    acceptInput.events.map(event => event.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased'],
  );
  assert.equal(acceptInput.events[1].button, 'left');
  assert.equal(acceptInput.events[1].clickCount, 1);

  const rejectRuntime = runtimeReturning([
    JSON.stringify({ status: 'point', detail: 'live:file-readme-md', x: 12, y: 34 }),
    JSON.stringify({ x: 56, y: 78 }),
  ]);
  const rejectInput = trustedInput();
  const rejected = await selectors.rejectCursorFileChange(
    rejectRuntime, 'file-readme-md', rejectInput,
  );
  assert.deepStrictEqual(rejected, {
    ok: true,
    detail: 'clicked-trusted-confirmed:live:file-readme-md',
  });
  assert.deepStrictEqual(
    rejectInput.events.map(event => event.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseMoved', 'mousePressed', 'mouseReleased'],
  );
  assert.equal(rejectRuntime.calls(), 2, 'Undo must wait for and click native Confirm');

  const fallbackRuntime = runtimeReturning([
    JSON.stringify({ status: 'clicked-dom', detail: 'card:0' }),
  ]);
  assert.deepStrictEqual(
    await selectors.acceptCursorFileChange(fallbackRuntime, 'legacy-card'),
    { ok: true, detail: 'card:0' },
  );

  const missingRuntime = runtimeReturning([
    JSON.stringify({ status: 'no-btn', detail: 'file-missing' }),
  ]);
  assert.deepStrictEqual(
    await selectors.rejectCursorFileChange(missingRuntime, 'file-missing'),
    { ok: false, detail: 'file-missing' },
  );

  const engineSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
  assert(engineSource.includes('fn(sessionData.client.Runtime, changeId, sessionData.client.Input)'),
    'proxy must pass the CDP Input domain into Cursor file-change controls');

  const result = {
    ok: true,
    trusted_keep_events: acceptInput.events.length,
    trusted_undo_confirm_events: rejectInput.events.length,
    legacy_dom_fallback: true,
    missing_control_fails_closed: true,
  };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const outputPath = path.resolve(process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
