#!/usr/bin/env node
/* Two Hours In — standalone server.
 *
 * Serves the app and gives it three things the browser cannot do for itself:
 * a real catalog search, gameplay ratings from the Claude API, and storage.
 * Every credential stays in this process. The browser is handed results only. */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeCatalog } from "./catalog.mjs";
import { makeRater, FEATURE_KEYS, RATING_SCHEMA_VERSION } from "./rate.mjs";
import { makeScreenCatalog, makeScreenRater, AXIS_KEYS } from "./screen.mjs";
import { makeLLM } from "./llm.mjs";
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
const APP_HTML = path.resolve(here, env.APP_HTML || "../games/index.html");
const APP_TOKEN = (env.APP_TOKEN || "").trim();

const APP_HTML_HOLDS = path.resolve(here, env.APP_HTML_HOLDS || "../holds/index.html");

const llm = makeLLM(env);
const catalog = makeCatalog(env);                 // games — IGDB / RAWG
const rater = makeRater(env, llm);
const screenCatalog = makeScreenCatalog(env);     // shows and films — TMDb
const screenRater = makeScreenRater(llm.client, llm.defaults.model, llm.defaults.fallbackModel,
  llm.defaults.effort, llm.defaults.betas, (prompt, schema, o) => llm.parse(prompt, schema, o));
const store = makeStore(DATA_DIR);
await store.init();

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
    return send(res, 200, {
      ok: true,
      app: "two-hours-in",
      needsToken: !!APP_TOKEN,
      authed: authed(req, url),
      catalog: { connected: catalog.connected, provider: catalog.provider, missing: catalog.missing },
      screen: { connected: screenCatalog.connected, provider: screenCatalog.provider, missing: screenCatalog.missing },
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
    const titles = [];
    for (const t of want) {
      const id = String((t && t.id) || "").trim();
      const title = String((t && t.title) || "").trim();
      if (!id || !title) continue;
      let facts = {};
      if (screenCatalog.connected && /^tmdb:/.test(id)) {
        const known = store.getScreen(id);
        if (known) facts = known.meta;
        else { try { const row = await screenCatalog.byId(id);
          if (row) { await store.putScreen([row]); facts = row.meta; } } catch (e) {
          console.warn("[screen] lookup failed for", id, e.message); } }
      }
      titles.push({ id, title, kind: (t && t.kind) || (facts && facts.kind) || "show", facts });
    }
    if (!titles.length) return fail(res, 400, "Nothing usable in that list.");
    const placed = await screenRater.place(titles, scale);
    return send(res, 200, {
      placed,
      facts: Object.fromEntries(titles.map(t => [t.id, t.facts])),
      missed: titles.filter(t => !placed.some(p => p.id === t.id)).map(t => t.title),
    });
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await fs.readFile(APP_HTML, "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    if (url.pathname === "/holds" || url.pathname === "/holds/") {
      const html = await fs.readFile(APP_HTML_HOLDS, "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
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
  console.log(`\nTwo Hours In — http://localhost:${PORT}\n`);
  console.log(`  games     http://localhost:${PORT}/`);
  console.log(`  screen    http://localhost:${PORT}/holds\n`);
  line(`catalog   games: ${catalog.connected ? `${catalog.provider} connected` : `NOT connected — set ${catalog.missing.join(", ")}`}`);
  line(`          screen: ${screenCatalog.connected ? "tmdb connected" : `NOT connected — set ${screenCatalog.missing.join(", ")}`}`);
  line(`ratings   ${llm.configured() ? `${llm.defaults.model} via ANTHROPIC_API_KEY` : "NOT configured — set ANTHROPIC_API_KEY"}`);
  line(`data      ${DATA_DIR}`);
  line(`apps      ${APP_HTML}\n            ${APP_HTML_HOLDS}`);
  line(`access    ${APP_TOKEN ? "token required (APP_TOKEN is set)" : "OPEN — anyone with the URL can spend your API credit; set APP_TOKEN"}`);
  console.log("");
});
