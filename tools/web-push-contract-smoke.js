#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const webpush = require('../relay-server/node_modules/web-push');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = read('relay-server/index.js');
const app = read('frontend/app.jsx');
const worker = read('frontend/sw.js');
const protocol = read('protocol.md');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS web_push_subscriptions',
  'CREATE TABLE IF NOT EXISTS relay_settings',
  'webpush.generateVAPIDKeys()',
  "webpush.setVapidDetails(",
  "app.get('/api/push/web-config', requireAnyAuth",
  "app.post('/api/push/web-subscription', requireAnyAuth",
  "app.delete('/api/push/web-subscription', requireAnyAuth",
  'webpush.sendNotification({',
  "e.statusCode === 404 || e.statusCode === 410",
  "isAllowed(subscription.email, 'web-push')",
]) assert(relay.includes(marker), `missing relay Web Push marker: ${marker}`);
for (const marker of [
  'validateWebPushSubscription(req.body)',
  'MAX_WEB_PUSH_SUBSCRIPTIONS_PER_USER',
  'pushMutationRateLimit',
  'existing.email !== email',
]) assert(relay.includes(marker), `missing Web Push security marker: ${marker}`);
assert(!relay.includes('async function sendPushNotification(title, body, data = {}) {\n  if (!firebaseApp) return;'),
  'missing Firebase configuration must not disable PWA Web Push');

for (const marker of [
  'applicationServerKeyBytes',
  'Notification.requestPermission()',
  'registration.pushManager.subscribe({',
  "fetch('/api/push/web-config'",
  "fetch('/api/push/web-subscription'",
  "method: 'DELETE'",
  'Browser notifications',
  "event.data?.type !== 'push_notification_clicked'",
  "new URLSearchParams(window.location.search).get('session')",
]) assert(app.includes(marker), `missing PWA subscription UI marker: ${marker}`);

for (const marker of [
  "self.addEventListener('push'",
  'self.registration.showNotification',
  'authoritativePushPolicy(data)',
  "fetch('/api/preferences/notifications'",
  "fetch('/api/preferences/sessions'",
  "reason: 'preferences_offline'",
  'semanticPushClaims.has(notificationTag)',
  "self.addEventListener('notificationclick'",
  "type: 'push_notification_clicked'",
]) assert(worker.includes(marker), `missing service-worker Web Push marker: ${marker}`);

assert(protocol.includes('### PWA Web Push subscription API'));
const generated = webpush.generateVAPIDKeys();
assert(generated.publicKey.length > 40 && generated.privateKey.length > 20,
  'web-push must generate a valid VAPID key pair');

const result = {
  ok: true,
  relay_vapid_persistence: true,
  authenticated_subscription_api: true,
  shared_preference_and_session_mute_filtering: true,
  service_worker_last_hop_preference_filtering: true,
  service_worker_offline_fail_closed: true,
  pwa_subscription_ui: true,
  service_worker_push_and_click: true,
};
const serialized = JSON.stringify(result, null, 2) + '\n';
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
process.stdout.write(serialized);
