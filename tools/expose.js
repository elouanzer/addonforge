'use strict';

/**
 * forge expose <port> [--tool cloudflared|tailscale|localtunnel|docker] [--config <json>] [--once] [--json]
 *
 * Makes a local add-on reachable over HTTPS through a tunnel (docs/hosting.md):
 * checks the add-on answers locally, starts the first tunnel tool found, prints the
 * public URL, runs validate + smoke against it, prints the install link, and keeps
 * the tunnel open until Ctrl+C (or closes it right away with --once).
 *
 * Never installs software or creates accounts. `--tool docker` (pulls the cloudflared
 * image) is only used when asked for explicitly.
 */

const { spawn, spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { reportError } = require('./lib/output');
const { getJson } = require('./lib/http');
const { parseConfig } = require('./lib/addon-url');
const { checkLive } = require('./lib/check-live');
const { hint } = require('./doctor');

/** Same pinned image as the template's Compose tunnel profile. */
const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:2026.10.4';
const TRYCLOUDFLARE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/**
 * @typedef {object} Tunnel
 * @property {string} id
 * @property {string} name
 * @property {[string, string[]]} detect     Command proving the tool is usable.
 * @property {(port: number) => [string, string[]]} command
 * @property {RegExp} url                    Matches the public URL in the tool's output.
 * @property {boolean} [explicitOnly]        Only used with --tool.
 * @property {boolean} [cmdShim]             An npm .cmd shim on Windows, which needs a shell to run.
 * @property {string} install                How to get it.
 */

/** @type {Tunnel[]} In order of preference. */
const TUNNELS = [
  {
    id: 'cloudflared',
    name: 'Cloudflare quick tunnel',
    detect: ['cloudflared', ['--version']],
    command: (port) => ['cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`]],
    url: TRYCLOUDFLARE,
    install: hint('cloudflared', process.platform),
  },
  {
    id: 'tailscale',
    name: 'Tailscale Funnel',
    detect: ['tailscale', ['version']],
    command: (port) => ['tailscale', ['funnel', String(port)]],
    url: /https:\/\/[a-z0-9.-]+\.ts\.net\/?/i,
    install: hint('tailscale', process.platform),
  },
  {
    id: 'localtunnel',
    name: 'localtunnel',
    detect: ['lt', ['--version']],
    command: (port) => ['lt', ['--port', String(port)]],
    url: /https:\/\/[a-z0-9-]+\.loca\.lt/,
    cmdShim: true,
    install: hint('localtunnel', process.platform),
  },
  {
    id: 'docker',
    name: 'Cloudflare quick tunnel in Docker',
    detect: ['docker', ['info', '--format', '{{.ServerVersion}}']],
    command: (port) => [
      'docker',
      ['run', '--rm', '--add-host=host.docker.internal:host-gateway', CLOUDFLARED_IMAGE, 'tunnel', '--no-autoupdate', '--url', `http://host.docker.internal:${port}`],
    ],
    url: TRYCLOUDFLARE,
    explicitOnly: true,
    install: `Docker Desktop (macOS, Windows). Pulls ${CLOUDFLARED_IMAGE}.`,
  },
];

/** @param {Tunnel} t */
const useShell = (t) => Boolean(t.cmdShim) && process.platform === 'win32';

/** @param {Tunnel} t */
function isAvailable(t) {
  const [cmd, args] = t.detect;
  const res = spawnSync(cmd, args, { stdio: 'ignore', timeout: 15000, shell: useShell(t) });
  return res.status === 0;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the tunnel and wait for its public URL.
 * @param {Tunnel} tunnel
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ child: import('node:child_process').ChildProcess, url: string }>}
 */
function startTunnel(tunnel, port, timeoutMs) {
  const [cmd, args] = tunnel.command(port);
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: useShell(tunnel) });
  const tail = [];
  return new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer);
      child.kill();
      reject(new Error(`${message}${tail.length ? `\nLast output from ${cmd}:\n  ${tail.join('\n  ')}` : ''}`));
    };
    const timer = setTimeout(() => fail(`${tunnel.name} gave no public URL within ${timeoutMs / 1000} s.`), timeoutMs);
    const onData = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line.trim());
        if (tail.length > 8) tail.shift();
        const match = line.match(tunnel.url);
        if (match) {
          clearTimeout(timer);
          child.stdout.removeAllListeners('data');
          child.stderr.removeAllListeners('data');
          child.removeAllListeners('exit');
          child.stdout.resume();
          child.stderr.resume();
          resolve({ child, url: match[0].replace(/\/$/, '') });
          return;
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => fail(`could not start ${cmd}: ${err.message}`));
    child.on('exit', (code) => fail(`${cmd} exited (code ${code}) before giving a URL.`));
  });
}

/**
 * New tunnel URLs can take a few seconds to resolve: poll the manifest.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitUntilReachable(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await getJson(`${url}/manifest.json`, { timeoutMs: 10000 });
    if (res.status === 200 && res.json) return true;
    await sleep(2000);
  }
  return false;
}

/**
 * @param {string[]} args
 * @param {{ tunnels?: Tunnel[], urlTimeoutMs?: number, reachTimeoutMs?: number }} [options] Overrides, used by tests.
 * @returns {Promise<number>}
 */
