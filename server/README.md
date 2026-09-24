# Standalone server for Wavelength, Rumble, Will It Hold and Two Hours In

Runs both apps outside the Claude artifact sandbox so it can do three things the
published page cannot: search a real game catalog, resolve titles to stable
catalog ids, and call the Claude API. **Every credential stays in this process.
The browser is handed results, never a key.**

Four apps are served:

- `/wavelength` — **Wavelength**: describe a feeling, get shows and films that match it. TMDb.
- `/rumble` — **Rumble**: Wavelength for games. Describe a feeling, get games that match it. IGDB or RAWG; without either, Claude's suggestions, labelled as such.
- `/holds` — **Will It Hold**: shows and films, catalog from TMDb.
- `/games` — **Two Hours In**: games, catalog from IGDB or RAWG.

`/` is a signpost page linking to all four and showing which catalogs are connected.
Neither app is served at the root, so neither looks like "the" app.

Each page runs in both places. It probes `/api/health` on
load: if this server answers it uses the catalog and the server-side rater, and
if nothing answers it falls back to the artifact behaviour and says so on screen.

## Wavelength, in one paragraph

You describe a mood. Claude reads it into things TMDb can search on — its genre names,
its own keyword tags, an era, things to avoid — plus a few titles it thinks fit. TMDb does
the retrieval, so every result is a real catalog record; a suggested title TMDb doesn't have
is dropped, and a tag phrase with no TMDb equivalent is dropped rather than guessed. Claude
then scores each title against what you wrote, from TMDb's synopsis and tags. The score is a
judgment and is labelled as one; the tags a title shares with the reading are computed on the
server and shown as the catalog facts they are.

## What a rating is, and is not

**One difference between the two apps, on purpose.** The games rater is *blind*:
it never sees your profile, and the server rejects any request that carries it,
because there a rating is an estimate of a property of the game. Will It Hold is
the opposite — your anchor numbers *are* the ruler, so the placement call is
given your scale by design. Both are inferences; neither is ever called verified.

The catalog supplies **facts**: title, release year, developer, genres, themes,
game modes, the publisher's summary. Those are attributed to the catalog.

The nine gameplay features are **inferred by a model**, from those facts plus
what it knows about the game. Connecting a catalog grounds that inference — it
does not verify it. Every rating record carries `method: "model-inference"`
whatever the catalog status, the card says "gameplay ratings inferred, not
verified", and each feature records whether it came from the supplied catalog
facts or the model's own knowledge. Nothing in this system will call a gameplay
rating verified, and the server refuses any rating request carrying user
preference data so the inference cannot be steered toward what would score well.

## Rumble, in one paragraph

The same three steps as Wavelength, for games. Claude reads what you wrote into genres, concrete
tags ("roguelike", "base building", "cozy"), who's playing, a length and a handful of games that
fit. The game catalog does the retrieval; a suggested game the catalog doesn't have is dropped,
and avoided genres/themes/tags and the wrong platform are filtered out in code. Claude then scores
each game against what you wrote from the catalog's summary and tags, and says when it doesn't know
a game well. With **no** game catalog configured it still works, but the games are Claude's
suggestions from memory and the page says so. The quickest fix for that is `RAWG_API_KEY`
(one key, free); `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` gives richer data.

## Credentials you need to supply

| Variable | Required | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | <https://console.anthropic.com> → API keys. This is what rates games; without it the server starts but refuses to rate. |
| `CATALOG_PROVIDER` | Optional | `igdb` or `rawg`, only needed to choose when both are set. If it names one that has no credentials, the other is used and the home page says so. |
| `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET` | If `igdb` | <https://dev.twitch.tv/console/apps> → Register Your Application (any name; OAuth Redirect URL `http://localhost`; category "Application Integration"). Then **Manage** → copy the Client ID → **New Secret** → copy the secret. IGDB is free and is the better of the two: it returns game modes, themes, perspectives and a real summary. The server exchanges these for an app token itself and refreshes it. |
| `TMDB_API_KEY` *(or `TMDB_READ_TOKEN`)* | For **Will It Hold** at `/holds` | <https://www.themoviedb.org> → sign up → Settings → API → Request an API key → Developer. Free, approved in minutes. Either the v3 key or the v4 read token works. This is what turns runtimes, episode counts and season counts from recalled numbers into facts. |
| `RAWG_API_KEY` | If `rawg` | <https://rawg.io/apidocs> → sign up; the key appears on your profile. Simpler, one key, 20k requests/month free, but thinner metadata. |
| `APP_TOKEN` | Strongly recommended | Any string you invent. Without it, anyone who finds the URL can spend your Anthropic credit. The app asks for it once and keeps it in the browser. |

