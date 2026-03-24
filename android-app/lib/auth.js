// lib/auth.js — Google OAuth (native Google Sign-In + Chrome Custom Tab fallback)
//
// Primary flow (native Google Sign-In):
//   1. @react-native-google-signin opens native Google account picker
//   2. Google returns an ID token directly (no browser needed)
//   3. POST /auth/google-id-token exchanges the ID token for a 30-day app JWT
//   4. JWT stored in SecureStore
//
// Fallback flow (Chrome Custom Tab — "Link App" web flow):
//   1. openAuthSessionAsync → relay /auth/google/app → Google OAuth → relay callback
//   2. Relay redirects to agentchat://auth?token=<one-time>
//   3. POST /auth/app-token exchanges the one-time token for a 30-day JWT

import * as SecureStore  from 'expo-secure-store';
import * as WebBrowser   from 'expo-web-browser';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

export const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || 'https://agents.yourdomain.com';
const JWT_KEY          = 'app_jwt';

// Configure Google Sign-In with the web client ID (needed to get an idToken)
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

// Required for Android Chrome Custom Tab auth session completion
WebBrowser.maybeCompleteAuthSession();

// ── JWT storage ───────────────────────────────────────────────────────────────

export async function getStoredJwt() {
  try {
    const token = await SecureStore.getItemAsync(JWT_KEY);
    if (!token) return null;
    // Decode payload (no signature check — relay validates on each request)
    const [, b64] = token.split('.');
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      await SecureStore.deleteItemAsync(JWT_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

async function storeJwt(token) {
  await SecureStore.setItemAsync(JWT_KEY, token);
}

// Store a JWT received directly via deep link (no HTTP exchange needed)
export async function storeJwtDirectly(token) {
  await storeJwt(token);
}

export async function signOut() {
  try { await GoogleSignin.signOut(); } catch {}
  await SecureStore.deleteItemAsync(JWT_KEY);
}

// Returns days until JWT expiry, or null if no valid token
export async function getJwtDaysRemaining() {
  try {
    const token = await SecureStore.getItemAsync(JWT_KEY);
    if (!token) return null;
    const [, b64] = token.split('.');
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return null;
    const msRemaining = payload.exp * 1000 - Date.now();
    return Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60 * 24)));
  } catch {
    return null;
  }
}

// ── One-time token exchange (from deep link or web "Link App" button) ─────────

export async function exchangeToken(oneTime) {
  const resp = await fetch(`${RELAY_URL}/auth/app-token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token: oneTime }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Token exchange failed (${resp.status})`);
  }
  const { token } = await resp.json();
  await storeJwt(token);
  return token;
}

// ── Native Google Sign-In (primary flow) ─────────────────────────────────────

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  const idToken = response.data?.idToken;
  if (!idToken) {
    throw new Error('No ID token received from Google');
  }
  return exchangeGoogleIdToken(idToken);
}

// Exchange a Google ID token for an app JWT via the relay
export async function exchangeGoogleIdToken(idToken) {
  const resp = await fetch(`${RELAY_URL}/auth/google-id-token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id_token: idToken }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Google sign-in failed (${resp.status})`);
  }
  const { token } = await resp.json();
  await storeJwt(token);
  return token;
}

// ── Chrome Custom Tab fallback flow ───────────────────────────────────────────

export async function signInWithCustomTab() {
  const result = await WebBrowser.openAuthSessionAsync(
    `${RELAY_URL}/auth/google/app`,
    'agentchat://auth',
  );

  if (result.type !== 'success') {
    throw new Error('Sign-in cancelled or failed');
  }

  const url     = new URL(result.url);
  const oneTime = url.searchParams.get('token');
  if (!oneTime) throw new Error('No token in redirect — auth may have failed');

  return exchangeToken(oneTime);
}

// Re-export statusCodes for error handling in screens
export { statusCodes };
