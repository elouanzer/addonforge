'use strict';

/**
 * forge smoke <url> [--samples N] [--search <text>] [--config <json>] [--json]
 *
 * Exercises a running add-on the way Stremio would: every catalog with and
 * without each supported extra (search=test, the first genre, skip=100), then
 * meta / stream / subtitles for up to N items found in those catalogs.
 * Prints one row per request: endpoint, status, latency, item count, pass/fail.
 * `validate` checks the protocol in depth; smoke checks that everything answers.
 */

const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { report, reportError } = require('./lib/output');
const { getJson } = require('./lib/http');
const { baseUrl, resourceUrl, manifestUrl, configSegment, parseConfig } = require('./lib/addon-url');
const { resourceNames, resourceScope } = require('./lib/check-manifest');
const { SAMPLE_IDS } = require('./lib/check-live');

const DEFAULT_SAMPLES = 3;

/** Top-level key and kind each resource must answer with. */
const EXPECTED = {
  catalog: ['metas', 'array'],
  meta: ['meta', 'object'],
  stream: ['streams', 'array'],
  subtitles: ['subtitles', 'array'],
  addon_catalog: ['addons', 'array'],
};

/**
 * @typedef {object} SmokeRow
 * @property {string} endpoint  Path relative to the add-on, user config masked.
 * @property {number} status
 * @property {number} ms
 * @property {number|null} items
 * @property {boolean} pass
 * @property {string} [note]    Why it failed, or extra context.
 */

/**
 * Catalog requests to try: the plain feed (unless an extra is required) and one per supported extra.
 * @param {any} catalog
 * @param {{ search?: string }} [options] search: the text sent as search=… (default "test").
 * @returns {Record<string, string>[]} One extra object per request.
 */
function catalogVariants(catalog, { search = 'test' } = {}) {
  const declared = Array.isArray(catalog.extra) ? catalog.extra.filter((e) => e && typeof e.name === 'string') : [];
  const supported = new Set([...declared.map((e) => e.name), ...(Array.isArray(catalog.extraSupported) ? catalog.extraSupported : [])]);
  const required = new Set([...declared.filter((e) => e.isRequired).map((e) => e.name), ...(Array.isArray(catalog.extraRequired) ? catalog.extraRequired : [])]);
  const options = (name) => (declared.find((e) => e.name === name) || {}).options;

  /** A value for an extra, or undefined if there is no sensible one. */
  const valueFor = (name) => {
    if (name === 'search') return search;
    if (name === 'skip') return '100';
    const opts = options(name);
    return Array.isArray(opts) && opts.length ? String(opts[0]) : undefined;
  };

  const base = {};
  for (const name of required) {
    const v = valueFor(name);
    if (v === undefined) return [];
    base[name] = v;
  }
  const variants = [base];
  for (const name of ['search', 'genre', 'skip']) {
    if (!supported.has(name) || required.has(name)) continue;
    const v = valueFor(name);
    if (v !== undefined) variants.push({ ...base, [name]: v });
  }
  return variants;
}

/**
 * Up to `n` items, alternating between content types so each type gets tried.
 * @template {{ type: string }} T
 * @param {T[]} items
 * @param {number} n
 * @returns {T[]}
 */
function roundRobinByType(items, n) {
  const byType = new Map();
  for (const item of items) {
    if (!byType.has(item.type)) byType.set(item.type, []);
    byType.get(item.type).push(item);
  }
  const queues = [...byType.values()];
  const out = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < n) out.push(q.shift());
  }
  return out;
}

/**
 * Run the smoke test.
 * @param {string} input
 * @param {{ samples?: number, search?: string, config?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, rows: SmokeRow[], error?: string }>}
 */
