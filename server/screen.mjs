/* Will It Hold — the screen side: TMDb for the catalog, and placement against
 * the user's own anchor scale.
 *
 * The split is the same as the games side but the line falls in a different
 * place. A TMDb record is FACT: runtime, episode count, season count, air
 * dates, genres, the network's own synopsis. Those replace the numbers the
 * model used to supply from memory, which were the ones that drifted.
 *
 * The six holdability axes and the placement are INFERRED, and they are
 * deliberately NOT blind: the whole design is that the user's own anchor
 * numbers are the ruler, so the scale is part of the input. That is the
 * opposite of the games rater and it is on purpose — here the model is not
 * estimating a property of the work, it is locating it on someone's personal
 * scale. Nothing inferred is ever labelled verified. */

const TMDB_BASE = "https://api.themoviedb.org/3";

function clean(s, n = 1200) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
const yearOf = d => (d && /^\d{4}/.test(d)) ? Number(String(d).slice(0, 4)) : null;

export class Tmdb {
  constructor({ apiKey, readToken, base }) {
    this.key = apiKey; this.token = readToken; this.base = base || TMDB_BASE;
    this.name = "tmdb"; this.genreCache = {};
  }
  configured() { return !!(this.key || this.token); }

  async get(pathname, params) {
    const u = new URL(`${this.base}/${pathname}`);
    for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, v);
    const headers = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    else u.searchParams.set("api_key", this.key);
    const r = await fetch(u, { headers });
    if (!r.ok) throw new Error(`TMDb failed (${r.status}): ${clean(await r.text(), 200)}`);
    return r.json();
  }

  /* Facts only. Episode counts and runtimes come from here so they stop being
   * remembered wrong. */
  shapeTv(g) {
    const runs = (g.episode_run_time || []).filter(Boolean);
    return {
      id: `tmdb:tv:${g.id}`, kind: "show", title: g.name,
      meta: {
        source: "tmdb", kind: "show",
        sourceUrl: `https://www.themoviedb.org/tv/${g.id}`,
        year: yearOf(g.first_air_date), endYear: yearOf(g.last_air_date),
        status: g.status || null,
        episodes: g.number_of_episodes ?? null,
        seasons: g.number_of_seasons ?? null,
        epMinutes: runs.length ? Math.round(runs.reduce((a, b) => a + b, 0) / runs.length) : null,
        genres: (g.genres || []).map(x => x.name),
        networks: (g.networks || []).map(x => x.name),
        creators: (g.created_by || []).map(x => x.name),
        language: g.original_language || null,
        overview: clean(g.overview),
        voteCount: g.vote_count || 0,
        poster: g.poster_path ? `https://image.tmdb.org/t/p/w185${g.poster_path}` : null,
        keywords: g.keywords ? (g.keywords.results || g.keywords.keywords || []).map(k => k.name) : undefined,
        retrievedAt: Date.now(),
      },
    };
  }
  shapeMovie(g) {
    return {
      id: `tmdb:movie:${g.id}`, kind: "film", title: g.title,
      meta: {
        source: "tmdb", kind: "film",
        sourceUrl: `https://www.themoviedb.org/movie/${g.id}`,
        year: yearOf(g.release_date), endYear: null, status: g.status || null,
        episodes: 0, seasons: 0,
        epMinutes: g.runtime || null,           // the whole runtime, as one sitting
        genres: (g.genres || []).map(x => x.name),
        networks: [], creators: [],
        language: g.original_language || null,
        overview: clean(g.overview),
        voteCount: g.vote_count || 0,
        poster: g.poster_path ? `https://image.tmdb.org/t/p/w185${g.poster_path}` : null,
        keywords: g.keywords ? (g.keywords.keywords || g.keywords.results || []).map(k => k.name) : undefined,
        retrievedAt: Date.now(),
      },
    };
  }

  /* ---- for Wavelength: vibe search ------------------------------------ */

  // TMDb's own tag vocabulary. A phrase resolves to its closest real tag, or nothing.
  async keywordIds(phrases) {
    const out = [];
    await Promise.all((phrases || []).slice(0, 10).map(async phrase => {
      try {
        const j = await this.get("search/keyword", { query: phrase });
        const hit = (j.results || [])[0];
        if (hit) out.push({ phrase, id: hit.id, name: hit.name });
      } catch (e) { /* an unmatched phrase is simply dropped */ }
    }));
    return out;
  }

  async genreIdsByName(kind, names) {
    const map = await this.genreNames(kind);
    const byName = {};
    for (const [id, n] of Object.entries(map)) byName[String(n).toLowerCase()] = Number(id);
    return (names || []).map(n => byName[String(n).toLowerCase()]).filter(Boolean);
  }

  // One page of discover results filtered by the vibe's genres and tags.
  async discoverVibe({ kind, genreIds = [], keywordIds = [], withoutGenreIds = [], withoutKeywordIds = [],
                        from = null, to = null, maxRuntime = null, page = 1 }) {
    const endpoint = kind === "show" ? "tv" : "movie";
    const dateKey = kind === "show" ? "first_air_date" : "primary_release_date";
    const params = {
      language: "en-US", include_adult: "false", page,
      sort_by: "vote_count.desc",
      "vote_count.gte": kind === "show" ? 60 : 150,
      with_genres: genreIds.join("|") || null,          // | is OR in TMDb discover
      with_keywords: keywordIds.join("|") || null,
      without_genres: withoutGenreIds.join(",") || null,
      without_keywords: withoutKeywordIds.join(",") || null,
      [`${dateKey}.gte`]: from ? `${from}-01-01` : null,
      [`${dateKey}.lte`]: to ? `${to}-12-31` : null,
      "with_runtime.lte": kind === "film" && maxRuntime ? maxRuntime : null,
    };
    const j = await this.get(`discover/${endpoint}`, params);
    return (j.results || []).map(r => ({ id: `tmdb:${endpoint}:${r.id}`, kind }));
  }

  // Full record plus TMDb's keyword tags, in one request.
  async detailsWithKeywords(id) {
    const m = /^tmdb:(tv|movie):(\d+)$/.exec(String(id));
    if (!m) throw new Error("not a TMDb id");
    const row = await this.get(`${m[1]}/${m[2]}`, { language: "en-US", append_to_response: "keywords" });
    return m[1] === "tv" ? this.shapeTv(row) : this.shapeMovie(row);
  }

  async genreNames(kind) {
    if (this.genreCache[kind]) return this.genreCache[kind];
    const j = await this.get(`genre/${kind === "show" ? "tv" : "movie"}/list`, { language: "en-US" });
    const map = {};
    for (const g of j.genres || []) map[g.id] = g.name;
    this.genreCache[kind] = map;
    return map;
  }

  /* Search returns lightweight rows; details are fetched when one is picked,
   * because only the detail endpoint carries runtime and episode counts. */
  async search(q, limit = 10, form = "either") {
    const want = [];
    if (form !== "film") want.push(["tv", "show"]);
    if (form !== "show") want.push(["movie", "film"]);
    const out = [];
    for (const [endpoint, kind] of want) {
      const j = await this.get(`search/${endpoint}`, { query: q, include_adult: "false", language: "en-US" });
      const genres = await this.genreNames(kind);
      for (const row of (j.results || []).slice(0, limit)) {
        out.push({
          id: `tmdb:${endpoint}:${row.id}`, kind,
          title: kind === "show" ? row.name : row.title,
          partial: true,
          meta: {
            source: "tmdb", kind,
            sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
            year: yearOf(kind === "show" ? row.first_air_date : row.release_date),
            genres: (row.genre_ids || []).map(id => genres[id]).filter(Boolean),
            overview: clean(row.overview, 300),
            voteCount: row.vote_count || 0,
            retrievedAt: Date.now(),
          },
        });
      }
    }
    return out.sort((a, b) => (b.meta.voteCount || 0) - (a.meta.voteCount || 0)).slice(0, limit);
  }

  async byId(id) {
    const m = /^tmdb:(tv|movie):(\d+)$/.exec(String(id));
    if (!m) throw new Error("not a TMDb id");
    const row = await this.get(`${m[1]}/${m[2]}`, { language: "en-US" });
    return m[1] === "tv" ? this.shapeTv(row) : this.shapeMovie(row);
  }

  /* The candidate pool. Real discovery: sorted by vote count with a floor, so
   * it returns things that exist and that people have actually watched. */
  async discover(opts = {}) {
    const form = opts.form || "either";
    const page = Math.max(1, Math.floor((Number(opts.offset) || 0) / 20) + 1);
    const kinds = form === "film" ? [["movie", "film"]] : form === "show" ? [["tv", "show"]]
      : [["tv", "show"], ["movie", "film"]];
    const out = [];
    for (const [endpoint, kind] of kinds) {
      const j = await this.get(`discover/${endpoint}`, {
        language: "en-US", include_adult: "false", page,
        sort_by: "vote_count.desc",
        "vote_count.gte": endpoint === "tv" ? 150 : 400,
        with_original_language: opts.language || null,
        with_genres: (opts.genreIds || []).join(",") || null,
      });
      const genres = await this.genreNames(kind);
      for (const row of j.results || []) {
        out.push({
          id: `tmdb:${endpoint}:${row.id}`, kind, partial: true,
          title: kind === "show" ? row.name : row.title,
          meta: {
            source: "tmdb", kind,
            sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
            year: yearOf(kind === "show" ? row.first_air_date : row.release_date),
            genres: (row.genre_ids || []).map(id => genres[id]).filter(Boolean),
            overview: clean(row.overview, 300),
            voteCount: row.vote_count || 0,
            retrievedAt: Date.now(),
          },
        });
      }
    }
    return out;
  }
}

