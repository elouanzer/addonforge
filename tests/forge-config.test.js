'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidName,
  validateForgeConfig,
  defaultForgeConfig,
  manifestFromForge,
  titleCase,
} = require('../tools/lib/forge-config');

/** A valid config; each test breaks one thing. */
const valid = () => ({
  name: 'letterboxd-nl-search',
  description: 'Natural-language film search backed by Letterboxd data',
  template: 'node-sdk',
  resources: ['catalog'],
  types: ['movie'],
  idScheme: 'imdb',
  sources: [{ name: 'letterboxd', needsKey: false, terms: 'https://letterboxd.com/legal/' }],
  catalogFeatures: ['search'],
  userConfig: [{ key: 'username', type: 'text', required: true }],
  hosting: 'localhost',
  contentPolicyAcknowledged: true,
});

/** @param {object} config */
const errorPaths = (config) => validateForgeConfig(config).map((e) => e.path);

test('the reference example is valid', () => {
  assert.deepEqual(validateForgeConfig(valid()), []);
});

test('the default config is valid', () => {
  assert.deepEqual(validateForgeConfig(defaultForgeConfig('demo')), []);
});

test('names must be kebab-case', () => {
  for (const ok of ['demo', 'my-addon', 'a1-b2']) assert.ok(isValidName(ok), ok);
  for (const bad of ['', 'Demo', 'my_addon', '-x', 'x-', 'a--b', 'a b', '../x', 'x'.repeat(51)]) {
    assert.ok(!isValidName(bad), bad);
  }
});

const broken = {
  'missing required field': [(c) => delete c.types, 'types'],
  'invalid name': [(c) => (c.name = 'My Addon'), 'name'],
  'unknown resource': [(c) => (c.resources = ['torrents']), 'resources[0]'],
  'empty resources': [(c) => (c.resources = []), 'resources'],
  'duplicate type': [(c) => (c.types = ['movie', 'movie']), 'types'],
  'unknown idScheme': [(c) => (c.idScheme = 'tmdb'), 'idScheme'],
  'unknown property': [(c) => (c.foo = 1), 'foo'],
  'stream without content policy': [
    (c) => {
      c.resources = ['stream'];
      delete c.contentPolicyAcknowledged;
    },
    'contentPolicyAcknowledged',
  ],
  'stream with content policy false': [
    (c) => {
      c.resources = ['stream'];
      c.contentPolicyAcknowledged = false;
    },
    'contentPolicyAcknowledged',
  ],
  'custom ids without prefix': [(c) => (c.idScheme = 'custom'), 'idPrefix'],
  'genre filter without genres': [(c) => (c.catalogFeatures = ['genre']), 'genres'],
  'select config without options': [(c) => (c.userConfig = [{ key: 'lang', type: 'select' }]), 'userConfig[0].options'],
  'bad config type': [(c) => (c.userConfig = [{ key: 'k', type: 'boolean' }]), 'userConfig[0].type'],
  'port out of range': [(c) => (c.port = 80), 'port'],
};

for (const [label, [breakIt, expectedPath]] of Object.entries(broken)) {
  test(`rejects: ${label}`, () => {
    const config = valid();
    breakIt(config);
    assert.ok(errorPaths(config).includes(expectedPath), `expected an error at ${expectedPath}, got ${errorPaths(config)}`);
  });
}

test('titleCase', () => {
  assert.equal(titleCase('hello-catalog'), 'Hello Catalog');
});

test('manifest for a search catalog with user config', () => {
  const m = manifestFromForge(valid());
  assert.equal(m.id, 'community.addonforge.letterboxd-nl-search');
  assert.equal(m.name, 'Letterboxd Nl Search');
  assert.deepEqual(m.catalogs, [
    { type: 'movie', id: 'letterboxd-nl-search', name: 'Letterboxd Nl Search', extra: [{ name: 'search', isRequired: false }] },
  ]);
  assert.equal(m.idPrefixes, undefined, 'catalog-only add-ons need no idPrefixes');
  assert.deepEqual(m.config, [{ key: 'username', type: 'text', title: 'username', required: true }]);
  assert.deepEqual(m.behaviorHints, { configurable: true, configurationRequired: true });
});

test('manifest: searchOnly makes search a required extra', () => {
  const m = manifestFromForge({ ...valid(), catalogFeatures: ['searchOnly'] });
  assert.deepEqual(m.catalogs[0].extra, [{ name: 'search', isRequired: true }]);
  const both = manifestFromForge({ ...valid(), catalogFeatures: ['search', 'searchOnly'] });
  assert.deepEqual(both.catalogs[0].extra, [{ name: 'search', isRequired: true }]);
  assert.deepEqual(validateForgeConfig({ ...valid(), catalogFeatures: ['searchOnly'] }), []);
});

test('manifest: custom ids, several types, genre and pagination', () => {
  const m = manifestFromForge({
    ...valid(),
    id: 'org.example.thing',
    displayName: 'Thing',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idScheme: 'custom',
    idPrefix: 'thing:',
    catalogFeatures: ['genre', 'pagination'],
    genres: ['Drama'],
    userConfig: [],
  });
  assert.equal(m.id, 'org.example.thing');
  assert.deepEqual(m.idPrefixes, ['thing:']);
  assert.deepEqual(m.catalogs.map((c) => c.id), ['letterboxd-nl-search-movie', 'letterboxd-nl-search-series']);
  assert.deepEqual(m.catalogs[0].extra, [
    { name: 'genre', isRequired: false, options: ['Drama'] },
    { name: 'skip', isRequired: false },
  ]);
  assert.equal(m.config, undefined);
  assert.equal(m.behaviorHints, undefined);
});

test('manifest: subtitles-only add-on with IMDb ids', () => {
  const m = manifestFromForge({ ...valid(), resources: ['subtitles'], catalogFeatures: [], userConfig: [] });
  assert.deepEqual(m.catalogs, []);
  assert.deepEqual(m.idPrefixes, ['tt']);
});

test('manifest: addon_catalog declares addonCatalogs', () => {
  const m = manifestFromForge({ ...valid(), resources: ['addon_catalog'], userConfig: [] });
  assert.deepEqual(m.addonCatalogs, [{ type: 'movie', id: 'letterboxd-nl-search-addons', name: 'Letterboxd Nl Search' }]);
});
