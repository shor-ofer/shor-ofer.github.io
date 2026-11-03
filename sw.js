// Serves the packs the tools keep in the browser (src/js/packstore.js): any
// request under /__idb/<kind>/<name>/ is answered from IndexedDB, so a stored
// pack reads exactly like a folder on disk. Everything else goes to the
// server as if this weren't here. It sits at the site's root so its scope
// takes in the game, the level editor and the asset pack creator alike.
importScripts('src/js/packstore.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const want = packStore.parse(url.pathname);
  if (!want) return;
  e.respondWith((async () => {
    try {
      const rec = await packStore.get(want.kind, want.name, want.path);
      if (!rec) return new Response(`not in the browser's packs: ${url.pathname}`, { status: 404, headers: { 'Content-Type': 'text/plain' } });
      const headers = { 'Content-Type': rec.type, 'Cache-Control': 'no-store' };
      // a pack's page built before the game joined this browser's room
      // (src/js/sharehost.js) joins it all the same
      if (want.kind === 'levels' && String(rec.type).startsWith('text/html')) {
        const page = await new Response(rec.data).text();
        return new Response(page.includes('wtwShareHost') ? page : page + '\n<script src="/src/js/sharehost.js"></script>\n', { status: 200, headers });
      }
      return new Response(rec.data, { status: 200, headers });
    } catch (err) {
      return new Response(`could not read the browser's packs: ${err.message}`, { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