export function makeScreenCatalog(env) {
  const t = new Tmdb({ apiKey: env.TMDB_API_KEY, readToken: env.TMDB_READ_TOKEN, base: env.TMDB_API_BASE });
  return {
    client: t,
    provider: t.configured() ? "tmdb" : null,
    connected: t.configured(),
    missing: t.configured() ? [] : ["TMDB_API_KEY (or TMDB_READ_TOKEN)"],
    search: (q, n, form) => t.configured() ? t.search(q, n, form) : Promise.reject(new Error("no TMDb credentials")),
    byId: id => t.configured() ? t.byId(id) : Promise.reject(new Error("no TMDb credentials")),
    discover: o => t.configured() ? t.discover(o) : Promise.reject(new Error("no TMDb credentials")),
  };
}

/* ---- the prompt pieces, lifted from the app so both copies stay identical -- */

const DOCTRINE = `HOLDABILITY is whether this person actually gets through the thing. It is NOT
quality, prestige, taste, or whether the show is worth watching. A brilliant show can score 3
and a mediocre one can score 9. Never let your opinion of the work move this number.

What raises it: something grabbing inside the first few minutes; frequent payoff so attention
gets fed; a low load on working memory — few names, factions, timelines to hold; episodes
short enough that starting one is cheap; being able to return after weeks away without
rewatching; ending in a way that makes the next one easy to start.

What sinks it: a slow burn that asks for patience up front; long atmospheric stretches with
nothing landing; a large cast and dense plot you must track or be lost; hour-plus episodes;
heavy serialisation that punishes a gap; subtitles combined with a second-screen habit;
a season count that reads as impossible before you begin.

Be concrete about the work. Runtimes, cast size, how fast the first episode moves, whether
episodes close anything. Do not speak in generalities about attention.`;

