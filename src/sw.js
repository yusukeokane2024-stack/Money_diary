// アプリシェルをキャッシュ優先で配信 (裏で更新) → 2回目以降の起動はネットワーク待ちなし
const VERSION = '__VERSION__';
const SHELL = __SHELL__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const key = req.mode === 'navigate' ? '/index.html' : req;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(key);
      const net = fetch(req).then((res) => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