async function run(args, { tunnels = TUNNELS, urlTimeoutMs = 60000, reachTimeoutMs = 60000 } = {}) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        tool: { type: 'string' },
        config: { type: 'string' },
        once: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    reportError(args.includes('--json'), err.message);
    return EXIT.USAGE;
  }
  const json = values.json;
  /** Human-readable progress; silent in --json mode. */
  const say = (text) => {
    if (!json) console.log(text);
  };

  const port = Number(positionals[0]);
  if (positionals.length !== 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
    reportError(json, 'expected the add-on port. Usage: node tools/forge.js expose <port> [--tool cloudflared|tailscale|localtunnel|docker]');
    return EXIT.USAGE;
  }
  let config;
  try {
    config = parseConfig(values.config);
  } catch (err) {
    reportError(json, err.message);
    return EXIT.USAGE;
  }

  // 1. The add-on must answer locally first.
  const local = `http://127.0.0.1:${port}`;
  const probe = await getJson(`${local}/manifest.json`, { timeoutMs: 5000 });
  if (probe.status !== 200 || !probe.json || !probe.json.id) {
    reportError(json, `no add-on answers at ${local}/manifest.json (${probe.error || `HTTP ${probe.status}`}). Start it first, e.g. "docker compose up -d" in its folder.`);
    return EXIT.USAGE;
  }

  // 2. Pick a tunnel tool.
  let tunnel;
  if (values.tool) {
    tunnel = tunnels.find((t) => t.id === values.tool);
    if (!tunnel) {
      reportError(json, `unknown --tool "${values.tool}". Choose one of: ${tunnels.map((t) => t.id).join(', ')}.`);
      return EXIT.USAGE;
    }
    if (!isAvailable(tunnel)) {
      reportError(json, `${tunnel.name} is not available. ${tunnel.install}`);
      return EXIT.USAGE;
    }
  } else {
    tunnel = tunnels.find((t) => !t.explicitOnly && isAvailable(t));
    if (!tunnel) {
      const options = tunnels.map((t) => `  - ${t.name}${t.explicitOnly ? ` (--tool ${t.id})` : ''}: ${t.install}`);
      reportError(
        json,
        [
          'no tunnel tool found. Install one of these (Addon Forge never installs software for you), then run expose again:',
          ...options,
          '  - Or, without installing anything: the "tunnel" profile in the add-on\'s docker-compose.yml.',
          'See docs/hosting.md.',
        ].join('\n'),
      );
      return EXIT.USAGE;
    }
  }

  say(`Starting ${tunnel.name} for ${local} …`);
  say('Warning: anyone with the tunnel URL can use this add-on (and any API key behind it) while the tunnel runs.');

  // 3. Start it and get the public URL.
  let child;
  let url;
  try {
    ({ child, url } = await startTunnel(tunnel, port, urlTimeoutMs));
  } catch (err) {
    reportError(json, err.message);
    return EXIT.USAGE;
  }
  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };

  try {
    say(`\nPublic URL: ${url}`);
    say('Waiting for it to answer …');
    if (!(await waitUntilReachable(url, reachTimeoutMs))) {
      reportError(json, `${url}/manifest.json is not answering after ${reachTimeoutMs / 1000} s.`);
      stop();
      return EXIT.FAILURE;
    }

    // 4. Validate + smoke through the tunnel, then the install link.
    const configArgs = values.config ? ['--config', values.config] : [];
    let checksOk;
    if (json) {
      const live = await checkLive(url, { config });
      const smokeResult = await require('./smoke').smoke(url, { config });
      const errors = live.issues.filter((i) => i.severity === 'error');
      checksOk = errors.length === 0 && smokeResult.ok;
      const { installLinks } = require('./install-link');
      const links = await installLinks(url, { config, check: false });
      console.log(JSON.stringify({ ok: checksOk, tool: tunnel.id, url, validate: { ok: errors.length === 0, errors, warnings: live.issues.filter((i) => i.severity === 'warning') }, smoke: smokeResult, install: links }, null, 2));
    } else {
      say('');
      const validateCode = await require('./validate').run([url, ...configArgs]);
      say('');
      const smokeCode = await require('./smoke').run([url, ...configArgs]);
      say('');
      await require('./install-link').run([url, ...configArgs]);
      checksOk = validateCode === EXIT.OK && smokeCode === EXIT.OK;
      if (!checksOk) say('\nThe add-on does not pass validate/smoke through the tunnel: fix it before installing it on another device.');
    }

    if (values.once) {
      stop();
      return checksOk ? EXIT.OK : EXIT.FAILURE;
    }

    // 5. Keep the tunnel open until Ctrl+C.
    say(`\nTunnel running at ${url} — press Ctrl+C to stop it.`);
    await new Promise((resolve) => {
      const done = () => {
        process.off('SIGINT', done);
        process.off('SIGTERM', done);
        resolve();
      };
      process.on('SIGINT', done);
      process.on('SIGTERM', done);
      child.on('exit', () => {
        say(`\n${tunnel.name} stopped.`);
        done();
      });
    });
    say('Tunnel closed.');
    return checksOk ? EXIT.OK : EXIT.FAILURE;
  } finally {
    stop();
  }
}

module.exports = { run, TUNNELS, startTunnel };