const FILM_RULES = `IF IT IS A FILM the shape of the problem changes and these override:
- There is no next episode to rescue a slow open, so the first ten minutes carry far more
  weight than they do for a series.
- Cost to start is the entire runtime as one commitment, not one cheap episode. Ninety
  minutes and a hundred and fifty are genuinely different propositions, and a long film is
  a harder ask than a long series made of short parts.
- Re-entry mostly does not exist. A film paused forty minutes in is usually never resumed,
  so the real question is whether he finishes it in one sitting. Score re-entry on whether
  it survives being stopped at all, and say so in the note.
- Judge pull as whether the middle sags, not whether there is a cliffhanger — the failure
  mode is drifting out during the second act, not failing to start episode four.
- The wall is a point in the runtime, not an episode number.
Set epMinutes to the runtime and leave episodes and seasons at 0.`;

const PLACEMENT = `THE USER'S SCALE IS THE FINAL AUTHORITY.
Pick exactly ONE anchor below that is closest in HOLDABILITY — not genre, quality or subject.
Copy its title EXACTLY. Then give a delta from -1.5 to +1.5. 0 means the same difficulty to
finish; +0.5 clearly easier to finish; -0.5 clearly harder. Usually stay within +/-0.75.
Final score = anchor score + delta. The axes are evidence for the placement, never an override.`;

const SHAPE = `FAMILIARITY 0-3: 3 thoroughly; 2 well enough; 1 mostly reputation; 0 unknown.
IDENT: creator, years, and the premise in one line so a wrong match is caught.`;

