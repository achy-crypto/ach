#!/usr/bin/env node
/* Two Hours In — standalone server.
 *
 * Serves the app and gives it three things the browser cannot do for itself:
 * a real catalog search, gameplay ratings from the Claude API, and storage.
 * Every credential stays in this process. The browser is handed results only. */

import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeCatalog } from "./catalog.mjs";
import { makeRater, FEATURE_KEYS, RATING_SCHEMA_VERSION } from "./rate.mjs";
import { makeScreenCatalog, makeScreenRater, AXIS_KEYS } from "./screen.mjs";
import { makeLLM } from "./llm.mjs";
import { makeVibe } from "./vibe.mjs";
import { makeGameVibe } from "./gamevibe.mjs";
import { makeStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/* A .env file is read if present; real environment variables win over it. */
async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(here, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) { if (e.code !== "ENOENT") console.error("[env]", e.message); }
  return process.env;
}

const env = await loadEnv();
const PORT = Number(env.PORT || 8787);
const DATA_DIR = path.resolve(here, env.DATA_DIR || "./data");
/* Each app is looked for in every place a build might have put it, so one
 * missed COPY or env var cannot take a page down on its own. */
function firstExisting(...candidates) {
  const list = candidates.filter(Boolean).map(c => path.resolve(here, c));
  return list.find(p => existsSync(p)) || list[0];
}
const APP_HTML = firstExisting(env.APP_HTML, "/app/app/games.html", "../games/index.html", "./games.html");
const APP_TOKEN = (env.APP_TOKEN || "").trim();

const APP_HTML_HOLDS = firstExisting(env.APP_HTML_HOLDS, "/app/app/holds.html", "../holds/index.html", "./holds.html");
const APP_HTML_VIBE = firstExisting(env.APP_HTML_VIBE, "/app/app/wavelength.html", "../wavelength/index.html", "./wavelength.html");
const APP_HTML_RUMBLE = firstExisting(env.APP_HTML_RUMBLE, "/app/app/rumble.html", "../rumble/index.html", "./rumble.html");

const llm = makeLLM(env);
const catalog = makeCatalog(env);                 // games — IGDB / RAWG
const rater = makeRater(env, llm);
const screenCatalog = makeScreenCatalog(env);     // shows and films — TMDb
const screenRater = makeScreenRater(llm.client, llm.defaults.model, llm.defaults.fallbackModel,
  llm.defaults.effort, llm.defaults.betas, (prompt, schema, o) => llm.parse(prompt, schema, o));
const store = makeStore(DATA_DIR);
await store.init();
const vibe = makeVibe({ screenCatalog, store, llm });
const gameVibe = makeGameVibe({ catalog, llm });

/* ------------------------------------------------------------- helpers --- */

