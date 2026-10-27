# Caching

Two caches work together:

1. **Stremio's.** Every response can tell Stremio (and any proxy) how long to keep it, in seconds:

   ```js
   return { metas, cacheMaxAge: 60 * 60, staleRevalidate: 60 * 60 * 4, staleError: 60 * 60 * 24 };
   ```

   The SDK turns these into a `Cache-Control` header ([defineCatalogHandler](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md)). `validate` warns when a response has none. Use hours for data that rarely changes, minutes for fresh data, and `0` while debugging.

2. **Your own,** in the add-on's memory, so a slow, paid or rate-limited source isn't called twice for the same thing.

## An in-memory cache

```js
// src/cache.js
/**
 * Remember results for `ttlMs`. Concurrent calls for the same key share one request,
 * and failures are not remembered, so the next call retries.
 * @template T
 * @param {(key: string) => Promise<T>} load
 * @param {{ ttlMs: number, maxEntries?: number }} options
 * @returns {(key: string) => Promise<T>}
 */
function cached(load, { ttlMs, maxEntries = 500 }) {
  const entries = new Map();
  return (key) => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load(key);
    entries.set(key, { at: Date.now(), value });
    value.catch(() => entries.delete(key));
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value); // forget the oldest
    return value;
  };
}

module.exports = { cached };
```

```js
const { cached } = require('./cache');
const searchApi = cached((query) => myApi.search(query), { ttlMs: 6 * 60 * 60 * 1000 });

const metas = await searchApi(extra.search.trim().toLowerCase()); // normalise the key
```

Notes:

- Normalise keys (case, spaces) so equivalent requests share an entry.
- Don't cache a fallback or degraded answer as if it were the real one. `examples/letterboxd-nl-search/src/search/index.js` shows how.
- The cache empties when the add-on restarts. That's fine for most add-ons; a file or database cache is rarely worth the complexity.
