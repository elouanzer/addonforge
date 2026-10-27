'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validFixture, serve } = require('./fixtures/addon');
const { installLinks, deepLink } = require('../tools/install-link');

const FORGE = path.join(__dirname, '..', 'tools', 'forge.js');

test('deep link replaces http(s):// with stremio://', () => {
  assert.equal(deepLink('https://a.example/manifest.json'), 'stremio://a.example/manifest.json');
  assert.equal(deepLink('http://127.0.0.1:7100/manifest.json'), 'stremio://127.0.0.1:7100/manifest.json');
});

test('local URL: manifest URL normalised, local note, no QR', async () => {
  const links = await installLinks('http://127.0.0.1:7100/', { check: false });
  assert.equal(links.manifestUrl, 'http://127.0.0.1:7100/manifest.json');
  assert.equal(links.local, true);
  assert.ok(links.notes.some((n) => /only works on this computer/.test(n)));
});

test('plain HTTP on a non-local host gets an HTTPS warning', async () => {
  const links = await installLinks('http://192.168.1.20:7100', { check: false });
  assert.ok(links.notes.some((n) => /only installs HTTPS/.test(n)));
});

test('--config is encoded into the path, with a sharing warning', async () => {
  const links = await installLinks('https://a.example', { config: { user: 'me' }, check: false });
  assert.equal(links.manifestUrl, `https://a.example/${encodeURIComponent('{"user":"me"}')}/manifest.json`);
  assert.equal(links.deepLink, `stremio://a.example/${encodeURIComponent('{"user":"me"}')}/manifest.json`);
  assert.ok(links.notes.some((n) => /contains your configuration/.test(n)));
});

test('points to /configure when the add-on needs configuration', async () => {
  const fixture = validFixture();
  fixture.manifest.behaviorHints.configurationRequired = true;
  const server = await serve(fixture);
  try {
    const links = await installLinks(server.url);
    assert.equal(links.configureUrl, `${server.url}/configure`);
    assert.ok(links.notes.some((n) => /needs configuration/.test(n)));
  } finally {
    await server.close();
  }
});

test('warns when the add-on is not running', async () => {
  const links = await installLinks('http://127.0.0.1:9', { timeoutMs: 2000 });
  assert.ok(links.notes.some((n) => /not answering/.test(n)));
});

test('cli: QR code only for non-local URLs; --json; usage errors', () => {
  const local = spawnSync(process.execPath, [FORGE, 'install-link', 'http://127.0.0.1:9'], { encoding: 'utf8' });
  assert.equal(local.status, 0);
  assert.doesNotMatch(local.stdout, /Scan with a phone/);

  const remote = spawnSync(process.execPath, [FORGE, 'install-link', 'https://203.0.113.1', '--json'], { encoding: 'utf8', timeout: 30000 });
  const out = JSON.parse(remote.stdout);
  assert.equal(out.deepLink, 'stremio://203.0.113.1/manifest.json');

  assert.equal(spawnSync(process.execPath, [FORGE, 'install-link'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [FORGE, 'install-link', 'not a url'], { encoding: 'utf8' }).status, 2);
});
