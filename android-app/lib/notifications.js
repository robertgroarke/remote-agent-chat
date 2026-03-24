// lib/notifications.js — Expo push notification registration + channel setup
//
// Two notification channels:
//   agent-idle  — agent finished a task and is waiting (HIGH importance)
//   rate-limit  — a rate limit has cleared (DEFAULT importance)
//
// The relay server targets these channelId values in its FCM payloads.

import * as Notifications from 'expo-notifications';
import * as Device        from 'expo-device';
import { RELAY_URL }      from './auth';

const PUSH_ENDPOINT = `${RELAY_URL}/fcm-token`;

// ── Android notification channels ─────────────────────────────────────────────
// Must be called before any notifications can be shown on Android.

export async function configureNotificationChannels() {
  await Notifications.setNotificationChannelAsync('agent-idle', {
    name:             'Agent Ready',
    description:      'Notifies when an agent finishes a task and is waiting for input.',
    importance:       Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#58a6ff',
    sound:            true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync('rate-limit', {
    name:        'Rate Limit Cleared',
    description: 'Notifies when a model rate limit has cleared.',
    importance:  Notifications.AndroidImportance.DEFAULT,
    sound:       false,
  });
}

// ── Permission + token registration ──────────────────────────────────────────

export async function registerForPushNotifications(jwt) {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const tokenData  = await Notifications.getExpoPushTokenAsync();
  const pushToken  = tokenData.data;

  await _uploadToken(pushToken, jwt);
  return pushToken;
}

// Listen for token rotation (FCM sometimes rotates tokens) and re-upload.
export function subscribeToTokenRefresh(jwt) {
  return Notifications.addPushTokenListener(async ({ data: newToken }) => {
    if (newToken) await _uploadToken(newToken, jwt);
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _uploadToken(pushToken, jwt) {
  try {
    const resp = await fetch(PUSH_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ token: pushToken, platform: 'android' }),
    });
    if (!resp.ok) console.warn('[notifications] Token upload failed:', resp.status);
  } catch (err) {
    console.warn('[notifications] Token upload error:', err.message);
  }
}
