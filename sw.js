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

const CACHE = "speaktiger-checkin-v2";
/* index.html explicitly, not the directory alias: Safari opening a cold tab
   offline asks for the resolved document, and a cached "./" does not always
   answer it. ?tab=…&k=… still comes from the real page location. */
const SHELL = "./index.html";
const NET_MS = 5000;

/* Falling back only when fetch throws is not enough: wifi that is connected but
   dead hangs instead of failing, and a refresh at the door would sit on a blank
   page rather than opening the cached shell. */
function withDeadline(promise, ctrl, ms) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
      reject(new Error("timeout"));
    }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); },
                 function (e) { clearTimeout(t); reject(e); });
  });
}

self.addEventListener("message", (e) => {
  /* the page asking to be taken over immediately after an update */
  if (e.data === "claim") self.skipWaiting();
});

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
      let res;
      if (req.mode === "navigate") {
        const ctrl = new AbortController();
        /* no-store, or GitHub Pages' own caching headers hand back yesterday's
           HTML and a new build looks like it never deployed */
        res = await withDeadline(
          fetch(req.url, { cache: "no-store", signal: ctrl.signal }), ctrl, NET_MS);
      } else {
        res = await fetch(req);        /* same-origin assets: unchanged */
      }
      if (res.ok && req.mode === "navigate") {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {}));
      }
      return res;
    } catch (err) {
      /* Two ways in, because a cold tab asks for the full URL with its query
         and Safari has been inconsistent about which one matches. ignoreSearch
         handles the query; the app reads its parameters from location, not
         from whatever the cache key happened to be. */
      const hit = (await caches.match(SHELL, { ignoreSearch: true })) ||
                  (await caches.match(req, { ignoreSearch: true })) ||
                  (await caches.match(new URL("./index.html", self.location).href,
                                      { ignoreSearch: true }));
      if (hit) return hit;
      throw err;
    }
  })());
});
