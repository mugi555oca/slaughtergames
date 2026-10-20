// Service Worker der Slaughter-Games-App.
//
// Schnell UND aktuell:
//   * HTML, CSS, JS, JSON, Bilder -> sofort aus dem Cache, im Hintergrund
//     vom Server auffrischen (stale-while-revalidate)
//   * /version.json               -> immer vom Server. Die App vergleicht die
//     Nummer bei jedem Start; ist ein neuer Deploy da, leert sie den Cache und
//     laedt einmal neu (js/app.js -> checkVersion). So ist nie etwas veraltet.
//   * Supabase-API                -> nie anfassen
const VERSION = 'sg-v2';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const PRECACHE = ['/', '/offline.html', '/app.css', '/js/app.js', '/js/supabase.js', '/js/push.js',
  '/js/data.js', '/tournament-app/js/config.js', '/icons/logo-160.webp', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(!k.startsWith(VERSION) && k !== 'sg-meta') await caches.delete(k);
    await self.clients.claim();
  })());
});

// Neuer Deploy? Bei jedem Seitenaufruf (max. alle 20 s) /version.json pruefen.
// Hat sich die Nummer geaendert: Cache leeren und offene Fenster neu laden -
// so mischen sich nie alte und neue Dateien.
const META = 'sg-meta';
let lastCheck = 0;
async function checkVersion(){
  if(Date.now() - lastCheck < 20000) return;
  lastCheck = Date.now();
  const res = await fetch('/version.json', { cache: 'no-store' }).catch(() => null);
  if(!res?.ok) return;
  const { v } = await res.json().catch(() => ({}));
  if(!v || v === 'dev') return;
  const meta = await caches.open(META);
  const old = await meta.match('/__version').then(r => r?.text()).catch(() => null);
  await meta.put('/__version', new Response(v));
  if(old && old !== v){
    await caches.delete(RUNTIME);
    await caches.delete(SHELL);
    for(const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  }
}

const CDN = ['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// Seiten werden nach Pfad gecacht (round.html?tournament=… ist immer dieselbe Datei)
const keyFor = (req, url) => (req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req);

async function staleWhileRevalidate(e, req, url){
  const cache = await caches.open(RUNTIME);
  const key = keyFor(req, url);
  const hit = await cache.match(key) || await caches.match(key);
  const net = fetch(req).then(res => {
    if(res.ok || res.type === 'opaque') cache.put(key, res.clone());
    return res;
  });
  if(hit){
    e.waitUntil(net.catch(() => {}));
    return hit;
  }
  try{ return await net; }
  catch(err){
    if(req.mode === 'navigate') return caches.match('/offline.html');
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === location.origin){
    if(url.pathname === '/sw.js' || url.pathname === '/version.json') return;
    if(req.mode === 'navigate') e.waitUntil(checkVersion());
    e.respondWith(staleWhileRevalidate(e, req, url));
    return;
  }
  if(CDN.includes(url.hostname)) e.respondWith(staleWhileRevalidate(e, req, url));
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
