/* Rumble — find a game from a feeling. Wavelength's three steps, for games:
 *
 *   1. READ    Claude turns the words into things a game catalog can search
 *              on: genres, concrete tags ("roguelike", "base building"),
 *              who's playing, an era, and a handful of games that fit.
 *   2. PULL    The catalog (IGDB or RAWG) does the retrieval, and suggested
 *              games are looked up there. One that isn't in the catalog is
 *              dropped, not shown. With no catalog configured, the suggestions
 *              are kept but marked as coming from Claude's memory.
 *   3. SCORE   Claude scores each candidate against the words, from the
 *              catalog's own summary, genres and tags. The score is a judgment
 *              and is labelled as one; the tags a game shares with the reading
 *              are computed here and shown as the catalog facts they are.
 */

const IGDB_GENRES = ["Point-and-click", "Fighting", "Shooter", "Music", "Platform", "Puzzle", "Racing",
  "Real Time Strategy (RTS)", "Role-playing (RPG)", "Simulator", "Sport", "Strategy", "Turn-based strategy (TBS)",
  "Tactical", "Hack and slash/Beat 'em up", "Quiz/Trivia", "Pinball", "Adventure", "Indie", "Arcade",
  "Visual Novel", "Card & Board Game", "MOBA"];
const IGDB_THEMES = ["Action", "Fantasy", "Science fiction", "Horror", "Thriller", "Survival", "Historical", "Stealth",
  "Comedy", "Business", "Drama", "Non-fiction", "Sandbox", "Educational", "Kids", "Open world", "Warfare", "Party",
  "Mystery", "Romance"];
const RAWG_GENRES = { action: "action", indie: "indie", adventure: "adventure", rpg: "role-playing-games-rpg",
  "role-playing": "role-playing-games-rpg", strategy: "strategy", shooter: "shooter", casual: "casual",
  simulation: "simulation", simulator: "simulation", puzzle: "puzzle", arcade: "arcade", platformer: "platformer",
  platform: "platformer", racing: "racing", mmo: "massively-multiplayer", sports: "sports", sport: "sports",
  fighting: "fighting", family: "family", "board game": "board-games", card: "card", educational: "educational" };

const PLATFORMS = {
  pc: { igdb: ["PC", "Mac", "Linux"], rawg: "1", test: /\b(?:PC|Windows|Mac|Linux)\b/i },
  playstation: { igdb: ["PlayStation"], rawg: "2", test: /PlayStation|\bPS\d/i },
  xbox: { igdb: ["Xbox"], rawg: "3", test: /Xbox/i },
  switch: { igdb: ["Switch"], rawg: "7", test: /Switch/i },
  mobile: { igdb: ["iOS", "Android"], rawg: "4,8", test: /iOS|Android|iPhone|iPad/i },
};
const MODE_NAMES = { solo: ["Single player"], coop: ["Co-operative", "Split screen"],
  multiplayer: ["Multiplayer", "Massively Multiplayer Online (MMO)", "Battle Royale"] };

