'use strict';

// Guards for the repository's own invariants: layout, pointer files, content policy,
// examples and secrets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('required top-level files exist', () => {
  for (const file of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'LICENSE', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SHOWCASE.md']) {
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

test('CONTRIBUTING states the content policy; the PR template asks for it', () => {
  const contributing = read('CONTRIBUTING.md');
  assert.match(contributing, /^## Content policy$/m);
  for (const phrase of [/torrent/i, /debrid/i, /legitimate/i]) assert.match(contributing, phrase);
  assert.match(read('.github/PULL_REQUEST_TEMPLATE.md'), /- \[ \] \*\*Content policy:\*\*/);
});

test('issue templates are issue forms, and a content-policy check guards ideas', () => {
  const dir = path.join(ROOT, '.github', 'ISSUE_TEMPLATE');
  const forms = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'config.yml');
  assert.ok(forms.length >= 3, 'bug, friction and idea templates');
  for (const form of forms) {
    const text = fs.readFileSync(path.join(dir, form), 'utf8');
    assert.match(text, /^name: .+/m, `${form}: name`);
    assert.match(text, /^description: .+/m, `${form}: description`);
    assert.match(text, /^body:$/m, `${form}: body`);
    assert.doesNotMatch(text, /\t/, `${form}: YAML must not contain tabs`);
  }
  assert.match(fs.readFileSync(path.join(dir, 'idea.yml'), 'utf8'), /torrents[\s\S]*required: true/);
  assert.match(fs.readFileSync(path.join(dir, 'config.yml'), 'utf8'), /blank_issues_enabled: false/);
});

// ------------------------------------------------------------------------- examples

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

// ------------------------------------------------------------------------- agent docs

const { COMMANDS } = require('../tools/forge');

/** Markdown files an assistant or a user reads (examples' READMEs included). */
function docFiles() {
  const recipes = fs.readdirSync(path.join(ROOT, 'docs', 'recipes')).map((f) => `docs/recipes/${f}`);
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md') && f !== 'SPEC.md').map((f) => `docs/${f}`);
  const examples = exampleNames.map((n) => `examples/${n}/README.md`);
  const community = ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SHOWCASE.md', '.github/PULL_REQUEST_TEMPLATE.md'];
  return ['README.md', 'AGENTS.md', 'PROMPT.md', 'CLAUDE.md', 'GEMINI.md', 'tools/README.md', ...community, ...docs, ...recipes, ...examples];
}

test('the agent flow documents exist', () => {
  for (const file of ['PROMPT.md', 'docs/checklist.md', 'docs/protocol-cheatsheet.md', 'docs/configuration.md', 'docs/hosting.md', 'docs/recipes/README.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
  }
  for (const recipe of ['search', 'pagination', 'genre-filter', 'caching', 'rate-limited-apis', 'imdb-mapping', 'subtitles', 'llm-search']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'recipes', `${recipe}.md`)), `docs/recipes/${recipe}.md is missing`);
    assert.match(read('docs/recipes/README.md'), new RegExp(`\\(${recipe}\\.md\\)`), `docs/recipes/README.md must list ${recipe}`);
  }
});

test('PROMPT.md is short and sends the assistant to AGENTS.md', () => {
  const prompt = read('PROMPT.md');
  assert.ok(prompt.split('\n').length <= 40, 'PROMPT.md must stay under 40 lines');
  assert.match(prompt, /AGENTS\.md/);
});

test('AGENTS.md enforces the content policy and covers every phase', () => {
  const agents = read('AGENTS.md');
  for (const phrase of [/torrent/i, /debrid/i, /contentPolicyAcknowledged/, /docs\/checklist\.md/]) assert.match(agents, phrase);
  for (let phase = 0; phase <= 6; phase++) assert.match(agents, new RegExp(`### Phase ${phase}:`), `Phase ${phase} is missing`);
});

test('relative links in the docs point to files that exist', () => {
  const broken = [];
  for (const file of docFiles()) {
    const text = read(file).replace(/```[\s\S]*?```/g, ''); // links inside code blocks are examples
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const resolved = path.normalize(path.join(path.dirname(file), target.split('#')[0]));
      if (!fs.existsSync(path.join(ROOT, resolved))) broken.push(`${file} → ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('forge commands named in the docs exist', () => {
  const unknown = [];
  for (const file of docFiles()) {
    for (const [, command] of read(file).matchAll(/tools\/forge\.js ([a-z][a-z-]*)/g)) {
      if (!Object.hasOwn(COMMANDS, command)) unknown.push(`${file}: ${command}`);
    }
  }
  assert.deepEqual(unknown, []);
});

test('addon.forge.json examples in the checklist are valid', () => {
  const blocks = [...read('docs/checklist.md').matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1])).filter((b) => b.template);
  assert.ok(blocks.length > 0, 'the checklist shows a complete addon.forge.json');
  for (const block of blocks) {
    delete block.$schema;
    assert.deepEqual(validateForgeConfig(block), [], JSON.stringify(block));
  }
});

test('shell commands in the docs also run in Windows PowerShell 5.1 (no &&)', () => {
  const chained = [];
  for (const file of docFiles()) {
    for (const [, block] of read(file).matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g)) {
      if (block.includes('&&')) chained.push(`${file}: ${block.trim().split('\n')[0]}`);
    }
  }
  assert.deepEqual(chained, [], 'split chained commands into one command per block');
});
