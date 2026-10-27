# Rate-limited APIs

Most free APIs limit requests per second or per day, and a Stremio catalog can trigger many lookups at once. Four habits keep an add-on inside the limits.

## 1. Time out every request

A hanging request blocks the whole response. Give `fetch` a deadline:

```js
const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
```

## 2. Limit how many run at once

```js
/**
 * Run `fn` over `items`, at most `limit` at a time, keeping the order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const details = await mapLimit(ids, 4, (id) => myApi.details(id));
```

## 3. Retry politely

Retry only what can succeed later (`429 Too Many Requests` and `5xx` server errors), a limited number of times, waiting longer each time and honouring `Retry-After`:

```js
async function getJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10000)));
  }
}
```

The error message names the host, not the full URL: URLs often carry the API key.

## 4. Cache

The cheapest request is the one you don't make. See [caching](caching.md).

Write the source's limits in `addon.forge.json` (`sources[].rateLimit`) and in the add-on's README, so the next person knows them.