function send(res, code, body, type = "application/json; charset=utf-8") {
  const payload = type.startsWith("application/json") ? JSON.stringify(body) : body;
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}
function fail(res, code, message, extra) {
  send(res, code, Object.assign({ error: message }, extra || {}));
}
async function readBody(req, limit = 2_000_000) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("body too large"), { code: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function authed(req, url) {
  if (!APP_TOKEN) return true;
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ") && h.slice(7) === APP_TOKEN) return true;
  return url.searchParams.get("token") === APP_TOKEN;
}

/* --------------------------------------------------------------- routes --- */

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === "/api/health") {
    // ?check=catalog makes one small real request, so the page can tell a
    // missing key from a rejected one.
    const catalogCheck = url.searchParams.get("check") === "catalog" ? await catalog.check() : null;
    return send(res, 200, {
      ok: true,
      app: "two-hours-in",
      needsToken: !!APP_TOKEN,
      authed: authed(req, url),
      catalog: { connected: catalog.connected, provider: catalog.provider, missing: catalog.missing, note: catalog.note,
        check: catalogCheck && { ok: catalogCheck.ok, error: catalogCheck.error || null } },
      screen: { connected: screenCatalog.connected, provider: screenCatalog.provider, missing: screenCatalog.missing,
        credential: screenCatalog.credentialKind },
      rater: { configured: rater.configured(), model: llm.defaults.model, schema: RATING_SCHEMA_VERSION },
      ratingsCached: store.ratingCount(),
      features: FEATURE_KEYS,
      axes: AXIS_KEYS,
    });
  }

  if (!authed(req, url)) return fail(res, 401, "This server needs its access token.", { needsToken: true });

  if (route === "/api/catalog/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return fail(res, 400, "Nothing to search for.");
    if (!catalog.connected) return fail(res, 503, "No catalog is configured on this server.", { missing: catalog.missing });
    const results = await catalog.search(q, Number(url.searchParams.get("limit")) || 12);
    return send(res, 200, { provider: catalog.provider, results });
  }

  if (route === "/api/catalog/game") {
    const id = (url.searchParams.get("id") || "").trim();
    if (!id) return fail(res, 400, "No id given.");
    if (!catalog.connected) return fail(res, 503, "No catalog is configured on this server.", { missing: catalog.missing });
    const game = await catalog.byId(id);
    return game ? send(res, 200, { game }) : fail(res, 404, "No game with that id.");
  }

  if (route === "/api/catalog/discover") {
    if (!catalog.connected) return fail(res, 503, "No catalog is configured on this server.", { missing: catalog.missing });
    const list = v => (v || "").split(",").map(s => s.trim()).filter(Boolean);
    const results = await catalog.discover({
      limit: Number(url.searchParams.get("limit")) || 40,
      offset: Number(url.searchParams.get("offset")) || 0,
      platforms: list(url.searchParams.get("platform")),
      genres: list(url.searchParams.get("genres")),
      modes: list(url.searchParams.get("modes")),
    });
    return send(res, 200, { provider: catalog.provider, results });
  }

  /* Rate games. Accepts catalog metadata as the basis; refuses anything that
   * looks like user preference data, so the blindness cannot be bypassed by a
   * caller. Cached per id + schema so a game is never paid for twice. */
  if (route === "/api/rate" && req.method === "POST") {
    if (!rater.configured()) return fail(res, 503, "ANTHROPIC_API_KEY is not set on this server.", { missing: ["ANTHROPIC_API_KEY"] });
    const body = await readBody(req);
    const want = Array.isArray(body && body.games) ? body.games.slice(0, 40) : [];
    if (!want.length) return fail(res, 400, "No games given.");
    const banned = ["weights", "tolerance", "liked", "dropped", "profile", "preferred", "prefs"];
    for (const g of want) {
      for (const k of Object.keys(g || {}))
        if (banned.includes(k)) return fail(res, 400, `The rating call must stay blind; "${k}" is not accepted.`);
      if (g && g.basis) for (const k of Object.keys(g.basis))
        if (banned.includes(k)) return fail(res, 400, `The rating basis must be catalog facts only; "${k}" is not accepted.`);
    }
    const out = [], need = [];
    for (const g of want) {
      const id = String(g.id || "").trim();
      if (!id || !g.title) continue;
      const hit = store.getRating(id, RATING_SCHEMA_VERSION);
      if (hit) out.push(hit); else need.push({ id, title: String(g.title), basis: g.basis || {} });
    }
    let fresh = [];
    if (need.length) {
      fresh = await rater.rate(need);
      if (fresh.length) await store.putRatings(fresh);
    }
    return send(res, 200, { ratings: out.concat(fresh), cached: out.length, rated: fresh.length,
      missed: need.filter(n => !fresh.some(f => f.id === n.id)).map(n => n.title) });
  }

  /* ---- shows and films ------------------------------------------------- */

  if (route === "/api/screen/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return fail(res, 400, "Nothing to search for.");
    if (!screenCatalog.connected) return fail(res, 503, "TMDb is not configured on this server.", { missing: screenCatalog.missing });
    const results = await screenCatalog.search(q, Number(url.searchParams.get("limit")) || 10,
      url.searchParams.get("form") || "either");
    return send(res, 200, { provider: screenCatalog.provider, results });
  }

  if (route === "/api/screen/title") {
    const id = (url.searchParams.get("id") || "").trim();
    if (!id) return fail(res, 400, "No id given.");
    if (!screenCatalog.connected) return fail(res, 503, "TMDb is not configured on this server.", { missing: screenCatalog.missing });
    const row = await screenCatalog.byId(id);
    if (!row) return fail(res, 404, "No title with that id.");
    await store.putScreen([row]);
    return send(res, 200, { title: row });
  }

  if (route === "/api/screen/discover") {
    if (!screenCatalog.connected) return fail(res, 503, "TMDb is not configured on this server.", { missing: screenCatalog.missing });
    const results = await screenCatalog.discover({
      form: url.searchParams.get("form") || "either",
      offset: Number(url.searchParams.get("offset")) || 0,
      language: url.searchParams.get("language") || null,
    });
    return send(res, 200, { provider: screenCatalog.provider, results });
  }

  /* Placement against the user's own anchors. Unlike /api/rate this one is
   * SUPPOSED to see the scale — the anchors are the ruler, that is the whole
   * design — so there is no blindness guard here, and none is implied. */
  if (route === "/api/screen/place" && req.method === "POST") {
    if (!llm.configured()) return fail(res, 503, "ANTHROPIC_API_KEY is not set on this server.", { missing: ["ANTHROPIC_API_KEY"] });
    const body = await readBody(req);
    const want = Array.isArray(body && body.titles) ? body.titles.slice(0, 24) : [];
    const scale = (body && body.scale) || {};
    if (!want.length) return fail(res, 400, "No titles given.");
    if (!Array.isArray(scale.anchors) || !scale.anchors.length)
      return fail(res, 400, "No anchors given; the scale is what a placement is made against.");

    /* Facts come from the catalog here, never from the caller, so a client
     * cannot pass off invented runtimes as catalog records. */
    // Looked up side by side: twelve TMDb fetches in a row was needless waiting.
    const titles = (await Promise.all(want.map(async t => {
      const id = String((t && t.id) || "").trim();
      const title = String((t && t.title) || "").trim();
      if (!id || !title) return null;
      let facts = {};
      if (screenCatalog.connected && /^tmdb:/.test(id)) {
        const known = store.getScreen(id);
        if (known) facts = known.meta;
        else { try { const row = await screenCatalog.byId(id);
          if (row) { await store.putScreen([row]); facts = row.meta; } } catch (e) {
          console.warn("[screen] lookup failed for", id, e.message); } }
      }
      return { id, title, kind: (t && t.kind) || (facts && facts.kind) || "show", facts };
    }))).filter(Boolean);
    if (!titles.length) return fail(res, 400, "Nothing usable in that list.");
    const placed = await screenRater.place(titles, scale);
    return send(res, 200, {
      placed,
      facts: Object.fromEntries(titles.map(t => [t.id, t.facts])),
      missed: titles.filter(t => !placed.some(p => p.id === t.id)).map(t => t.title),
    });
  }

  /* ---- Wavelength ------------------------------------------------------ */

  if (route === "/api/vibe/pool" && req.method === "POST") {
    if (!llm.configured()) return fail(res, 503, "ANTHROPIC_API_KEY is not set on this server.", { missing: ["ANTHROPIC_API_KEY"] });
    if (!screenCatalog.connected) return fail(res, 503, "TMDb is not configured on this server.", { missing: screenCatalog.missing });
    const body = await readBody(req);
    const text = String((body && body.vibe) || "").trim();
    if (text.length < 3) return fail(res, 400, "Describe what you're in the mood for.");
    const out = await vibe.pool(text, (body && body.form) || "either");
    return send(res, 200, out);
  }

  if (route === "/api/vibe/rank" && req.method === "POST") {
    if (!llm.configured()) return fail(res, 503, "ANTHROPIC_API_KEY is not set on this server.", { missing: ["ANTHROPIC_API_KEY"] });
    if (!screenCatalog.connected) return fail(res, 503, "TMDb is not configured on this server.", { missing: screenCatalog.missing });
    const body = await readBody(req);
    const text = String((body && body.vibe) || "").trim();
    const ids = Array.isArray(body && body.ids) ? body.ids.map(String).filter(id => /^tmdb:(tv|movie):\d+$/.test(id)) : [];
    if (!text || !ids.length) return fail(res, 400, "Nothing to score.");
    const ranked = await vibe.rank(text, (body && body.reading) || {}, ids);
    return send(res, 200, { ranked });
  }

  /* ---- Rumble: Wavelength for games ----------------------------------- */
  /* Works without a game catalog too, but then says so: the pool is Claude's
   * suggestions, marked source "memory", and the page labels them that way. */

  if (route === "/api/gvibe/pool" && req.method === "POST") {
    if (!llm.configured()) return fail(res, 503, "ANTHROPIC_API_KEY is not set on this server.", { missing: ["ANTHROPIC_API_KEY"] });
    const body = await readBody(req);
    const text = String((body && body.vibe) || "").trim();
    if (text.length < 3) return fail(res, 400, "Describe what you feel like playing.");
    const out = await gameVibe.pool(text, String((body && body.platform) || "any"));
    return send(res, 200, out);
  }

  if (route === "/api/gvibe/rank" && req.method === "POST") {
    if (!llm.configured()) return fail(res, 503, "ANTHROPIC_API_KEY is not set on this server.", { missing: ["ANTHROPIC_API_KEY"] });
    const body = await readBody(req);
    const text = String((body && body.vibe) || "").trim();
    const ids = Array.isArray(body && body.ids)
      ? body.ids.map(String).filter(id => /^(?:igdb|rawg):\d+$|^est:[a-z0-9-]{1,80}$/.test(id)) : [];
    if (!text || !ids.length) return fail(res, 400, "Nothing to score.");
    const ranked = await gameVibe.rank(text, (body && body.reading) || {}, ids);
    return send(res, 200, { ranked });
  }

  if (route === "/api/screen/state") {
    if (req.method === "GET") return send(res, 200, { state: store.getScreenState() });
    if (req.method === "PUT") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") return fail(res, 400, "State must be an object.");
      await store.putScreenState(body);
      return send(res, 200, { ok: true });
    }
    return fail(res, 405, "Use GET or PUT.");
  }

  if (route === "/api/state") {
    if (req.method === "GET") return send(res, 200, { state: store.getState() });
    if (req.method === "PUT") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") return fail(res, 400, "State must be an object.");
      await store.putState(body);
      return send(res, 200, { ok: true });
    }
    return fail(res, 405, "Use GET or PUT.");
  }

  return fail(res, 404, "No such endpoint.");
}

