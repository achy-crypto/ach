/* File-backed storage, deliberately split in two:
 *   ratings.json — gameplay feature records, keyed by stable catalog id.
 *                  Independent of any user; shared across everyone using this
 *                  server; safe to delete and rebuild.
 *   state.json   — one user's preferences, feedback and shown-list.
 * Nothing about a user is written into the ratings file. */

import fs from "node:fs/promises";
import path from "node:path";

export function makeStore(dir) {
  const ratingsPath = path.join(dir, "ratings.json");
  const statePath = path.join(dir, "state.json");
  let ratings = null, state = null;
  let writing = Promise.resolve();

  async function readJson(p, fallback) {
    try { return JSON.parse(await fs.readFile(p, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") console.error(`[store] could not read ${p}:`, e.message); return fallback; }
  }
  async function writeJson(p, value) {
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 1));
    await fs.rename(tmp, p);
  }
  function queue(fn) { writing = writing.then(fn, fn); return writing; }

  return {
    async init() {
      await fs.mkdir(dir, { recursive: true });
      ratings = await readJson(ratingsPath, { v: 1, games: {} });
      state = await readJson(statePath, null);
    },
    getRating(id, schema) {
      const r = ratings.games[id];
      return r && r.ratings && r.ratings.schema === schema ? r : null;
    },
    putRatings(rows) {
      for (const row of rows) ratings.games[row.id] = row;
      return queue(() => writeJson(ratingsPath, ratings));
    },
    ratingCount() { return Object.keys(ratings.games).length; },
    getState() { return state; },
    putState(next) { state = next; return queue(() => writeJson(statePath, state)); },
  };
}
