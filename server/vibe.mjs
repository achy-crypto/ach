/* Wavelength — find a show or film from a feeling.
 *
 * Three steps, and the line between fact and judgment sits in the same place
 * as the rest of this server:
 *
 *   1. READ    Claude turns the vibe into things TMDb understands: its genre
 *              names, short tag phrases, an era, a runtime cap, things to
 *              avoid, and a handful of titles that fit.
 *   2. PULL    TMDb does the retrieval. Tag phrases resolve to TMDb's own
 *              keyword ids, discover is filtered by them, and the suggested
 *              titles are looked up — one that doesn't exist on TMDb is
 *              dropped, not shown. Every candidate is a real catalog record.
 *   3. SCORE   Claude scores each candidate against the vibe from TMDb's own
 *              synopsis, genres and tags. That number is a judgment and is
 *              labelled as one. The tags and genres the candidate shares with
 *              the reading are computed here, not by the model, and are shown
 *              as the catalog facts they are.
 */

const genreField = names => names.length ? { type: "string", enum: names } : { type: "string" };

const READ_SCHEMA = (movieGenres, tvGenres) => ({
  type: "object",
  properties: {
    heard: { type: "array", items: { type: "string" },
      description: "3 to 6 short phrases saying how you read the vibe, in plain words, e.g. 'low stakes', 'rainy afternoon', 'found family'" },
    form: { type: "string", enum: ["show", "film", "either"],
      description: "show or film only if the person clearly asked for one; otherwise either" },
    genres: { type: "array", items: genreField(Array.from(new Set(movieGenres.concat(tvGenres)))),
      description: "TMDb genre names that fit. Two or three at most — genre is a blunt instrument" },
    keywords: { type: "array", items: { type: "string" },
      description: "4 to 8 short tag phrases of the kind TMDb uses: 'heist', 'small town', 'road trip', 'coming of age', 'slow burn', 'time loop'. Concrete, not adjectives about quality" },
    avoidGenres: { type: "array", items: genreField(Array.from(new Set(movieGenres.concat(tvGenres)))),
      description: "genres the vibe rules out, if it clearly does" },
    avoidKeywords: { type: "array", items: { type: "string" },
      description: "tag phrases the vibe rules out, e.g. 'gore' for someone who asked for cosy" },
    from: { type: ["integer", "null"], description: "earliest release year, only if the vibe implies an era" },
    to: { type: ["integer", "null"], description: "latest release year, only if the vibe implies an era" },
    maxRuntime: { type: ["integer", "null"], description: "a runtime cap in minutes for films, only if the vibe implies one ('something short')" },
    seeds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: ["integer", "null"] },
          kind: { type: "string", enum: ["show", "film"] },
        },
        required: ["title", "year", "kind"],
        additionalProperties: false,
      },
      description: "8 to 12 real titles that genuinely fit. Spread them: different decades, countries and sizes, not just the famous ones",
    },
  },
  required: ["heard", "form", "genres", "keywords", "avoidGenres", "avoidKeywords", "from", "to", "maxRuntime", "seeds"],
  additionalProperties: false,
});