Optional: `PORT` (8787), `DATA_DIR` (`./data`), `ANTHROPIC_MODEL` (`claude-opus-5`),
`ANTHROPIC_FALLBACK_MODEL` (`claude-opus-4-8`, used once if a rating is declined),
`ANTHROPIC_EFFORT` (`high`), `ANTHROPIC_BETAS`, `APP_HTML`, `APP_HTML_RUMBLE`.

## Run it locally

```bash
cd server
npm install
cp .env.example .env      # then fill in the keys above
npm start                 # http://localhost:8787 — pick an app from there
```

The startup banner states, in order: whether the catalog is connected, whether
the rater is configured, where data is written, and whether access is open. If
one is missing it names the exact variable to set.

## Deploy it

It is one Node process with no database. Any of these work; pick whichever you
already use.

**Fly.io** (persistent volume, cheapest for a personal instance)

```bash
fly launch --no-deploy            # from the repo root; it will find the Dockerfile
fly volumes create data --size 1
fly secrets set ANTHROPIC_API_KEY=sk-ant-... IGDB_CLIENT_ID=... IGDB_CLIENT_SECRET=... \
                CATALOG_PROVIDER=igdb APP_TOKEN=pick-something
fly deploy
```

Add to `fly.toml` so the data survives restarts:

```toml
[[mounts]]
  source = "data"
  destination = "/data"
```

**Render / Railway / any container host**

Point it at this repo, Dockerfile build, add the environment variables above,
and mount a disk at `/data`. Health check path `/api/health`.

**A box you already own**

```bash
git clone <this repo> && cd <repo>/server
npm install --omit=dev
cp .env.example .env    # fill it in
node server.mjs
```

Put it behind nginx or Caddy with TLS, or a tunnel like Tailscale, and set
`APP_TOKEN`. Run it under systemd or `pm2` so it restarts.

**Docker directly** (build from the repo root — it copies both `server/` and the app):

```bash
docker build -t two-hours-in -f server/Dockerfile .
docker run -p 8787:8787 -v two-hours-data:/data --env-file server/.env two-hours-in
```

## What it stores, and where

Two files in `DATA_DIR`, deliberately separate:

- `screen-catalog.json` — TMDb records keyed by stable id. Facts, no user data.
- `screen-state.json` — the Will It Hold scale, log and seen-list.
- `ratings.json` — gameplay feature records keyed by stable catalog id. Nothing
  about a user is written here. Shared across everyone using the instance, so a
  game is rated once and paid for once. Safe to delete; it rebuilds.
- `state.json` — the user's examples, feedback, weights and shown-list.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | What is configured, what is missing. Safe to hit unauthenticated. |
| `GET /api/catalog/search?q=` | Real title search. Returns stable ids (`igdb:1942`). |
| `GET /api/catalog/game?id=` | One record by stable id. |
| `GET /api/catalog/discover?limit=&offset=&platform=` | The broad candidate pool for discovery. |
| `POST /api/rate` | Rates games. Cached per id. **Rejects any payload carrying user preference data.** |
| `GET /api/screen/search?q=&form=` | TMDb title search. Returns stable ids (`tmdb:tv:1396`). |
| `GET /api/screen/title?id=` | Full TMDb record — runtime, episode and season counts. |
| `GET /api/screen/discover?form=&offset=` | The candidate pool for Will It Hold. |
| `POST /api/screen/place` | Places titles on the user's anchor scale. Facts are fetched server-side from TMDb, never taken from the caller. |
| `POST /api/vibe/pool` | Wavelength step 1–2: reads the vibe into TMDb genres and tags, retrieves real titles, drops suggestions TMDb doesn't have. |
| `POST /api/gvibe/pool` | Rumble step 1–2: reads the request into genres, tags, players and length; retrieves games from IGDB/RAWG; drops suggestions the catalog doesn't have; filters avoided themes and platform in code. |
| `POST /api/gvibe/rank` | Rumble step 3: scores each game against the request from the catalog's summary and tags, with a `known` flag when Claude doesn't know the game well. |
| `POST /api/vibe/rank` | Wavelength step 3: scores each title against the vibe from TMDb's own synopsis and tags. Facts are re-read server-side by id. |
| `GET/PUT /api/state`, `GET/PUT /api/screen/state` | Each app's own state. |

## Cost

One `/api/rate` call covers a batch of six games. Discovery rates up to 18
candidates the first time and nothing on repeat, because ratings are cached by
id across everyone using the instance. Ordinary use is pennies; leaving it open
on the public internet without `APP_TOKEN` is how that stops being true.

## A note on what was tested

The catalog layer, the blindness guard, caching, storage separation and the full
browser flow were exercised end to end against a stand-in for IGDB and the
Anthropic API. The live third-party calls — real Twitch OAuth, real IGDB, real
`api.anthropic.com` — have not been run from here, because that needs your
credentials. If the structured-output path is unavailable on your key or SDK
version, the rater logs one line and falls back to JSON-in-text with tolerant
parsing, so it keeps working either way.
