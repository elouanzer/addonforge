'use strict';

// Search backends and the pipeline. Fake providers and a mocked fetch stand in for
// the LLMs and Cinemeta: no key and no network needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { keywordSearch, parseQuery } = require('../src/search/keyword');
const { llmSearch, buildPrompt, FILM_LIST_SCHEMA } = require('../src/search/llm');
const { createAnthropicProvider } = require('../src/search/anthropic');
const { createOpenAiProvider } = require('../src/search/openai');
const { createSearch } = require('../src/search');
const { loadConfig } = require('../src/config');
const cinemeta = require('../src/sources/cinemeta');
const letterboxd = require('../src/sources/letterboxd');

const EXPORT_DIR = path.join(__dirname, 'fixtures', 'export');
const names = (films) => films.map((f) => f.name);

/** Cinemeta search answers: every title resolves to itself with a made-up id. */
function fakeCinemeta(t) {
  cinemeta.clearCache();
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const title = decodeURIComponent(String(url).match(/search=(.*)\.json$/)[1]);
    const id = `tt${[...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9999991, 7)}`;
    return { ok: true, status: 200, json: async () => ({ metas: title === 'Made Up Film' ? [] : [{ id, name: title, releaseInfo: '1974' }] }) };
  });
}

/** A provider returning fixed titles, recording what it was asked. */
function fakeProvider(films) {
  const calls = [];
  return { calls, provider: { name: 'fake', suggest: async (request) => (calls.push(request), { films }) } };
}

test('parseQuery: decade, genre, two-word tag and setting', () => {
  assert.deepEqual(parseQuery('slow-burn 70s thrillers set in Paris'), { genres: ['Thriller'], countries: [], terms: ['slow burn', 'pari'], from: 1970, to: 1979 });
  assert.deepEqual(parseQuery("1990s"), { genres: [], countries: [], terms: [], from: 1990, to: 1999 });
  assert.deepEqual(parseQuery("sixties"), { genres: [], countries: [], terms: [], from: 1960, to: 1969 });
  assert.deepEqual(parseQuery('noir before 1950'), { genres: ['Film-Noir'], countries: [], terms: [], to: 1949 });
  assert.deepEqual(parseQuery('Japanese science fiction'), { genres: ['Sci-Fi'], countries: ['Japan'], terms: ['japan'] });
});

test('keywordSearch: the README example finds 70s Paris thrillers', () => {
  const found = keywordSearch('slow-burn 70s thrillers set in Paris', { limit: 3 });
  assert.deepEqual(names(found), ['The Day of the Jackal', 'The Red Circle', 'The Tenant']);
  for (const f of keywordSearch('slow-burn 70s thrillers set in Paris')) assert.ok(f.year >= 1970 && f.year <= 1979);
});

test('keywordSearch: directors, original titles, decades only, and no match', () => {
  assert.ok(names(keywordSearch('Hitchcock')).includes('Vertigo'));
  assert.equal(keywordSearch('le cercle rouge')[0].name, 'The Red Circle');
  assert.equal(keywordSearch('80s films', { limit: 50 }).every((f) => f.year >= 1980 && f.year <= 1989), true);
  assert.deepEqual(keywordSearch('test'), []);
  assert.equal(keywordSearch('heist', { limit: 2 }).length, 2);
});

test('buildPrompt: the query, a count, and taste hints only when given', () => {
  assert.equal(buildPrompt('heists', { count: 5 }), 'Search: heists\n\nList up to 5 films.');
  const withHints = buildPrompt('heists', { count: 5, favourites: ['Chinatown (1974)'] });
  assert.match(withHints, /rated highly on Letterboxd/);
  assert.match(withHints, /- Chinatown \(1974\)/);
});

test('llmSearch: resolves titles, drops unknown ones and duplicates, keeps order', async (t) => {
  fakeCinemeta(t);
  const { provider, calls } = fakeProvider([
    { title: 'Chinatown', year: 1974 },
    { title: 'Made Up Film', year: 1974 },
    { title: 'chinatown', year: 1974 },
    { title: 'The Conversation', year: 1974 },
  ]);
  const films = await llmSearch('70s paranoia', { provider, count: 10 });
  assert.deepEqual(names(films), ['Chinatown', 'The Conversation']);
  assert.match(films[0].id, /^tt\d+$/);
  assert.deepEqual(calls[0].schema, FILM_LIST_SCHEMA);
  assert.match(calls[0].prompt, /^Search: 70s paranoia/);
});

