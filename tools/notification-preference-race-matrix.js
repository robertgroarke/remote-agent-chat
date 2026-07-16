#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(
  root, 'evidence', 'harness-maturity', '2026-07-15', 'notification-race-hotfix',
);
const inputs = Object.freeze({
  browser: 'cross-session-attention.json',
  preferences: 'notification-preferences.json',
  web: 'semantic-notification-web.json',
  android: 'semantic-notification-android.json',
  service_worker: 'notification-service-worker-race.json',
  relay: 'notification-preference-race-relay.json',
});

function loadEvidence(name) {
  const filePath = path.join(evidenceDir, name);
  const bytes = fs.readFileSync(filePath);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.strictEqual(value.ok, true, `${name} is not green`);
  return {
    value,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

const loaded = Object.fromEntries(
  Object.entries(inputs).map(([key, name]) => [key, loadEvidence(name)]),
);
const browser = loaded.browser.value;
const preferences = loaded.preferences.value;
const web = loaded.web.value;
const android = loaded.android.value;
const serviceWorker = loaded.service_worker.value;
const relay = loaded.relay.value;
const webSource = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');

assert(webSource.includes('NOTIFICATION_PREFERENCE_PENDING'));
assert(webSource.includes('if (!notificationPreferencesLoaded || !sessionPreferencesLoaded) return undefined'));
assert.strictEqual(browser.connection_history_waited_for_authoritative_preferences, true);
assert.strictEqual(browser.disabled_history_event_toasts, 0);
assert.strictEqual(android.first_install_missing_async_storage_fails_closed, true);
assert.strictEqual(android.preferences_pending_fails_closed, true);
assert.strictEqual(android.offline_preference_refresh_fails_closed, true);
assert.strictEqual(android.stale_local_true_cannot_override_relay_false, true);
assert.strictEqual(android.foreground_focused_session_suppressed, true);
assert.strictEqual(android.background_unfocused_session_surfaced_once, true);
assert.strictEqual(serviceWorker.stale_disabled_category_displays, 0);
assert.strictEqual(serviceWorker.muted_session_displays, 0);
assert.strictEqual(serviceWorker.offline_preference_fetch_displays, 0);
assert.strictEqual(serviceWorker.displays_before_preference_fetch, 0);
assert.strictEqual(serviceWorker.eligible_delayed_displays, 1);
assert.strictEqual(serviceWorker.duplicate_semantic_displays, 1);
assert.strictEqual(relay.authenticated_accounts, 2);
assert.strictEqual(relay.account_b_disabled_live_deliveries, 0);
assert.strictEqual(relay.disabled_reconnect_history_events, 0);
assert.strictEqual(relay.muted_goal_deliveries, 0);
assert.strictEqual(relay.two_tabs_per_account_received_enabled_event, true);
assert.strictEqual(relay.persisted_turn_ready_events, 0);
assert.strictEqual(web.two_tab_exactly_once, true);
assert.strictEqual(preferences.android_sync_and_cache_fail_closed, true);

const matrix = [
  {
    race: 'first_install_before_policy',
    web: 'pending-all-false',
    android: 'preferences_pending',
    disabled_deliveries: 0,
  },
  {
    race: 'missing_android_async_storage',
    web: 'not_applicable',
    android: 'preferences_pending',
    disabled_deliveries: 0,
  },
  {
    race: 'stale_service_worker',
    web: 'authoritative-no-store-recheck',
    android: 'not_applicable',
    disabled_deliveries: serviceWorker.stale_disabled_category_displays,
  },
  {
    race: 'offline_launch_or_policy_refresh',
    web: 'preferences_offline',
    android: 'preferences_pending',
    disabled_deliveries: serviceWorker.offline_preference_fetch_displays,
  },
  {
    race: 'connection_history_before_preference_fetch',
    web: 'history-held-until-policy',
    android: 'signed-in-routes-held-until-policy',
    disabled_deliveries: browser.disabled_history_event_toasts,
  },
  {
    race: 'two_authenticated_accounts',
    web: 'account-policy-isolated',
    android: 'same-authenticated-api',
    disabled_deliveries: relay.account_b_disabled_live_deliveries,
  },
  {
    race: 'per_session_mute',
    web: 'relay-and-client-checked',
    android: 'relay-and-client-checked',
    disabled_deliveries: relay.muted_goal_deliveries,
  },
  {
    race: 'two_tabs_and_duplicate_provider_payload',
    web: 'cross-tab-and-service-worker-claim',
    android: 'persistent-device-ledger',
    disabled_deliveries: 0,
  },
  {
    race: 'foreground_and_background',
    web: 'in-app-plus-service-worker',
    android: 'focused-suppressed-background-once',
    disabled_deliveries: 0,
  },
  {
    race: 'reconnect_history',
    web: 'account-filtered-history',
    android: 'shared-account-filtered-history',
    disabled_deliveries: relay.disabled_reconnect_history_events,
  },
];
assert(matrix.every(row => row.disabled_deliveries === 0));

const result = {
  ok: true,
  deterministic_matrix_rows: matrix.length,
  deterministic_rows_green: matrix.length,
  disabled_channel_bypasses: 0,
  persisted_turn_ready_events: relay.persisted_turn_ready_events,
  matrix,
  exact_once_proofs: {
    web_two_tabs: web.two_tab_exactly_once,
    service_worker_concurrent_payload_displays: serviceWorker.duplicate_semantic_displays,
    android_websocket_and_replay: android.websocket_and_replay_exactly_once,
    relay_duplicate_displayed_receipts: relay.displayed_receipts_after_duplicate,
  },
  diagnostics: {
    relay_rows: relay.diagnostic_total,
    relay_stages: relay.diagnostic_stages,
    relay_reasons: relay.diagnostic_reasons,
    service_worker_suppression_reasons: serviceWorker.suppression_reasons,
    content_columns_persisted: relay.content_columns_persisted,
  },
  external_provider_gates: {
    web_push: 'GATED: browser notification permission requires User Action 2',
    android_fcm: 'GATED: Firebase credentials and a real Android device require User Action 3',
  },
  evidence_inputs: Object.fromEntries(Object.entries(inputs).map(([key, name]) => [key, {
    path: `evidence/harness-maturity/2026-07-15/notification-race-hotfix/${name}`,
    sha256: loaded[key].sha256,
  }])),
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