async function smoke(input, { samples = DEFAULT_SAMPLES, search, config, timeoutMs } = {}) {
  const base = baseUrl(input);
  /** @type {SmokeRow[]} */
  const rows = [];
  const mask = (url) => {
    let path = url.slice(base.href.replace(/\/$/, '').length);
    if (config) path = path.replace(configSegment(config), '/<config>');
    return decodeURIComponent(path);
  };

  /**
   * GET an endpoint and record a row.
   * @param {string} url
   * @param {string} [resource]
   */
  const call = async (url, resource) => {
    const res = await getJson(url, { timeoutMs });
    const row = { endpoint: mask(url), status: res.status, ms: res.ms, items: null, pass: false };
    if (res.status !== 200) row.note = res.error || `HTTP ${res.status}`;
    else if (res.json === undefined) row.note = 'not JSON';
    else if (resource) {
      const [key, kind] = EXPECTED[resource];
      const value = res.json && res.json[key];
      if (kind === 'array' ? Array.isArray(value) : value !== undefined) {
        row.pass = true;
        if (Array.isArray(value)) row.items = value.length;
      } else row.note = `missing "${key}" ${kind}`;
    } else row.pass = true;
    rows.push(row);
    return { res, row };
  };

  const { res: mres, row: mrow } = await call(manifestUrl(base, config));
  const manifest = mres.json;
  if (!mrow.pass || !manifest || !Array.isArray(manifest.resources)) {
    if (mrow.pass) {
      mrow.pass = false;
      mrow.note = 'not a manifest';
    }
    return { ok: false, rows };
  }
  const names = resourceNames(manifest);

  // Catalogs, collecting items to sample.
  const items = [];
  for (const catalog of Array.isArray(manifest.catalogs) ? manifest.catalogs : []) {
    if (!catalog || typeof catalog.type !== 'string' || typeof catalog.id !== 'string') continue;
    const variants = catalogVariants(catalog, { search });
    if (!variants.length) {
      rows.push({ endpoint: `/catalog/${catalog.type}/${catalog.id}`, status: 0, ms: 0, items: null, pass: true, note: 'skipped: required extra with no value to try' });
      continue;
    }
    for (const extra of variants) {
      const { res, row } = await call(resourceUrl(base, { resource: 'catalog', type: catalog.type, id: catalog.id, extra, config }), 'catalog');
      if (row.pass && !Object.keys(extra).some((k) => k !== 'genre')) {
        for (const m of res.json.metas) {
          if (m && typeof m.id === 'string' && typeof m.type === 'string' && !items.some((i) => i.id === m.id)) items.push({ id: m.id, type: m.type });
        }
      }
    }
  }

  if (names.includes('addon_catalog')) {
    for (const ac of Array.isArray(manifest.addonCatalogs) ? manifest.addonCatalogs : []) {
      if (ac && typeof ac.type === 'string' && typeof ac.id === 'string') {
        await call(resourceUrl(base, { resource: 'addon_catalog', type: ac.type, id: ac.id, config }), 'addon_catalog');
      }
    }
  }

  // meta, then stream and subtitles, for up to N items per resource.
  const videoIds = new Map();
  for (const resource of ['meta', 'stream', 'subtitles']) {
    const scope = resourceScope(manifest, resource);
    if (!scope) continue;
    const matches = (i) => scope.types.includes(i.type) && (!scope.idPrefixes || scope.idPrefixes.some((p) => i.id.startsWith(p)));
    let targets = roundRobinByType(items.filter(matches), samples);
    if (!targets.length) {
      targets = scope.types
        .filter((t) => SAMPLE_IDS[t] && (!scope.idPrefixes || scope.idPrefixes.some((p) => SAMPLE_IDS[t].meta.startsWith(p))))
        .map((t) => ({ type: t, id: SAMPLE_IDS[t].meta, video: SAMPLE_IDS[t].video, fallback: true }))
        .slice(0, samples);
    }
    if (!targets.length) {
      rows.push({ endpoint: `/${resource}`, status: 0, ms: 0, items: null, pass: true, note: 'skipped: no item to try' });
      continue;
    }
    for (const t of targets) {
      const id = resource === 'meta' ? t.id : videoIds.get(t.id) || t.video || t.id;
      const { res, row } = await call(resourceUrl(base, { resource, type: t.type, id, config }), resource);
      if (resource === 'meta' && row.pass) {
        const meta = res.json.meta;
        if (!meta || typeof meta !== 'object') {
          // Unknown sample ids may legitimately have no meta; items from the add-on's own catalog may not.
          if (!t.fallback) {
            row.pass = false;
            row.note = 'meta is empty for an item from the add-on’s own catalog';
          } else row.note = 'no meta for sample id';
        } else if (Array.isArray(meta.videos)) {
          row.items = meta.videos.length;
          const first = meta.videos.find((v) => v && typeof v.id === 'string');
          if (first) videoIds.set(t.id, first.id);
        }
      }
    }
  }

  return { ok: rows.every((r) => r.pass), rows };
}

/**
 * @param {SmokeRow[]} rows
 * @param {string} target
 * @param {boolean} ok
 */
function formatTable(rows, target, ok) {
  const width = Math.min(70, Math.max(8, ...rows.map((r) => r.endpoint.length)));
  const cut = (s) => (s.length > width ? `${s.slice(0, width - 1)}…` : s.padEnd(width));
  const lines = [
    `Smoke test: ${target}`,
    '',
    `  ${'Endpoint'.padEnd(width)}  Status  Latency  Items  Result`,
    `  ${'-'.repeat(width)}  ------  -------  -----  ------`,
  ];
  for (const r of rows) {
    const status = r.status ? String(r.status) : '-';
    const ms = r.status ? `${r.ms} ms` : '-';
    const items = r.items === null ? '-' : String(r.items);
    const result = r.pass ? (r.note ? 'skip' : 'pass') : 'FAIL';
    lines.push(`  ${cut(r.endpoint)}  ${status.padStart(6)}  ${ms.padStart(7)}  ${items.padStart(5)}  ${result}${r.note ? `  (${r.note})` : ''}`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  lines.push('', ok ? `PASS: ${rows.length} request(s)` : `FAIL: ${failed} of ${rows.length} request(s) failed`);
  return lines.join('\n');
}

/**
 * @param {string[]} args
 * @returns {Promise<number>}
 */
async function run(args) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        samples: { type: 'string' },
        search: { type: 'string' },
        config: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    reportError(args.includes('--json'), err.message);
    return EXIT.USAGE;
  }
  const json = values.json;
  if (positionals.length !== 1) {
    reportError(json, 'expected one add-on URL. Usage: node tools/forge.js smoke <url> [--samples N] [--search <text>]');
    return EXIT.USAGE;
  }
  const samples = values.samples === undefined ? DEFAULT_SAMPLES : Number(values.samples);
  if (!Number.isInteger(samples) || samples < 1) {
    reportError(json, '--samples must be a positive integer');
    return EXIT.USAGE;
  }
  if (values.search !== undefined && !values.search.trim()) {
    reportError(json, '--search needs some text, e.g. --search "70s thriller"');
    return EXIT.USAGE;
  }

  let result;
  let target;
  try {
    target = `${baseUrl(positionals[0]).href.replace(/\/$/, '')}/manifest.json`;
    result = await smoke(positionals[0], { samples, search: values.search, config: parseConfig(values.config) });
  } catch (err) {
    reportError(json, err.message);
    return EXIT.USAGE;
  }
  report(json, { ok: result.ok, target, rows: result.rows }, () => formatTable(result.rows, target, result.ok));
  return result.ok ? EXIT.OK : EXIT.FAILURE;
}

module.exports = { run, smoke, catalogVariants, roundRobinByType };
