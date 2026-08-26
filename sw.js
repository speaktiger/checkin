/* SpeakTiger check-in — service worker
 * ---------------------------------------------------------------------------
 * Deliberately small. Its only job: if the host refreshes or reopens the page
 * with no connection, the page still opens and the app restores its cached
 * guests, seats and unsent actions from localStorage.
 *
 * This lives in its own folder so its scope cannot collide with the Speed
 * Friending guest app's worker. Two workers registered against one scope
 * replace each other, and the guest app would silently lose its offline shell.
 *
 * It never touches Apps Script: those requests are cross-origin and fall
 * through untouched, so an API response is never served from cache and a stale
 * guest list can never masquerade as live.
 */

const CACHE = "speaktiger-checkin-v1";
const SHELL = "./";

self.addEventListener("install", (e) => e.waitUntil((async () => {
  /* Not wrapped in a catch: a worker that installs without a shell is worse
     than no worker, because it takes over and has nothing to serve. */
  const c = await caches.open(CACHE);
  await c.add(new Request(SHELL, { cache: "reload" }));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith("speaktiger-checkin") && k !== CACHE)
        .map((k) => caches.delete(k))
  );
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;   // never the API

  /* Network first, so a redeploy always lands. The cached shell exists only for
     the moment the network is gone. */
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && req.mode === "navigate") {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {}));
      }
      return res;
    } catch (err) {
      /* ignoreSearch so ?tab=…&k=… still resolves to the one cached shell — the
         app reads its own parameters from location, not from the cache key. */
      const hit = await caches.match(SHELL, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
