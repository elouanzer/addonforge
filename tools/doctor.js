'use strict';

/**
 * forge doctor [--json]
 *
 * Checks what Addon Forge needs: Node LTS, npm, Docker (installed and running),
 * Docker Compose, plus the optional tunnel tools used by `forge expose`.
 * Never installs anything: it only reports and prints install hints.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { report, reportError } = require('./lib/output');

/** Minimum Node version, kept in sync with "engines" in package.json. */
const MIN_NODE = [22, 13, 0];

/**
 * @typedef {object} ExecResult
 * @property {boolean} ok     Exit code was 0.
 * @property {string} stdout  Trimmed standard output.
 */

/**
 * @typedef {object} Env
 * @property {(cmd: string, args: string[]) => ExecResult} exec
 * @property {NodeJS.Platform} platform
 * @property {string} nodeVersion          e.g. "v24.22.1"
 * @property {string|undefined} nodeLts    LTS codename, undefined for non-LTS releases
 * @property {(file: string) => boolean} exists
 * @property {string} home
 */

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {boolean} required
 * @property {'ok'|'warn'|'missing'} status
 * @property {string} [version]
 * @property {string} [hint]
 */

/** @type {(cmd: string, args: string[]) => ExecResult} */
function defaultExec(cmd, args) {
  // npm, and sometimes docker, are .cmd shims on Windows and need a shell there.
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32' });
  return { ok: res.status === 0, stdout: (res.stdout || '').trim() };
}

/** @returns {Env} */
function defaultEnv() {
  return {
    exec: defaultExec,
    platform: process.platform,
    nodeVersion: process.version,
    nodeLts: process.release.lts,
    exists: (file) => fs.existsSync(file),
    home: os.homedir(),
  };
}

/** Per-platform install hints. */
const HINTS = {
  node: {
    default: 'Install the LTS version from https://nodejs.org',
  },
  docker: {
    darwin: 'Install Docker Desktop: https://www.docker.com/products/docker-desktop/',
    win32: 'Install Docker Desktop: https://www.docker.com/products/docker-desktop/',
    default: 'Install Docker Engine: https://docs.docker.com/engine/install/',
  },
  compose: {
    default: 'Docker Compose v2 ships with Docker Desktop; on Linux install the plugin: https://docs.docker.com/compose/install/linux/',
  },
  cloudflared: {
    darwin: 'brew install cloudflared, or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    win32: 'winget install --id Cloudflare.cloudflared, or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    default: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  },
  tailscale: {
    default: 'https://tailscale.com/download (then enable Funnel: https://tailscale.com/kb/1223/funnel)',
  },
  localtunnel: {
    default: 'npm install -g localtunnel (https://github.com/localtunnel/localtunnel)',
  },
};

/**
 * @param {keyof HINTS} tool
 * @param {NodeJS.Platform} platform
 */
function hint(tool, platform) {
  return HINTS[tool][platform] || HINTS[tool].default;
}

/**
 * Compare dotted versions.
 * @param {number[]} a
 * @param {number[]} b
 */
function versionAtLeast(a, b) {
  for (let i = 0; i < b.length; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  }
  return true;
}

/**
 * @param {Env} env
 * @returns {Check}
 */
function checkNode(env) {
  const version = env.nodeVersion.replace(/^v/, '');
  const parts = version.split('.').map(Number);
  if (!versionAtLeast(parts, MIN_NODE)) {
    return { name: 'Node.js', required: true, status: 'missing', version, hint: `Node ${MIN_NODE.join('.')} or newer is required. ${hint('node', env.platform)}` };
  }
  if (!env.nodeLts) {
    return { name: 'Node.js', required: true, status: 'warn', version, hint: `This is not an LTS release. ${hint('node', env.platform)}` };
  }
  return { name: 'Node.js', required: true, status: 'ok', version };
}

/**
 * @param {Env} env
 * @returns {Check}
 */
function checkNpm(env) {
  const res = env.exec('npm', ['--version']);
  if (!res.ok) return { name: 'npm', required: true, status: 'missing', hint: `npm ships with Node.js. ${hint('node', env.platform)}` };
  return { name: 'npm', required: true, status: 'ok', version: res.stdout };
}

/**
 * Path helpers for the platform being checked, not the one running the check (tests
 * check a fake macOS from a Windows runner, and the other way round).
 * @param {Env} env
 */
const platformPath = (env) => (env.platform === 'win32' ? path.win32 : path.posix);

/**
 * Where Docker Desktop puts the CLI when it is not linked onto the PATH.
 * @param {Env} env
 */
function dockerOffPath(env) {
  const p = platformPath(env);
  const candidates =
    env.platform === 'darwin'
      ? [p.join(env.home, '.docker', 'bin', 'docker'), '/Applications/Docker.app/Contents/Resources/bin/docker']
      : env.platform === 'win32'
        ? ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe']
        : [p.join(env.home, '.docker', 'bin', 'docker')];
  return candidates.find((file) => env.exists(file));
}

