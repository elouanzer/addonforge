'use strict';

// Guards for the repository's own invariants (docs/SPEC.md §3, §9, §12).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('required top-level files exist', () => {
  for (const file of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'LICENSE', 'docs/SPEC.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
  }
});

test('.gitignore keeps user add-ons and secrets out of git', () => {
  const lines = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('addons/*'), 'addons/* must be ignored');
  assert.ok(lines.includes('.env'), '.env must be ignored');
  assert.ok(lines.includes('!.env.example'), '.env.example must stay tracked');
});

test('CLAUDE.md and GEMINI.md defer to AGENTS.md', () => {
  for (const file of ['CLAUDE.md', 'GEMINI.md']) {
    assert.match(read(file), /AGENTS\.md/, `${file} must point to AGENTS.md`);
  }
});

test('README states the content policy and independence from Stremio', () => {
  const readme = read('README.md');
  assert.match(readme, /content policy/i);
  assert.match(readme, /independent community project/i);
});

// ------------------------------------------------------------- examples (SPEC §7, §9)

const { validateForgeConfig } = require('../tools/lib/forge-config');
const { findSecrets } = require('../tools/lib/secrets');

const EXAMPLES = path.join(ROOT, 'examples');
const exampleNames = fs
  .readdirSync(EXAMPLES)
  .filter((n) => !n.startsWith('.') && fs.statSync(path.join(EXAMPLES, n)).isDirectory());

/** Every file of an example, except dependencies (fallback when git is unavailable). */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * The files of an example that git would commit: tracked, or untracked and not ignored.
 * A contributor's own .env or Letterboxd export is gitignored, so it is not checked.
 * @param {string} dir
 */
function exampleFiles(dir) {
  const res = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', dir], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) return walk(dir);
  return res.stdout
    .split('\0')
    .filter(Boolean)
    .map((f) => path.join(ROOT, f))
    .filter((f) => fs.existsSync(f));
}

test('the v1 examples exist', () => {
  for (const name of ['hello-catalog', 'letterboxd-nl-search']) assert.ok(exampleNames.includes(name), `examples/${name} is missing`);
});

for (const name of exampleNames) {
  const dir = path.join(EXAMPLES, name);

  test(`examples/${name}: required files, valid addon.forge.json, .env never committed`, () => {
    for (const file of ['addon.forge.json', 'README.md', '.env.example', 'package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml', 'screenshot.png']) {
      assert.ok(fs.existsSync(path.join(dir, file)), `${file} is missing`);
    }
    // A local .env is how the example is configured; it must just stay out of git.
    assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split(/\r?\n/).includes('.env'), `.env must be in examples/${name}/.gitignore`);
    assert.ok(!exampleFiles(dir).some((f) => path.basename(f) === '.env'), 'a real .env must never be committed in examples/');
    const forge = JSON.parse(fs.readFileSync(path.join(dir, 'addon.forge.json'), 'utf8'));
    delete forge.$schema;
    assert.deepEqual(validateForgeConfig(forge), []);
    assert.equal(forge.name, name, 'folder name matches addon.forge.json name');
  });

  test(`examples/${name}: nothing that looks like an API key`, () => {
    const hits = exampleFiles(dir)
      .filter((f) => path.basename(f) !== 'package-lock.json' && !/\.(png|jpe?g|gif|webp)$/i.test(f))
      .flatMap((f) => findSecrets(fs.readFileSync(f, 'utf8')).map((h) => `${path.relative(ROOT, f)}:${h.line} (${h.name})`));
    assert.deepEqual(hits, []);
  });

  test(`examples/${name}: is validated and smoke-tested in CI`, () => {
    assert.match(read('.github/workflows/ci.yml'), new RegExp(`example:\\s*\\[[^\\]]*\\b${name}\\b`), `add ${name} to the examples matrix in ci.yml`);
  });
}

test('the secret detector catches typical keys and ignores ordinary text', () => {
  // Built from pieces so that secret scanners (GitHub's included) don't flag this file.
  const fakes = [
    `OPENAI_API_KEY=${'sk-'}abcdefghijklmnopqrstuvwx1234`,
    `const key = "${'AI' + 'za'}SyA1234567890abcdefghijklmnopqrstuv";`,
    `token: ${'gh' + 'p_'}abcdefghijklmnopqrstuvwxyz0123456789`,
    'apiKey = "a1b2c3d4e5f6a7b8c9d0e1f2"',
    `-----BEGIN RSA ${'PRIVATE'} KEY-----`,
  ];
  for (const f of fakes) assert.ok(findSecrets(f).length, f);
  for (const ok of ['API_KEY=', '# Put your API key in .env', 'password: process.env.PASSWORD', 'token = getToken(userConfig)']) {
    assert.deepEqual(findSecrets(ok), [], ok);
  }
});