test('anthropic provider: structured-output request, refusal and parsing', async () => {
  const requests = [];
  let reply = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"films":[{"title":"Heat","year":1995}]}' }] };
  const client = { messages: { create: async (body) => (requests.push(body), reply) } };
  const provider = createAnthropicProvider({ apiKey: 'unused', model: 'claude-haiku-5-5', timeoutMs: 1000, client });

  assert.deepEqual(await provider.suggest({ system: 'S', prompt: 'P', schema: FILM_LIST_SCHEMA }), { films: [{ title: 'Heat', year: 1995 }] });
  assert.equal(requests[0].model, 'claude-haiku-5-5');
  assert.equal(requests[0].system, 'S');
  assert.deepEqual(requests[0].messages, [{ role: 'user', content: 'P' }]);
  assert.deepEqual(requests[0].output_config, { effort: 'low', format: { type: 'json_schema', schema: FILM_LIST_SCHEMA } });

  reply = { stop_reason: 'refusal', content: [] };
  await assert.rejects(provider.suggest({ system: 'S', prompt: 'P', schema: FILM_LIST_SCHEMA }), /declined/);
});

test('openai-compatible provider: request shape, key only when set, errors', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"films":[]}' } }] }),
  }));
  const ollama = createOpenAiProvider({ name: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', timeoutMs: 1000 });
  assert.deepEqual(await ollama.suggest({ system: 'S', prompt: 'P', schema: FILM_LIST_SCHEMA }), { films: [] });
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(init.headers.authorization, undefined);
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'llama3.2');
  assert.deepEqual(body.response_format.json_schema.schema, FILM_LIST_SCHEMA);

  const openai = createOpenAiProvider({ name: 'openai', baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k', timeoutMs: 1000 });
  await openai.suggest({ system: 'S', prompt: 'P', schema: FILM_LIST_SCHEMA });
  assert.equal(fetchMock.mock.calls[1].arguments[1].headers.authorization, 'Bearer k');

  fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 401, text: async () => 'bad key' }));
  await assert.rejects(openai.suggest({ system: 'S', prompt: 'P', schema: FILM_LIST_SCHEMA }), /HTTP 401: bad key/);
});

test('pipeline, keyword mode: meta previews, watched films hidden', async (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  const base = loadConfig({ LETTERBOXD_DIR: EXPORT_DIR, MAX_RESULTS: '3' });
  const results = await createSearch(base)('slow-burn 70s thrillers set in Paris');
  assert.equal(results.length, 3);
  assert.ok(!names(results).includes('The Day of the Jackal'), 'watched');
  assert.ok(!names(results).includes('The Red Circle'), 'watched as "Le Cercle Rouge"');
  for (const m of results) {
    assert.equal(m.type, 'movie');
    assert.match(m.id, /^tt\d+$/);
    assert.equal(m.poster, `https://images.metahub.space/poster/small/${m.id}/img`);
  }

  letterboxd.clearCache();
  const shown = await createSearch({ ...base, hideWatched: false })('slow-burn 70s thrillers set in Paris');
  assert.equal(shown[0].name, 'The Day of the Jackal');
});

test('pipeline, LLM mode: taste hints, hidden watched films, cache', async (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  fakeCinemeta(t);
  const { provider, calls } = fakeProvider([
    { title: 'Chinatown', year: 1974 },
    { title: 'Klute', year: 1971 },
  ]);
  const config = { ...loadConfig({ LETTERBOXD_DIR: EXPORT_DIR }), provider: 'anthropic' };
  const search = createSearch(config, { provider });

  const results = await search('70s paranoia');
  assert.deepEqual(names(results), ['Klute'], 'Chinatown is rated, so watched');
  assert.match(calls[0].prompt, /Chinatown \(1974\)/, 'favourites sent as hints');
  const asked = calls.length;
  await search('  70S   Paranoia ');
  assert.equal(calls.length, asked, 'same search served from cache');

  letterboxd.clearCache();
  t.mock.method(console, 'warn', () => {});
  const noHints = fakeProvider([]);
  await createSearch({ ...config, tasteHints: false }, { provider: noHints.provider })('heists');
  assert.doesNotMatch(noHints.calls[0].prompt, /Letterboxd/);
});

