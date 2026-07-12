#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const android = fs.readFileSync(path.join(root, 'android-app/lib/notifications.js'), 'utf8');
const relay = fs.readFileSync(path.join(root, 'relay-server/index.js'), 'utf8');

assert(android.includes('Notifications.getDevicePushTokenAsync()'),
  'Android must request the native device push token used by Firebase Admin');
assert(!android.includes('Notifications.getExpoPushTokenAsync()'),
  'Expo push tokens are not valid Firebase Admin registration tokens');
assert(android.includes("tokenData.type !== 'fcm'"),
  'initial registration must reject a non-FCM native token');
assert(android.includes("tokenData?.type === 'fcm'"),
  'token refresh must reject a non-FCM native token');
assert(android.includes("JSON.stringify({ fcm_token: pushToken, platform: 'android' })"),
  'Android upload payload must use the relay fcm_token field');
assert(relay.includes("const { fcm_token, platform = 'android' } = req.body || {}"),
  'relay must accept the Android fcm_token field');
for (const channel of ['permission-required', 'agent-idle', 'agent-error', 'session-offline', 'rate-limit']) {
  assert(android.includes(`setNotificationChannelAsync('${channel}'`),
    `Android must configure the ${channel} channel`);
  assert(relay.includes(`channelId: '${channel}'`),
    `relay must target the ${channel} channel`);
}
assert(!relay.includes("data.type === 'agent_idle' ? 'agent_idle' : 'rate_limit'"),
  'legacy underscore channel IDs must not return');

console.log(JSON.stringify({
  ok: true,
  token_kind: 'native-fcm',
  upload_field: 'fcm_token',
  channels: ['permission-required', 'agent-idle', 'agent-error', 'session-offline', 'rate-limit'],
}, null, 2));
