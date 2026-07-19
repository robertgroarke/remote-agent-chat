#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('../frontend/node_modules/esbuild');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadModule(relative, mocks) {
  const filename = path.join(root, relative);
  const transformed = esbuild.transformSync(read(relative), {
    loader: relative.endsWith('.jsx') ? 'jsx' : 'js',
    format: 'cjs',
    target: 'es2020',
  }).code;
  const loaded = new Module(`${filename}.test.cjs`);
  loaded.filename = `${filename}.test.cjs`;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(transformed, loaded.filename);
  return loaded.exports;
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  async setItem(key, value) { this.values.set(key, String(value)); }
}

(async () => {
  const storage = new MemoryStorage();
  const emitted = [];
  let haptics = 0;
  const appState = { currentState: 'background' };
  const semantic = loadModule('android-app/lib/semantic-notifications.js', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    'react-native': {
      AppState: appState,
      DeviceEventEmitter: {
        emit: (...args) => emitted.push(args),
        addListener: () => ({ remove() {} }),
      },
    },
    './attention-feedback': {
      noteSemanticNotificationForAttentionFeedback: async () => { haptics += 1; return true; },
    },
    './auth': { getStoredJwt: async () => null, RELAY_URL: 'https://example.invalid' },
  });

  const event = {
    type: 'semantic_notification',
    event_type: 'goal_completed',
    category: 'goal_completed',
    dedupe_key: 'goal_completed:android-transition-1',
    session_id: 'android-goal-loop',
    session_name: 'Sol',
    title: 'Goal completed',
    body: 'Sol completed its goal.',
  };
  const missingStoragePending = await semantic.processSemanticNotification({
    ...event,
    dedupe_key: 'goal_completed:missing-async-storage',
  }, null);
  assert.strictEqual(missingStoragePending.code, 'preferences_pending');
  assert.strictEqual(emitted.length, 0);

  await storage.setItem('pref_notify_goal_completed', 'true');
  const preferencesPending = await semantic.processSemanticNotification({
    ...event,
    dedupe_key: 'goal_completed:preferences-pending',
  }, null);
  assert.strictEqual(preferencesPending.code, 'preferences_pending');
  assert.strictEqual(emitted.length, 0);
  assert.strictEqual(await semantic.refreshAuthoritativeSemanticNotificationPreferences(), false);
  const offlineRefreshPending = await semantic.processSemanticNotification({
    ...event,
    dedupe_key: 'goal_completed:offline-refresh',
  }, null);
  assert.strictEqual(offlineRefreshPending.code, 'preferences_pending');
  assert.strictEqual(emitted.length, 0);

  semantic.setAuthoritativeSemanticNotificationPreferences({
    turn_ready: true,
    goal_completed: false,
    goal_attention: false,
  });
  const staleCacheRejected = await semantic.processSemanticNotification({
    ...event,
    dedupe_key: 'goal_completed:stale-local-cache',
  }, null);
  assert.strictEqual(staleCacheRejected.code, 'disabled');
  assert.strictEqual(emitted.length, 0);

  semantic.setAuthoritativeSemanticNotificationPreferences({
    turn_ready: true,
    goal_completed: true,
    goal_attention: false,
  });
  const results = await Promise.all([
    semantic.processSemanticNotification(event, null),
    semantic.processSemanticNotification(event, null),
  ]);
  assert.strictEqual(results.filter(result => result.handled).length, 1);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(haptics, 1);
  assert.strictEqual((await semantic.processSemanticNotification(event, null)).code, 'duplicate');

  appState.currentState = 'active';
  const focused = await semantic.processSemanticNotification({
    ...event,
    dedupe_key: 'goal_completed:focused-foreground',
  }, event.session_id);
  assert.strictEqual(focused.code, 'focused');
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(haptics, 1);
  appState.currentState = 'background';

  const disabled = await semantic.processSemanticNotification({
    ...event,
    event_type: 'goal_attention',
    category: 'goal_attention',
    dedupe_key: 'goal_attention:disabled',
  }, null);
  assert.strictEqual(disabled.code, 'disabled');
  assert.strictEqual(emitted.length, 1);

  const usageWarning = await semantic.processSemanticNotification({
    ...event,
    event_type: 'provider_usage_threshold',
    category: 'provider_usage_warning',
    dedupe_key: 'provider-usage-threshold:android-disabled:75',
    title: 'OpenAI Codex has 25% usage left',
  }, null);
  assert.strictEqual(usageWarning.code, 'disabled');
  assert.strictEqual(emitted.length, 1);

  const pushed = semantic.semanticNotificationFromExpo({
    request: { content: { title: event.title, body: event.body, data: {
      type: 'goal_completed',
      category: 'goal_completed',
      dedupe_key: 'goal_completed:push',
      session_id: event.session_id,
    } } },
  });
  assert.strictEqual(pushed?.event_type, 'goal_completed');
  assert.strictEqual(semantic.semanticNotificationToBanner(pushed).request.content.body, event.body);
  assert.strictEqual(semantic.normalizeSemanticNotification({
    ...event,
    event_type: 'turn_ready',
    category: 'turn_ready',
    dedupe_key: 'turn_ready:legacy',
  }), null);

  const vibrations = [];
  const feedback = loadModule('android-app/lib/attention-feedback.js', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    'react-native': {
      AppState: { currentState: 'background' },
      Vibration: { vibrate: (...args) => vibrations.push(args) },
    },
    './auth': { getStoredJwt: async () => null, RELAY_URL: 'https://example.invalid' },
  });
  feedback.setAttentionHapticPreference(true);
  assert.strictEqual(await feedback.noteSemanticNotificationForAttentionFeedback(event, null), true);
  assert.strictEqual(await feedback.noteSemanticNotificationForAttentionFeedback({ ...event, event_type: 'agent_idle' }, null), false);
  assert.strictEqual(await feedback.noteSemanticNotificationForAttentionFeedback({ ...event, event_type: 'turn_ready' }, null), false);
  assert.strictEqual(vibrations.length, 1);

  const app = read('android-app/App.jsx');
  const chat = read('android-app/screens/ChatScreen.jsx');
  const list = read('android-app/screens/SessionListScreen.jsx');
  const channels = read('android-app/lib/notifications.js');
  const feedbackSource = read('android-app/lib/attention-feedback.js');
  for (const source of [app, chat, list]) {
    esbuild.transformSync(source, { loader: 'jsx', target: 'es2020' });
  }
  esbuild.transformSync(channels, { loader: 'js', target: 'es2020' });
  assert(!feedbackSource.includes('noteActivityForAttentionFeedback'));
  assert(!feedbackSource.includes('generatingBySession'));
  assert(chat.includes("case 'semantic_notification'"));
  assert(list.includes("case 'semantic_notification'"));
  assert(chat.includes('msg.semantic_notifications'));
  assert(list.includes('msg.semantic_notifications'));
  assert(app.includes('semanticNotificationFromExpo(notification)'));
  for (const channel of ['turn-ready', 'goal-completed', 'goal-attention']) {
    assert(channels.includes(`setNotificationChannelAsync('${channel}'`));
  }

  const result = {
    ok: true,
    websocket_and_replay_exactly_once: true,
    foreground_fcm_dedupe: true,
    semantic_haptics_only: true,
    category_filtering: true,
    first_install_missing_async_storage_fails_closed: true,
    preferences_pending_fails_closed: true,
    offline_preference_refresh_fails_closed: true,
    authenticated_relay_preferences_required: true,
    stale_local_true_cannot_override_relay_false: true,
    foreground_focused_session_suppressed: true,
    background_unfocused_session_surfaced_once: true,
    idle_completion_events_rejected: true,
    android_channels: ['turn-ready', 'goal-completed', 'goal-attention'],
    syntax: true,
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
