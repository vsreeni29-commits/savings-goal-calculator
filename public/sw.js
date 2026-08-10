/**
 * Offline support for the installed web app.
 *
 * Two rules, chosen to match how Vite builds this app:
 *   - Hashed build assets are immutable, so they are served from the cache and
 *     never revalidated. A new build produces new filenames.
 *   - Navigations go to the network first so a deploy is picked up straight
 *     away, falling back to the cached shell when there is no connection.
 *
 * Anything not covered — API calls, cross-origin requests — is left alone.
 */

const CACHE = 'goalvault-v1';
const SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, './manifest.webmanifest']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error())),
    );
    return;
  }

  const isBuildAsset = url.pathname.includes('/assets/');
  const isStatic = /\.(?:css|js|png|svg|woff2?|webmanifest)$/.test(url.pathname);
  if (!isBuildAsset && !isStatic) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    }),
  );
});
