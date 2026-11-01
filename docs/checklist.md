# The interview checklist

What the assistant asks before writing any code (Phase 1 of [`AGENTS.md`](../AGENTS.md)), what each question means, and the default to propose. Every answer lands in a field of `addons/<name>/addon.forge.json`, whose schema is [`tools/lib/schemas/forge.schema.json`](../tools/lib/schemas/forge.schema.json).

**How to ask:** two to four questions per message, in the order below, each with a proposed default the user can accept with "ok". Skip what the user's description already answered, and say what you inferred. Explain Stremio terms in plain words; the user may never have heard of a "manifest".

---

## Round 1: what it is

### 1. Name and description

| | |
|---|---|
| Ask | "What should it be called? And in one sentence, what does it do?" |
| Fields | `name` (folder name: lowercase, words joined by hyphens, e.g. `french-subtitles`), `displayName` (what Stremio shows, e.g. "French Subtitles"), `description` (one sentence, shown on the install page) |
| Default | Derive all three from the user's idea and propose them. |

### 2. What it provides (resources)

| | |
|---|---|
| Ask | "What should it add to Stremio?" and list the options below in plain words. Most add-ons need only one. |
| Field | `resources` |
| Default | `catalog` for lists of films or shows; `subtitles` for subtitles. |

| Resource | In plain words | Example idea |
|---|---|---|
| `catalog` | Rows of titles on the Board, in Discover, or in search results | "Films my friends rated 4.5+" |
| `meta` | The details page of a title (synopsis, cast, episodes). Only needed for titles Stremio doesn't already know: see question 4 | A catalog of your own home videos |
| `stream` | Something to play. Legitimate sources only: see the content policy | Public-domain films from archive.org, official trailers |
| `subtitles` | Subtitle tracks offered in the player | French subtitles from your own folder |
| `addon_catalog` | A list of other add-ons to install | A curated add-on collection |

### 3. Content types

| | |
|---|---|
| Ask | "Is it about films, series, or something else?" |
| Field | `types` |
| Default | `movie`, `series`, or both, from the idea. `channel` (YouTube-like channels) and `tv` (live TV) also exist; any other lowercase word creates a custom type. |

## Round 2: where the data comes from

### 4. Identifiers

| | |
|---|---|
| Ask | Usually nothing: decide and explain. Ask only if the titles may not exist on IMDb. |
| Fields | `idScheme`: `imdb` or `custom`; `idPrefix` when custom (e.g. `"myaddon:"`) |
| Default | `imdb`. Titles are identified by IMDb ids (`tt0071315`), and Stremio's built-in Cinemeta add-on supplies posters and details pages for free. Choose `custom` only for content that isn't on IMDb (personal videos, live channels); the add-on then needs its own `meta` resource. To get IMDb ids from titles, see [recipes/imdb-mapping.md](recipes/imdb-mapping.md). |

### 5. Data sources

| | |
|---|---|
| Ask | "Where does the data come from: an API, a website, a file you have, a list you'll write?" Then for each source: does it need an API key? Any rate limit? |
| Field | `sources`: one `{ name, needsKey, rateLimit, terms }` per source |
| Default | Propose the best-known legitimate source for the idea (an official API, the user's own export or files). |

Check each source's **terms of use** before planning on it, and record the link in `terms`:

- Prefer official APIs and data the user owns (exports, files, their own lists).
- **Don't scrape a site whose terms forbid it.** Letterboxd, for example, forbids scraping; its users can export their own data instead (see `examples/letterboxd-nl-search`).
- Free API tiers often require an account: the user creates it, never the assistant.
- `needsKey: true` makes `forge new` add a `<NAME>_API_KEY=` line to `.env.example`.

## Round 3: how it behaves

### 6. Catalog features (catalogs only)

| | |
|---|---|
| Ask | "Should it be searchable? Filterable by genre? Hold more than 100 titles?" |
| Fields | `catalogFeatures`: any of `search`, `searchOnly`, `genre`, `pagination`; `genres` (the list offered) when `genre` is chosen |
| Default | `search` for a normal catalog; nothing else unless the data supports it. |

| Feature | Effect in Stremio | Recipe |
|---|---|---|
| `search` | Typing in Stremio's search bar also queries the catalog; the row still shows on the Board | [search](recipes/search.md) |
| `searchOnly` | The catalog *only* answers searches: no row on the Board or in Discover. For search engines | [search](recipes/search.md) |
| `genre` | A genre picker in Discover | [genre-filter](recipes/genre-filter.md) |
| `pagination` | Stremio loads more titles 100 at a time as you scroll | [pagination](recipes/pagination.md) |

### 7. User configuration

| | |
|---|---|
| Ask | "Does each person who installs it need to enter something: a username, an API key, a language?" |
| Field | `userConfig`: one `{ key, type, title, required, default, options }` per value; `type` is `text`, `number`, `password`, `checkbox` or `select` (`select` needs `options`) |
| Default | None. If the add-on is only for the user, a setting in `.env` is simpler. |

Read [configuration.md](configuration.md) before answering: values entered there travel **inside the install URL**, so an API key in user configuration is visible to anyone who sees that link.

## Round 4: where it runs

### 8. Hosting

| | |
|---|---|
| Ask | "Will you use it only on this computer, on other devices at home (TV, phone), or should it be always on and shareable?" |
| Field | `hosting`: `localhost`, `lan` or `internet` |
| Default | `localhost`. Other devices need HTTPS through a tunnel, which Phase 5 sets up; always-on needs a host. See [hosting.md](hosting.md). |

### 9. Port

| | |
|---|---|
| Ask | Don't ask: choose and mention it. |
| Field | `port` |
| Default | `7100`, or the next free one: run `node tools/forge.js list` and pick a port no other add-on uses. Never 7000 (taken by AirPlay on macOS). On Windows, also avoid the ranges listed by `netsh interface ipv4 show excludedportrange protocol=tcp`. |

### 10. Content policy (only if `stream` is a resource)

| | |
|---|---|
| Ask | Quote the policy below and ask the user to confirm the streams are legitimate. |
| Field | `contentPolicyAcknowledged: true` (required by the schema whenever `stream` is declared) |

> Addon Forge is for catalogs, metadata, recommendations, subtitles and **legitimate** stream sources: public-domain media, your own files, services that license their content, official trailers and YouTube videos. It does not build add-ons that scrape or index torrents, debrid-resolve links, or serve content you are not authorized to stream.

If the idea is about pirated content, decline as [`AGENTS.md`](../AGENTS.md) says, and offer a catalog-only version instead.

---

## The summary to confirm

After the interview, write `addons/<name>/addon.forge.json` and show the user a summary like this before writing code:

```text
French Subtitles (french-subtitles)
  What:      French subtitles for films, from .srt files in a folder you choose
  Provides:  subtitles · for movie · IMDb ids
  Source:    your own folder (no key)
  Settings:  none (folder set in .env)
  Runs on:   this computer, http://127.0.0.1:7102/manifest.json
```

A complete `addon.forge.json` for that summary:

```json
{
  "$schema": "../../tools/lib/schemas/forge.schema.json",
  "name": "french-subtitles",
  "displayName": "French Subtitles",
  "description": "French subtitles for films, from .srt files in a folder you choose.",
  "template": "node-sdk",
  "resources": ["subtitles"],
  "types": ["movie"],
  "idScheme": "imdb",
  "sources": [{ "name": "local folder", "needsKey": false }],
  "catalogFeatures": [],
  "userConfig": [],
  "hosting": "localhost",
  "port": 7102,
  "contentPolicyAcknowledged": false
}
```
