/* Catalog providers. Credentials live here and never reach the browser.
 *
 * A provider returns CATALOG METADATA only — title, year, developer, platforms,
 * genres, modes, the publisher's own summary. It never returns gameplay feature
 * ratings: those are inferred separately in rate.mjs and stay labelled as
 * inferred, whether or not a catalog is connected. */

const IGDB_FIELDS = [
  "name", "slug", "first_release_date", "summary", "storyline", "url",
  "category", "total_rating_count", "total_rating",
  "genres.name", "themes.name", "game_modes.name", "player_perspectives.name",
  "platforms.name", "platforms.abbreviation",
  "involved_companies.developer", "involved_companies.publisher",
  "involved_companies.company.name",
  "cover.image_id", "keywords.name",
].join(",");

function clean(s, n = 1200) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
}

/* ---------------------------------------------------------------- IGDB ---- */

class Igdb {
  constructor({ clientId, clientSecret, apiBase, authBase }) {
    this.id = clientId; this.secret = clientSecret;
    this.apiBase = apiBase || "https://api.igdb.com";
    this.authBase = authBase || "https://id.twitch.tv";
    this.token = null; this.expires = 0;
    this.name = "igdb";
  }
  configured() { return !!(this.id && this.secret); }

  async auth() {
    if (this.token && Date.now() < this.expires - 60_000) return this.token;
    const url = `${this.authBase}/oauth2/token`
      + `?client_id=${encodeURIComponent(this.id)}`
      + `&client_secret=${encodeURIComponent(this.secret)}`
      + "&grant_type=client_credentials";
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) throw new Error(`IGDB auth failed (${r.status}): ${clean(await r.text(), 200)}`);
    const j = await r.json();
    this.token = j.access_token;
    this.expires = Date.now() + (j.expires_in || 3600) * 1000;
    return this.token;
  }

  async query(body) {
    const token = await this.auth();
    const r = await fetch(`${this.apiBase}/v4/games`, {
      method: "POST",
      headers: {
        "Client-ID": this.id,
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "Content-Type": "text/plain",
      },
      body,
    });
    if (r.status === 401) { this.token = null; throw new Error("IGDB rejected the token; it will re-authenticate on retry"); }
    if (!r.ok) throw new Error(`IGDB query failed (${r.status}): ${clean(await r.text(), 200)}`);
    return r.json();
  }

  shape(g) {
    const companies = (g.involved_companies || []);
    const devs = companies.filter(c => c.developer).map(c => c.company && c.company.name).filter(Boolean);
    const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
    const names = a => (a || []).map(x => x.name).filter(Boolean);
    return {
      id: `igdb:${g.id}`,
      title: g.name,
      meta: {
        source: "igdb",
        sourceUrl: g.url || `https://www.igdb.com/games/${g.slug || ""}`,
        year,
        developers: devs,
        genres: names(g.genres),
        themes: names(g.themes),
        modes: names(g.game_modes),
        perspectives: names(g.player_perspectives),
        platforms: names(g.platforms),
        summary: clean(g.summary),
        keywords: names(g.keywords).slice(0, 24),
        cover: g.cover && g.cover.image_id
          ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : null,
        ratingCount: g.total_rating_count || 0,
        retrievedAt: Date.now(),
      },
    };
  }

  // Real title search. Returns stable ids.
  async search(q, limit = 12) {
    const safe = String(q).replace(/"/g, "");
    const rows = await this.query(
      `search "${safe}"; fields ${IGDB_FIELDS};`
      + ` where category = (0,3,8,9,10,11) & version_parent = null;`
      + ` limit ${Math.min(50, Math.max(1, limit))};`);
    return rows.map(g => this.shape(g));
  }

  async byId(id) {
    const n = String(id).replace(/^igdb:/, "");
    if (!/^\d+$/.test(n)) throw new Error("not an IGDB id");
    const rows = await this.query(`fields ${IGDB_FIELDS}; where id = ${n};`);
    return rows.length ? this.shape(rows[0]) : null;
  }

  /* A broad candidate pool straight from the catalog — this is the retrieval
   * step. Scoring happens in the browser against the user's own examples. */
  async discover(opts = {}) {
    const limit = Math.min(60, Math.max(1, opts.limit || 40));
    const where = ["category = 0", "version_parent = null", "total_rating_count > 25"];
    if (opts.platforms && opts.platforms.length)
      where.push(`platforms.name ~ *"${String(opts.platforms[0]).replace(/"/g, "")}"*`);
    if (opts.genres && opts.genres.length)
      where.push(`genres.name = ("${opts.genres.map(g => String(g).replace(/"/g, "")).join('","')}")`);
    if (opts.modes && opts.modes.length)
      where.push(`game_modes.name = ("${opts.modes.map(m => String(m).replace(/"/g, "")).join('","')}")`);
    if (opts.since) where.push(`first_release_date > ${Math.floor(opts.since / 1000)}`);
    const offset = Math.max(0, Number(opts.offset) || 0);
    const rows = await this.query(
      `fields ${IGDB_FIELDS}; where ${where.join(" & ")};`
      + ` sort total_rating_count desc; limit ${limit}; offset ${offset};`);
    return rows.map(g => this.shape(g));
  }

  /* Retrieval for a described feeling: anything carrying one of the wanted
   * genres, themes or keywords, filtered by mode, platform and era. */
  async discoverVibe(o = {}) {
    const q = a => a.map(x => `"${String(x).replace(/"/g, "")}"`).join(",");
    const any = [];
    if (o.genres && o.genres.length) any.push(`genres.name = (${q(o.genres)})`);
    if (o.themes && o.themes.length) any.push(`themes.name = (${q(o.themes)})`);
    if (o.keywords && o.keywords.length) any.push(`keywords.name = (${q(o.keywords)})`);
    if (!any.length) return [];
    // No category filter: IGDB is moving that field to game_type, and the rating floor already keeps DLC out.
    const where = ["version_parent = null", "total_rating_count > 8", `(${any.join(" | ")})`];
    if (o.modes && o.modes.length) where.push(`game_modes.name = (${q(o.modes)})`);
    if (o.platform) where.push(`(${o.platform.map(p => `platforms.name ~ *"${p.replace(/"/g, "")}"*`).join(" | ")})`);
    if (o.from) where.push(`first_release_date >= ${Math.floor(Date.UTC(o.from, 0, 1) / 1000)}`);
    if (o.to) where.push(`first_release_date < ${Math.floor(Date.UTC(o.to + 1, 0, 1) / 1000)}`);
    const rows = await this.query(`fields ${IGDB_FIELDS}; where ${where.join(" & ")};`
      + ` sort total_rating_count desc; limit ${Math.min(50, o.limit || 30)};`);
    return rows.map(g => this.shape(g));
  }
}

