'use strict';

// `expose` with a fake tunnel binary: the fixture add-on serves both as the local
// add-on and as the "public" side of the tunnel.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validFixture, serve } = require('./fixtures/addon');
const { run, TUNNELS } = require('../tools/expose');

const FAKE = path.join(__dirname, 'fixtures', 'fake-tunnel.js');

/**
 * A tunnel definition running the fake binary.
 * @param {string} mode
 * @param {string} url
 * @param {object} [extra]
 */
function fakeTunnel(mode, url, extra = {}) {
  return {
    id: 'fake',
    name: 'Fake tunnel',
    detect: [process.execPath, ['--version']],
    command: () => [process.execPath, [FAKE, mode, url]],
    url: /http:\/\/127\.0\.0\.1:\d+/,
    install: 'install the fake tunnel',
    ...extra,
  };
}

const missing = { ...fakeTunnel('ok', ''), id: 'missing', name: 'Missing tool', detect: ['addonforge-no-such-binary', []], install: 'get it from example.com' };

/** Run expose with console output captured. */
async function expose(args, options) {
  const { log, error } = console;
  let out = '';
  console.log = (...a) => (out += `${a.join(' ')}\n`);
  console.error = (...a) => (out += `${a.join(' ')}\n`);
  try {
    const code = await run(args, { urlTimeoutMs: 3000, reachTimeoutMs: 3000, ...options });
    return { code, out };
  } finally {
    Object.assign(console, { log, error });
  }
}

/** Serve a fixture for the duration of a test. */
async function fixtureServer(t, mutate) {
  const fixture = validFixture();
  if (mutate) mutate(fixture);
  const server = await serve(fixture);
  t.after(() => server.close());
  return server;
}

test('the real tunnel list: docker only on request, tools in order of preference', () => {
  assert.deepEqual(TUNNELS.map((t) => t.id), ['cloudflared', 'tailscale', 'localtunnel', 'docker']);
  assert.equal(TUNNELS.find((t) => t.id === 'docker').explicitOnly, true);
  for (const t of TUNNELS) assert.ok(t.install, `${t.id} has install instructions`);
  assert.ok('https://abc-def-123.trycloudflare.com'.match(TUNNELS[0].url));
  assert.ok('Available on the internet:\nhttps://box.tail1234.ts.net/'.match(TUNNELS[1].url));
  assert.ok('your url is: https://silly-cat-42.loca.lt'.match(TUNNELS[2].url));
});

test('usage errors', async () => {
  for (const args of [[], ['abc'], ['70000'], ['7100', 'extra'], ['7100', '--config', '{bad']]) {
    assert.equal((await expose(args, { tunnels: [] })).code, 2, args.join(' '));
  }
});

test('refuses when no add-on answers on the port', async () => {
  const { code, out } = await expose(['9'], { tunnels: [] });
  assert.equal(code, 2);
  assert.match(out, /no add-on answers at http:\/\/127\.0\.0\.1:9/);
});

test('no tunnel tool: lists the options and installs nothing', async (t) => {
  const server = await fixtureServer(t);
  const { code, out } = await expose([String(server.port)], { tunnels: [missing] });
  assert.equal(code, 2);
  assert.match(out, /no tunnel tool found/);
  assert.match(out, /get it from example\.com/);
  assert.match(out, /"tunnel" profile/);
});

test('explicit-only tools are not picked automatically', async (t) => {
  const server = await fixtureServer(t);
  const { code } = await expose([String(server.port), '--once'], { tunnels: [fakeTunnel('ok', server.url, { explicitOnly: true })] });
  assert.equal(code, 2);
  const chosen = await expose([String(server.port), '--once', '--tool', 'fake'], { tunnels: [fakeTunnel('ok', server.url, { explicitOnly: true })] });
  assert.equal(chosen.code, 0, chosen.out);
});

test('--tool must exist and be installed', async (t) => {
  const server = await fixtureServer(t);
  assert.equal((await expose([String(server.port), '--tool', 'nope'], { tunnels: [missing] })).code, 2);
  const { code, out } = await expose([String(server.port), '--tool', 'missing'], { tunnels: [missing] });
  assert.equal(code, 2);
  assert.match(out, /Missing tool is not available/);
});

test('--once: URL, warning, validate, smoke and install link through the tunnel', async (t) => {
  const server = await fixtureServer(t);
  const { code, out } = await expose([String(server.port), '--once'], { tunnels: [fakeTunnel('ok', server.url)] });
  assert.equal(code, 0, out);
  assert.match(out, new RegExp(`Public URL: ${server.url}`));
  assert.match(out, /anyone with the tunnel URL/);
  assert.match(out, /Validating .* \(live\)/);
  assert.match(out, /Smoke test:/);
  assert.match(out, /Deep link:\s+stremio:\/\/127\.0\.0\.1/);
});

test('--json reports the checks and the links', async (t) => {
  const server = await fixtureServer(t);
  const { code, out } = await expose([String(server.port), '--once', '--json'], { tunnels: [fakeTunnel('ok', server.url)] });
  assert.equal(code, 0);
  const result = JSON.parse(out);
  assert.equal(result.ok, true);
  assert.equal(result.url, server.url);
  assert.equal(result.validate.ok, true);
  assert.equal(result.smoke.ok, true);
  assert.equal(result.install.deepLink, `${server.url.replace('http://', 'stremio://')}/manifest.json`);
});

test('an add-on failing validation through the tunnel exits 1', async (t) => {
  const server = await fixtureServer(t, (f) => delete f.headers['access-control-allow-origin']);
  const { code, out } = await expose([String(server.port), '--once'], { tunnels: [fakeTunnel('ok', server.url)] });
  assert.equal(code, 1);
  assert.match(out, /cors-missing/);
});

test('a tunnel that crashes is reported with its output', async (t) => {
  const server = await fixtureServer(t);
  const { code, out } = await expose([String(server.port)], { tunnels: [fakeTunnel('crash', server.url)] });
  assert.equal(code, 2);
  assert.match(out, /exited \(code 1\) before giving a URL/);
  assert.match(out, /failed to connect to the edge/);
});

test('a tunnel that never prints a URL times out', async (t) => {
  const server = await fixtureServer(t);
  const { code, out } = await expose([String(server.port)], { tunnels: [fakeTunnel('silent', server.url)], urlTimeoutMs: 800 });
  assert.equal(code, 2);
  assert.match(out, /gave no public URL/);
});

test('a URL that never answers fails', async (t) => {
  const server = await fixtureServer(t);
  const { code, out } = await expose([String(server.port)], { tunnels: [fakeTunnel('ok', 'http://127.0.0.1:9')], reachTimeoutMs: 500 });
  assert.equal(code, 1);
  assert.match(out, /not answering/);
});

test('without --once it stays up until the tunnel stops', async (t) => {
  const server = await fixtureServer(t);
  const started = Date.now();
  const { code, out } = await expose([String(server.port)], { tunnels: [fakeTunnel('ok-exit', server.url)] });
  assert.equal(code, 0, out);
  assert.match(out, /press Ctrl\+C to stop/);
  assert.match(out, /Fake tunnel stopped/);
  assert.ok(Date.now() - started >= 1000, 'waited for the tunnel');
});
