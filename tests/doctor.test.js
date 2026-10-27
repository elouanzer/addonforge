'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, runChecks } = require('../tools/doctor');

/**
 * Fake environment: `tools` maps "cmd arg1 arg2" to stdout; anything else fails.
 * @param {Record<string, string>} tools
 * @param {object} [overrides]
 */
function fakeEnv(tools, overrides = {}) {
  return {
    exec: (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      return Object.hasOwn(tools, key) ? { ok: true, stdout: tools[key] } : { ok: false, stdout: '' };
    },
    platform: 'linux',
    nodeVersion: 'v24.22.1',
    nodeLts: 'Krypton',
    exists: () => false,
    home: '/home/me',
    ...overrides,
  };
}

const ALL_REQUIRED = {
  'npm --version': '11.19.1',
  'docker --version': 'Docker version 29.9.2, build a82e528',
  'docker info --format {{.ServerVersion}}': '29.9.2',
  'docker compose version --short': 'v5.6.1',
};

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

/** Run with output captured. */
async function quietRun(args, env) {
  const original = console.log;
  let out = '';
  console.log = (s) => (out += `${s}\n`);
  try {
    return { code: await run(args, { env }), out };
  } finally {
    console.log = original;
  }
}

test('everything installed: exit 0, versions parsed', async () => {
  const env = fakeEnv({ ...ALL_REQUIRED, 'cloudflared --version': 'cloudflared version 2026.10.4 (built 2026-10-01)' });
  const checks = byName(runChecks(env));
  assert.equal(checks['Docker'].version, '29.9.2');
  assert.equal(checks['Docker Compose'].version, '5.6.1');
  assert.equal(checks['cloudflared'].version, '2026.10.4');
  const { code, out } = await quietRun(['--json'], env);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).ok, true);
});

test('missing optional tunnels do not fail', async () => {
  const { code } = await quietRun([], fakeEnv(ALL_REQUIRED));
  assert.equal(code, 0);
});

test('Docker missing: exit 2 with an install hint', async () => {
  const { 'npm --version': npm } = ALL_REQUIRED;
  const env = fakeEnv({ 'npm --version': npm });
  const checks = byName(runChecks(env));
  assert.equal(checks['Docker'].status, 'missing');
  assert.match(checks['Docker'].hint, /docs\.docker\.com/);
  assert.equal(checks['Docker Compose'].status, 'missing');
  assert.equal((await quietRun(['--json'], env)).code, 2);
});

test('Docker off the PATH: found, checked through its full path, and the fix is a command an assistant can run', async () => {
  const bin = '/Users/me/.docker/bin/docker';
  const tools = { 'npm --version': '11.0.0' };
  for (const [key, out] of Object.entries(ALL_REQUIRED)) if (key.startsWith('docker ')) tools[key.replace(/^docker/, bin)] = out;
  const env = fakeEnv(tools, { platform: 'darwin', home: '/Users/me', exists: (f) => f === bin });
  const checks = byName(runChecks(env));
  assert.equal(checks['Docker'].status, 'warn');
  assert.equal(checks['Docker'].path, bin);
  assert.match(checks['Docker'].hint, /PATH="\/Users\/me\/\.docker\/bin:\$PATH" docker compose up/);
  assert.equal(checks['Docker engine'].status, 'ok');
  assert.equal(checks['Docker Compose'].status, 'ok');
  const { code, out } = await quietRun([], env);
  assert.equal(code, 0, 'usable Docker is not a blocker');
  assert.match(out, /export PATH=/);
});

test('Docker off the PATH on Windows: a PowerShell command', () => {
  const bin = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
  const env = fakeEnv({ [`${bin} --version`]: 'Docker version 29.9.2' }, { platform: 'win32', exists: (f) => f === bin });
  assert.match(byName(runChecks(env))['Docker'].hint, /\$env:Path = "C:\\Program Files\\Docker\\Docker\\resources\\bin;" \+ \$env:Path/);
});

test('Docker found off the PATH but not runnable is missing', () => {
  const env = fakeEnv({}, { platform: 'darwin', home: '/Users/me', exists: (f) => f === '/Users/me/.docker/bin/docker' });
  const docker = byName(runChecks(env))['Docker'];
  assert.equal(docker.status, 'missing');
  assert.match(docker.hint, /does not run/);
});

test('Docker engine not running', () => {
  const tools = { ...ALL_REQUIRED };
  delete tools['docker info --format {{.ServerVersion}}'];
  const engine = byName(runChecks(fakeEnv(tools, { platform: 'darwin' })))['Docker engine'];
  assert.equal(engine.status, 'missing');
  assert.match(engine.hint, /Start Docker Desktop/);
});

test('Node too old fails; non-LTS only warns', () => {
  assert.equal(byName(runChecks(fakeEnv(ALL_REQUIRED, { nodeVersion: 'v20.11.0' })))['Node.js'].status, 'missing');
  assert.equal(byName(runChecks(fakeEnv(ALL_REQUIRED, { nodeVersion: 'v25.1.0', nodeLts: undefined })))['Node.js'].status, 'warn');
});

test('unknown option is a usage error', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await run(['--nope'], { env: fakeEnv(ALL_REQUIRED) }), 2);
  } finally {
    console.error = original;
  }
});