/* The app files are written for the claude.ai viewer, which wraps them in a
 * document with a charset and a phone viewport. Served bare, phones lay the page
 * out at desktop width and "autosize" long paragraphs, so body text comes out
 * several times larger than the headings. Supply the same wrapper here. */
function asDocument(html) {
  if (/^\s*<!doctype/i.test(html)) return html;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>
${html}
</body></html>`;
}

function missingPage(name, where) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — not in this build</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:540px;margin:40px auto;padding:0 18px">
<h1 style="font-size:22px">${name} isn't in this build</h1>
<p>The server is running, but the page file for ${name} wasn't copied into it. This is a
deploy problem, not a problem with your data — nothing has been lost.</p>
<p><b>Fix:</b> in Render, open this service and press <b>Manual Deploy → Deploy latest commit</b>.</p>
<p style="color:#777;font-size:13px">Looked for: <code>${where}</code></p></body>`;
}

function indexPage(gameCheck) {
  const card = (href, name, what, cat, ok, missing, offText) => `
    <a class="card" href="${href}">
      <h2>${name}</h2>
      <p>${what}</p>
      <span class="${ok ? "on" : "off"}">${ok ? `${cat} connected` : offText || `${cat} not connected — set ${missing.join(", ")}`}</span>
    </a>`;
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your apps</title>
<style>
:root{color-scheme:light dark;--ground:#e9ecee;--card:#f7f8f9;--ink:#16191d;--dim:#666d75;--rule:#ccd2d7;--ok:#2f7a55;--bad:#a33227}
@media (prefers-color-scheme:dark){:root{--ground:#101316;--card:#181c20;--ink:#e7e9ea;--dim:#8b939b;--rule:#2a2f35;--ok:#6db98c;--bad:#e0776a}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:40px 18px 60px}
h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600;margin:0 0 22px}
.card{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--rule);
  border-radius:4px;padding:20px;margin-bottom:14px}
.card:hover{border-color:var(--ink)}
.card h2{margin:0;font-size:23px;letter-spacing:.01em}
.card p{margin:6px 0 0;color:var(--dim);font-size:14.5px}
.on,.off{display:inline-block;margin-top:12px;font-family:ui-monospace,monospace;font-size:11px;
  letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--rule);padding:4px 9px;border-radius:3px}
.on{color:var(--ok);border-color:var(--ok)}
.off{color:var(--bad);border-color:var(--bad)}
.note{color:var(--dim);font-size:13px;margin-top:26px}
</style>
<div class="wrap">
  <h1>Four apps on this server</h1>
  ${card("/wavelength", "Wavelength", "Shows and films — describe a feeling, get titles that match it.",
    "TMDb", screenCatalog.connected, screenCatalog.missing)}
  ${card("/rumble", "Rumble", "Games — describe a feeling, get games that match it.",
    catalog.provider ? catalog.provider.toUpperCase() : "A game catalog",
    catalog.connected && !!(gameCheck && gameCheck.ok),
    ["RAWG_API_KEY (or IGDB) — until then, games come from Claude's memory and are labelled that way"],
    catalog.connected && gameCheck && !gameCheck.ok
      ? `${catalog.provider.toUpperCase()} key is set but was rejected: ${String(gameCheck.error || "").replace(/[<>&]/g, "")}` : "")}
  ${catalog.note ? `<p class="note" style="margin-top:-6px">${catalog.note.replace(/[<>&]/g, "")}</p>` : ""}
  ${card("/holds", "Will It Hold", "Shows and films — whether you'll actually get through one.",
    "TMDb", screenCatalog.connected, screenCatalog.missing)}
  ${card("/games", "Two Hours In", "Games — whether one survives its first week with you.",
    catalog.provider ? catalog.provider.toUpperCase() : "A game catalog",
    catalog.connected && !!(gameCheck && gameCheck.ok), catalog.missing,
    catalog.connected && gameCheck && !gameCheck.ok ? `${catalog.provider.toUpperCase()} key is set but was rejected` : "")}
  <p class="note">Claude: ${llm.configured() ? `${llm.defaults.model}` : "NOT configured — set ANTHROPIC_API_KEY"}.
  ${APP_TOKEN ? "Access token required." : "No access token set — anyone with this URL can spend your API credit."}</p>
</div>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    /* The root is a signpost, not one of the apps. Serving one of them here
     * makes the other look missing, and makes the whole deployment look like
     * whichever app happened to be at "/". */
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(res, 200, indexPage(catalog.connected ? await catalog.check() : null), "text/html; charset=utf-8");
    }
    if (url.pathname === "/games" || url.pathname === "/games/") {
      if (!existsSync(APP_HTML)) return send(res, 500, missingPage("Two Hours In", APP_HTML), "text/html; charset=utf-8");
      const html = await fs.readFile(APP_HTML, "utf8");
      return send(res, 200, asDocument(html), "text/html; charset=utf-8");
    }
    if (url.pathname === "/wavelength" || url.pathname === "/wavelength/") {
      if (!existsSync(APP_HTML_VIBE)) return send(res, 500, missingPage("Wavelength", APP_HTML_VIBE), "text/html; charset=utf-8");
      const html = await fs.readFile(APP_HTML_VIBE, "utf8");
      return send(res, 200, asDocument(html), "text/html; charset=utf-8");
    }
    if (url.pathname === "/rumble" || url.pathname === "/rumble/") {
      if (!existsSync(APP_HTML_RUMBLE)) return send(res, 500, missingPage("Rumble", APP_HTML_RUMBLE), "text/html; charset=utf-8");
      const html = await fs.readFile(APP_HTML_RUMBLE, "utf8");
      return send(res, 200, asDocument(html), "text/html; charset=utf-8");
    }
    if (url.pathname === "/holds" || url.pathname === "/holds/") {
      if (!existsSync(APP_HTML_HOLDS)) return send(res, 500, missingPage("Will It Hold", APP_HTML_HOLDS), "text/html; charset=utf-8");
      const html = await fs.readFile(APP_HTML_HOLDS, "utf8");
      return send(res, 200, asDocument(html), "text/html; charset=utf-8");
    }
    return fail(res, 404, "Not found.");
  } catch (e) {
    const code = e && e.code === 413 ? 413 : 500;
    console.error(`[${req.method} ${url.pathname}]`, e && e.stack || e);
    return fail(res, code, String((e && e.message) || e), { code: (e && e.code) || null });
  }
});

