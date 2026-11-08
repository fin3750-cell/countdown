/* ===================================================================
   Countdown PWA - service worker

   Strategy
   --------
   App shell precache, then:
     - navigations  -> network first, fall back to the cached shell
     - static files -> cache first, fall back to network
     - anything else (cross-origin, non-GET) -> left alone entirely

   Network-first for navigations means a user who is online always gets the
   current HTML, so a deploy is picked up on the next visit; cache-first for
   the CSS/JS/icons keeps start-up instant. The shell fallback is what makes
   the app open with no connection at all.

   Updating the app
   ----------------
   Bump CACHE_VERSION. That changes the cache name, so `install` builds a
   fresh cache and `activate` deletes every older one. Leaving the version
   alone after editing a file will serve the stale copy from cache forever.
   =================================================================== */

'use strict';

var CACHE_VERSION = 'v5';
var CACHE_NAME = 'countdown-' + CACHE_VERSION;

/* Relative URLs here resolve against the service worker's own location,
   which is the app directory - so this list is correct whether the app is
   served from a domain root or from a GitHub Pages subdirectory. */
var PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './img/background.jpg'
];

/* ------------------------------------------------------------------
   install: build the cache for this version.
   ------------------------------------------------------------------ */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // `reload` bypasses the HTTP cache, so installing a new version cannot
      // pick up a stale copy of a file the browser happens to be holding.
      return cache.addAll(PRECACHE_URLS.map(function (url) {
        return new Request(url, { cache: 'reload' });
      }));
    })
  );
  // Note: we do NOT call skipWaiting() here. A new worker waits until the
  // user chooses to reload (see the message handler below), so the running
  // page is never swapped for a different version mid-session.
});

/* ------------------------------------------------------------------
   activate: drop caches from previous versions.
   ------------------------------------------------------------------ */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        // Only touch this app's caches, and only older ones.
        if (name.indexOf('countdown-') === 0 && name !== CACHE_NAME) {
          return caches.delete(name);
        }
        return null;
      }));
    }).then(function () {
      // Take control of already-open pages that have no controller yet.
      return self.clients.claim();
    })
  );
});

/* ------------------------------------------------------------------
   fetch
   ------------------------------------------------------------------ */
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Never interfere with POST/PUT/etc - they must not be served from cache.
  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  // Leave other origins to the network. There are none today, but this stops
  // the worker quietly caching a third-party asset added later.
  if (url.origin !== self.location.origin) return;

  // ---- Navigations: network first, cached shell as the offline fallback ----
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        // Keep the shell copy fresh for the next offline start.
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put('./index.html', copy);
        }).catch(function () { /* cache full or unavailable */ });
        return response;
      }).catch(function () {
        return caches.match('./index.html', { ignoreSearch: true })
          .then(function (cached) {
            return cached || caches.match('./');
          })
          .then(function (cached) {
            return cached || new Response(
              '<!DOCTYPE html><meta charset="utf-8"><title>Offline</title>' +
              '<body style="font:16px system-ui;background:#0b1020;color:#f1f5ff;' +
              'display:grid;place-items:center;height:100vh;margin:0">' +
              '<p>Offline, and no cached copy of the app is available yet.</p>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
      })
    );
    return;
  }

  // ---- Everything else: cache first ----
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;

      return fetch(request).then(function (response) {
        // Only store ordinary, complete, successful same-origin responses.
        // Caching a 206 Partial Content or an opaque response produces
        // corrupt entries that are served back later as broken files.
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          }).catch(function () { /* ignore */ });
        }
        return response;
      });
    })
  );
});

/* ------------------------------------------------------------------
   message: the page asks the waiting worker to take over, after the user
   clicks "reload" on the update badge.
   ------------------------------------------------------------------ */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