const AXES = [
  ["hook",     "Grabs you fast",       "Something pulls in the first few minutes, not the third episode"],
  ["payoff",   "Pays off often",       "A joke, a turn, a reveal lands regularly. Little dead air"],
  ["tracking", "Easy to follow",       "Few names and threads to hold. Look away and you're not lost"],
  ["reentry",  "Easy to come back to", "Drop it three weeks, pick it up without rewatching"],
  ["epload",   "Cheap to start one",   "Short episodes. Low cost to press play on the next"],
  ["pull",     "Makes you want more",  "Ends leaving you wanting the next one"],
];
export const AXIS_KEYS = AXES.map(a => a[0]);

const axisCell = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 5, description: "0-5, evidence for the placement" },
    note: { type: "string", description: "the concrete detail behind it, under 25 words" },
  },
  required: ["score", "note"], additionalProperties: false,
};

const placementBlock = {
  anchor: { type: "string", description: "the EXACT title of one anchor from his scale" },
  delta: { type: "number", minimum: -1.5, maximum: 1.5, description: "how much easier (+) or harder (-) to finish than that anchor" },
  near: { type: "string", description: "why that anchor is the closest match for difficulty of finishing" },
};

function readSchema(hasFacts) {
  const shape = hasFacts
    ? { hookMinutes: { type: ["number", "null"], description: "roughly how many minutes in before it genuinely grabs" },
        wall: { type: "string", description: "where people typically stop, one sentence, or empty" } }
    : { epMinutes: { type: ["number", "null"] }, episodes: { type: ["number", "null"] },
        seasons: { type: ["number", "null"] },
        hookMinutes: { type: ["number", "null"] }, wall: { type: "string" } };
  return {
    type: "object",
    properties: {
      ident: { type: "string", description: "creator, years, and the premise in one line" },
      placement: { type: "object", properties: placementBlock, required: ["anchor", "delta", "near"], additionalProperties: false },
      axes: { type: "object", properties: Object.fromEntries(AXIS_KEYS.map(k => [k, axisCell])),
              required: AXIS_KEYS, additionalProperties: false },
      shape: { type: "object", properties: shape, required: Object.keys(shape), additionalProperties: false },
      tactics: { type: "array", items: { type: "string" }, description: "three to five concrete things that would get him through THIS one" },
      stopRule: { type: "string", description: "one sentence: how to stop so coming back still works" },
      secondScreen: { type: "string", enum: ["yes", "partly", "no"] },
      familiarity: { type: "number", minimum: 0, maximum: 3, description: "3 you know it thoroughly, 0 unknown" },
    },
    required: ["ident", "placement", "axes", "shape", "tactics", "stopRule", "secondScreen", "familiarity"],
    additionalProperties: false,
  };
}

const batchSchema = hasFacts => ({
  type: "object",
  properties: { titles: { type: "array", items: {
    type: "object",
    properties: Object.assign({ title: { type: "string", description: "the exact title as given" } },
      readSchema(hasFacts).properties),
    required: ["title"].concat(readSchema(hasFacts).required),
    additionalProperties: false,
  } } },
  required: ["titles"], additionalProperties: false,
});

function factsLine(t) {
  const m = t.facts || {};
  if (!m || !Object.keys(m).length) return `"${t.title}" — no catalog record; go on what you know.`;
  const bits = [];
  bits.push(m.kind === "film" ? "a feature film" : "a television series");
  if (m.year) bits.push(m.endYear && m.endYear !== m.year ? `${m.year}-${m.endYear}` : `${m.year}`);
  if (m.status) bits.push(String(m.status).toLowerCase());
  if (m.kind === "film") { if (m.epMinutes) bits.push(`${m.epMinutes} minute runtime`); }
  else {
    if (m.episodes) bits.push(`${m.episodes} episodes`);
    if (m.seasons) bits.push(`${m.seasons} season${m.seasons === 1 ? "" : "s"}`);
    if (m.epMinutes) bits.push(`about ${m.epMinutes} minutes an episode`);
  }
  if (m.genres && m.genres.length) bits.push(m.genres.join(", "));
  if (m.networks && m.networks.length) bits.push(`on ${m.networks.join(", ")}`);
  if (m.creators && m.creators.length) bits.push(`by ${m.creators.join(", ")}`);
  if (m.overview) bits.push(`synopsis: ${m.overview}`);
  return `"${t.title}" — ${bits.join("; ")}`;
}

