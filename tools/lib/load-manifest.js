'use strict';

/**
 * Find an add-on's manifest on disk, for `validate --static`.
 *
 * Accepted targets, in order of preference:
 * - a manifest .json file, or an addon.forge.json file;
 * - a folder containing manifest.json;
 * - a node-sdk add-on folder (src/manifest.js, loaded in a separate Node process);
 * - a folder containing only addon.forge.json (the manifest `forge new` would generate).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FORGE_FILE, readForgeConfig, manifestFromForge } = require('./forge-config');

/**
 * @typedef {object} LoadedManifest
 * @property {unknown} manifest
 * @property {string} source         Which file the manifest came from.
 * @property {string} [forgeFile]    addon.forge.json found alongside, if any.
 * @property {unknown} [forge]       Its parsed content.
 */

/**
 * @param {string} file
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
  }
}

/**
 * Load src/manifest.js in a child process, so the add-on's code never runs inside the tool.
 * @param {string} file
 */
function loadJsManifest(file) {
  const res = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])))', file], {
    encoding: 'utf8',
    cwd: path.dirname(file),
    timeout: 15000,
  });
  if (res.status !== 0) {
    const reason = (res.stderr || res.error?.message || '').trim().split('\n').slice(0, 5).join('\n');
    throw new Error(`could not load ${file}:\n${reason}`);
  }
  return JSON.parse(res.stdout);
}

/**
 * The manifest a forge config generates, with a placeholder version.
 * @param {unknown} forge
 */
function manifestFromForgeFile(forge) {
  return { ...manifestFromForge(/** @type {any} */ (forge)), version: '0.0.0' };
}

/**
 * @param {string} target File or folder path.
 * @returns {LoadedManifest}
 * @throws {Error} When nothing usable is found.
 */
function loadManifest(target) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`${target} does not exist`);

  if (fs.statSync(abs).isFile()) {
    if (path.basename(abs) === FORGE_FILE) {
      const forge = readForgeConfig(abs);
      return { manifest: manifestFromForgeFile(forge), source: `${target} (generated)`, forgeFile: abs, forge };
    }
    return { manifest: readJson(abs), source: target };
  }

  const forgeFile = path.join(abs, FORGE_FILE);
  const extra = fs.existsSync(forgeFile) ? { forgeFile, forge: readForgeConfig(forgeFile) } : {};
  const rel = (f) => path.relative(process.cwd(), f) || f;

  const json = path.join(abs, 'manifest.json');
  if (fs.existsSync(json)) return { manifest: readJson(json), source: rel(json), ...extra };

  const js = path.join(abs, 'src', 'manifest.js');
  if (fs.existsSync(js)) return { manifest: loadJsManifest(js), source: rel(js), ...extra };

  if (extra.forge) return { manifest: manifestFromForgeFile(extra.forge), source: `${rel(forgeFile)} (generated)`, ...extra };

  throw new Error(`no manifest found in ${target} (looked for manifest.json, src/manifest.js, ${FORGE_FILE})`);
}

module.exports = { loadManifest };
