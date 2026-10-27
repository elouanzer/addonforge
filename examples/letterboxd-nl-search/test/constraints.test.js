'use strict';

// Checking LLM suggestions against the era, genres and countries a search asks for.
// Cinemeta's metadata comes from a mocked fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { keepMatching, constraintsFor, yearFits, metaFits } = require('../src/search/constraints');
const { parseQuery } = require('../src/search/keyword');
const { createSearch, candidateCount } = require('../src/search');
const { loadConfig } = require('../src/config');
const cinemeta = require('../src/sources/cinemeta');

/** Cinemeta metadata by id, as /meta/movie/<id>.json would answer it. */
const METAS = {
  tt1527788: { name: 'The Man from Nowhere', genres: ['Action', 'Crime', 'Thriller'], country: 'South Korea' },
  tt1590089: { name: 'Confessions', genres: ['Drama', 'Thriller'], country: 'Japan' },
  tt0404254: { name: 'My Sassy Girl', genres: ['Comedy', 'Romance'], country: 'United States' },
  tt0456912: { name: 'A Bittersweet Life', genres: ['Action', 'Crime', 'Drama'], country: 'South Korea' },
  tt4016934: { name: 'The Handmaiden', genres: ['Drama', 'Romance', 'Thriller'], country: 'South Korea, Japan' },
};

/** Answers Cinemeta search and meta requests; ids listed in `down` fail. */
function fakeCinemeta(t, { down = [] } = {}) {
  cinemeta.clearCache();
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    const metaId = (href.match(/\/meta\/movie\/(tt\d+)\.json$/) || [])[1];
    if (metaId) {
      if (down.includes(metaId)) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ meta: METAS[metaId] || null }) };
    }
    const title = decodeURIComponent(href.match(/search=(.*)\.json$/)[1]);
    const film = korean.find((f) => f.name === title);
    return { ok: true, status: 200, json: async () => ({ metas: film ? [{ id: film.id, name: film.name, releaseInfo: String(film.year) }] : [] }) };
  });
}

const korean = [
  { id: 'tt1527788', name: 'The Man from Nowhere', year: 2010 },
  { id: 'tt1590089', name: 'Confessions', year: 2010 },
  { id: 'tt0192657', name: 'Shiri', year: 1999, cinemetaYear: 1999 },
  { id: 'tt0404254', name: 'My Sassy Girl', year: 2008 },
  { id: 'tt0456912', name: 'A Bittersweet Life', year: 2005 },
  { id: 'tt4016934', name: 'The Handmaiden', year: 2016 },
];

test('parseQuery: post/pre years and negated genres or countries', () => {
  assert.deepEqual(parseQuery('korean thriller post 2000'), { genres: ['Thriller'], countries: ['South Korea'], terms: ['south korea'], from: 2000 });
  assert.equal(parseQuery('pre-1960 noir').to, 1959);
  assert.deepEqual(parseQuery('not american thrillers').countries, []);
  assert.deepEqual(parseQuery('non-korean horror'), { genres: ['Horror'], countries: [], terms: [] });
  assert.deepEqual(parseQuery('english films').countries, [], '"English" is a language, not a country');
});

test('constraintsFor: related genres accepted; drama and family are not filtered on', () => {
  const c = constraintsFor('korean thriller post 2000');
  assert.equal(c.from, 2000);
  assert.deepEqual(c.genres, [['Thriller', 'Crime', 'Mystery']]);
  assert.deepEqual(c.countries, [['South Korea']]);
  assert.deepEqual(constraintsFor('family drama').genres, []);
  assert.deepEqual(constraintsFor('german expressionism').countries, [['Germany', 'West Germany', 'East Germany']]);
});

test('yearFits: either known year in range; unknown years pass', () => {
  const c = constraintsFor('post 2000');
  assert.equal(yearFits(c, [1999, 1999]), false);
  assert.equal(yearFits(c, [1999, 2001]), true, 'the model or Cinemeta year');
  assert.equal(yearFits(c, [undefined, undefined]), true);
});