function scaleBlock(scale) {
  const out = [];
  const anchors = (scale.anchors || []).slice().sort((a, b) => b.score - a.score);
  out.push("HIS HOLDABILITY ANCHORS (1-10; his numbers are ground truth):\n"
    + anchors.map(a => `  ${a.title} = ${a.score}${a.note ? " — " + a.note : ""}`).join("\n"));
  const corr = (scale.corrections || []).filter(c => c && c.title);
  if (corr.length) out.push("HIS CORRECTIONS — these outrank any prediction:\n"
    + corr.map(c => `  ${c.title}: app said ${Number(c.said).toFixed(1)}; he says ${Number(c.actual).toFixed(1)}`).join("\n")
    + "\nTreat each as an anchor.");
  const outc = (scale.outcomes || []).filter(o => o && o.title);
  if (outc.length) out.push("WHAT ACTUALLY HAPPENED — the outcomes this scale exists to predict. Where a\nprediction missed, correct toward the outcome:\n"
    + outc.map(o => `  ${o.title} — predicted ${Number(o.said).toFixed(1)} — he ${o.verdict}`).join("\n"));
  return out.join("\n\n");
}

export function makeScreenRater(client, model, fallbackModel, effort, betas, parseWith) {
  return {
    /* titles: [{id, title, kind, facts}] — facts are the TMDb record, or {} when
     * no catalog is connected. scale: the user's anchors and history, which ARE
     * the ruler here and so are deliberately part of the input. */
    async place(titles, scale, { batchSize = 4 } = {}) {
      const hasFacts = titles.some(t => t.facts && Object.keys(t.facts).length);
      const out = [];
      const slices = [];
      for (let i = 0; i < titles.length; i += batchSize) slices.push(titles.slice(i, i + batchSize));
      /* The batches run side by side rather than one after another: three in a
       * row at high effort is minutes of waiting, long enough for a phone or a
       * proxy to give up on the request. And one batch failing costs only that
       * batch — the others still come back. */
      const results = await Promise.allSettled(slices.map(slice => placeSlice(slice)));
      const failures = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") out.push(...r.value);
        else { failures.push(r.reason); console.error("[screen] a placement batch failed:", r.reason && (r.reason.stack || r.reason.message || r.reason)); }
      });
      if (!out.length && failures.length) throw failures[0];
      return out;

      async function placeSlice(slice) {
        const out = [];
        const prompt = `Work out, for each of these, whether this person would actually get through it.

${DOCTRINE}

${scaleBlock(scale)}

${scale.state || ""}

${PLACEMENT}

Score each axis 0-5 as evidence for the placement:
${AXES.map(a => `  ${a[0]} — ${a[1]}: ${a[2]}`).join("\n")}

${SHAPE}

${FILM_RULES}

${hasFacts
  ? `THE RUNTIMES, EPISODE AND SEASON COUNTS BELOW ARE FROM A CATALOG AND ARE CORRECT.
Do not restate or contradict them — reason FROM them. You are asked only for the two
numbers a catalog cannot hold: how many minutes in before it genuinely grabs, and where
people stop.`
  : `No catalog record is available, so give the shape yourself — episode length, episode
count, seasons — and say plainly in the ident if you are unsure.`}

TACTICS: three to five concrete things that would get him through this one specifically.
Practical, specific to this work, no general advice about focus.

THE TITLES, in this order:
${slice.map((t, n) => `${n + 1}. ${factsLine(t)}`).join("\n\n")}`;

        const parsed = await parseWith(prompt, batchSchema(hasFacts), { model, fallbackModel, effort, betas });
        const rows = (parsed && Array.isArray(parsed.titles)) ? parsed.titles : [];
        const used = new Set();
        rows.forEach((row, idx) => {
          const n = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          let want = slice.find(t => !used.has(t.id) && n(t.title) === n(row.title));
          if (!want) want = slice[idx] && !used.has(slice[idx].id) ? slice[idx] : slice.find(t => !used.has(t.id));
          if (!want) return;
          used.add(want.id);
          out.push({
            id: want.id, title: want.title, kind: want.kind,
            reading: {
              ident: row.ident, placement: row.placement, axes: row.axes,
              shape: row.shape, tactics: row.tactics, stopRule: row.stopRule,
              secondScreen: row.secondScreen, familiarity: row.familiarity,
              method: "model-inference",      // never verified, catalog or not
              groundedIn: (want.facts && Object.keys(want.facts).length)
                ? { source: want.facts.source || null, fields: Object.keys(want.facts) } : null,
              model, at: Date.now(),
            },
          });
        });
        return out;
      }
    },
  };
}
