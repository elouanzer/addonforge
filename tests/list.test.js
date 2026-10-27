'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, collect, containerState } = require('../tools/list');

/** A temp repo with two examples and one add-on. */
function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-list-'));
  const write = (dir, forge) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    if (forge) fs.writeFileSync(path.join(root, dir, 'addon.forge.json'), typeof forge === 'string' ? forge : JSON.stringify(forge));
  };
  write('examples/hello', { resources: ['catalog'], types: ['movie'], port: 7001 });
  write('examples/broken', '{not json');
  write('addons/mine', { resources: ['subtitles'], types: ['movie', 'series'] });
  fs.writeFileSync(path.join(root, 'addons', '.gitkeep'), '');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('collects examples and add-ons with their status', (t) => {
  const root = makeRoot(t);
  const containers = new Map([[path.resolve(root, 'examples/hello'), ['running (healthy)', 'stopped']]]);
  const entries = collect(root, containers);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.name, e.resources.join(','), e.port, e.container]),
    [
      ['example', 'broken', '', 7100, 'not started'],
      ['example', 'hello', 'catalog', 7001, 'running (healthy)'],
      ['addon', 'mine', 'subtitles', 7100, 'not started'],
    ],
  );
  assert.match(entries[0].problem, /addon\.forge\.json/);
});

test('container status is unknown without Docker', (t) => {
  const entries = collect(makeRoot(t), null);
  assert.ok(entries.every((e) => e.container === 'unknown'));
});

test('containerState prefers the worst running state', () => {
  assert.equal(containerState(undefined), 'not started');
  assert.equal(containerState(['stopped']), 'stopped');
  assert.equal(containerState(['running (healthy)', 'running (unhealthy)']), 'running (unhealthy)');
});

test('--json output; usage error', async (t) => {
  const root = makeRoot(t);
  const { log, error } = console;
  let out = '';
  console.log = (s) => (out += s);
  console.error = () => {};
  try {
    assert.equal(await run(['--json'], { rootDir: root, containers: null }), 0);
    assert.equal(await run(['--bogus'], { rootDir: root, containers: null }), 2);
  } finally {
    Object.assign(console, { log, error });
  }
  const parsed = JSON.parse(out);
  assert.equal(parsed.dockerAvailable, false);
  assert.equal(parsed.addons.length, 3);
});
