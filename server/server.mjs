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

const catalog = makeCatalog(env);
const rater = makeRater(env);
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
      rater: { configured: rater.configured(), model: rater.model, schema: RATING_SCHEMA_VERSION },
      ratingsCached: store.ratingCount(),
      features: FEATURE_KEYS,
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
  line(`catalog   ${catalog.connected ? `${catalog.provider} connected` : `NOT connected — set ${catalog.missing.join(", ")}`}`);
  line(`ratings   ${rater.configured() ? `${rater.model} via ANTHROPIC_API_KEY` : "NOT configured — set ANTHROPIC_API_KEY"}`);
  line(`data      ${DATA_DIR}`);
  line(`app       ${APP_HTML}`);
  line(`access    ${APP_TOKEN ? "token required (APP_TOKEN is set)" : "OPEN — anyone with the URL can spend your API credit; set APP_TOKEN"}`);
  console.log("");
});