test('metaFits: genres and co-producing countries; missing fields pass', () => {
  const c = constraintsFor('korean thriller');
  assert.equal(metaFits(c, METAS.tt1527788), true);
  assert.equal(metaFits(c, METAS.tt0456912), true, 'Crime counts as thriller');
  assert.equal(metaFits(c, METAS.tt4016934), true, 'co-production');
  assert.equal(metaFits(c, METAS.tt1590089), false, 'Japanese');
  assert.equal(metaFits(c, METAS.tt0404254), false, 'American comedy');
  assert.equal(metaFits(c, { name: 'No data' }), true);
});

test('keepMatching: the screenshot search keeps the Korean thrillers only', async (t) => {
  fakeCinemeta(t);
  const kept = await keepMatching(korean, 'korean thriller post 2000');
  assert.deepEqual(kept.map((f) => f.name), ['The Man from Nowhere', 'A Bittersweet Life', 'The Handmaiden']);
});

test('keepMatching: no constraint, no request; year-only needs no metadata; failures keep the film', async (t) => {
  const fetchMock = fakeCinemeta(t, { down: ['tt1590089'] });
  assert.equal(await keepMatching(korean, 'slow burn heist'), korean);
  assert.deepEqual((await keepMatching(korean, 'after 2000')).map((f) => f.name), ['The Man from Nowhere', 'Confessions', 'My Sassy Girl', 'A Bittersweet Life', 'The Handmaiden']);
  assert.equal(fetchMock.mock.callCount(), 0);
  const kept = await keepMatching(korean, 'korean thriller');
  assert.ok(kept.some((f) => f.name === 'Confessions'), 'metadata unavailable: unknown is not a mismatch');
});

test('candidateCount: more films asked for with a longer watch history; Ollama capped at 40', () => {
  const claude = { maxResults: 20, provider: 'anthropic' };
  assert.equal(candidateCount(claude, 0), 20);
  assert.equal(candidateCount(claude, 100), 32);
  assert.equal(candidateCount(claude, 1486), 60);
  const ollama = { maxResults: 20, provider: 'ollama' };
  assert.equal(candidateCount(ollama, 100), 32);
  assert.equal(candidateCount(ollama, 1486), 40);
  assert.equal(candidateCount({ maxResults: 50, provider: 'ollama' }, 1486), 50, 'never fewer than shown');
});

test('pipeline: LLM suggestions are checked, and more films are asked for with a big history', async (t) => {
  fakeCinemeta(t);
  t.mock.method(console, 'log', () => {});
  const letterboxd = require('../src/sources/letterboxd');
  letterboxd.clearCache();
  const calls = [];
  const provider = {
    name: 'fake',
    suggest: async (request) => (calls.push(request), { films: korean.map((f) => ({ title: f.name, year: f.year })) }),
  };
  const search = createSearch({ ...loadConfig({ LETTERBOXD_DIR: '/nonexistent' }), provider: 'ollama' }, { provider });
  const results = await search('korean thriller post 2000');
  assert.deepEqual(results.map((m) => m.name), ['The Man from Nowhere', 'A Bittersweet Life', 'The Handmaiden']);
  assert.match(calls[0].prompt, /List up to 20 films/, 'no export: no extra candidates');

  t.mock.method(letterboxd, 'load', () => ({ watched: Array.from({ length: 1486 }, (_, i) => ({ name: `Seen ${i}`, year: 2000 })), ratings: [] }));
  await createSearch({ ...loadConfig({}), provider: 'anthropic' }, { provider })('korean thriller');
  assert.match(calls[1].prompt, /List up to 60 films/);
  await createSearch({ ...loadConfig({}), provider: 'ollama' }, { provider })('korean thriller');
  assert.match(calls[2].prompt, /List up to 40 films/);
});
