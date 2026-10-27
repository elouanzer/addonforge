'use strict';

// Data sources: the Letterboxd export reader, the Cinemeta resolver and the seed list.
// Cinemeta calls are answered by a mocked fetch: these tests never hit the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const letterboxd = require('../src/sources/letterboxd');
const cinemeta = require('../src/sources/cinemeta');
const SEED = require('../src/sources/seed-films.json');

const EXPORT_DIR = path.join(__dirname, 'fixtures', 'export');

/** A fetch answering Cinemeta searches from a { title: metas[] } table. */
function fakeCinemeta(table) {
  return async (url) => {
    const title = decodeURIComponent(String(url).match(/search=(.*)\.json$/)[1]);
    return { ok: true, status: 200, json: async () => ({ metas: table[title] || [] }) };
  };
}

test('parseCsv: header keys, quotes, doubled quotes, BOM and CRLF', () => {
  const rows = letterboxd.parseCsv('﻿Name,Year\r\n"Crouching Tiger, Hidden Dragon",2000\r\n"The ""Real"" Film",1999\r\n\r\n');
  assert.deepEqual(rows, [
    { Name: 'Crouching Tiger, Hidden Dragon', Year: '2000' },
    { Name: 'The "Real" Film', Year: '1999' },
  ]);
  assert.deepEqual(letterboxd.parseCsv(''), []);
});

test('load: watched includes rated films; a missing folder is empty', (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  const data = letterboxd.load(EXPORT_DIR);
  assert.equal(data.ratings.length, 3);
  assert.deepEqual(data.ratings[1], { name: 'The "Real" Film', year: 1999, rating: 4.5 });
  assert.equal(data.watched.length, 6, '3 watched + 3 rated');
  assert.deepEqual(letterboxd.load(path.join(EXPORT_DIR, 'nope')), { watched: [], ratings: [] });
});

test('matcher: loose title, year within 1, any of several names', (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  const seen = letterboxd.matcher(letterboxd.load(EXPORT_DIR).watched);
  assert.equal(seen(['Day of the Jackal'], 1973), true, 'leading "The" ignored');
  assert.equal(seen(['crouching tiger hidden dragon'], 2001), true, 'punctuation and ±1 year');
  assert.equal(seen(['The Red Circle', 'Le Cercle Rouge'], 1970), true, 'any name');
  assert.equal(seen(['Jaws'], 2012), false, 'a remake years later is another film');
  assert.equal(seen(['Alien'], 1979), false);
});

test('favourites: films rated 4 or more, best first', (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  assert.deepEqual(letterboxd.favourites(letterboxd.load(EXPORT_DIR)), ['Chinatown (1974)', 'The "Real" Film (1999)']);
});

test('normalizeTitle ignores case, accents, punctuation, "&" and a leading article', () => {
  assert.equal(cinemeta.normalizeTitle('The Umbrellas of Cherbourg'), 'umbrellas of cherbourg');
  assert.equal(cinemeta.normalizeTitle('Amélie'), 'amelie');
  assert.equal(cinemeta.normalizeTitle('Thelma & Louise'), 'thelma and louise');
});

test('pickMatch: exact title, prefix title, then same-year top results', () => {
  const metas = [
    { id: 'tt0076759', name: 'Star Wars: Episode IV - A New Hope', releaseInfo: '1977' },
    { id: 'tt0120915', name: 'Star Wars: Episode I - The Phantom Menace', releaseInfo: '1999' },
  ];
  assert.equal(cinemeta.pickMatch(metas, 'Star Wars', 1977).id, 'tt0076759');
  assert.equal(cinemeta.pickMatch(metas, 'Star Wars', 1990), null);

  const samurai = [{ id: 'tt0047478', name: 'Seven Samurai', releaseInfo: '1956' }];
  assert.equal(cinemeta.pickMatch(samurai, 'Seven Samurai', 1954).id, 'tt0047478', 'US release year');

  const circle = [
    { id: 'tt0065531', name: 'The Red Circle', releaseInfo: '1970' },
    { id: 'tt0020345', name: 'Der rote Kreis', releaseInfo: '1929' },
  ];
  assert.equal(cinemeta.pickMatch(circle, 'Le Cercle Rouge', 1970).id, 'tt0065531', 'translated title, same year');
  assert.equal(cinemeta.pickMatch(circle, 'Le Cercle Rouge', 1975), null);

  const remakes = [
    { id: 'tt1', name: 'Dune', releaseInfo: '2021' },
    { id: 'tt2', name: 'Dune', releaseInfo: '1984' },
  ];
  assert.equal(cinemeta.pickMatch(remakes, 'Dune', 1984).id, 'tt2');
  assert.equal(cinemeta.pickMatch(remakes, 'Dune').id, 'tt1', 'no year: first exact title');
  assert.equal(cinemeta.pickMatch([{ id: 'x1', name: 'Dune' }], 'Dune'), null, 'only IMDb ids');
});

test('resolve: looks up once, and a failed lookup is retried later', async (t) => {
  cinemeta.clearCache();
  const fetchMock = t.mock.method(globalThis, 'fetch', fakeCinemeta({ Chinatown: [{ id: 'tt0071315', name: 'Chinatown', releaseInfo: '1974' }] }));
  assert.deepEqual(await cinemeta.resolve('Chinatown', 1974), { id: 'tt0071315', name: 'Chinatown', year: 1974 });
  await cinemeta.resolve('chinatown', 1974);
  assert.equal(fetchMock.mock.callCount(), 1, 'cached');
  assert.equal(await cinemeta.resolve('Nothing Like This', 2001), null);

  t.mock.method(console, 'warn', () => {});
  fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
  const before = fetchMock.mock.callCount();
  assert.equal(await cinemeta.resolve('Alien', 1979), null, 'errors are a non-match');
  assert.equal(fetchMock.mock.callCount() - before, 2, 'a server error is retried once');
  fetchMock.mock.mockImplementation(fakeCinemeta({ Alien: [{ id: 'tt0078748', name: 'Alien', releaseInfo: '1979' }] }));
  assert.equal((await cinemeta.resolve('Alien', 1979)).id, 'tt0078748', 'retried');
});

test('resolve: a passing 504 does not lose the film', async (t) => {
  cinemeta.clearCache();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1 ? { ok: false, status: 504 } : { ok: true, status: 200, json: async () => ({ metas: [{ id: 'tt0365376', name: 'A Tale of Two Sisters', releaseInfo: '2003' }] }) },
  );
  assert.equal((await cinemeta.resolve('A Tale of Two Sisters', 2003)).id, 'tt0365376');
});

test('seed list: unique IMDb ids and the fields keyword search needs', () => {
  assert.ok(SEED.length >= 150, `only ${SEED.length} films`);
  assert.equal(new Set(SEED.map((f) => f.id)).size, SEED.length);
  for (const f of SEED) {
    assert.match(f.id, /^tt\d+$/, f.name);
    assert.ok(f.name && Number.isInteger(f.year), f.id);
    for (const key of ['genres', 'countries', 'directors', 'tags']) assert.ok(Array.isArray(f[key]), `${f.name}.${key}`);
    assert.ok(f.tags.length > 0, `${f.name} has tags`);
    assert.equal(f.description, undefined, 'no synopses in the seed list');
  }
});
