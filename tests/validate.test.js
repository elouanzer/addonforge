'use strict';

// The validator against a valid fixture add-on and one broken fixture per rule.
// The last test fails if any rule in tools/lib/rules.js has no broken fixture.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validFixture, serve } = require('./fixtures/addon');
const { checkManifest } = require('../tools/lib/check-manifest');
const { checkLive } = require('../tools/lib/check-live');
const { RULES } = require('../tools/lib/rules');

const FORGE = path.join(__dirname, '..', 'tools', 'forge.js');
const caught = new Set();

/** @param {import('../tools/lib/rules').Issue[]} issues */
const rulesOf = (issues) => issues.map((i) => i.rule);

/**
 * Assert that `rule` is reported, and remember it for the coverage test.
 * @param {import('../tools/lib/rules').Issue[]} issues
 * @param {string} rule
 */
function expectRule(issues, rule) {
  assert.ok(rulesOf(issues).includes(rule), `expected [${rule}], got [${rulesOf(issues).join(', ')}]`);
  const found = issues.find((i) => i.rule === rule);
  assert.match(found.doc, /^https:\/\/|forge\.schema\.json$/, 'every issue links to its doc');
  caught.add(rule);
}

/**
 * Serve a fixture, run the live validator, close.
 * @param {(f: import('./fixtures/addon').Fixture) => void} [mutate]
 * @param {object} [options] checkLive options.
 */