/* ---------------------------------------------------------------- RAWG ---- */

class Rawg {
  constructor({ apiKey, apiBase }) { this.key = apiKey; this.name = "rawg";
    this.apiBase = apiBase || "https://api.rawg.io/api"; }
  configured() { return !!this.key; }

  async get(pathname, params) {
    const u = new URL(`${this.apiBase}/${pathname}`);
    u.searchParams.set("key", this.key);
    for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`RAWG failed (${r.status}): ${clean(await r.text(), 200)}`);
    return r.json();
  }

  shape(g, detail) {
    const names = a => (a || []).map(x => x.name).filter(Boolean);
    return {
      id: `rawg:${g.id}`,
      title: g.name,
      meta: {
        source: "rawg",
        sourceUrl: `https://rawg.io/games/${g.slug || g.id}`,
        year: g.released ? Number(String(g.released).slice(0, 4)) : null,
        developers: names(g.developers),
        genres: names(g.genres),
        themes: [],
        modes: names(g.tags).filter(t => /player|multiplayer|co-op|singleplayer/i.test(t)).slice(0, 6),
        perspectives: [],
        platforms: names((g.platforms || []).map(p => p.platform)),
        summary: clean(detail && detail.description_raw),
        keywords: (g.tags || []).filter(t => !t.language || t.language === "eng").map(t => t.name).filter(Boolean).slice(0, 24),
        cover: g.background_image || null,
        medianPlaytimeHours: g.playtime || null,
        ratingCount: g.ratings_count || 0,
        retrievedAt: Date.now(),
      },
    };
  }

  async search(q, limit = 12) {
    const j = await this.get("games", { search: q, page_size: Math.min(40, limit), search_precise: "true" });
    return (j.results || []).map(g => this.shape(g, null));
  }

  async byId(id) {
    const n = String(id).replace(/^rawg:/, "");
    const g = await this.get(`games/${encodeURIComponent(n)}`, {});
    return g && g.id ? this.shape(g, g) : null;
  }

  async discover(opts = {}) {
    const page = Math.floor((Number(opts.offset) || 0) / 40) + 1;
    const j = await this.get("games", {
      page_size: Math.min(40, opts.limit || 40),
      page,
      ordering: "-added",
      metacritic: "70,100",
      platforms: opts.rawgPlatforms || null,
      genres: (opts.genres || []).map(g => String(g).toLowerCase()).join(",") || null,
    });
    return (j.results || []).map(g => this.shape(g, null));
  }

  async discoverVibe(o = {}) {
    const base = { page_size: Math.min(40, o.limit || 20), ordering: "-added",
      parent_platforms: o.rawgPlatforms || null,
      dates: o.from || o.to ? `${o.from || 1970}-01-01,${o.to || new Date().getUTCFullYear()}-12-31` : null };
    const runs = [];
    if (o.tags && o.tags.length) runs.push(this.get("games", Object.assign({ tags: o.tags.join(",") }, base)));
    if (o.genres && o.genres.length) runs.push(this.get("games", Object.assign({ genres: o.genres.join(",") }, base)));
    const out = [];
    for (const r of await Promise.allSettled(runs))
      if (r.status === "fulfilled") out.push(...(r.value.results || []).map(g => this.shape(g, null)));
    return out;
  }
}

