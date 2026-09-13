#!/usr/bin/env python3
"""Build the two single-file copies of Cold Start.

Both need the add-ons inlined rather than linked: the offline copy is
opened from a phone's storage with no server to fetch neighbours from,
and the artifact is published as one file. They differ only in the
wrapper — the artifact host supplies its own head, so that copy must not
carry one.
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
    inlined = ", ".join(n for n in ADDONS if os.path.exists(os.path.join(HERE, n)))

    offline = HEAD + body + tail + "\n</body>\n</html>\n"
    open(os.path.join(HERE, "coldstart-offline.html"), "w", encoding="utf-8").write(offline)
    print("coldstart-offline.html  %d bytes" % len(offline))

    # The artifact host wraps the file itself, so no doctype/head here.
    artifact = body + tail
    open(os.path.join(HERE, "artifact.html"), "w", encoding="utf-8").write(artifact)
    print("artifact.html           %d bytes" % len(artifact))
    print("add-ons inlined in both: %s" % inlined)


if __name__ == "__main__":
    main()
