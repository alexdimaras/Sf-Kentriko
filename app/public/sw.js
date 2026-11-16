/* SF Κέντρο — the program's own files kept on the device.
   The screens open at once (also while the free cloud program is waking up) because the page, its styles and its
   scripts come from here first; a fresh copy is fetched behind and used at the next opening. Nothing of the shop's
   data ever passes through here: every /api/ request goes straight to the program. */
'use strict';
const SHELL = 'sfk-shell-v1';
const FILES = ['/', '/app.css', '/icon.svg', '/manifest.webmanifest',
  '/js/core.js', '/js/v-today.js', '/js/v-products.js', '/js/v-checks.js', '/js/v-new.js', '/js/v-suppliers.js', '/js/v-market.js', '/js/v-flow.js', '/js/v-fixes.js', '/js/v-settings.js', '/js/boot.js'];
const fresh = (c) => Promise.all(FILES.map((f) => fetch(f, { cache: 'no-store', credentials: 'same-origin' }).then((r) => (r.ok ? c.put(f, r) : null)).catch(() => null)));

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then(fresh).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// a new version of the program is running: take all its files now, then tell the page (it reloads itself)
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'refresh') return;
  e.waitUntil(caches.open(SHELL).then(fresh).then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage('ok'); }));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;                       // product photos etc.: the browser's own way
  const p = u.pathname;
  if (p.startsWith('/api/') || p.startsWith('/r/') || p === '/ping' || p === '/sw.js') return; // never the data
  const isShell = FILES.includes(p) || p.startsWith('/fonts/') || p.startsWith('/icons/');
  if (!isShell) return;
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(p === '/' ? '/' : req, { ignoreSearch: true });
    const net = fetch(req, { cache: 'no-store' }).then((r) => { if (r && r.ok) c.put(p === '/' ? '/' : req, r.clone()); return r; });
    if (hit) { net.catch(() => {}); return hit; }                       // at once from the device; the fresh copy for next time
    return net;
  }));
});
