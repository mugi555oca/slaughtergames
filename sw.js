// Service Worker der Slaughter-Games-App.
//
// Ziel: die App ist immer auf dem Stand des letzten Deploys, ohne dass jemand
// etwas "updaten" muss. Deshalb:
//   * HTML, CSS, JS, JSON  -> zuerst Netz, Cache nur als Offline-Rueckfall
//   * Bilder, Fonts, CDN    -> sofort aus dem Cache, im Hintergrund auffrischen
//   * Supabase-API          -> nie anfassen
// VERSION nur hochzaehlen, wenn sich am SW selbst etwas aendert.
const VERSION = 'sg-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const PRECACHE = ['/', '/offline.html', '/app.css', '/js/app.js', '/js/supabase.js',
  '/icons/logo-160.webp', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isFresh = url => /\.(html|css|js|mjs|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
const isAsset = url => /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf)$/.test(url.pathname);
const CDN = ['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

async function networkFirst(req){
  const cache = await caches.open(RUNTIME);
  try{
    const res = await fetch(req);
    if(res.ok) cache.put(req, res.clone());
    return res;
  }catch(err){
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' }) || await caches.match(req);
    if(hit) return hit;
    if(req.mode === 'navigate') return caches.match('/offline.html');
    throw err;
  }
}

async function staleWhileRevalidate(req){
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if(res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === location.origin){
    if(url.pathname === '/sw.js') return;
    if(req.mode === 'navigate' || isFresh(url)) e.respondWith(networkFirst(req));
    else if(isAsset(url)) e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if(CDN.includes(url.hostname)) e.respondWith(staleWhileRevalidate(req));
});

// ---------- Push ----------
self.addEventListener('push', e => {
  let data = {};
  try{ data = e.data ? e.data.json() : {}; }catch{ data = { title: 'Slaughter Games', body: e.data?.text() }; }
  const title = data.title || 'Slaughter Games';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const w of wins){
      if('focus' in w){
        await w.focus();
        if('navigate' in w) return w.navigate(target);
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});
