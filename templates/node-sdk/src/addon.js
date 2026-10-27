'use strict';

// Request handlers. Each one receives { type, id, extra, config } and returns a Promise.
// - type, id: what Stremio asks for (see the manifest's types, catalogs and idPrefixes)
// - extra:    catalog options such as { search, genre, skip }
// - config:   values the user entered on the /configure page (manifest.config)
// Handler reference: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/requests

const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest');
const source = require('./sources');

/** How long Stremio and proxies may cache a response, in seconds. */
const CACHE_MAX_AGE = 60 * 60;

/** Stremio asks for pages of 100 items (extra.skip = 0, 100, 200…). */
const PAGE_SIZE = 100;

/**
 * Catalog feed, search and filtering.
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md
 */
async function catalogHandler({ type, id, extra = {} }) {
  const known = manifest.catalogs.some((c) => c.type === type && c.id === id);
  if (!known) return { metas: [] };

  let metas = await source.list({ type });

  if (extra.search) {
    const query = String(extra.search).toLowerCase();
    metas = metas.filter((m) => m.name.toLowerCase().includes(query));
  }
  if (extra.genre) {
    metas = metas.filter((m) => (m.genres || []).includes(extra.genre));
  }

  const skip = Number.parseInt(extra.skip, 10) || 0;
  return { metas: metas.slice(skip, skip + PAGE_SIZE), cacheMaxAge: CACHE_MAX_AGE };
}

/**
 * Full metadata for one item. Only needed for custom ids: IMDb ids get their
 * metadata from Cinemeta.
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineMetaHandler.md
 */
async function metaHandler({ type, id }) {
  const item = await source.get(id);
  if (!item || item.type !== type) return { meta: null };
  return { meta: item, cacheMaxAge: CACHE_MAX_AGE };
}

/**
 * Streams for one video. Only legitimate sources: public-domain media, the user's
 * own files, licensed services, official trailers (see the content policy in AGENTS.md).
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md
 */
async function streamHandler(_args) {
  return { streams: [], cacheMaxAge: CACHE_MAX_AGE };
}

/**
 * Subtitles for one video.
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md
 */
async function subtitlesHandler(_args) {
  return { subtitles: [], cacheMaxAge: CACHE_MAX_AGE };
}

/**
 * A catalog of other add-ons.
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineResourceHandler.md
 */
async function addonCatalogHandler(_args) {
  return { addons: [], cacheMaxAge: CACHE_MAX_AGE };
}

// The SDK refuses to start unless every declared resource has a handler and no
// handler is defined for an undeclared one, so register exactly what the manifest declares.
const declared = new Set(manifest.resources.map((r) => (typeof r === 'string' ? r : r.name)));
const builder = new addonBuilder(manifest);
if (manifest.catalogs.length) builder.defineCatalogHandler(catalogHandler);
if (declared.has('meta')) builder.defineMetaHandler(metaHandler);
if (declared.has('stream')) builder.defineStreamHandler(streamHandler);
if (declared.has('subtitles')) builder.defineSubtitlesHandler(subtitlesHandler);
if (declared.has('addon_catalog')) builder.defineResourceHandler('addon_catalog', addonCatalogHandler);

module.exports = {
  addonInterface: builder.getInterface(),
  handlers: { catalogHandler, metaHandler, streamHandler, subtitlesHandler, addonCatalogHandler },
};
