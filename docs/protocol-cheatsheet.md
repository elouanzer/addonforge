# Stremio add-on protocol: cheatsheet

The parts of the protocol an Addon Forge add-on uses, condensed for assistants. It summarises the official [stremio-addon-sdk docs](https://github.com/Stremio/stremio-addon-sdk/tree/master/docs); when something here is not enough, read the linked page instead of guessing. `node tools/forge.js validate` checks every rule below.

## How Stremio talks to an add-on

An add-on is an HTTP service. Stremio reads its manifest, then calls the resources it declares ([protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)):

```text
GET /manifest.json
GET /{resource}/{type}/{id}.json
GET /{resource}/{type}/{id}/{extra}.json      extra = search=noir&skip=100 (URL-encoded)
GET /{config}/manifest.json                   with user configuration (see configuration.md)
```

- **HTTPS is required**, except for `http://127.0.0.1`. The SDK adds the CORS headers; HTTPS is the host's or tunnel's job ([hosting.md](hosting.md)).
- Stremio only calls an add-on for a `type` it lists, and, for `meta`, `stream` and `subtitles`, only for ids starting with one of its `idPrefixes` ([how Stremio picks an add-on](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/README.md)).

## Manifest

Built from `addon.forge.json` by `forge new`, in `src/manifest.js` ([manifest.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md)).

| Field | Notes |
|---|---|
| `id` | Reverse-domain, unique: `community.addonforge.<name>` |
| `version` | Semver; the template reads it from `package.json` |
| `name`, `description` | Shown on the install page |
| `resources` | `catalog`, `meta`, `stream`, `subtitles`, `addon_catalog`. Also `{ name, types, idPrefixes }` to narrow one resource |
| `types` | `movie`, `series`, `channel`, `tv`, or custom |
| `idPrefixes` | e.g. `["tt"]` for IMDb ids. Needed for `meta`, `stream` and `subtitles` |
| `catalogs` | `[{ type, id, name, extra }]`; `[]` when there are none |
| `config` | User configuration: `[{ key, type, title, default, options, required }]`, `type` one of `text`, `number`, `password`, `checkbox`, `select` |
| `behaviorHints` | `configurable` (shows Configure), `configurationRequired` (must configure before installing), `adult`, `p2p` |
| `logo`, `background` | Absolute HTTPS URLs; logo 256×256 PNG |

Catalog `extra` entries are `{ name, isRequired, options, optionsLimit }`:

- `search`: text from Stremio's search bar. `isRequired: true` makes a **search-only** catalog that never appears on the Board or in Discover.
- `genre`: one of `options`, picked in Discover.
- `skip`: pagination offset, in multiples of **100**. Returning fewer than 100 items tells Stremio the catalog has ended.

The SDK refuses manifests over 8 KB and refuses to start when a declared resource has no handler, or a handler has no declared resource.

## Handlers

Each handler receives `{ type, id, extra, config }` and returns a Promise ([requests](https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/requests)).

| Resource | `id` is | Returns |
|---|---|---|
| catalog | the catalog's `id` | `{ metas: [MetaPreview] }` |
| meta | an item id | `{ meta: Meta }`, or `{ meta: null }` when unknown |
| stream | a video id | `{ streams: [Stream] }` |
| subtitles | a video id; `extra` may hold `videoHash`, `videoSize`, `filename` | `{ subtitles: [Subtitle] }` |
| addon_catalog | the add-on catalog's `id` | `{ addons: [{ transportName: 'http', transportUrl, manifest }] }` |

Video ids: a film's video id is its item id (`tt0071315`); a series episode is `tt0108778:1:1` (season 1, episode 1).

**Cache fields**, in seconds, on any response: `cacheMaxAge`, `staleRevalidate`, `staleError`. The SDK turns them into a `Cache-Control` header. See [recipes/caching.md](recipes/caching.md).

## Response objects

[responses/](https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/responses)

**MetaPreview** (catalog items): `id`, `type`, `name` required; `poster` (absolute URL, recommended), `posterShape` (`poster`, `square`, `landscape`), `genres`, `releaseInfo` (e.g. `"1974"`), `description`. For IMDb ids, `https://images.metahub.space/poster/small/<id>/img` is a free poster.

**Meta** (details page): the preview fields plus `background`, `logo`, `cast`, `director`, `runtime`, `imdbRating`… and `videos` for series: `[{ id, title, released, season, episode }]`, where `released` is an ISO date.

**Stream**: exactly one source among `url` (direct HTTPS video), `ytId` (YouTube id), `externalUrl` (opens in a browser), `infoHash`, `nzbUrl`, archive URLs. Optional: `name` (e.g. quality), `description`, `subtitles`, `behaviorHints` (`notWebReady`, `bingeGroup`, `filename`, `proxyHeaders`, `countryWhitelist`). Torrent and Usenet sources are almost never compatible with the content policy.

**Subtitle**: `id` (unique), `url` (absolute; `.srt`, `.vtt`, `.ass`), `lang` (ISO 639-2, e.g. `fre`, `eng`), `label` (optional, shown in the picker).

## Rules of thumb

- Reuse IMDb ids whenever possible: Stremio's Cinemeta add-on then provides details pages, and other add-ons' streams and subtitles attach to your titles.
- Return empty arrays, not errors, for "nothing found". Throwing makes Stremio show an error.
- Keep responses under 3 s. Cache anything slow.
- Use absolute URLs everywhere (posters, subtitles, streams).
