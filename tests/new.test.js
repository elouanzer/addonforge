'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../tools/new');
const { validateForgeConfig, manifestFromForge } = require('../tools/lib/forge-config');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'node-sdk');

/** A throwaway repo root containing the real node-sdk template (without node_modules). */
function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-new-'));
  fs.cpSync(TEMPLATE, path.join(root, 'templates', 'node-sdk'), {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('node_modules'),
  });
  fs.mkdirSync(path.join(root, 'addons'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Run `new` with output silenced. */
async function forgeNew(root, args) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await run(args, { rootDir: root });
  } finally {
    Object.assign(console, { log, error });
  }
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

/** A config different from the defaults, to see it flow into every file. */
const custom = () => ({
  name: 'french-subs',
  displayName: 'French Subtitles',
  description: 'French subtitles from my own folder',
  template: 'node-sdk',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idScheme: 'imdb',
  sources: [{ name: 'open subs', needsKey: true }],
  userConfig: [{ key: 'folder', type: 'text', required: true, title: 'Subtitle folder' }],
  hosting: 'lan',
  port: 7123,
});

test('new <name> with defaults creates a complete add-on', async (t) => {
  const root = makeRoot(t);
  assert.equal(await forgeNew(root, ['demo']), 0);
  const dir = path.join(root, 'addons', 'demo');

  for (const file of ['src/addon.js', 'src/server.js', 'src/manifest.js', 'src/sources/index.js', 'src/sources/example.js', 'test/addon.test.js', 'Dockerfile', 'docker-compose.yml', '.env.example', '.dockerignore', 'package-lock.json']) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} is missing`);
  }
  const forge = readJson(dir, 'addon.forge.json');
  delete forge.$schema;
  assert.deepEqual(validateForgeConfig(forge), []);
  assert.equal(readJson(dir, 'package.json').name, 'demo');
  assert.equal(readJson(dir, 'package-lock.json').packages[''].name, 'demo');
  assert.doesNotMatch(read(dir, 'README.md'), /\{\{\w+\}\}/, 'README placeholders are all filled');

  const manifest = require(path.join(dir, 'src', 'manifest.js'));
  assert.deepEqual(manifest, { ...manifestFromForge(forge), version: '0.1.0' });
});

test('uses addons/<name>/addon.forge.json written by the interview', async (t) => {
  const root = makeRoot(t);
  const dir = path.join(root, 'addons', 'french-subs');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'addon.forge.json'), JSON.stringify(custom()));

  assert.equal(await forgeNew(root, ['french-subs']), 0);

  const manifest = require(path.join(dir, 'src', 'manifest.js'));
  assert.equal(manifest.name, 'French Subtitles');
  assert.deepEqual(manifest.resources, ['subtitles']);
  assert.deepEqual(manifest.catalogs, []);
  assert.equal(manifest.behaviorHints.configurationRequired, true);
  assert.match(read(dir, '.env.example'), /^HOST_PORT=7123$/m);
  assert.match(read(dir, '.env.example'), /^OPEN_SUBS_API_KEY=$/m);
  assert.match(read(dir, 'docker-compose.yml'), /127\.0\.0\.1:\$\{HOST_PORT:-7123\}:7123/);
  assert.match(read(dir, 'docker-compose.yml'), /--url http:\/\/addon:7123/);
  assert.match(read(dir, 'Dockerfile'), /^ENV PORT=7123$/m);
  assert.match(read(dir, 'src', 'server.js'), /\|\| 7123;/);
  assert.match(read(dir, 'README.md'), /`folder` \(text, required\): Subtitle folder/);
});

test('--from a file, name taken from it', async (t) => {
  const root = makeRoot(t);
  const file = path.join(root, 'answers.json');
  fs.writeFileSync(file, JSON.stringify(custom()));
  assert.equal(await forgeNew(root, ['--from', file]), 0);
  assert.ok(fs.existsSync(path.join(root, 'addons', 'french-subs', 'src', 'addon.js')));
});

test('name and --from must agree', async (t) => {
  const root = makeRoot(t);
  const file = path.join(root, 'answers.json');
  fs.writeFileSync(file, JSON.stringify(custom()));
  assert.equal(await forgeNew(root, ['other-name', '--from', file]), 2);
});

test('invalid names are usage errors', async (t) => {
  const root = makeRoot(t);
  for (const bad of ['My Addon', '../escape', 'UPPER']) {
    assert.equal(await forgeNew(root, [bad]), 2, bad);
  }
  assert.equal(await forgeNew(root, []), 2, 'missing name');
  assert.deepEqual(fs.readdirSync(path.join(root, 'addons')), []);
});

test('an invalid config is a validation failure', async (t) => {
  const root = makeRoot(t);
  const file = path.join(root, 'answers.json');
  fs.writeFileSync(file, JSON.stringify({ ...custom(), resources: ['stream'] }));
  assert.equal(await forgeNew(root, ['--from', file]), 1, 'stream without content-policy acknowledgement');
});

test('unknown template is a usage error', async (t) => {
  const root = makeRoot(t);
  assert.equal(await forgeNew(root, ['demo', '--template', 'python']), 2);
  assert.equal(await forgeNew(root, ['demo', '--template', 'node-sdk']), 0);
});

test('refuses to overwrite without --force, keeps .env with it', async (t) => {
  const root = makeRoot(t);
  const dir = path.join(root, 'addons', 'demo');
  assert.equal(await forgeNew(root, ['demo']), 0);
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');

  assert.equal(await forgeNew(root, ['demo']), 2);
  assert.equal(await forgeNew(root, ['demo', '--force']), 0);
  assert.equal(read(dir, '.env'), 'SECRET=1\n');
});

test('next steps: run with --wait, then validate and smoke; a real query for search-only catalogs', async (t) => {
  const root = makeRoot(t);
  const { log } = console;
  let out = '';
  console.log = (...a) => (out += `${a.join(' ')}\n`);
  try {
    assert.equal(await run(['plain', '--json'], { rootDir: root }), 0);
    const plain = JSON.parse(out).nextSteps;
    assert.ok(plain.includes('docker compose up -d --build --wait'));
    assert.ok(plain.includes('node ../../tools/forge.js smoke http://127.0.0.1:7100'));

    const dir = path.join(root, 'addons', 'finder');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'addon.forge.json'), JSON.stringify({ ...custom(), name: 'finder', resources: ['catalog'], types: ['movie'], catalogFeatures: ['searchOnly'], userConfig: [] }));
    out = '';
    assert.equal(await run(['finder', '--json'], { rootDir: root }), 0);
    assert.match(JSON.parse(out).nextSteps.join('\n'), /smoke http:\/\/127\.0\.0\.1:7123 --search "/);
  } finally {
    console.log = log;
  }
});
