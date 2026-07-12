'use strict';

const CACHE_NAME = 'agent-chat-v70';
const ASSET_VERSION = '20260712-light-code-1';

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
];

const VERSIONED_SHELL_ASSETS = new Set(SHELL_ASSETS.filter(asset => asset.includes('?')));

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
  event.waitUntil(self.registration.showNotification(payload.title || 'Remote Agent Chat', {
    body: payload.body || 'An agent needs your attention.',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: `${data.type || 'agent-update'}:${data.session_id || ''}`,
    renotify: true,
    data,
  }));
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

  // Never intercept: WebSocket upgrades, auth routes, uploads, non-GET
  if (
    event.request.method !== 'GET' ||
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
