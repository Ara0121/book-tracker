'use strict';

const CACHE_VERSION = 'v4';
const SHELL_CACHE   = `bk-shell-${CACHE_VERSION}`;
const COVER_CACHE   = `bk-covers-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './store.js',
  './github.js',
  './openlibrary.js',
  './sync.js',
  './discover.js',
  './stats.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== COVER_CACHE)
            .map(k  => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // GitHub API — always pass through, no caching
  if (url.hostname === 'api.github.com') return;

  // Open Library covers — cache-first (covers rarely change)
  if (url.hostname === 'covers.openlibrary.org') {
    event.respondWith(
      caches.open(COVER_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const resp = await fetch(event.request);
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      })
    );
    return;
  }

  // App shell — cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
