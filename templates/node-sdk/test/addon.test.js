'use strict';

// Handler tests with a mocked data source: they never hit the network.
// Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../src/manifest');
const source = require('../src/sources');
const { handlers } = require('../src/addon');

const catalog = manifest.catalogs[0];
// A search-only catalog (catalogFeatures: searchOnly) always receives a search.
const base = catalog && (catalog.extra || []).some((e) => e.name === 'search' && e.isRequired) ? { search: 'film' } : {};
const declares = (resource) => manifest.resources.some((r) => (typeof r === 'string' ? r : r.name) === resource);

/** @param {number} n */
function fakeItems(n, type = catalog ? catalog.type : 'movie') {
  return Array.from({ length: n }, (_, i) => ({
    id: `tt${String(i).padStart(7, '0')}`,
    type,
    name: i % 2 ? `Odd film ${i}` : `Even film ${i}`,
    poster: `https://example.com/${i}.jpg`,
    genres: [i % 2 ? 'Comedy' : 'Drama'],
  }));
}

test('manifest has the fields Stremio requires', () => {
  for (const field of ['id', 'version', 'name', 'description', 'resources', 'types', 'catalogs']) {
    assert.ok(manifest[field] !== undefined, `manifest.${field} is missing`);
  }
});

test('catalog returns meta previews with id, type, name and poster', { skip: !catalog }, async (t) => {
  t.mock.method(source, 'list', async () => fakeItems(3));
  const { metas } = await handlers.catalogHandler({ type: catalog.type, id: catalog.id, extra: { ...base } });
  assert.equal(metas.length, 3);
  for (const meta of metas) {
    assert.ok(meta.id && meta.type && meta.name && meta.poster);
  }
});

test('catalog search filters by name', { skip: !catalog }, async (t) => {
  t.mock.method(source, 'list', async () => fakeItems(4));
  const { metas } = await handlers.catalogHandler({ type: catalog.type, id: catalog.id, extra: { search: 'odd' } });
  assert.deepEqual(metas.map((m) => m.name), ['Odd film 1', 'Odd film 3']);
});

test('catalog genre filter', { skip: !catalog }, async (t) => {
  t.mock.method(source, 'list', async () => fakeItems(4));
  const { metas } = await handlers.catalogHandler({ type: catalog.type, id: catalog.id, extra: { ...base, genre: 'Drama' } });
  assert.equal(metas.length, 2);
});

test('catalog pages by 100 with skip', { skip: !catalog }, async (t) => {
  t.mock.method(source, 'list', async () => fakeItems(150));
  const first = await handlers.catalogHandler({ type: catalog.type, id: catalog.id, extra: { ...base } });
  const second = await handlers.catalogHandler({ type: catalog.type, id: catalog.id, extra: { ...base, skip: '100' } });
  assert.equal(first.metas.length, 100);
  assert.equal(second.metas.length, 50);
});

test('unknown catalog returns an empty list', async () => {
  const { metas } = await handlers.catalogHandler({ type: 'movie', id: 'does-not-exist', extra: {} });
  assert.deepEqual(metas, []);
});

test('meta returns the item, or null when unknown', { skip: !declares('meta') }, async (t) => {
  const [item] = fakeItems(1, manifest.types[0]);
  t.mock.method(source, 'get', async (id) => (id === item.id ? item : null));
  assert.deepEqual((await handlers.metaHandler({ type: item.type, id: item.id })).meta, item);
  assert.equal((await handlers.metaHandler({ type: item.type, id: 'tt9999999' })).meta, null);
});

test('stream returns a streams array', { skip: !declares('stream') }, async () => {
  const res = await handlers.streamHandler({ type: manifest.types[0], id: 'tt0000001' });
  assert.ok(Array.isArray(res.streams));
});

test('subtitles returns a subtitles array', { skip: !declares('subtitles') }, async () => {
  const res = await handlers.subtitlesHandler({ type: manifest.types[0], id: 'tt0000001', extra: {} });
  assert.ok(Array.isArray(res.subtitles));
});
