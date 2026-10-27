'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { main, COMMANDS } = require('../tools/forge');

const FORGE = path.join(__dirname, '..', 'tools', 'forge.js');

/**
 * Run the CLI in a child process.
 * @param {string[]} args
 */
function forge(args) {
  return spawnSync(process.execPath, [FORGE, ...args], { encoding: 'utf8' });
}

test('no arguments prints help and exits 0', () => {
  const res = forge([]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage: node tools\/forge\.js <command>/);
  for (const name of Object.keys(COMMANDS)) {
    assert.match(res.stdout, new RegExp(`\\b${name}\\b`), `help mentions ${name}`);
  }
});

test('--version prints the package version', () => {
  const res = forge(['--version']);
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), require('../package.json').version);
});

test('unknown command exits 2', () => {
  const res = forge(['nope']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Unknown command: nope/);
});

test('prototype keys are not treated as commands', () => {
  const res = forge(['constructor']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Unknown command/);
});

test('a command without an implementation file exits 2', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-'));
  try {
    const code = await main(['doctor'], { toolsDir: empty });
    assert.equal(code, 2);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('a command is dispatched to its file with the remaining arguments', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'list.js'),
      "'use strict';\nmodule.exports.run = async (args) => (args.join(',') === 'a,b' ? 0 : 1);\n",
    );
    assert.equal(await main(['list', 'a', 'b'], { toolsDir: dir }), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
