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
 * @property {string} [path]   Docker only: where it was found when it is not on the PATH
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
 * How to put Docker's folder on the PATH: for one command (what an assistant should do,
 * its shell may not keep variables between commands) and for good (the user's choice).
 * @param {Env} env
 * @param {string} dir
 */
function pathHint(env, dir) {
  if (env.platform === 'win32') {
    return [
      `Docker works, but its folder is not on your PATH. In PowerShell, run first: $env:Path = "${dir};" + $env:Path`,
      `For good: add ${dir} to your user PATH (Settings > System > About > Advanced system settings > Environment Variables), then open a new terminal.`,
    ].join('\n');
  }
  return [
    `Docker works, but its folder is not on your PATH. Prefix Docker commands with it, e.g.: PATH="${dir}:$PATH" docker compose up -d --build --wait`,
    `For good: add  export PATH="${dir}:$PATH"  to ~/.zshrc (or ~/.bashrc), then open a new terminal.`,
  ].join('\n');
}

/**
 * Docker CLI (on the PATH, or where Docker Desktop installs it), then whether the
 * engine is running. Returns the command that runs Docker, for the Compose check.
 * @param {Env} env
 * @returns {{ checks: Check[], docker: string|null }}
 */
function checkDocker(env) {
  let docker = 'docker';
  let res = env.exec(docker, ['--version']);
  let offPath = null;
  if (!res.ok) {
    offPath = dockerOffPath(env) || null;
    if (offPath) {
      docker = offPath;
      res = env.exec(docker, ['--version']);
    }
  }
  if (!res.ok) {
    const why = offPath ? `Docker is installed (${offPath}) but does not run. Reinstall Docker Desktop: ${hint('docker', env.platform)}` : hint('docker', env.platform);
    return {
      docker: null,
      checks: [
        { name: 'Docker', required: true, status: 'missing', hint: why },
        { name: 'Docker engine', required: true, status: 'missing', hint: 'Needs the Docker CLI first.' },
      ],
    };
  }
  const version = (res.stdout.match(/(\d+\.\d+\.\d+)/) || [])[1] || res.stdout;
  const engine = env.exec(docker, ['info', '--format', '{{.ServerVersion}}']);
  return {
    docker,
    checks: [
      offPath
        ? { name: 'Docker', required: true, status: 'warn', version, path: offPath, hint: pathHint(env, platformPath(env).dirname(offPath)) }
        : { name: 'Docker', required: true, status: 'ok', version },
      engine.ok
        ? { name: 'Docker engine', required: true, status: 'ok', version: engine.stdout }
        : {
            name: 'Docker engine',
            required: true,
            status: 'missing',
            hint: env.platform === 'linux' ? 'Start it: sudo systemctl start docker' : 'Start Docker Desktop and wait until it says "Engine running".',
          },
    ],
  };
}

/**
 * @param {Env} env
 * @param {string} docker  The command that runs Docker.
 * @returns {Check}
 */
function checkCompose(env, docker) {
  const res = env.exec(docker, ['compose', 'version', '--short']);
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
  const { checks: docker, docker: command } = checkDocker(env);
  const compose = command
    ? checkCompose(env, command)
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
    const pad = `  ${' '.repeat(width)}  `;
    return c.hint && c.status !== 'ok' ? `${line}\n${pad}→ ${c.hint.split('\n').join(`\n${pad}  `)}` : line;
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

/**
 * Environment variables for running `docker` from another tool: unchanged when Docker
 * is on the PATH, with Docker Desktop's folder added in front when it isn't (the folder
 * also holds the credential helpers `docker` calls itself).
 * @returns {NodeJS.ProcessEnv}
 */
function dockerSpawnEnv() {
  const env = defaultEnv();
  if (env.exec('docker', ['--version']).ok) return process.env;
  const found = dockerOffPath(env);
  if (!found) return process.env;
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return { ...process.env, [key]: `${path.dirname(found)}${path.delimiter}${process.env[key] || ''}` };
}

module.exports = { run, runChecks, hint, dockerSpawnEnv };