const READ_SCHEMA = {
  type: "object",
  properties: {
    heard: { type: "array", items: { type: "string" },
      description: "3 to 6 short phrases saying how you read the feeling, e.g. 'low pressure', 'lonely vastness', 'friends yelling'" },
    genres: { type: "array", items: { type: "string" },
      description: "2 or 3 broad genres, e.g. RPG, Puzzle, Strategy, Simulation, Adventure, Platformer, Shooter" },
    tags: { type: "array", items: { type: "string" },
      description: "4 to 8 concrete lowercase tags of the kind game catalogs use: 'roguelike', 'open world', 'base building', 'cozy', 'metroidvania', 'story rich', 'deckbuilding', 'exploration', 'atmospheric', 'local co-op'. Mechanics and moods, not praise" },
    themes: { type: "array", items: { type: "string", enum: IGDB_THEMES },
      description: "catalog themes that fit, if any" },
    avoid: { type: "array", items: { type: "string" },
      description: "genres, themes or tags the words rule out, e.g. 'horror' for someone who asked for cosy" },
    players: { type: "string", enum: ["solo", "coop", "multiplayer", "any"],
      description: "only if the words say who's playing; otherwise any" },
    length: { type: "string", enum: ["short", "medium", "long", "endless", "any"],
      description: "short is an evening or two, long is 40+ hours, endless is a game you keep coming back to; any unless implied" },
    from: { type: ["integer", "null"], description: "earliest release year, only if an era is implied" },
    to: { type: ["integer", "null"], description: "latest release year, only if an era is implied" },
    seeds: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, year: { type: ["integer", "null"] } },
        required: ["title", "year"], additionalProperties: false,
      },
      description: "10 to 14 real games that genuinely fit the FEELING. Spread them: indie and big, old and new, different platforms. Only games you are confident exist",
    },
  },
  required: ["heard", "genres", "tags", "themes", "avoid", "players", "length", "from", "to", "seeds"],
  additionalProperties: false,
};

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
          reason: { type: "string", description: "why it fits or doesn't, under 22 words, naming concrete things about THIS game: what you do in it, how it feels to play" },
          matchedOn: { type: "array", items: { type: "string" }, description: "up to 3 short phrases from the request this game actually delivers" },
          misses: { type: "string", description: "the one part of the request it doesn't deliver, or an empty string" },
          known: { type: "boolean", description: "true if you know this game well enough to judge how it plays, beyond the facts given" },
        },
        required: ["id", "match", "reason", "matchedOn", "misses", "known"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const slug = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const norm = s => String(s || "").toLowerCase().trim();
const titleKey = s => norm(s).replace(/[^a-z0-9]+/g, "");

function pickNames(known, wanted) {
  const out = new Set();
  for (const w of wanted || []) {
    const n = norm(w).replace(/-/g, " ");
    if (!n) continue;
    for (const k of known) { const kl = norm(k);
      if (kl === n || kl.startsWith(n) || kl.includes(`(${n})`) || (n.length > 4 && kl.includes(n))) out.add(k); }
  }
  return [...out];
}

function factsLine(t) {
  const m = t.meta || {};
  const bits = [];
  if (m.year) bits.push(String(m.year));
  if (m.developers && m.developers.length) bits.push(`by ${m.developers.slice(0, 2).join(", ")}`);
  if (m.genres && m.genres.length) bits.push(`genres: ${m.genres.join(", ")}`);
  if (m.themes && m.themes.length) bits.push(`themes: ${m.themes.join(", ")}`);
  if (m.modes && m.modes.length) bits.push(`modes: ${m.modes.join(", ")}`);
  if (m.keywords && m.keywords.length) bits.push(`tags: ${m.keywords.slice(0, 16).join(", ")}`);
  if (m.medianPlaytimeHours) bits.push(`typical playtime ${m.medianPlaytimeHours}h`);
  if (m.summary) bits.push(`summary: ${String(m.summary).slice(0, 420)}`);
  if (m.source === "memory") bits.push("no catalog record: judge from what you know");
  return `[${t.id}] "${t.title}" — ${bits.join("; ")}`;
}

function overlapOf(meta, reading) {
  const want = new Set([].concat(reading.tags || [], reading.genres || [], reading.themes || []).map(norm));
  const have = [].concat(meta.keywords || [], meta.genres || [], meta.themes || []);
  const hit = [];
  for (const h of have) { const n = norm(h);
    if (want.has(n) || [...want].some(w => w.length > 4 && (n.includes(w) || w.includes(n) && n.length > 4))) hit.push(h); }
  return [...new Set(hit)].slice(0, 5);
}

export function makeGameVibe({ catalog, llm }) {
  const cache = new Map();   // id → record, so rank re-reads facts from here, never from the caller
  const remember = r => { if (cache.size > 3000) cache.delete(cache.keys().next().value); cache.set(r.id, r); return r; };

  async function record(id) {
    const known = cache.get(id);
    // RAWG list rows carry no description; the detail call does.
    if (known && (known.meta.summary || known.meta.source !== "rawg")) return known;
    if (!catalog.connected || /^est:/.test(id)) return known || null;
    const row = await catalog.byId(id);
    return row ? remember(row) : known || null;
  }

  return {
    async pool(text, platform) {
      const reading = await llm.parse(
`Someone wants a game to play and described it in their own words. Read it the way a friend
who plays everything would: what feeling are they after, and what would deliver it?

THEIR WORDS: """${String(text).slice(0, 600)}"""
${platform && PLATFORMS[platform] ? `They're playing on ${platform === "pc" ? "PC" : platform}.` : ""}

Translate it into things a game catalog can search on. Tags should be mechanics, structures and
moods ("roguelike", "base building", "cozy", "atmospheric"), not praise. Leave era null and
players/length as "any" unless the words imply them. Seeds must be real games you are confident
exist, chosen for the FEELING rather than the genre.`,
        READ_SCHEMA, { effort: "low" });

      const plat = PLATFORMS[platform] || null;
      const found = [];
      const seedsDropped = [];
      if (catalog.connected) {
        const isIgdb = catalog.provider === "igdb";
        const opts = isIgdb ? {
          genres: pickNames(IGDB_GENRES, reading.genres),
          themes: (reading.themes || []).filter(t => IGDB_THEMES.includes(t)),
          keywords: (reading.tags || []).map(norm).slice(0, 8),
          modes: MODE_NAMES[reading.players] || null,
          platform: plat ? plat.igdb : null, from: reading.from, to: reading.to, limit: 30,
        } : {
          genres: [...new Set((reading.genres || []).map(g => RAWG_GENRES[norm(g)] || null).filter(Boolean))],
          tags: (reading.tags || []).map(slug).filter(Boolean).slice(0, 6),
          rawgPlatforms: plat ? plat.rawg : null, from: reading.from, to: reading.to, limit: 20,
        };
        const [discovered, seeded] = await Promise.all([
          catalog.discoverVibe(opts).catch(e => { console.warn("[rumble] discover failed:", e.message); return []; }),
          Promise.all((reading.seeds || []).slice(0, isIgdb ? 10 : 14).map(async s => {   // IGDB: 4 requests a second
            try {
              const hits = await catalog.search(s.title, 5);
              const want = titleKey(s.title);
              const best = hits.find(h => titleKey(h.title) === want && (!s.year || !h.meta.year || Math.abs(h.meta.year - s.year) <= 1))
                || hits.find(h => titleKey(h.title) === want)
                || hits.find(h => titleKey(h.title).startsWith(want) && (!s.year || h.meta.year === s.year));
              if (best) return Object.assign({ seed: true }, best);
              seedsDropped.push(s.title); return null;
            } catch { seedsDropped.push(s.title); return null; }
          })),
        ]);
        found.push(...seeded.filter(Boolean), ...discovered);
      } else {
        for (const s of (reading.seeds || []).slice(0, 14))
          found.push({ id: `est:${slug(s.title)}`, title: s.title, seed: true,
            meta: { source: "memory", year: s.year || null } });
      }

      // Avoided genres/themes/tags and the wrong platform are filtered here, in code.
      const avoid = (reading.avoid || []).map(norm).filter(Boolean);
      const seen = new Set(), pool = [];
      for (const r of found) {
        if (!r || seen.has(r.id)) continue;
        const m = r.meta || {};
        const labels = [].concat(m.genres || [], m.themes || [], m.keywords || []).map(norm);
        if (avoid.some(a => labels.includes(a))) continue;
        if (plat && m.platforms && m.platforms.length && !m.platforms.some(p => plat.test.test(p))) continue;
        seen.add(r.id); pool.push(remember(r));
        if (pool.length >= 30) break;
      }
      return {
        reading: { heard: reading.heard || [], genres: reading.genres || [], tags: reading.tags || [],
          themes: reading.themes || [], avoid: reading.avoid || [], players: reading.players, length: reading.length,
          from: reading.from, to: reading.to, platform: plat ? platform : "any" },
        pool: pool.map(r => ({ id: r.id, title: r.title, seed: !!r.seed, meta: r.meta })),
        seedsDropped,
        source: catalog.connected ? catalog.provider : "memory",
      };
    },

    async rank(text, reading, ids) {
      const titles = (await Promise.all((ids || []).slice(0, 30).map(async id => {
        try { return await record(id); } catch { return cache.get(id) || null; }
      }))).filter(Boolean);
      if (!titles.length) return [];
      const batches = [];
      for (let i = 0; i < titles.length; i += 10) batches.push(titles.slice(i, i + 10));
      const settled = await Promise.allSettled(batches.map(batch => llm.parse(
`Score how well each game below matches what this person asked for.

THEIR WORDS: """${String(text).slice(0, 600)}"""
HOW IT WAS READ: ${(reading.heard || []).join(" · ")}
${reading.players && reading.players !== "any" ? `WHO'S PLAYING: ${reading.players}` : ""}
${reading.length && reading.length !== "any" ? `LENGTH WANTED: ${reading.length}` : ""}
${reading.avoid && reading.avoid.length ? `THEY DON'T WANT: ${reading.avoid.join(", ")}` : ""}
${reading.platform && PLATFORMS[reading.platform] ? `THEY PLAY ON: ${reading.platform === "pc" ? "PC" : reading.platform === "mobile" ? "a phone" : reading.platform}. A game that isn't available there scores 0.` : ""}

Judge from the catalog facts given and what you know of how each game actually plays: the
loop you repeat, the pace, the pressure, how it feels an hour in. Score the FEELING they asked
for, not quality or popularity: a masterpiece that misses the mood scores low, an obscure game
that nails it scores high. If you don't know a game beyond its facts, say so with known: false
and score from the facts alone, conservatively.

Use the whole range, and be sparing at the top:
  90-100  almost exactly what they described
  75-89   a strong fit; one part of it is off
  55-74   partly there
  35-54   shares a genre or a surface, not the feeling
  0-34    wrong for this

THE GAMES:
${batch.map(factsLine).join("\n\n")}

Return one entry for every game, using each id exactly as given.`,
        RANK_SCHEMA, { effort: "medium" })));

      const byId = new Map(titles.map(t => [t.id, t]));
      const out = [];
      for (const r of settled) {
        if (r.status !== "fulfilled") { console.error("[rumble] a scoring batch failed:", r.reason && (r.reason.message || r.reason)); continue; }
        for (const row of (r.value.results || [])) {
          const t = byId.get(String(row.id));
          if (!t) continue;
          out.push({
            id: t.id, title: t.title, meta: t.meta,
            match: Math.max(0, Math.min(100, Math.round(Number(row.match) || 0))),
            reason: String(row.reason || ""), matchedOn: (row.matchedOn || []).slice(0, 3),
            misses: String(row.misses || ""), known: row.known !== false,
            overlap: overlapOf(t.meta || {}, reading || {}),
            method: "model-judgment",   // the score is Claude's read, never a catalog fact
          });
        }
      }
      if (!out.length && settled.some(r => r.status === "rejected"))
        throw settled.find(r => r.status === "rejected").reason;
      return out.sort((a, b) => b.match - a.match);
    },
  };
}
