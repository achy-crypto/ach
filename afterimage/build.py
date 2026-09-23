#!/usr/bin/env python3
"""Build the installable and offline copies of Afterimage.

Emits three things from one source:
  ../docs/afterimage/   the installable site (manifest, icons, worker)
  afterimage-offline.html   one file that works from a phone's Files app
  artifact.html             the same page without a <head>, which the
                            artifact host supplies itself

    python3 build.py
"""
import hashlib, os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(os.path.dirname(HERE), "docs", "afterimage")

INK, LIT, GHOST = (0x0D, 0x10, 0x16), (0xF0, 0xA0, 0x57), (0x6A, 0x4C, 0x33)


def png(size, path):
    """The mark: a lit disc and the dimmer one it leaves behind."""
    rows = bytearray()
    r = size * 0.24
    a = (size * 0.40, size * 0.38)          # the bright disc
    b = (size * 0.62, size * 0.60)          # its afterimage
    for y in range(size):
        rows.append(0)                       # filter: none
        for x in range(size):
            da = ((x - a[0]) ** 2 + (y - a[1]) ** 2) ** 0.5
            db = ((x - b[0]) ** 2 + (y - b[1]) ** 2) ** 0.5
            if da <= r:      rows += bytes(LIT)
            elif db <= r:    rows += bytes(GHOST)
            else:            rows += bytes(INK)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(rows), 9)))
        f.write(chunk(b"IEND", b""))


HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#e4e5e1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15181d" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Afterimage">
__LINKS__
<style>
  html{color-scheme:light dark}
  body{margin:0;font:14px system-ui,-apple-system,sans-serif;background:#e4e5e1}
  @media (prefers-color-scheme:dark){body{background:#15181d}}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
</head>
<body>
"""

SITE_LINKS = """<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-192.png">
<link rel="icon" href="./icon-192.png">"""

TAIL = """
</body>
</html>
"""

SW = """/* Afterimage — offline shell.

   The cache name carries the build id, so a new build installs a fresh
   cache and activate drops every older one. Navigations go to the network
   first and fall back to the cache, so an online visit always gets the
   current page rather than whatever was cached first. */
const BUILD = "__BUILD__";
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
  /\\/(index\\.html)?$/.test(new URL(req.url).pathname);

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
"""

MANIFEST = """{
  "name": "Afterimage",
  "short_name": "Afterimage",
  "description": "Holding a picture in your head after it's gone.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#15181d",
  "theme_color": "#15181d",
  "icons": [
    { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
"""

REGISTER = """
<script>
/* Registered last, so a failure here can never stop the app booting. */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
</script>
"""


def build_id():
    h = hashlib.sha256()
    h.update(open(os.path.join(HERE, "index.html"), "rb").read())
    return h.hexdigest()[:10]


def main():
    os.makedirs(OUT, exist_ok=True)
    bid = build_id()
    app = open(os.path.join(HERE, "index.html"), encoding="utf-8").read()
    stamp = "<script>window.__BUILD__=%r;</script>\n" % bid

    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(
        HEAD.replace("__LINKS__", SITE_LINKS) + stamp + app + REGISTER + TAIL)
    open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8").write(SW.replace("__BUILD__", bid))
    open(os.path.join(OUT, "manifest.webmanifest"), "w", encoding="utf-8").write(MANIFEST)
    for n in (192, 512):
        png(n, os.path.join(OUT, "icon-%d.png" % n))

    # one file, no network, nothing to install
    open(os.path.join(HERE, "afterimage-offline.html"), "w", encoding="utf-8").write(
        HEAD.replace("__LINKS__", "") + stamp + app + TAIL)
    # the artifact host writes its own <head>
    open(os.path.join(HERE, "artifact.html"), "w", encoding="utf-8").write(stamp + app)

    print("  build id: %s" % bid)
    for f in sorted(os.listdir(OUT)):
        print("  docs/afterimage/%s  %d bytes" % (f, os.path.getsize(os.path.join(OUT, f))))
    for f in ("afterimage-offline.html", "artifact.html"):
        print("  %s  %d bytes" % (f, os.path.getsize(os.path.join(HERE, f))))


if __name__ == "__main__":
    main()
