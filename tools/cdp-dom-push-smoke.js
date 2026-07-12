'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  CdpDomPushManager,
  observerExpression,
} = require('../agent-proxy/cdp-dom-push');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fakeRuntime() {
  const bindingListeners = new Set();
  const clearedListeners = new Set();
  return {
    addBindingCalls: [],
    evaluateCalls: [],
    removeBindingCalls: [],
    async addBinding(params) { this.addBindingCalls.push(params); },
    async evaluate(params) {
      this.evaluateCalls.push(params);
      return { result: { value: { ok: true, reused: false } } };
    },
    async removeBinding(params) { this.removeBindingCalls.push(params); },
    bindingCalled(listener) {
      bindingListeners.add(listener);
      return () => bindingListeners.delete(listener);
    },
    executionContextsCleared(listener) {
      clearedListeners.add(listener);
      return () => clearedListeners.delete(listener);
    },
    emitBinding(event) { for (const listener of bindingListeners) listener(event); },
    emitContextsCleared() { for (const listener of clearedListeners) listener(); },
  };
}

async function main() {
  const runtime = fakeRuntime();
  const dispatches = [];
  let releaseFirst;
  const firstPoll = new Promise(resolve => { releaseFirst = resolve; });
  const manager = new CdpDomPushManager({
    policy: { debounceMs: 5, reinstallMs: 5 },
    onDirty: async (sessionId, event) => {
      dispatches.push({ sessionId, event });
      if (dispatches.length === 1) await firstPoll;
    },
  });

  const attached = await manager.attach('session-a', { Runtime: runtime }, { contextId: 42 });
  assert.deepStrictEqual(attached, { ok: true, reused: false });
  assert.deepStrictEqual(runtime.addBindingCalls, [{ name: '__racDomChanged' }]);
  assert.strictEqual(runtime.evaluateCalls.length, 1);
  assert.strictEqual(runtime.evaluateCalls[0].contextId, 42);
  assert.match(runtime.evaluateCalls[0].expression, /MutationObserver/);
  assert.match(runtime.evaluateCalls[0].expression, /characterData: true/);

  const expression = observerExpression('__binding', '__observer', 'token-a');
  assert.match(expression, /source_at: Date\.now\(\)/);
  assert.doesNotMatch(expression, /innerHTML|innerText|textContent/);

  const token = JSON.parse(runtime.evaluateCalls[0].expression.match(/token === ("[a-f0-9]+")/)[1]);
  const emit = sequence => runtime.emitBinding({
    name: '__racDomChanged',
    payload: JSON.stringify({ token, sequence, source_at: Date.now() }),
  });
  emit(1);
  emit(2);
  emit(3);
  await wait(15);
  assert.strictEqual(dispatches.length, 1, 'burst mutations should debounce to one poll');
  emit(4);
  await wait(10);
  assert.strictEqual(dispatches.length, 1, 'in-flight poll should coalesce follow-up mutations');
  releaseFirst();
  await wait(15);
  assert.strictEqual(dispatches.length, 2, 'one follow-up poll should run after the in-flight poll');
  assert.strictEqual(dispatches[1].event.sequence, 4);

  const now = 1_000_000;
  const idle = { agentType: 'codex', activity: { kind: 'idle' } };
  const working = { agentType: 'codex', activity: { kind: 'generating' } };
  manager.notePoll('session-a', idle, now);
  assert.strictEqual(manager.shouldRunFallback('session-a', working, now + 4_999), false);
  assert.strictEqual(manager.shouldRunFallback('session-a', working, now + 5_000), true);
  assert.strictEqual(manager.shouldRunFallback('session-a', idle, now + 29_999), false);
  assert.strictEqual(manager.shouldRunFallback('session-a', idle, now + 30_000), true);
  assert.strictEqual(manager.shouldRunFallback('missing', working, now + 749), false);
  assert.strictEqual(manager.shouldRunFallback('missing', working, now + 750), true);

  runtime.emitContextsCleared();
  await wait(15);
  assert.strictEqual(runtime.evaluateCalls.length, 2, 'context reset should reinstall observer');

  await manager.detach('session-a');
  assert.deepStrictEqual(runtime.removeBindingCalls, [{ name: '__racDomChanged' }]);
  assert.strictEqual(manager.getState('session-a'), null);

  const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
  for (const marker of [
    'new CdpDomPushManager({',
    'async _handleDomPush(sessionId, event)',
    'async _runAdaptivePollCycle(sessionId, options = {})',
    'await this._syncDomPushObservers()',
    'this._domPush.close().catch(() => {})',
  ]) assert(proxySource.includes(marker), `missing proxy integration marker: ${marker}`);

  const result = {
    ok: true,
    burst_events: 4,
    dispatched_polls: dispatches.length,
    observer_working_fallback_ms: 5000,
    observer_idle_fallback_ms: 30000,
    binding_unavailable_working_fallback_ms: 750,
    binding_unavailable_idle_fallback_ms: 5000,
    context_reinstall_verified: true,
    proxy_engine_integrated: true,
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const outputPath = path.resolve(process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
