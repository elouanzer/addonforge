'use strict';

// Request handlers. This add-on only has a search-only catalog: Stremio calls it
// with { type: 'movie', id: 'letterboxd-nl-search', extra: { search: '…' } } when
// you type in its search bar, and shows the results as a row.
// Handler reference: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/requests

const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const { loadConfig } = require('./config');
const { createSearch } = require('./search');

/** How long Stremio and proxies may cache a response, in seconds. */
const CACHE_MAX_AGE = 60 * 60;

const config = loadConfig();
let search = createSearch(config);

/**
 * Search results as meta previews; IMDb ids, so Cinemeta supplies the details page.
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md
 */
async function catalogHandler({ type, id, extra = {} }) {
  const known = manifest.catalogs.some((c) => c.type === type && c.id === id);
  const query = typeof extra.search === 'string' ? extra.search.trim() : '';
  if (!known || !query) return { metas: [] };

  const metas = await search(query.slice(0, 200));
  return { metas, cacheMaxAge: CACHE_MAX_AGE };
}

const builder = new addonBuilder(manifest);
builder.defineCatalogHandler(catalogHandler);

module.exports = {
  addonInterface: builder.getInterface(),
  config,
  handlers: { catalogHandler },
  /** Replace the search function (tests). */
  setSearch: (fn) => {
    search = fn;
  },
};
