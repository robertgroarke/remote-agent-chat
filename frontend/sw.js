'use strict';

const CACHE_NAME = 'agent-chat-build-f373cfbec8de1f2d';
const ASSET_VERSION = 'build-f373cfbec8de1f2d';

const SHELL_ASSETS = [
  '/',
  `/styles.css?v=${ASSET_VERSION}`,
  `/dist/bundle.js?v=${ASSET_VERSION}`,
  '/manifest.json',
  '/icon.png',
  '/logo-antigravity.svg',
  '/logo-codex.svg',
  '/logo-cline.svg',
  '/logo-claude-in-ag.svg',
  '/logo-codex-in-ag.svg',
  '/logo-gemini-in-ag.svg',
  '/provider-assets/openai-light.png',
  '/provider-assets/openai-dark.png',
  '/provider-assets/claude-color.svg',
  '/provider-assets/cursor-light.svg',
  '/provider-assets/cursor-dark.svg',
  '/provider-assets/antigravity-color.png',
  '/provider-assets/ollama-light.png',
];

const VERSIONED_SHELL_ASSETS = new Set(SHELL_ASSETS.filter(asset => asset.includes('?')));

const PUSH_CATEGORY_BY_TYPE = Object.freeze({
  permission_required: 'permission_required',
  goal_completed: 'goal_completed',
  goal_attention: 'goal_attention',
  provider_usage_threshold: 'provider_usage_warning',
  agent_error: 'agent_error',
  rate_limit_active: 'agent_error',
  proxy_watchdog_failed: 'agent_error',
  app_update_fail: 'agent_error',
  session_offline: 'session_offline',
  proxy_offline: 'session_offline',
  proxy_recovered: 'session_offline',
  rate_limit_cleared: 'rate_limit_cleared',
  rate_limit_resumed: 'rate_limit_cleared',
  app_update_pass: 'agent_ready',
});
const semanticPushClaims = new Set();
const SEMANTIC_PUSH_TYPES = new Set(['goal_completed', 'goal_attention', 'provider_usage_threshold']);

async function authoritativePushPolicy(data) {
  const type = String(data?.type || '').trim();
  const category = String(data?.category || PUSH_CATEGORY_BY_TYPE[type] || '').trim();
  if (!category) return { allowed: true, reason: '' };
  if (type === 'turn_ready' || category === 'turn_ready') {
    return { allowed: false, reason: 'unsupported_turn_ready' };
  }
  if (SEMANTIC_PUSH_TYPES.has(type) && category !== PUSH_CATEGORY_BY_TYPE[type]) {
    return { allowed: false, reason: 'invalid_category' };
  }
  try {
    const [notificationResponse, sessionResponse] = await Promise.all([
      fetch('/api/preferences/notifications', {
        credentials: 'include',
        cache: 'no-store',
      }),
      fetch('/api/preferences/sessions', {
        credentials: 'include',
        cache: 'no-store',
      }),
    ]);
    if (!notificationResponse.ok || !sessionResponse.ok) {
      return { allowed: false, reason: 'preferences_unavailable' };
    }
    const [notificationBody, sessionBody] = await Promise.all([
      notificationResponse.json().catch(() => ({})),
      sessionResponse.json().catch(() => ({})),
    ]);
    if (notificationBody.preferences?.[category] !== true) {
      return { allowed: false, reason: 'client_preference' };
    }
    const sessionId = String(data?.session_id || data?.session || '').trim();
    if (sessionId && sessionBody.preferences?.[sessionId]?.muted === true) {
      return { allowed: false, reason: 'session_muted' };
    }
    return { allowed: true, reason: '' };
  } catch {
    return { allowed: false, reason: 'preferences_offline' };
  }
}

async function recordSemanticStage(data, stage) {
  if (!data?.dedupe_key || !['claimed', 'displayed', 'suppressed'].includes(stage)) return false;
  try {
    const response = await fetch('/api/notifications/semantic-receipts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dedupe_key: data.dedupe_key,
        stage,
        channel: 'web-service-worker',
        client_id: 'service-worker',
        ...(data.reason_code ? { reason_code: data.reason_code } : {}),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ── Install: cache shell assets ───────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clear old caches ────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first with shell fallback ──────────────────────────────────

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const data = payload.data || {};
  if (['agent_idle', 'turn_ready'].includes(String(data.type || '').trim())
    || /session completed/i.test(`${payload.title || ''} ${payload.body || ''}`)) {
    return;
  }
  const semanticType = SEMANTIC_PUSH_TYPES.has(data.type);
  const notificationTag = semanticType && data.dedupe_key
    ? `semantic:${data.dedupe_key}`
    : `${data.type || 'agent-update'}:${data.session_id || ''}`;
  event.waitUntil((async () => {
    const policy = await authoritativePushPolicy(data);
    if (!policy.allowed) {
      if (semanticType) {
        await recordSemanticStage({ ...data, reason_code: policy.reason }, 'suppressed');
      }
      return;
    }
    if (semanticType) {
      if (semanticPushClaims.has(notificationTag)) {
        await recordSemanticStage({ ...data, reason_code: 'client_duplicate' }, 'suppressed');
        return;
      }
      semanticPushClaims.add(notificationTag);
      if (typeof self.registration.getNotifications === 'function') {
        const existing = await self.registration.getNotifications({ tag: notificationTag });
        if (existing.length > 0) {
          await recordSemanticStage({ ...data, reason_code: 'client_duplicate' }, 'suppressed');
          return;
        }
      }
    }
    const claimedReceipt = semanticType ? recordSemanticStage(data, 'claimed') : Promise.resolve(false);
    try {
      await self.registration.showNotification(payload.title || 'Remote Agent Chat', {
        body: payload.body || 'An agent needs your attention.',
        icon: '/icon.png',
        badge: '/icon.png',
        tag: notificationTag,
        renotify: !semanticType,
        data,
      });
    } catch (error) {
      if (semanticType) semanticPushClaims.delete(notificationTag);
      throw error;
    }
    if (semanticType) {
      await Promise.allSettled([claimedReceipt, recordSemanticStage(data, 'displayed')]);
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const sessionQuery = data.session_id ? `?session=${encodeURIComponent(data.session_id)}` : '';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.postMessage({ type: 'push_notification_clicked', data });
      return existing.focus();
    }
    return self.clients.openWindow(`/${sessionQuery}`);
  }));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept: authenticated APIs, WebSocket upgrades, auth routes, uploads, non-GET
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/client-ws') ||
    url.pathname.startsWith('/proxy-ws') ||
    url.pathname.startsWith('/uploads') ||
    url.pathname.startsWith('/health') ||
    url.origin !== location.origin
  ) {
    return;
  }

  // Navigation requests: network-first so OAuth redirects always work;
  // fall back to cached shell on complete offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Versioned build artifacts are immutable. Serve them directly from the
  // warm PWA cache; a new HTML cache key and cache generation activate every
  // deployed frontend revision.
  if (VERSIONED_SHELL_ASSETS.has(`${url.pathname}${url.search}`)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Shell JS/CSS should be network-first so UI fixes aren't masked by stale SW cache.
  if (
    url.pathname === '/styles.css' ||
    url.pathname === '/dist/bundle.js'
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Other static shell assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
