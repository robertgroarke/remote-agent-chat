#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('../frontend/node_modules/esbuild');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadHelper() {
  const source = read('frontend/semantic-notifications.js');
  const transformed = esbuild.transformSync(source, {
    loader: 'js',
    format: 'cjs',
    target: 'es2020',
  }).code;
  const loaded = new Module(path.join(root, 'frontend', 'semantic-notifications.test.cjs'));
  loaded.filename = path.join(root, 'frontend', 'semantic-notifications.test.cjs');
  loaded.paths = Module._nodeModulePaths(path.join(root, 'frontend'));
  loaded._compile(transformed, loaded.filename);
  return loaded.exports;
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class SerializedLocks {
  constructor() { this.tail = Promise.resolve(); }
  request(_name, _options, callback) {
    const next = this.tail.then(callback);
    this.tail = next.catch(() => {});
    return next;
  }
}

(async () => {
  const helper = loadHelper();
  const base = {
    type: 'semantic_notification',
    event_type: 'goal_completed',
    category: 'goal_completed',
    dedupe_key: 'goal_completed:transition-1',
    session_id: 'codex-goal-loop',
    title: 'Goal completed',
    body: 'Sol completed its goal.',
    created_at: '2026-07-15T12:00:00.000Z',
  };
  assert.strictEqual(helper.normalizeSemanticNotification(base)?.event_type, 'goal_completed');
  assert.strictEqual(helper.normalizeSemanticNotification({ ...base, event_type: 'agent_idle' }), null);
  assert.strictEqual(helper.normalizeSemanticNotification({
    ...base,
    event_type: 'turn_ready',
    category: 'turn_ready',
    dedupe_key: 'turn_ready:legacy',
  }), null);
  assert.strictEqual(helper.normalizeSemanticNotification({ ...base, category: 'turn_ready' }), null);
  assert.strictEqual(helper.semanticNotificationAllowed(base, { goal_completed: true }), true);
  assert.strictEqual(helper.semanticNotificationAllowed(base, { goal_completed: false }), false);
  assert.strictEqual(helper.semanticNotificationAllowed(base, {}), false);
  assert.strictEqual(helper.mergeSemanticNotifications([base], [base, { ...base, title: 'Goal completed' }]).length, 1);

  const storage = new MemoryStorage();
  const locks = new SerializedLocks();
  const claims = await Promise.all([
    helper.claimSemanticNotification(base, { storage, locks, now: () => 1784116800000 }),
    helper.claimSemanticNotification(base, { storage, locks, now: () => 1784116800001 }),
  ]);
  assert.deepStrictEqual(claims, [true, false], 'two tabs must surface one semantic notification');
  assert.strictEqual(await helper.claimSemanticNotification(base, {
    storage,
    locks: new SerializedLocks(),
    now: () => 1784116800002,
  }), false, 'reload/reconnect replay must remain consumed');

  const fallbackStorage = new MemoryStorage();
  const fallbackClaims = await Promise.all([
    helper.claimSemanticNotification({ ...base, dedupe_key: 'fallback-race' }, {
      storage: fallbackStorage, locks: null, now: () => 1784116800010,
    }),
    helper.claimSemanticNotification({ ...base, dedupe_key: 'fallback-race' }, {
      storage: fallbackStorage, locks: null, now: () => 1784116800011,
    }),
  ]);
  assert.strictEqual(fallbackClaims.filter(Boolean).length, 1, 'storage fallback must settle on one claimant');

  const app = read('frontend/app.jsx');
  const hooks = read('frontend/hooks.jsx');
  const worker = read('frontend/sw.js');
  assert(!app.includes('Session completed'));
  assert(!app.includes('previousThinkingRef'));
  assert(!app.includes('thinkingAttentionReadyRef'));
  assert(app.includes('claimSemanticNotification(event)'));
  assert(app.includes('semanticNotificationAllowed(event, attentionFeedbackPreferences)'));
  assert(hooks.includes("if (t === 'semantic_notification')"));
  assert(hooks.includes('msg.semantic_notifications'));
  assert(worker.includes('data.dedupe_key'));
  assert(worker.includes('renotify: !semanticType'));
  assert(worker.includes("['agent_idle', 'turn_ready']"));
  assert(worker.includes('/session completed/i'));

  const result = {
    ok: true,
    live_and_replay_reducer_dedupe: true,
    two_tab_exactly_once: true,
    storage_fallback_exactly_once: true,
    local_thinking_completion_inference_removed: true,
    service_worker_semantic_dedupe: true,
    legacy_and_idle_completion_rejected: true,
  };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const outputPath = path.resolve(process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
