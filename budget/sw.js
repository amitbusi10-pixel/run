// The budget app moved to https://taktziv-shnati.github.io/ : this removes the old copy (its caches only) and steps aside.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('b4a-')).map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate('https://taktziv-shnati.github.io/'))));
});
