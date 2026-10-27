'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validFixture, serve } = require('./fixtures/addon');
const { smoke, catalogVariants, roundRobinByType } = require('../tools/smoke');

const FORGE = path.join(__dirname, '..', 'tools', 'forge.js');

/**
 * @param {(f: import('./fixtures/addon').Fixture) => void} [mutate]
 * @param {object} [options]
 */
async function run(mutate, options) {
  const fixture = validFixture();
  if (mutate) mutate(fixture);
  const server = await serve(fixture);
  try {
    return { ...(await smoke(server.url, options)), seen: server.seen };
  } finally {
    await server.close();
  }
}

const endpoints = (rows) => rows.map((r) => r.endpoint);

test('catalogVariants: feed plus one request per supported extra', () => {
  assert.deepEqual(catalogVariants({ extra: [{ name: 'search' }, { name: 'genre', options: ['Drama', 'Horror'] }, { name: 'skip' }] }), [
    {},
    { search: 'test' },
    { genre: 'Drama' },
    { skip: '100' },
  ]);
});

test('catalogVariants: required extras are always sent; legacy notation works', () => {
  assert.deepEqual(catalogVariants({ extra: [{ name: 'search', isRequired: true }] }), [{ search: 'test' }]);
  assert.deepEqual(catalogVariants({ extraSupported: ['search', 'skip'] }), [{}, { search: 'test' }, { skip: '100' }]);
  assert.deepEqual(catalogVariants({ extra: [{ name: 'genre', isRequired: true, options: ['A'] }, { name: 'skip' }] }), [{ genre: 'A' }, { genre: 'A', skip: '100' }]);
  assert.deepEqual(catalogVariants({ extra: [{ name: 'ids', isRequired: true }] }), [], 'nothing to send: skipped');
  assert.deepEqual(catalogVariants({ extra: [{ name: 'genre' }] }), [{}], 'genre without options is not tried');
});

test('catalogVariants: --search replaces the default search text', () => {
  assert.deepEqual(catalogVariants({ extra: [{ name: 'search', isRequired: true }] }, { search: '70s thriller' }), [{ search: '70s thriller' }]);
});

test('roundRobinByType alternates types', () => {
  const items = [{ type: 'movie', id: 1 }, { type: 'movie', id: 2 }, { type: 'series', id: 3 }];
  assert.deepEqual(roundRobinByType(items, 2).map((i) => i.id), [1, 3]);
  assert.deepEqual(roundRobinByType(items, 5).map((i) => i.id), [1, 3, 2]);
});

test('the valid fixture passes, every resource exercised', async () => {
  const { ok, rows } = await run();
  assert.equal(ok, true, JSON.stringify(rows, null, 2));
  const e = endpoints(rows);
  for (const p of ['/manifest.json', '/catalog/movie/top.json', '/catalog/movie/top/search=test.json', '/addon_catalog/movie/friends.json', '/meta/movie/tt0063350.json', '/stream/movie/tt0063350.json', '/subtitles/movie/tt0063350.json']) {
    assert.ok(e.includes(p), `${p} in ${e}`);
  }
  const catalogRow = rows.find((r) => r.endpoint === '/catalog/movie/top.json');
  assert.equal(catalogRow.items, 1);
  assert.equal(typeof catalogRow.ms, 'number');
});

test('--samples limits the items tried per resource', async () => {
  const movies = ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004'].map((id) => ({ id, type: 'movie', name: id, poster: 'https://x/p.jpg' }));
  const mutate = (f) => {
    f.routes['catalog/movie/top'].body.metas = movies;
    for (const m of movies) f.routes[`meta/movie/${m.id}`] = { body: { meta: m } };
  };
  const { rows } = await run(mutate, { samples: 2 });
  assert.equal(rows.filter((r) => r.endpoint.startsWith('/meta/')).length, 2);
});

test('a failing endpoint fails the run with a reason', async () => {
  const { ok, rows } = await run((f) => (f.routes['stream/movie/tt0063350'] = { status: 500, body: {} }));
  assert.equal(ok, false);
  const row = rows.find((r) => r.endpoint === '/stream/movie/tt0063350.json');
  assert.equal(row.pass, false);
  assert.equal(row.note, 'HTTP 500');
});

test('a wrong response shape fails', async () => {
  const { ok, rows } = await run((f) => (f.routes['subtitles/movie/tt0063350'] = { body: { subs: [] } }));
  assert.equal(ok, false);
  assert.match(rows.find((r) => !r.pass).note, /missing "subtitles"/);
});

test('empty meta for an item of the add-on’s own catalog fails', async () => {
  const { ok } = await run((f) => (f.routes['meta/movie/tt0063350'] = { body: { meta: null } }));
  assert.equal(ok, false);
});

test('series streams use the episode id from meta', async () => {
  const { seen } = await run((f) => {
    f.routes['catalog/movie/top'].body.metas.push({ id: 'tt0108778', type: 'series', name: 'Friends', poster: 'https://x/f.jpg' });
  });
  assert.ok(seen.includes('/stream/series/tt0108778%3A1%3A1.json'), seen.join('\n'));
});

test('an unreachable manifest fails cleanly', async () => {
  const { ok, rows } = await smoke('http://127.0.0.1:9', { timeoutMs: 2000 });
  assert.equal(ok, false);
  assert.equal(rows.length, 1);
});

test('--config is sent and masked', async () => {
  const config = { lang: 'fr', apiKey: 'abcdef0123456789abcdef' };
  const { ok, rows, seen } = await run(undefined, { config });
  assert.equal(ok, true);
  assert.ok(seen.some((p) => p.startsWith(`/${encodeURIComponent(JSON.stringify(config))}/catalog/`)));
  assert.ok(rows.every((r) => !r.endpoint.includes('abcdef')));
  assert.ok(rows.some((r) => r.endpoint.startsWith('/<config>/')));
});

test('cli: table output, exit codes', async () => {
  const server = await serve(validFixture());
  try {
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [FORGE, 'smoke', server.url]);
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.on('close', (status) => resolve({ status, stdout }));
    });
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /Endpoint\s+Status\s+Latency\s+Items\s+Result/);
    assert.match(out.stdout, /PASS: \d+ request\(s\)/);
  } finally {
    await server.close();
  }
  const usage = await new Promise((resolve) => spawn(process.execPath, [FORGE, 'smoke', 'http://x', '--samples', '0']).on('close', resolve));
  assert.equal(usage, 2);
  const emptySearch = await new Promise((resolve) => spawn(process.execPath, [FORGE, 'smoke', 'http://x', '--search', ' ']).on('close', resolve));
  assert.equal(emptySearch, 2);
});