const RANK_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "the id exactly as given" },
          match: { type: "integer", minimum: 0, maximum: 100 },
          reason: { type: "string", description: "why it fits or doesn't, in under 22 words, naming concrete things about THIS title" },
          matchedOn: { type: "array", items: { type: "string" }, description: "up to 3 short phrases from the vibe this title actually delivers" },
          misses: { type: "string", description: "the one part of the vibe it doesn't deliver, or an empty string" },
        },
        required: ["id", "match", "reason", "matchedOn", "misses"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

function factsLine(t) {
  const m = t.meta || {};
  const bits = [m.kind === "film" ? "film" : "series"];
  if (m.year) bits.push(String(m.year));
  if (m.kind === "film" && m.epMinutes) bits.push(`${m.epMinutes} min`);
  if (m.kind !== "film" && m.seasons) bits.push(`${m.seasons} season${m.seasons === 1 ? "" : "s"}`);
  if (m.genres && m.genres.length) bits.push(`genres: ${m.genres.join(", ")}`);
  if (m.keywords && m.keywords.length) bits.push(`tags: ${m.keywords.slice(0, 14).join(", ")}`);
  if (m.overview) bits.push(`synopsis: ${String(m.overview).slice(0, 420)}`);
  return `[${t.id}] "${t.title}" — ${bits.join("; ")}`;
}

// Shared tags and genres, computed here rather than claimed by the model.
function overlapOf(meta, reading) {
  const norm = s => String(s || "").toLowerCase().trim();
  const wantTags = new Set((reading.resolvedKeywords || []).map(k => norm(k.name)).concat((reading.keywords || []).map(norm)));
  const wantGenres = new Set((reading.genres || []).map(norm));
  return {
    tags: (meta.keywords || []).filter(k => wantTags.has(norm(k))).slice(0, 4),
    genres: (meta.genres || []).filter(g => wantGenres.has(norm(g))),
  };
}

export function makeVibe({ screenCatalog, store, llm }) {
  const tmdb = screenCatalog.client;

  async function record(id) {
    const known = store.getScreen(id);
    if (known && known.meta && Array.isArray(known.meta.keywords)) return known;
    const row = await tmdb.detailsWithKeywords(id);
    if (row) await store.putScreen([row]);
    return row;
  }

  return {
    /* Steps 1 and 2. Returns the reading and a pool of real TMDb records. */
    async pool(vibe, formWanted) {
      const [movieMap, tvMap] = await Promise.all([tmdb.genreNames("film"), tmdb.genreNames("show")]);
      const movieGenres = Object.values(movieMap), tvGenres = Object.values(tvMap);

      const reading = await llm.parse(
`Someone wants something to watch and has described it in their own words. Read it the way
a good video-shop clerk would: what feeling are they after, and what would deliver it?

THEIR WORDS: """${String(vibe).slice(0, 600)}"""
${formWanted && formWanted !== "either" ? `They asked for a ${formWanted === "film" ? "film" : "series"}.` : ""}

Translate it into things a film catalog can search on. Tag phrases should be concrete
subject matter or structure ("heist", "small town", "unreliable narrator"), not praise
("great", "well-acted"). Leave era and runtime null unless the words imply them. Seeds must
be real titles you are confident exist, and they should fit the FEELING, not just the genre.`,
        READ_SCHEMA(movieGenres, tvGenres), { effort: "low" });

      const form = formWanted && formWanted !== "either" ? formWanted : (reading.form || "either");
      const kinds = form === "either" ? ["show", "film"] : [form];

      const resolvedKeywords = await tmdb.keywordIds(reading.keywords || []);
      const avoidKeywords = await tmdb.keywordIds(reading.avoidKeywords || []);
      reading.resolvedKeywords = resolvedKeywords;

      // Discover by genre-or-tag, per kind; then the seeds, looked up by title.
      const found = [];
      await Promise.all(kinds.map(async kind => {
        const [genreIds, avoidGenreIds] = await Promise.all([
          tmdb.genreIdsByName(kind, reading.genres), tmdb.genreIdsByName(kind, reading.avoidGenres)]);
        const common = { kind, withoutGenreIds: avoidGenreIds, withoutKeywordIds: avoidKeywords.map(k => k.id),
          from: reading.from, to: reading.to, maxRuntime: reading.maxRuntime };
        const byTags = resolvedKeywords.length
          ? await tmdb.discoverVibe(Object.assign({ keywordIds: resolvedKeywords.map(k => k.id) }, common)).catch(() => [])
          : [];
        const byGenre = genreIds.length
          ? await tmdb.discoverVibe(Object.assign({ genreIds }, common)).catch(() => [])
          : [];
        found.push(...byTags.slice(0, 14), ...byGenre.slice(0, 6));
      }));

      const seedsDropped = [];
      await Promise.all((reading.seeds || []).slice(0, 12).map(async s => {
        if (form !== "either" && s.kind !== form) return;
        try {
          const hits = await tmdb.search(s.title, 3, s.kind);
          const best = hits.find(h => !s.year || !h.meta.year || Math.abs(h.meta.year - s.year) <= 1) || hits[0];
          if (best) found.unshift({ id: best.id, kind: best.kind, seed: true });
          else seedsDropped.push(s.title);
        } catch { seedsDropped.push(s.title); }
      }));

      const seen = new Set(), ids = [];
      for (const f of found) if (!seen.has(f.id)) { seen.add(f.id); ids.push(f); }
      const pool = (await Promise.all(ids.slice(0, 30).map(async f => {
        try { const r = await record(f.id); return r ? Object.assign({ seed: !!f.seed }, r) : null; }
        catch { return null; }
      }))).filter(Boolean);

      return {
        reading: {
          heard: reading.heard || [], form, genres: reading.genres || [], keywords: reading.keywords || [],
          resolvedKeywords, avoid: (reading.avoidGenres || []).concat(reading.avoidKeywords || []),
          from: reading.from, to: reading.to, maxRuntime: reading.maxRuntime,
        },
        pool: pool.map(r => ({ id: r.id, title: r.title, kind: r.kind, seed: r.seed, meta: r.meta })),
        seedsDropped,
      };
    },

    /* Step 3. Facts are re-read from the server's own cache by id, never taken
     * from the caller. Batches run side by side; one failing costs only itself. */
    async rank(vibe, reading, ids) {
      const titles = (await Promise.all((ids || []).slice(0, 30).map(async id => {
        try { return await record(id); } catch { return null; }
      }))).filter(Boolean);
      if (!titles.length) return [];

      const batches = [];
      for (let i = 0; i < titles.length; i += 10) batches.push(titles.slice(i, i + 10));
      const settled = await Promise.allSettled(batches.map(batch => llm.parse(
`Score how well each title below matches what this person asked for.

THEIR WORDS: """${String(vibe).slice(0, 600)}"""
HOW IT WAS READ: ${(reading.heard || []).join(" · ")}

Judge from the catalog facts given (synopsis, genres, tags) and what you know of each title.
Score the FEELING they asked for, not quality or popularity: a beloved classic that misses the
mood scores low, an obscure one that nails it scores high.

Use the whole range, and be sparing at the top:
  90-100  this is almost exactly what they described
  75-89   a strong fit; one part of it is off
  55-74   partly there
  35-54   shares a genre or a surface, not the feeling
  0-34    wrong for this

THE TITLES:
${batch.map(factsLine).join("\n\n")}

Return one entry for every title, using each id exactly as given.`,
        RANK_SCHEMA, { effort: "medium" })));

      const byId = new Map(titles.map(t => [t.id, t]));
      const out = [];
      settled.forEach((r, i) => {
        if (r.status !== "fulfilled") {
          console.error("[vibe] a scoring batch failed:", r.reason && (r.reason.message || r.reason));
          return;
        }
        for (const row of (r.value.results || [])) {
          const t = byId.get(String(row.id));
          if (!t) continue;
          out.push({
            id: t.id, title: t.title, kind: t.kind, meta: t.meta,
            match: Math.max(0, Math.min(100, Math.round(Number(row.match) || 0))),
            reason: String(row.reason || ""), matchedOn: (row.matchedOn || []).slice(0, 3),
            misses: String(row.misses || ""),
            overlap: overlapOf(t.meta || {}, reading || {}),
            method: "model-judgment",   // the score is Claude's read, never a catalog fact
          });
        }
      });
      if (!out.length && settled.some(r => r.status === "rejected"))
        throw settled.find(r => r.status === "rejected").reason;
      return out.sort((a, b) => b.match - a.match);
    },
  };
}
