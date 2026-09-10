#!/usr/bin/env python3
"""Build the single-file offline copy of Cold Start.

Everything has to live in one file — it is opened from a phone's storage
with no server to fetch neighbours from — so the add-ons are inlined
rather than linked.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ADDONS = ["spark.js", "language.js"]

HEAD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cold Start">
<style>
  html{color-scheme:light dark}
  body{margin:0;font:14px system-ui,-apple-system,sans-serif;background:#e4e5e1}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
</head>
<body>
'''


def main():
    body = open(os.path.join(HERE, "index.html"), encoding="utf-8").read()
    tail = ""
    for name in ADDONS:
        path = os.path.join(HERE, name)
        if os.path.exists(path):
            tail += "\n<script>\n/* %s — inlined */\n%s\n</script>\n" % (
                name, open(path, encoding="utf-8").read())
    out = HEAD + body + tail + "\n</body>\n</html>\n"
    open(os.path.join(HERE, "coldstart-offline.html"), "w", encoding="utf-8").write(out)
    print("coldstart-offline.html  %d bytes  (add-ons inlined: %s)" % (
        len(out), ", ".join(n for n in ADDONS if os.path.exists(os.path.join(HERE, n)))))


if __name__ == "__main__":
    main()