server.listen(PORT, () => {
  const line = s => console.log(`  ${s}`);
  console.log(`\nhttp://localhost:${PORT}\n`);
  console.log(`  Wavelength   http://localhost:${PORT}/wavelength  (find by feeling)`);
  console.log(`  Rumble        http://localhost:${PORT}/rumble   (games by feeling)`);
  console.log(`  Will It Hold  http://localhost:${PORT}/holds    (shows and films)`);
  console.log(`  Two Hours In  http://localhost:${PORT}/games    (games)\n`);
  line(`catalog   games: ${catalog.connected ? `${catalog.provider} configured` : `NOT connected — set ${catalog.missing.join(", ")}`}${catalog.note ? ` (${catalog.note})` : ""}`);
  line(`          screen: ${screenCatalog.connected ? `tmdb configured, using the ${screenCatalog.credentialKind}` : `NOT connected — set ${screenCatalog.missing.join(", ")}`}`);
  line(`ratings   ${llm.configured() ? `${llm.defaults.model} via ANTHROPIC_API_KEY` : "NOT configured — set ANTHROPIC_API_KEY"}`);
  line(`data      ${DATA_DIR}`);
  line(`apps      ${APP_HTML}\n            ${APP_HTML_HOLDS}\n            ${APP_HTML_VIBE}\n            ${APP_HTML_RUMBLE}`);
  line(`access    ${APP_TOKEN ? "token required (APP_TOKEN is set)" : "OPEN — anyone with the URL can spend your API credit; set APP_TOKEN"}`);
  console.log("");
});