async function live(mutate, options = {}) {
  const fixture = validFixture();
  if (mutate) mutate(fixture);
  const server = await serve(fixture);
  try {
    const result = await checkLive(options.urlFor ? options.urlFor(server) : server.url, options);
    return { ...result, seen: server.seen };
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------- baseline

test('the valid fixture passes with no errors and no warnings', async () => {
  const { issues, requests } = await live();
  assert.deepEqual(issues, []);
  const paths = requests.map((r) => r.path);
  for (const p of ['/manifest.json', '/catalog/movie/top.json', '/addon_catalog/movie/friends.json', '/meta/movie/tt0063350.json', '/meta/series/tt0108778.json', '/stream/movie/tt0063350.json', '/stream/series/tt0108778:1:1.json', '/subtitles/movie/tt0063350.json']) {
    assert.ok(paths.includes(p), `requested ${p}`);
  }
});

test('the generated template manifest passes static checks', () => {
  const r = spawnSync(process.execPath, [FORGE, 'validate', path.join(__dirname, '..', 'templates', 'node-sdk'), '--static'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---------------------------------------------------------- static rules

/** [rule, description, mutate(manifest)] */
const STATIC = [
  ['manifest-shape', 'missing name', (m) => delete m.name],
  ['manifest-shape', 'version not semver', (m) => (m.version = '1.0')],
  ['manifest-shape', 'id not dot-separated', (m) => (m.id = 'fixture')],
  ['manifest-shape', 'resource object without types', (m) => (m.resources = [{ name: 'stream' }])],
  ['manifest-shape', 'empty types', (m) => (m.types = [])],
  ['manifest-shape', 'catalog without name', (m) => delete m.catalogs[0].name],
  ['manifest-shape', 'extra without name', (m) => (m.catalogs[0].extra = [{ isRequired: true }])],
  ['manifest-shape', 'bad config type', (m) => (m.config[0].type = 'boolean')],
  ['manifest-shape', 'behaviorHints not boolean', (m) => (m.behaviorHints.configurable = 'yes')],
  ['manifest-shape', 'idPrefixes not an array', (m) => (m.idPrefixes = 'tt')],
  ['manifest-size', 'manifest over 8 KB', (m) => (m.description = 'x'.repeat(9000))],
  ['resource-unknown', 'unknown resource', (m) => m.resources.push('torrents')],
  ['catalog-resource-mismatch', '"catalog" declared, no catalogs', (m) => (m.catalogs = [])],
  ['catalog-resource-mismatch', 'catalogs without "catalog" resource', (m) => (m.resources = m.resources.filter((r) => r !== 'catalog'))],
  ['catalog-duplicate', 'same catalog twice', (m) => m.catalogs.push({ ...m.catalogs[0] })],
  ['catalog-type-undeclared', 'catalog type not in types', (m) => (m.catalogs[0].type = 'channel')],
  ['extra-duplicate', 'search declared twice', (m) => m.catalogs[0].extra.push({ name: 'search' })],
  ['extra-inconsistent', 'extraRequired not supported', (m) => (m.catalogs[0] = { type: 'movie', id: 'top', name: 'Top', extraSupported: ['search'], extraRequired: ['genre'] })],
  ['extra-inconsistent', 'isRequired disagrees with extraRequired', (m) => (m.catalogs[0].extraRequired = ['search'])],
  ['extra-inconsistent', 'required genre without options', (m) => (m.catalogs[0].extra = [{ name: 'genre', isRequired: true }])],
  ['extra-inconsistent', 'optionsLimit above options', (m) => (m.catalogs[0].extra = [{ name: 'genre', options: ['A'], optionsLimit: 3 }])],
  ['addon-catalogs-missing', 'addon_catalog without addonCatalogs', (m) => delete m.addonCatalogs],
  ['id-prefixes-missing', 'stream without idPrefixes', (m) => delete m.idPrefixes],
  ['custom-ids-without-meta', 'custom prefix, no meta', (m) => {
    m.idPrefixes = ['myaddon:'];
    m.resources = m.resources.filter((r) => r !== 'meta');
  }],
  ['config-duplicate-key', 'duplicate config key', (m) => m.config.push({ key: 'lang', type: 'text' })],
  ['config-select-options', 'select without options', (m) => delete m.config[0].options],
  ['config-not-configurable', 'config without configurable', (m) => delete m.behaviorHints],
  ['configuration-required-without-config', 'configurationRequired, no config', (m) => {
    delete m.config;
    m.behaviorHints = { configurationRequired: true };
  }],
  ['relative-image-url', 'relative logo', (m) => (m.logo = '/logo.png')],
  ['insecure-image', 'logo over http', (m) => (m.logo = 'http://example.com/logo.png')],
];

test('static: the valid manifest has no issues', () => {
  assert.deepEqual(checkManifest(validFixture().manifest), []);
});

for (const [rule, label, mutate] of STATIC) {
  test(`static [${rule}]: ${label}`, () => {
    const { manifest } = validFixture();
    mutate(manifest);
    expectRule(checkManifest(manifest), rule);
  });
}

test('static: a non-object manifest is a shape error', () => {
  expectRule(checkManifest([]), 'manifest-shape');
  expectRule(checkManifest('nope'), 'manifest-shape');
});

// ------------------------------------------------------------ live rules

/** [rule, description, mutate(fixture), checkLive options?] */
const LIVE = [
  ['manifest-unreachable', 'manifest 404', (f) => (f.routes.manifest = { status: 404, body: {} })],
  ['manifest-not-json', 'manifest is HTML', (f) => (f.routes.manifest = { raw: '<html></html>' })],
  ['content-type', 'served as text/plain', (f) => (f.headers['content-type'] = 'text/plain')],
  ['cors-missing', 'no CORS header', (f) => delete f.headers['access-control-allow-origin']],
  ['endpoint-failed', 'stream handler crashes', (f) => (f.routes['stream/movie/tt0063350'] = { status: 500, body: { err: 'handler error' } })],
  ['endpoint-failed', 'declared resource not served', (f) => delete f.routes['subtitles/movie/tt0063350']],
  ['endpoint-failed', 'catalog answers HTML', (f) => (f.routes['catalog/movie/top'] = { raw: 'oops' })],
  ['response-shape', 'catalog without metas', (f) => (f.routes['catalog/movie/top'] = { body: { items: [] } })],
  ['response-shape', 'meta preview without name', (f) => delete f.routes['catalog/movie/top'].body.metas[0].name],
  ['response-shape', 'meta without type', (f) => delete f.routes['meta/movie/tt0063350'].body.meta.type],
  ['response-shape', 'video without released', (f) => delete f.routes['meta/series/tt0108778'].body.meta.videos[0].released],
  ['response-shape', 'video without title or name', (f) => delete f.routes['meta/series/tt0108778'].body.meta.videos[0].title],
  ['response-shape', 'streams not an array', (f) => (f.routes['stream/movie/tt0063350'] = { body: { streams: {} } })],
  ['response-shape', 'subtitle without lang', (f) => (f.routes['subtitles/movie/tt0063350'].body.subtitles = [{ id: '1', url: 'https://x/s.srt' }])],
  ['response-shape', 'addon without transportUrl', (f) => delete f.routes['addon_catalog/movie/friends'].body.addons[0].transportUrl],
  ['poster-missing', 'meta preview without poster', (f) => delete f.routes['catalog/movie/top'].body.metas[0].poster],
  ['relative-image-url', 'relative poster', (f) => (f.routes['catalog/movie/top'].body.metas[0].poster = 'p.jpg')],
  ['insecure-image', 'poster over http', (f) => (f.routes['catalog/movie/top'].body.metas[0].poster = 'http://example.com/p.jpg')],
  ['meta-not-found', 'meta null for own catalog item', (f) => (f.routes['meta/movie/tt0063350'] = { body: { meta: null } })],
  ['stream-source', 'stream with two sources', (f) => (f.routes['stream/movie/tt0063350'].body.streams = [{ url: 'https://x/v.mp4', ytId: 'abc' }])],
  ['stream-source', 'stream with no source', (f) => (f.routes['stream/movie/tt0063350'].body.streams = [{ name: 'HD' }])],
  ['cache-headers', 'no Cache-Control', (f) => delete f.headers['cache-control']],
  ['slow-response', 'slow catalog', (f) => (f.routes['catalog/movie/top'].delayMs = 120), { slowMs: 50 }],
  ['insecure-url', 'http on localhost', () => {}, { urlFor: (s) => `http://localhost:${s.port}` }],
  ['not-configured', 'configurationRequired tested without --config', (f) => (f.manifest.behaviorHints.configurationRequired = true)],
  ['not-tested', 'required extra with no value to try', (f) => (f.manifest.catalogs[0].extra = [{ name: 'year', isRequired: true }])],
  ['not-tested', 'no id for a custom type', (f) => {
    f.manifest.types.push('channel');
  }],
];

for (const [rule, label, mutate, options] of LIVE) {
  test(`live [${rule}]: ${label}`, async () => {
    const { issues } = await live(mutate, options);
    expectRule(issues, rule);
  });
}

test('live: --config is sent in the path and masked in the report', async () => {
  const config = { lang: 'fr', token: 's3cret' };
  const { issues, requests, seen } = await live((f) => (f.manifest.behaviorHints.configurationRequired = true), { config });
  assert.deepEqual(issues, []);
  const encoded = `/${encodeURIComponent(JSON.stringify(config))}`;
  assert.ok(seen.includes(`${encoded}/catalog/movie/top.json`), 'config segment sent to the add-on');
  assert.ok(requests.some((r) => r.path === '/<config>/catalog/movie/top.json'));
  assert.ok(!JSON.stringify(requests).includes('s3cret'), 'secrets never appear in the report');
});

test('live: a video with name instead of title is accepted (as Cinemeta does)', async () => {
  const { issues } = await live((f) => {
    const v = f.routes['meta/series/tt0108778'].body.meta.videos[0];
    v.name = v.title;
    delete v.title;
  });
  assert.deepEqual(issues, []);
});

test('live: a required extra declared in both extra and extraRequired uses its options', async () => {
  const { issues, requests } = await live((f) => {
    f.manifest.catalogs[0].extra = [{ name: 'genre', isRequired: true, options: ['Horror'] }];
    f.manifest.catalogs[0].extraRequired = ['genre'];
    f.routes['catalog/movie/top'].body.metas.length = 1;
  });
  assert.ok(requests.some((r) => r.path === '/catalog/movie/top/genre=Horror.json'), JSON.stringify(requests.map((r) => r.path)));
  assert.ok(!issues.some((i) => i.rule === 'not-tested'), JSON.stringify(issues));
});

test('live: a required search uses the search option', async () => {
  const { requests } = await live(
    (f) => {
      f.manifest.catalogs[0].extra = [{ name: 'search', isRequired: true }];
      f.routes['catalog/movie/top'].body.metas.length = 1;
    },
    { search: '70s thriller' },
  );
  assert.ok(requests.some((r) => /^\/catalog\/movie\/top\/search=70s(%20| )thriller\.json$/.test(r.path)), JSON.stringify(requests.map((r) => r.path)));
});

test('live: manifestOnly fetches nothing but the manifest', async () => {
  const { requests } = await live(undefined, { manifestOnly: true });
  assert.deepEqual(requests.map((r) => r.path), ['/manifest.json']);
});

test('live: a server that is down is reported, not thrown', async () => {
  const { issues } = await live((f) => f, { urlFor: () => 'http://127.0.0.1:9/manifest.json', timeoutMs: 2000 });
  expectRule(issues, 'manifest-unreachable');
});

// ------------------------------------------------------- CLI and paths

/** @param {string[]} args */
const cli = (args) => spawnSync(process.execPath, [FORGE, 'validate', ...args], { encoding: 'utf8' });

/** A temp folder with the given files. */
function tempDir(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-validate-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('cli: folder with manifest.json, valid then broken', (t) => {
  const good = tempDir(t, { 'manifest.json': validFixture().manifest });
  assert.equal(cli([good, '--static']).status, 0);
  const { manifest } = validFixture();
  delete manifest.types;
  const bad = tempDir(t, { 'manifest.json': manifest });
  const r = cli([bad, '--static']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\[manifest-shape\] manifest\.types: is required/);
  assert.match(r.stdout, /https:\/\/github\.com\/Stremio\/stremio-addon-sdk/);
});

test('cli: invalid addon.forge.json is reported', (t) => {
  const dir = tempDir(t, {
    'manifest.json': validFixture().manifest,
    'addon.forge.json': { name: 'x', description: 'x', template: 'node-sdk', resources: ['stream'], types: ['movie'], idScheme: 'imdb' },
  });
  const r = cli([dir, '--static', '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.ok(out.errors.some((e) => e.rule === 'forge-config'));
  caught.add('forge-config');
});

test('cli: addon.forge.json alone generates the manifest to check', (t) => {
  const dir = tempDir(t, {
    'addon.forge.json': { name: 'only-forge', description: 'x', template: 'node-sdk', resources: ['catalog'], types: ['movie'], idScheme: 'imdb' },
  });
  const r = cli([dir, '--json']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(JSON.parse(r.stdout).source, /addon\.forge\.json \(generated\)/);
});

test('cli: src/manifest.js that throws is a usage error, not a crash', (t) => {
  const dir = tempDir(t, { 'src/manifest.js': "throw new Error('broken on purpose')" });
  const r = cli([dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /broken on purpose/);
});

test('cli: usage errors exit 2', () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['/does/not/exist']).status, 2);
  assert.equal(cli(['ftp://example.com']).status, 2, 'ftp is treated as a missing path');
  assert.equal(cli(['http://127.0.0.1:1', '--config', '{bad']).status, 2);
  assert.equal(cli(['http://127.0.0.1:1', '--config', '[1]']).status, 2);
  assert.equal(cli(['http://127.0.0.1:1', '--search', '']).status, 2);
});

test('cli: live URL, --json output', async () => {
  const server = await serve(validFixture());
  try {
    const r = await new Promise((resolve) => {
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, [FORGE, 'validate', `${server.url}/manifest.json`, '--json']);
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.on('close', (status) => resolve({ status, stdout }));
    });
    assert.equal(r.status, 0, r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.mode, 'live');
    assert.ok(out.requests.length >= 8);
  } finally {
    await server.close();
  }
});

// -------------------------------------------------------------- coverage

test('every rule has at least one broken fixture', () => {
  const missing = Object.keys(RULES).filter((r) => !caught.has(r));
  assert.deepEqual(missing, [], `rules without a fixture: ${missing.join(', ')}`);
});