test('llmSearch: a year repeated in the title is removed before the lookup', async (t) => {
  const fetchMock = fakeCinemeta(t);
  const { provider } = fakeProvider([{ title: 'A Fistful of Dollars (1964)', year: 1964 }]);
  await llmSearch('westerns', { provider, count: 5 });
  assert.match(String(fetchMock.mock.calls[0].arguments[0]), /search=A%20Fistful%20of%20Dollars\.json$/);
});

test('llmSearch: a reply that stops after a film or two is asked again', async (t) => {
  fakeCinemeta(t);
  const replies = [[{ title: 'Heat', year: 1974 }], [1, 2, 3, 4, 5, 6].map((i) => ({ title: `Film ${i}`, year: 1974 }))];
  const provider = { name: 'fake', suggest: async () => ({ films: replies.shift() }) };
  assert.equal((await llmSearch('heists', { provider, count: 20 })).length, 6);
  const once = fakeProvider([{ title: 'Heat', year: 1995 }]);
  await llmSearch('heat', { provider: once.provider, count: 1 });
  assert.equal(once.calls.length, 1, 'one film asked for, one received');
});

test('pipeline, keyword mode: the era, genres and countries asked for are enforced', async (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  const search = createSearch(loadConfig({ LETTERBOXD_DIR: EXPORT_DIR }));
  const korean = await search('korean thriller post 2000');
  assert.ok(korean.length > 0);
  for (const m of korean) assert.ok(Number(m.releaseInfo) >= 2000, `${m.name} ${m.releaseInfo}`);
  assert.ok(names(korean).every((n) => ['Oldboy', 'Parasite', 'Memories of Murder', 'The Handmaiden', 'Train to Busan'].includes(n)), names(korean).join(', '));
});

test('pipeline: a watched film is hidden even when the model gets its year wrong', async (t) => {
  t.mock.method(console, 'log', () => {});
  letterboxd.clearCache();
  fakeCinemeta(t); // every title resolves with year 1974
  const { provider } = fakeProvider([{ title: 'Chinatown', year: 1980 }, { title: 'Klute', year: 1971 }]);
  const search = createSearch({ ...loadConfig({ LETTERBOXD_DIR: EXPORT_DIR }), provider: 'ollama' }, { provider });
  assert.deepEqual(names(await search('paranoia')), ['Klute'], 'Chinatown (1974 on Cinemeta) is rated');
});

test('pipeline: an empty LLM answer falls back to keyword search, uncached', async (t) => {
  t.mock.method(console, 'log', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  letterboxd.clearCache();
  fakeCinemeta(t);
  const { provider, calls } = fakeProvider([]);
  const search = createSearch({ ...loadConfig({ LETTERBOXD_DIR: path.join(EXPORT_DIR, 'none') }), provider: 'ollama' }, { provider });
  assert.ok(names(await search('Hitchcock')).includes('Vertigo'));
  assert.match(warn.mock.calls[0].arguments[0], /no film found on Cinemeta\); falling back/);
  const asked = calls.length; // 2: an empty reply is retried once
  await search('Hitchcock');
  assert.equal(calls.length, asked * 2, 'not cached: asked again');
});

test('pipeline: a failing LLM falls back to keyword search', async (t) => {
  t.mock.method(console, 'log', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  letterboxd.clearCache();
  const provider = { name: 'fake', suggest: async () => { throw new Error('HTTP 529'); } };
  const search = createSearch({ ...loadConfig({ LETTERBOXD_DIR: path.join(EXPORT_DIR, 'none') }), provider: 'anthropic' }, { provider });
  const results = await search('Hitchcock');
  assert.ok(names(results).includes('Vertigo'));
  assert.match(warn.mock.calls[0].arguments[0], /fake search failed \(HTTP 529\); falling back to keyword search/);

  await search('Hitchcock');
  assert.equal(warn.mock.callCount(), 2, 'a fallback answer is not cached: the LLM is asked again');
});
