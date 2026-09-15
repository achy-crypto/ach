/* Afterimage — offline shell.

   The cache name carries the build id, so a new build installs a fresh
   cache and activate drops every older one. Navigations go to the network
   first and fall back to the cache, so an online visit always gets the
   current page rather than whatever was cached first. */
const BUILD = "8d5512cfb4";
const CACHE = "afterimage-" + BUILD;
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isPage = (req) =>
  req.mode === "navigate" || req.destination === "document" ||
  /\/(index\.html)?$/.test(new URL(req.url).pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  if (isPage(req)) {
    /* cache: "reload" so the browser's own HTTP cache cannot hand back a
       stale page underneath us — that defeats the whole point. */
    e.respondWith(
      fetch(new Request(req.url, { cache: "reload", credentials: "same-origin" })).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match("./index.html", { ignoreSearch: true })
        .then((hit) => hit || caches.match("./", { ignoreSearch: true })))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res && (res.ok || res.type === "opaque")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => Response.error()))
  );
});
