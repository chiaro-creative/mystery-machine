// Service Worker: Spiel läuft auch ohne Netz und holt sich neue Versionen selbst.
// - version.json: nur Netz (wird nie gespeichert)
// - Seite: erst Netz, sonst Speicher (so kommt jede neue Version sofort an)
// - assets/ (Dateinamen mit Prüfsumme, ändern sich nie): erst Speicher
// - alles andere (Musik, Symbole): aus dem Speicher, im Hintergrund auffrischen; liegt in einem
//   eigenen Speicher, der Updates überlebt (die Musik soll nicht jedes Mal neu geladen werden)
const CACHE = 'mm-2026-11-10T16:28:30.115Z'; // beim Build ersetzt (vite.config.ts); alte Versionen räumt activate weg
const MEDIA = 'mm-media';

// Beim Installieren gleich Seite, Skript, Stil und Symbole holen: so läuft die neue Version
// auch dann offline, wenn das Handy nach dem Update direkt ohne Netz startet.
self.addEventListener('install', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    const page = await fetch(`./?_v=${Date.now()}`, { cache: 'no-store' });
    const html = await page.clone().text();
    await cache.put('./', page);
    const files = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => './' + m[1]);
    await cache.addAll(files);
    // Schriften stehen im Stylesheet, nicht in der Seite
    for (const css of files.filter((f) => f.endsWith('.css'))) {
      const text = await (await cache.match(css)).text();
      const base = new URL(css, self.registration.scope);
      const fonts = [...text.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => new URL(m[1].replace(/["']/g, ''), base).href);
      await cache.addAll(fonts);
    }
  } catch { /* ohne Netz: beim nächsten Mal */ }
  await self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k !== MEDIA) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/version.json')) return;
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
  } else if (url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(req));
  } else {
    e.respondWith(staleWhileRevalidate(req, e));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // Zeitstempel anhängen: so liefert auch der Zwischenspeicher von GitHub (bis 10 Min.) sicher die neue Seite
    const url = new URL(req.url);
    url.searchParams.set('_v', String(Date.now()));
    const res = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}