/**
 * Docker CLI, then whether the engine is running.
 * @param {Env} env
 * @returns {Check[]}
 */
function checkDocker(env) {
  const res = env.exec('docker', ['--version']);
  if (!res.ok) {
    const found = dockerOffPath(env);
    const why = found
      ? `Docker is installed (${found}) but not on your PATH. Open a new terminal; if it persists, add ${platformPath(env).dirname(found)} to your PATH.`
      : hint('docker', env.platform);
    return [
      { name: 'Docker', required: true, status: 'missing', hint: why },
      { name: 'Docker engine', required: true, status: 'missing', hint: 'Needs the Docker CLI first.' },
    ];
  }
  const version = (res.stdout.match(/(\d+\.\d+\.\d+)/) || [])[1] || res.stdout;
  const engine = env.exec('docker', ['info', '--format', '{{.ServerVersion}}']);
  return [
    { name: 'Docker', required: true, status: 'ok', version },
    engine.ok
      ? { name: 'Docker engine', required: true, status: 'ok', version: engine.stdout }
      : {
          name: 'Docker engine',
          required: true,
          status: 'missing',
          hint: env.platform === 'linux' ? 'Start it: sudo systemctl start docker' : 'Start Docker Desktop and wait until it says "Engine running".',
        },
  ];
}

/**
 * @param {Env} env
 * @returns {Check}
 */
function checkCompose(env) {
  const res = env.exec('docker', ['compose', 'version', '--short']);
  if (!res.ok) return { name: 'Docker Compose', required: true, status: 'missing', hint: hint('compose', env.platform) };
  return { name: 'Docker Compose', required: true, status: 'ok', version: res.stdout.replace(/^v/, '') };
}

/**
 * Optional tunnel tools for `forge expose`.
 * @param {Env} env
 * @returns {Check[]}
 */
function checkTunnels(env) {
  /** @type {[string, keyof HINTS, string, string[]][]} */
  const tools = [
    ['cloudflared', 'cloudflared', 'cloudflared', ['--version']],
    ['Tailscale', 'tailscale', 'tailscale', ['version']],
    ['localtunnel', 'localtunnel', 'lt', ['--version']],
  ];
  return tools.map(([name, key, cmd, args]) => {
    const res = env.exec(cmd, args);
    if (!res.ok) return { name, required: false, status: 'missing', hint: hint(key, env.platform) };
    const version = (res.stdout.match(/(\d+\.\d+(\.\d+)?)/) || [])[1] || res.stdout.split('\n')[0];
    return { name, required: false, status: 'ok', version };
  });
}

/**
 * Run every check.
 * @param {Env} env
 * @returns {Check[]}
 */
function runChecks(env) {
  const docker = checkDocker(env);
  const compose =
    docker[0].status === 'ok'
      ? checkCompose(env)
      : { name: 'Docker Compose', required: true, status: 'missing', hint: 'Needs the Docker CLI first.' };
  return [checkNode(env), checkNpm(env), ...docker, compose, ...checkTunnels(env)];
}

/**
 * @param {Check} c
 */
function label(c) {
  if (c.status === 'ok') return 'ok';
  if (c.status === 'warn') return 'warning';
  return c.required ? 'MISSING' : 'optional, missing';
}

/**
 * @param {Check[]} checks
 * @param {boolean} ok
 */
function formatReport(checks, ok) {
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = checks.map((c) => {
    const line = `  ${c.name.padEnd(width)}  ${label(c)}${c.version ? ` (${c.version})` : ''}`;
    return c.hint && c.status !== 'ok' ? `${line}\n  ${' '.repeat(width)}  → ${c.hint}` : line;
  });
  const tunnelOk = checks.some((c) => !c.required && c.status === 'ok');
  return [
    'Addon Forge environment check',
    '',
    ...lines,
    '',
    ok ? 'Ready: everything required is installed.' : 'Not ready: install or start the items marked MISSING, then run doctor again.',
    tunnelOk ? '' : 'No tunnel tool found: only needed to use the add-on on other devices (see docs/hosting.md).',
  ]
    .join('\n')
    .trimEnd();
}

/**
 * @param {string[]} args
 * @param {{ env?: Env }} [options] Overrides, used by tests.
 * @returns {Promise<number>}
 */
async function run(args, { env = defaultEnv() } = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } }));
  } catch (err) {
    reportError(args.includes('--json'), err.message);
    return EXIT.USAGE;
  }

  const checks = runChecks(env);
  const ok = checks.every((c) => !c.required || c.status !== 'missing');
  report(values.json, { ok, checks }, () => formatReport(checks, ok));
  return ok ? EXIT.OK : EXIT.USAGE;
}

module.exports = { run, runChecks, hint };
