# Pagination

Stremio loads a catalog 100 items at a time. When the user scrolls to the end, it asks for the next page with `extra.skip`: `100`, then `200`, and so on. **Returning fewer than 100 items tells Stremio the catalog has ended** ([defineCatalogHandler](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md)).

Enable it with `"catalogFeatures": ["pagination"]`, which adds `{ name: 'skip', isRequired: false }` to the catalog.

## A list in memory

```js
const PAGE_SIZE = 100;

const skip = Number.parseInt(extra.skip, 10) || 0;
return { metas: metas.slice(skip, skip + PAGE_SIZE), cacheMaxAge: 60 * 60 };
```

## An API with its own page size

Most APIs return 20 or 50 results per page. Fetch as many API pages as one Stremio page needs:

```js
const PAGE_SIZE = 100; // Stremio's
const API_PAGE_SIZE = 20; // the API's

async function page(skip) {
  const first = Math.floor(skip / API_PAGE_SIZE) + 1; // the API counts pages from 1
  const count = PAGE_SIZE / API_PAGE_SIZE;
  const pages = [];
  for (let p = first; p < first + count; p++) {
    const results = await myApi.popular({ page: p }); // one at a time: kinder to rate limits
    pages.push(...results);
    if (results.length < API_PAGE_SIZE) break; // the API has no more
  }
  return pages;
}
```

Cache each page (see [caching](caching.md)): scrolling back and forth shouldn't refetch.

## Testing

- Unit test: 150 fake items give 100 items at `skip` 0 and 50 at `skip` 100 (the template's tests do this).
- `smoke` requests `skip=100` for catalogs that declare it.
