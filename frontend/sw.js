'use strict';

const CACHE_NAME = 'agent-chat-v29';

const SHELL_ASSETS = [
  '/',
  '/styles.css',
  '/file-utils.js',
  '/markdown.js',
  '/hooks.jsx',
  '/app.jsx',
  '/manifest.json',
  '/icon.png',
  '/logo-antigravity.svg',
  '/logo-codex.svg',
  '/logo-claude-in-ag.svg',
  '/logo-codex-in-ag.svg',
  '/logo-gemini-in-ag.svg',
];

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

  // Static shell assets: cache-first
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
