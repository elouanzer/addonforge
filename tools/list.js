'use strict';

/**
 * forge list [--json]
 *
 * Lists examples/* and addons/* with their name, resources, types, port, and
 * whether their Docker container is running and healthy.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { report, reportError } = require('./lib/output');
const { FORGE_FILE, DEFAULT_PORT } = require('./lib/forge-config');

const ROOT = path.resolve(__dirname, '..');

/**
 * @typedef {object} AddonEntry
 * @property {'example'|'addon'} kind
 * @property {string} name
 * @property {string} path         Relative to the repo root, with forward slashes.
 * @property {string[]} resources
 * @property {string[]} types
 * @property {number} port
 * @property {string} container    "running (healthy)", "running", "stopped", "not started" or "unknown".
 * @property {string} [problem]    Why addon.forge.json could not be read.
 */

/**
 * Containers known to Docker, keyed by their Compose working directory.
 * @returns {Map<string, string[]>|null} null when Docker is unavailable.
 */
function dockerContainers() {
  const res = spawnSync('docker', ['ps', '-a', '--format', '{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}\t{{.Status}}'], {
    encoding: 'utf8',
    timeout: 15000,
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) return null;
  const byDir = new Map();
  for (const line of res.stdout.split('\n')) {
    const [dir, state, status] = line.split('\t');
    if (!dir) continue;
    const key = path.resolve(dir);
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(state === 'running' ? (/\(healthy\)/.test(status) ? 'running (healthy)' : /\(unhealthy\)/.test(status) ? 'running (unhealthy)' : 'running') : 'stopped');
  }
  return byDir;
}

/**
 * Summarise a project's containers: the add-on service decides, the tunnel does not.
 * @param {string[]|undefined} states
 */
function containerState(states) {
  if (!states || !states.length) return 'not started';
  for (const s of ['running (unhealthy)', 'running (healthy)', 'running']) if (states.includes(s)) return s;
  return 'stopped';
}

/**
 * Collect entries from examples/ and addons/.
 * @param {string} rootDir
 * @param {Map<string, string[]>|null} containers
 * @returns {AddonEntry[]}
 */
function collect(rootDir, containers) {
  const entries = [];
  for (const [kind, folder] of [['example', 'examples'], ['addon', 'addons']]) {
    const dir = path.join(rootDir, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (name.startsWith('.') || !fs.statSync(full).isDirectory()) continue;
      /** @type {AddonEntry} */
      const entry = {
        kind,
        name,
        path: `${folder}/${name}`,
        resources: [],
        types: [],
        port: DEFAULT_PORT,
        container: containers ? containerState(containers.get(path.resolve(full))) : 'unknown',
      };
      try {
        const forge = JSON.parse(fs.readFileSync(path.join(full, FORGE_FILE), 'utf8'));
        entry.resources = Array.isArray(forge.resources) ? forge.resources : [];
        entry.types = Array.isArray(forge.types) ? forge.types : [];
        if (Number.isInteger(forge.port)) entry.port = forge.port;
      } catch (err) {
        entry.problem = err.code === 'ENOENT' ? `no ${FORGE_FILE}` : `${FORGE_FILE}: ${err.message}`;
      }
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * @param {AddonEntry[]} entries
 * @param {boolean} dockerOk
 */
function formatTable(entries, dockerOk) {
  if (!entries.length) {
    return 'No add-ons yet. Create one with: node tools/forge.js new <name>';
  }
  const rows = entries.map((e) => [
    e.kind,
    e.name,
    e.problem ? `(${e.problem})` : e.resources.join(', '),
    e.types.join(', '),
    String(e.port),
    e.container,
  ]);
  const header = ['Kind', 'Name', 'Resources', 'Types', 'Port', 'Container'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`.trimEnd();
  const out = [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)];
  if (!dockerOk) out.push('', 'Docker is not available, so container status is unknown (run: node tools/forge.js doctor).');
  return out.join('\n');
}

/**
 * @param {string[]} args
 * @param {{ rootDir?: string, containers?: Map<string, string[]>|null }} [options] Overrides, used by tests.
 * @returns {Promise<number>}
 */
async function run(args, options = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } }));
  } catch (err) {
    reportError(args.includes('--json'), err.message);
    return EXIT.USAGE;
  }
  const rootDir = options.rootDir || ROOT;
  const containers = 'containers' in options ? options.containers : dockerContainers();
  const entries = collect(rootDir, containers);
  report(values.json, { ok: true, dockerAvailable: containers !== null, addons: entries }, () => formatTable(entries, containers !== null));
  return EXIT.OK;
}

module.exports = { run, collect, containerState };
