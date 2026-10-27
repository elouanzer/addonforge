'use strict';

/**
 * A fake add-on for testing the tools: a valid baseline that exercises every
 * resource, served by a real HTTP server. Tests break one thing at a time.
 */

const http = require('node:http');

/**
 * @typedef {object} Reply
 * @property {number} [status]
 * @property {unknown} [body]      Serialised as JSON unless `raw` is set.
 * @property {string} [raw]        Raw body.
 * @property {Record<string, string|null>} [headers] Overrides; null removes a default header.
 * @property {number} [delayMs]
 */

/**
 * @typedef {object} Fixture
 * @property {any} manifest
 * @property {Record<string, Reply>} routes Keyed by "manifest" or "resource/type/id".
 * @property {Record<string, string>} headers Default headers on every reply.
 * @property {string[]} [seen]   Paths requested, filled in by the server.
 */

/** @returns {Fixture} A fresh, fully valid fixture. */
function validFixture() {
  const movie = { id: 'tt0063350', type: 'movie', name: 'Night of the Living Dead', poster: 'https://example.com/p.jpg' };
  return {
    manifest: {
      id: 'community.addonforge.fixture',
      version: '1.0.0',
      name: 'Fixture',
      description: 'Every resource, all valid',
      resources: ['catalog', 'meta', 'stream', 'subtitles', 'addon_catalog'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: [{ type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'search', isRequired: false }] }],
      addonCatalogs: [{ type: 'movie', id: 'friends', name: 'Friends of fixture' }],
      config: [{ key: 'lang', type: 'select', options: ['en', 'fr'], title: 'Language' }],
      behaviorHints: { configurable: true },
      logo: 'https://example.com/logo.png',
    },
    routes: {
      'catalog/movie/top': { body: { metas: [movie] } },
      'meta/movie/tt0063350': { body: { meta: { ...movie, background: 'https://example.com/b.jpg' } } },
      'meta/series/tt0108778': {
        body: {
          meta: {
            id: 'tt0108778',
            type: 'series',
            name: 'Friends',
            poster: 'https://example.com/f.jpg',
            videos: [{ id: 'tt0108778:1:1', title: 'Pilot', released: '1994-09-22T00:00:00.000Z' }],
          },
        },
      },
      'stream/movie/tt0063350': { body: { streams: [{ url: 'https://example.com/v.mp4', name: 'HD' }] } },
      'stream/series/tt0108778:1:1': { body: { streams: [{ ytId: 'dQw4w9WgXcQ' }] } },
      'subtitles/movie/tt0063350': { body: { subtitles: [{ id: '1', url: 'https://example.com/s.srt', lang: 'eng' }] } },
      'subtitles/series/tt0108778:1:1': { body: { subtitles: [] } },
      'addon_catalog/movie/friends': {
        body: {
          addons: [
            {
              transportName: 'http',
              transportUrl: 'https://example.com/manifest.json',
              manifest: { id: 'org.example', version: '1.0.0', name: 'Example', description: 'x', resources: ['catalog'], types: ['movie'], catalogs: [] },
            },
          ],
        },
      },
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'max-age=60, public',
    },
  };
}

const RESOURCE_PATH = /^(?:\/[^/]+)?\/(catalog|meta|stream|subtitles|addon_catalog)\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/;

/**
 * Serve a fixture on 127.0.0.1 with a random port.
 * @param {Fixture} fixture
 * @returns {Promise<{ url: string, port: number, seen: string[], close: () => Promise<void> }>}
 */
async function serve(fixture) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    seen.push(path);
    let key = null;
    if (/^(?:\/[^/]+)?\/manifest\.json$/.test(path)) key = 'manifest';
    const m = path.match(RESOURCE_PATH);
    if (m) key = `${m[1]}/${decodeURIComponent(m[2])}/${decodeURIComponent(m[3])}`;

    /** @type {Reply} */
    let reply;
    if (key === 'manifest') reply = { body: fixture.manifest, ...(fixture.routes.manifest || {}) };
    else reply = (key && fixture.routes[key]) || { status: 404, body: { err: 'not found' } };

    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    const headers = { ...fixture.headers, ...(reply.headers || {}) };
    for (const [k, v] of Object.entries(headers)) if (v !== null) res.setHeader(k, v);
    res.statusCode = reply.status || 200;
    res.end(reply.raw !== undefined ? reply.raw : JSON.stringify(reply.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { validFixture, serve };
