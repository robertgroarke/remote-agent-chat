#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'frontend', 'sw.js'), 'utf8');
const listeners = new Map();
const displayed = [];
const receipts = [];
let policy = {
  notification: { goal_completed: false, goal_attention: false, session_offline: false },
  sessions: {},
  offline: false,
  notificationGate: null,
  sessionGate: null,
};

function response(body, ok = true) {
  return { ok, json: async () => body };
}

async function fetchMock(route, options = {}) {
  if (route === '/api/notifications/semantic-receipts') {
    receipts.push(JSON.parse(options.body));
    return response({ ok: true });
  }
  if (policy.offline) throw new Error('offline fixture');
  if (route === '/api/preferences/notifications') {
    if (policy.notificationGate) await policy.notificationGate;
    return response({ preferences: policy.notification });
  }
  if (route === '/api/preferences/sessions') {
    if (policy.sessionGate) await policy.sessionGate;
    return response({ preferences: policy.sessions });
  }
  throw new Error(`unexpected fetch ${route}`);
}

const registration = {
  async getNotifications({ tag } = {}) {
    return tag ? displayed.filter(entry => entry.options.tag === tag) : displayed.slice();
  },
  async showNotification(title, options) {
    displayed.push({ title, options });
  },
};
const self = {
  addEventListener(type, listener) { listeners.set(type, listener); },
  registration,
  clients: {},
  skipWaiting: async () => {},
};
vm.runInNewContext(workerSource, {
  self,
  fetch: fetchMock,
  caches: {},
  location: { origin: 'https://example.test' },
  URL,
  Promise,
  Set,
  Object,
  String,
}, { filename: 'frontend/sw.js' });

function payload({
  type = 'goal_completed',
  category = type,
  dedupeKey = `goal_completed:${Date.now()}`,
  sessionId = 'service-worker-race',
} = {}) {
  return {
    title: type === 'goal_completed' ? 'Goal completed' : 'Remote Agent Chat',
    body: 'Safe fixture body',
    data: {
      type,
      category,
      dedupe_key: dedupeKey,
      session_id: sessionId,
    },
  };
}

function dispatchPush(value) {
  let lifetime = null;
  listeners.get('push')({
    data: { json: () => value, text: () => JSON.stringify(value) },
    waitUntil(promise) { lifetime = Promise.resolve(promise); },
  });
  return lifetime || Promise.resolve();
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

(async () => {
  const disabledStart = displayed.length;
  await dispatchPush(payload({ dedupeKey: 'goal_completed:disabled' }));
  assert.strictEqual(displayed.length, disabledStart, 'disabled category displayed from stale push');

  policy.notification.goal_completed = true;
  policy.sessions = { 'service-worker-race': { muted: true } };
  await dispatchPush(payload({ dedupeKey: 'goal_completed:muted' }));
  assert.strictEqual(displayed.length, disabledStart, 'muted session displayed from stale push');

  policy.sessions = {};
  policy.offline = true;
  await dispatchPush(payload({ dedupeKey: 'goal_completed:offline' }));
  assert.strictEqual(displayed.length, disabledStart, 'offline preference fetch failed open');
  policy.offline = false;

  const notificationGate = deferred();
  const sessionGate = deferred();
  policy.notificationGate = notificationGate.promise;
  policy.sessionGate = sessionGate.promise;
  const delayed = dispatchPush(payload({ dedupeKey: 'goal_completed:delayed' }));
  await Promise.resolve();
  assert.strictEqual(displayed.length, disabledStart, 'push displayed before preferences resolved');
  notificationGate.resolve();
  sessionGate.resolve();
  await delayed;
  assert.strictEqual(displayed.length, disabledStart + 1, 'eligible delayed push did not display');
  policy.notificationGate = null;
  policy.sessionGate = null;

  const duplicatePayload = payload({ dedupeKey: 'goal_completed:duplicate' });
  await Promise.all([dispatchPush(duplicatePayload), dispatchPush(duplicatePayload)]);
  assert.strictEqual(
    displayed.filter(entry => entry.options.tag === 'semantic:goal_completed:duplicate').length,
    1,
    'duplicate service-worker push displayed more than once',
  );

  const afterSemantic = displayed.length;
  await dispatchPush(payload({ type: 'agent_idle', category: 'agent_ready', dedupeKey: 'agent-idle:legacy' }));
  await dispatchPush(payload({ type: 'turn_ready', dedupeKey: 'turn-ready:legacy' }));
  assert.strictEqual(displayed.length, afterSemantic, 'legacy completion payload displayed');

  policy.notification.session_offline = false;
  await dispatchPush(payload({
    type: 'session_offline',
    category: 'session_offline',
    dedupeKey: '',
  }));
  assert.strictEqual(displayed.length, afterSemantic, 'disabled non-semantic category displayed');

  const suppressionReasons = receipts
    .filter(receipt => receipt.stage === 'suppressed')
    .map(receipt => receipt.reason_code);
  for (const expected of ['client_preference', 'session_muted', 'preferences_offline', 'client_duplicate']) {
    assert(suppressionReasons.includes(expected), `missing ${expected} suppression receipt`);
  }

  const result = {
    ok: true,
    stale_disabled_category_displays: 0,
    muted_session_displays: 0,
    offline_preference_fetch_displays: 0,
    displays_before_preference_fetch: 0,
    eligible_delayed_displays: 1,
    duplicate_semantic_displays: 1,
    legacy_completion_displays: 0,
    disabled_nonsemantic_displays: 0,
    suppression_reasons: [...new Set(suppressionReasons)].sort(),
    visible_windows_opened: 0,
    focus_actions: 0,
    production_mutations: 0,
    generated_at: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const outputPath = path.resolve(process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
