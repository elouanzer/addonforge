'use strict';

// The manifest, the settings and the catalog handler, with the search mocked.

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../src/manifest');
const { loadConfig, describe } = require('../src/config');
const addon = require('../src/addon');

const catalog = manifest.catalogs[0];

test('manifest: one movie catalog that only answers searches', () => {
  for (const field of ['id', 'version', 'name', 'description', 'resources', 'types', 'catalogs']) {
    assert.ok(manifest[field] !== undefined, `manifest.${field} is missing`);
  }
  assert.deepEqual(manifest.resources, ['catalog']);
  assert.equal(catalog.type, 'movie');
  assert.deepEqual(catalog.extra, [{ name: 'search', isRequired: true }]);
});

test('catalog: searches, and returns nothing without a search or for another catalog', async () => {
  const queries = [];
  addon.setSearch(async (q) => (queries.push(q), [{ id: 'tt0071315', type: 'movie', name: 'Chinatown', poster: 'https://example.com/p.jpg' }]));

  const res = await addon.handlers.catalogHandler({ type: 'movie', id: catalog.id, extra: { search: '  70s noir ' } });
  assert.equal(res.metas[0].id, 'tt0071315');
  assert.ok(res.cacheMaxAge > 0);
  assert.deepEqual(queries, ['70s noir']);

  assert.deepEqual((await addon.handlers.catalogHandler({ type: 'movie', id: catalog.id, extra: {} })).metas, []);
  assert.deepEqual((await addon.handlers.catalogHandler({ type: 'movie', id: 'other', extra: { search: 'x' } })).metas, []);
  assert.equal(queries.length, 1);
});

test('config: keyword by default; a chosen LLM without its key falls back to keyword', () => {
  const plain = loadConfig({});
  assert.equal(plain.provider, 'keyword');
  assert.deepEqual(plain.problems, []);
  assert.equal(plain.hideWatched, true);
  assert.equal(plain.maxResults, 20);

  const noKey = loadConfig({ SEARCH_PROVIDER: 'anthropic' });
  assert.equal(noKey.provider, 'keyword');
  assert.match(noKey.problems[0], /needs ANTHROPIC_API_KEY/);

  const claude = loadConfig({ SEARCH_PROVIDER: 'Anthropic', ANTHROPIC_API_KEY: 'secret-value' });
  assert.equal(claude.provider, 'anthropic');
  assert.equal(claude.model, 'claude-haiku-5-5');
  assert.doesNotMatch(describe(claude), /secret-value/, 'the key is never printed');

  const openai = loadConfig({ SEARCH_PROVIDER: 'openai', OPENAI_API_KEY: 'k' });
  assert.equal(openai.provider, 'keyword', 'openai needs LLM_MODEL');
  assert.equal(loadConfig({ SEARCH_PROVIDER: 'openai', OPENAI_API_KEY: 'k', LLM_MODEL: 'm' }).baseUrl, 'https://api.openai.com/v1');

  const ollama = loadConfig({ SEARCH_PROVIDER: 'ollama', OLLAMA_URL: 'http://host.docker.internal:11434/v1/' });
  assert.equal(ollama.provider, 'ollama');
  assert.equal(ollama.baseUrl, 'http://host.docker.internal:11434/v1');

  assert.equal(loadConfig({ SEARCH_PROVIDER: 'gpt' }).provider, 'keyword');
  assert.equal(loadConfig({ HIDE_WATCHED: 'false', MAX_RESULTS: '500' }).hideWatched, false);
  assert.equal(loadConfig({ MAX_RESULTS: '500' }).maxResults, 50);
});
