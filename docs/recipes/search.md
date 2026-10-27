# Search

Stremio sends what the user types in its search bar to every installed catalog that declares a `search` extra, as `extra.search` ([advanced.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md)).

## Choose the kind of catalog

| `catalogFeatures` | Manifest `extra` | Behaviour |
|---|---|---|
| `search` | `{ name: 'search', isRequired: false }` | The catalog shows on the Board and in Discover, and also answers searches |
| `searchOnly` | `{ name: 'search', isRequired: true }` | The catalog *only* answers searches: Stremio never shows it without a query |

## Searching a list you already have

The template's catalog handler already does this. Compare loosely, ignoring case and accents:

```js
/** "Amélie" and "amelie" match. */
const fold = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function catalogHandler({ type, id, extra = {} }) {
  if (!manifest.catalogs.some((c) => c.type === type && c.id === id)) return { metas: [] };
  let metas = await mySource.list({ type });
  if (extra.search) {
    const query = fold(extra.search.trim());
    metas = metas.filter((m) => fold(m.name).includes(query));
  }
  return { metas: metas.slice(0, 100), cacheMaxAge: 60 * 60 };
}
```

## Passing the search to an API

When the source has its own search endpoint, send the query there instead of downloading everything:

```js
// src/sources/my-api.js
async function search(query) {
  const url = `https://api.example.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`my-api answered HTTP ${res.status}`);
  const body = await res.json();
  return body.results.map(toMetaPreview);
}
```

In the handler, trim the query, ignore empty ones, and cap their length (`extra.search.trim().slice(0, 200)`). Return `{ metas: [] }` when nothing matches; don't throw.

## Testing

- Unit test: call `catalogHandler({ type, id, extra: { search: 'noir' } })` with the source mocked.
- Live: `validate` and `smoke` search for "test" by default. For a search-only catalog, give them a query that should return results:

```bash
node tools/forge.js smoke http://127.0.0.1:7100 --search "1950s science fiction"
```
