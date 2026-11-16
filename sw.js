// שמירת האפליקציה ואריחי המפה במטמון, כדי שתעבוד גם כשהקליטה חלשה
const VERSION = 'v14';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const SHELL_FILES = ['./', 'index.html', 'styles.css?v=14', 'app.js?v=14', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isTile = (url) => /tile\.openstreetmap\.org|arcgisonline\.com/.test(url);
const MAX_TILES = 3000;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (isTile(url)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          c.put(req, res.clone());
          c.keys().then((k) => { if (k.length > MAX_TILES) k.slice(0, k.length - MAX_TILES).forEach((x) => c.delete(x)); });
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // קבצי האפליקציה: קודם רשת (כדי לקבל עדכונים), ואם אין רשת — מהמטמון
  if (url.startsWith(self.location.origin) || url.includes('cdnjs.cloudflare.com') || url.includes('fonts.g')) {
    // cache: 'no-cache' מוודא מול השרת שזו הגרסה האחרונה, כדי שכל עדכון יגיע לכולם מיד
    const own = url.startsWith(self.location.origin);
    const net = !own ? fetch(req) : req.mode === 'navigate' ? fetch(url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
    e.respondWith(net.then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  }
});
