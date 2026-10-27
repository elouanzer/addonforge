'use strict';

/**
 * Shapes of the add-on's responses, in the JSON Schema subset of ../json-schema.js.
 * Each part carries `doc`, the upstream section it comes from.
 */

const DOCS = require('./docs');

const nonEmptyString = { type: 'string', minLength: 1 };

/** Fields of a stream that point to the video itself: a stream needs exactly one. */
const STREAM_SOURCES = ['url', 'ytId', 'infoHash', 'externalUrl', 'nzbUrl', 'rarUrls', 'zipUrls', '7zipUrls', 'tgzUrls', 'tarUrls'];

const metaPreview = {
  doc: DOCS.metaPreview,
  type: 'object',
  required: ['id', 'type', 'name'],
  properties: {
    id: nonEmptyString,
    type: nonEmptyString,
    name: nonEmptyString,
    poster: { type: 'string' },
    posterShape: { type: 'string', enum: ['square', 'poster', 'landscape'] },
    genres: { type: 'array', items: { type: 'string' } },
    releaseInfo: { type: 'string' },
    description: { type: 'string' },
  },
};

// The docs require `title`; Cinemeta (Stremio's own add-on) sends `name` instead and
// Stremio accepts both, so either is enough.
const video = {
  doc: DOCS.video,
  type: 'object',
  required: ['id', 'released'],
  properties: { id: nonEmptyString, title: { type: 'string' }, name: { type: 'string' }, released: { type: 'string' } },
  anyOf: [{ required: ['title'] }, { required: ['name'] }],
  anyOfMessage: 'needs a title (or name)',
};

const meta = {
  doc: DOCS.meta,
  type: 'object',
  required: ['id', 'type', 'name'],
  properties: {
    id: nonEmptyString,
    type: nonEmptyString,
    name: nonEmptyString,
    poster: { type: 'string' },
    background: { type: 'string' },
    logo: { type: 'string' },
    genres: { type: 'array', items: { type: 'string' } },
    videos: { type: 'array', items: video },
  },
};

const stream = {
  doc: DOCS.stream,
  type: 'object',
  properties: {
    url: nonEmptyString,
    ytId: nonEmptyString,
    infoHash: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
    fileIdx: { type: 'integer', minimum: 0 },
    externalUrl: nonEmptyString,
    name: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
  },
};

const subtitle = {
  doc: DOCS.subtitles,
  type: 'object',
  required: ['id', 'url', 'lang'],
  properties: { id: nonEmptyString, url: nonEmptyString, lang: nonEmptyString, label: { type: 'string' } },
};

const addonCatalogItem = {
  doc: DOCS.addonCatalog,
  type: 'object',
  required: ['transportName', 'transportUrl', 'manifest'],
  properties: { transportName: nonEmptyString, transportUrl: nonEmptyString, manifest: { type: 'object' } },
};

/** Response body of each resource, keyed by resource name. */
const RESPONSES = {
  catalog: { doc: DOCS.catalogHandler, type: 'object', required: ['metas'], properties: { metas: { type: 'array', items: metaPreview } } },
  meta: { doc: DOCS.meta, type: 'object', required: ['meta'] },
  stream: { doc: DOCS.stream, type: 'object', required: ['streams'], properties: { streams: { type: 'array', items: stream } } },
  subtitles: { doc: DOCS.subtitles, type: 'object', required: ['subtitles'], properties: { subtitles: { type: 'array', items: subtitle } } },
  addon_catalog: { doc: DOCS.addonCatalog, type: 'object', required: ['addons'], properties: { addons: { type: 'array', items: addonCatalogItem } } },
};

module.exports = { RESPONSES, meta, STREAM_SOURCES };