/* ------------------------------------------------------------- factory ---- */

export function makeCatalog(env) {
  const want = String(env.CATALOG_PROVIDER || "").toLowerCase();
  const igdb = new Igdb({ clientId: env.IGDB_CLIENT_ID, clientSecret: env.IGDB_CLIENT_SECRET,
    apiBase: env.IGDB_API_BASE, authBase: env.TWITCH_AUTH_BASE });
  const rawg = new Rawg({ apiKey: env.RAWG_API_KEY, apiBase: env.RAWG_API_BASE });
  let chosen = null;
  if (want === "igdb" && igdb.configured()) chosen = igdb;
  else if (want === "rawg" && rawg.configured()) chosen = rawg;
  else if (!want) chosen = igdb.configured() ? igdb : rawg.configured() ? rawg : null;

  const missing = [];
  if (!chosen) {
    if (want === "igdb") missing.push("IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET");
    else if (want === "rawg") missing.push("RAWG_API_KEY");
    else missing.push("CATALOG_PROVIDER plus either IGDB_CLIENT_ID+IGDB_CLIENT_SECRET or RAWG_API_KEY");
  }
  return {
    provider: chosen ? chosen.name : null,
    connected: !!chosen,
    missing,
    search: (q, n) => chosen ? chosen.search(q, n) : Promise.reject(new Error("no catalog configured")),
    byId: id => chosen ? chosen.byId(id) : Promise.reject(new Error("no catalog configured")),
    discover: o => chosen ? chosen.discover(o) : Promise.reject(new Error("no catalog configured")),
    discoverVibe: o => chosen ? chosen.discoverVibe(o) : Promise.resolve([]),
  };
}
