/* Gameplay feature rating.
 *
 * These ratings are INFERRED by a model. They are never "verified", and a
 * connected catalog does not make them so — a catalog supplies facts about a
 * game (modes, genres, the publisher's summary), and those facts are passed in
 * as the basis so the inference is grounded and each feature can say which
 * side it came from. The rating record carries `method: "model-inference"`
 * whatever the catalog status.
 *
 * The call is BLIND: no part of the user's profile, weights or preferred
 * values is ever sent, so a rating cannot drift toward what would score well. */

import { makeLLM } from "./llm.mjs";

export const FEATURES = [
  ["pace",      "How fast things happen moment to moment. 0 slow, 10 relentless"],
  ["feedback",  "How fast an action produces a visible result. 0 delayed, 10 instant"],
  ["decisions", "How often a choice that actually matters comes up. 0 rare, 10 constant"],
  ["variety",   "How much the activity changes as you keep playing. 0 repetitive, 10 always new"],
  ["clarity",   "How plainly it tells you what to do next. 0 work it out, 10 always obvious"],
  ["overhead",  "Systems, inventory, map and build you must hold. 0 almost none, 10 heavy"],
  ["challenge", "How demanding it is to keep up. 0 forgiving, 10 punishing"],
  ["downtime",  "Travel, menus, cutscenes, waiting, loading. 0 almost none, 10 constant"],
  ["onramp",    "How long before it is genuinely engaging. 0 minutes, 10 many hours"],
];
export const FEATURE_KEYS = FEATURES.map(f => f[0]);
export const RATING_SCHEMA_VERSION = 5;

/* JSON Schema, enforced by the API when structured outputs are available. Written
 * against the installed SDK (0.71.x): the format goes in top-level `output_format`
 * and `output_config` carries only `effort`. */
const cell = {
  type: "object",
  properties: {
    value: { type: ["number", "null"], minimum: 0, maximum: 10,
      description: "0-10, or null when you do not know this game well enough to say" },
    confidence: { type: "number", minimum: 0, maximum: 1,
      description: "your own certainty for this feature of this game; 0 when value is null" },
    evidence: { type: "string", description: "the concrete detail behind the number, at most 20 words" },
    basis: { type: "string", enum: ["catalog", "knowledge", "none"],
      description: "catalog if the supplied catalog facts support it, knowledge if it comes from what you know about the game, none if value is null" },
  },
  required: ["value", "confidence", "evidence", "basis"],
  additionalProperties: false,
};

const BATCH_SCHEMA = {
  type: "object",
  properties: {
    games: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "the exact title as given" },
          endless: { type: "boolean", description: "true when the game has no ending to reach" },
          needsGroup: { type: "boolean", description: "true ONLY when it needs a premade group of people you know; matchmaking and solo queue are NOT a premade group" },
          offline: { type: "boolean", description: "true when it is fully playable with no internet connection" },
          frictions: { type: "array", items: { type: "string" }, description: "up to four things players commonly bounce off, named concretely" },
          features: {
            type: "object",
            properties: Object.fromEntries(FEATURE_KEYS.map(k => [k, cell])),
            required: FEATURE_KEYS,
            additionalProperties: false,
          },
        },
        required: ["title", "endless", "needsGroup", "offline", "frictions", "features"],
        additionalProperties: false,
      },
    },
  },
  required: ["games"],
  additionalProperties: false,
};

const RULES = `Rate how each game actually plays, feature by feature.

RATE THE GAME ITSELF, NOT ITS QUALITY, REPUTATION OR REVIEW SCORE. These describe how it
plays, and none of them is good or bad on its own.

Genre is not enough. Two roguelikes, two shooters, two RPGs sit at opposite ends of most of
these. Rate from how the game plays minute to minute: what you do, how often, how long the
gaps are, what the screen gives back.

Where catalog facts are supplied below, use them and set basis to "catalog" for any feature
they support. Where you are going on what you know about the game, set basis to "knowledge".
NEVER fill a gap with a guess dressed as a fact: if you do not know the game well enough,
set value to null, confidence to 0 and basis to "none". Coverage is reported to the user
separately and a score is withheld when there is too little to stand behind.

THE NINE FEATURES:
${FEATURES.map(([k, d]) => `  ${k} — ${d}`).join("\n")}`;

function basisBlock(g) {
  const m = g.basis || {};
  const bits = [];
  if (m.year) bits.push(`released ${m.year}`);
  if (m.developers && m.developers.length) bits.push(`by ${m.developers.join(", ")}`);
  if (m.genres && m.genres.length) bits.push(`genres: ${m.genres.join(", ")}`);
  if (m.themes && m.themes.length) bits.push(`themes: ${m.themes.join(", ")}`);
  if (m.modes && m.modes.length) bits.push(`modes: ${m.modes.join(", ")}`);
  if (m.perspectives && m.perspectives.length) bits.push(`perspective: ${m.perspectives.join(", ")}`);
  if (m.medianPlaytimeHours) bits.push(`median playtime ${m.medianPlaytimeHours}h`);
  if (m.summary) bits.push(`summary: ${m.summary}`);
  if (!bits.length) return `"${g.title}" — no catalog facts available; rate from what you know.`;
  return `"${g.title}" — catalog facts: ${bits.join("; ")}`;
}

export function makeRater(env, llm) {
  const ai = llm || makeLLM(env);
  const model = ai.defaults.model;
  const client = ai.client;

  function promptFor(games) {
    return `${RULES}\n\nGAMES, in this order:\n${games.map((g, i) => `${i + 1}. ${basisBlock(g)}`).join("\n\n")}\n\nRate every game on the list, in the order given, keeping its exact title.`;
  }

  async function rateBatch(games) {
    const parsed = await ai.parse(promptFor(games), BATCH_SCHEMA);
    if (!parsed || !Array.isArray(parsed.games) || !parsed.games.length)
      throw Object.assign(new Error("the rating reply did not parse"), { code: "invalid_output" });
    return parsed.games;
  }

  return {
    configured: () => ai.configured(),
    model,
    schemaVersion: RATING_SCHEMA_VERSION,
    /* games: [{id, title, basis}] — basis is catalog metadata, never user data.
     * Batched so one request never asks for more than it can finish. */
    async rate(games, { batchSize = 6 } = {}) {
      const out = [];
      for (let i = 0; i < games.length; i += batchSize) {
        const slice = games.slice(i, i + batchSize);
        const rows = await rateBatch(slice);
        const used = new Set();
        rows.forEach((row, idx) => {
          const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          let want = slice.find(g => !used.has(g.id) && norm(g.title) === norm(row.title));
          if (!want) want = slice[idx] && !used.has(slice[idx].id) ? slice[idx] : slice.find(g => !used.has(g.id));
          if (!want) return;
          used.add(want.id);
          out.push({
            id: want.id,
            title: want.title,
            ratings: {
              features: row.features,
              method: "model-inference",   // never "verified", catalog or not
              sourced: false,
              groundedIn: want.basis && Object.keys(want.basis).length
                ? { source: want.basis.source || null, fields: Object.keys(want.basis) }
                : null,
              model,
              schema: RATING_SCHEMA_VERSION,
              at: Date.now(),
            },
            inferred: { endless: row.endless, needsGroup: row.needsGroup, offline: row.offline,
                        frictions: row.frictions || [] },
          });
        });
      }
      return out;
    },
  };
}
