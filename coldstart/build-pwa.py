#!/usr/bin/env python3
"""Build the installable, offline copy of Cold Start into ../docs.

The artifact host injects a <head> (charset, viewport, reset) that a
self-hosted copy doesn't get, so this adds it, plus the manifest, icons
and a service worker that caches the shell for genuine offline use.

    python3 build-pwa.py
"""
import os, re, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(os.path.dirname(HERE), "docs")
CACHE_NAME = "coldstart-v1"

INK, AMBER = (0x15, 0x18, 0x1D), (0xF0, 0xA0, 0x57)


def png(size, path):
    """Minimal PNG writer — the ignition lamp: an amber disc on slate."""
    cx = cy = (size - 1) / 2
    r_out, r_in = size * 0.30, size * 0.40          # disc, and a thin ring
    rows = bytearray()
    for y in range(size):
        rows.append(0)                               # filter: none
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= r_out or (r_in - size * 0.035 <= d <= r_in):
                rows += bytes(AMBER)
            else:
                rows += bytes(INK)

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
<meta name="apple-mobile-web-app-title" content="Cold Start">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-192.png">
<link rel="icon" href="./icon-192.png">
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

REGISTER = """
<script>
/* Registered last so a failure here can never stop the app booting. */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
</script>
</body>
</html>
"""

SW = """/* Cold Start — cache-first shell so it opens with no signal at all. */
const CACHE = "%s";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        /* Cache what comes back, web fonts included — they're opaque
           cross-origin responses but they replay fine. */
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Response.error()));
    })
  );
});
""" % CACHE_NAME

MANIFEST = """{
  "name": "Cold Start",
  "short_name": "Cold Start",
  "description": "A launcher for the part of you that won't turn over.",
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


def main():
    os.makedirs(OUT, exist_ok=True)
    app = open(os.path.join(HERE, "index.html"), encoding="utf-8").read()
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(HEAD + app + REGISTER)
    open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8").write(SW)
    open(os.path.join(OUT, "manifest.webmanifest"), "w", encoding="utf-8").write(MANIFEST)
    open(os.path.join(OUT, ".nojekyll"), "w").write("")
    for n in (192, 512):
        png(n, os.path.join(OUT, "icon-%d.png" % n))
    for f in sorted(os.listdir(OUT)):
        print("  docs/%s  %d bytes" % (f, os.path.getsize(os.path.join(OUT, f))))


if __name__ == "__main__":
    main()
