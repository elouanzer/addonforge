'use strict';

/**
 * Live checks: fetch the manifest and exercise every declared resource over HTTP.
 * Language-agnostic: only speaks the add-on protocol.
 */

const { getJson } = require('./http');
const { validate } = require('./json-schema');
const { RESPONSES, meta: metaSchema, STREAM_SOURCES } = require('./schemas/responses');
const { checkManifest, checkImage, resourceNames, resourceScope } = require('./check-manifest');
const { baseUrl, isAllowedInsecure, resourceUrl, manifestUrl, configSegment } = require('./addon-url');
const { issue } = require('./rules');
const DOCS = require('./schemas/docs');

const SLOW_MS = 3000;
/** Cap per endpoint and rule, so one broken list does not flood the report. */
const MAX_PER_RULE = 5;

/** Well-known IMDb ids used when the add-on's catalogs give none to test with. */
const SAMPLE_IDS = {
  movie: { meta: 'tt0063350', video: 'tt0063350' }, // Night of the Living Dead (1968), public domain
  series: { meta: 'tt0108778', video: 'tt0108778:1:1' }, // Friends S1E1
};

/**
 * @typedef {object} RequestRecord
 * @property {string} path    Path relative to the add-on base URL.
 * @property {number} status
 * @property {number} ms
 * @property {number} [items] Number of items in the response list.
 * @property {string} [error]
 */

/**
 * @typedef {object} LiveResult
 * @property {any} manifest              Parsed manifest, or undefined.
 * @property {import('./rules').Issue[]} issues
 * @property {RequestRecord[]} requests
 * @property {Record<string, {type: string, id: string}[]>} samples Ids found per resource, for smoke.
 */

/**
 * Keep at most MAX_PER_RULE issues per rule; summarise the rest.
 * @param {import('./rules').Issue[]} issues
 * @returns {import('./rules').Issue[]}
 */
function capIssues(issues) {
  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i);
  }
  const out = [];
  for (const list of byRule.values()) {
    out.push(...list.slice(0, MAX_PER_RULE));
    if (list.length > MAX_PER_RULE) {
      const last = list[MAX_PER_RULE];
      out.push({ ...last, message: `…and ${list.length - MAX_PER_RULE} more like this` });
    }
  }
  return out;
}

/**
 * Path relative to the add-on base, with the user configuration masked: it may hold secrets.
 * @param {URL} base
 * @param {string} url
 * @param {object} [config]
 */
function relPath(base, url, config) {
  let path = url.slice(base.href.replace(/\/$/, '').length);
  if (config) path = path.replace(configSegment(config), '/<config>');
  return decodeURIComponent(path) || '/';
}

/**
 * Checks shared by every response: reachable, JSON, CORS, content type, speed, caching.
 * @param {import('./http').HttpResult} res
 * @param {string} where
 * @param {{ cache: boolean, slowMs: number }} opts
 * @returns {import('./rules').Issue[]}
 */
function checkHttp(res, where, { cache, slowMs }) {
  const issues = [];
  if (res.status !== 200) {
    const why = res.error || `HTTP ${res.status}`;
    issues.push(issue(where.endsWith('/manifest.json') ? 'manifest-unreachable' : 'endpoint-failed', where, `failed: ${why}`));
    return issues;
  }
  if (res.json === undefined) {
    issues.push(issue(where.endsWith('/manifest.json') ? 'manifest-not-json' : 'endpoint-failed', where, 'the response is not JSON'));
    return issues;
  }
  if (!res.headers.get('access-control-allow-origin')) {
    issues.push(issue('cors-missing', where, 'no Access-Control-Allow-Origin header; Stremio web cannot load it'));
  }
  if (!/application\/json/i.test(res.headers.get('content-type') || '')) {
    issues.push(issue('content-type', where, `Content-Type is "${res.headers.get('content-type') || 'missing'}", expected application/json`));
  }
  if (res.ms > slowMs) {
    issues.push(issue('slow-response', where, `took ${(res.ms / 1000).toFixed(1)} s (over ${slowMs / 1000} s); Stremio may give up`));
  }
  if (cache && !res.headers.get('cache-control')) {
    issues.push(issue('cache-headers', where, 'no Cache-Control header; return cacheMaxAge from the handler to reduce load'));
  }
  return issues;
}

/**
 * Map schema errors onto response-shape issues.
 * @param {unknown} value
 * @param {object} schema
 * @param {string} where
 * @param {string} prefix
 */
function shapeIssues(value, schema, where, prefix) {
  return validate(value, schema).map((e) => issue('response-shape', where, `${prefix}${e.path ? `.${e.path}` : ''} ${e.message}`, e.doc));
}

/**
 * @param {string} id
 * @param {string[]|undefined} prefixes
 */
function matchesPrefixes(id, prefixes) {
  return !prefixes || prefixes.some((p) => id.startsWith(p));
}

/**
 * Validate a live add-on.
 * @param {string} input   URL as typed by the user.
 * @param {{ config?: object, search?: string, timeoutMs?: number, manifestOnly?: boolean, slowMs?: number }} [options]
 *   search: the text sent to required search extras (default "test").
 * @returns {Promise<LiveResult>}
 */
async function checkLive(input, { config, search = 'test', timeoutMs, manifestOnly = false, slowMs = SLOW_MS } = {}) {
  const base = baseUrl(input);
  /** @type {import('./rules').Issue[]} */
  const issues = [];
  /** @type {RequestRecord[]} */
  const requests = [];
  /** @type {Record<string, {type: string, id: string}[]>} */
  const samples = {};

  if (!isAllowedInsecure(base)) {
    issues.push(issue('insecure-url', base.href, `Stremio only accepts HTTPS add-ons, except on 127.0.0.1${base.hostname === 'localhost' ? ' (use 127.0.0.1 instead of localhost)' : ''}`));
  }

  /** GET and record. */
  const get = async (url, opts) => {
    const res = await getJson(url, { timeoutMs });
    const path = relPath(base, url, config);
    const where = `GET ${path}`;
    const record = { path, status: res.status, ms: res.ms, ...(res.error ? { error: res.error } : {}) };
    requests.push(record);
    const httpIssues = checkHttp(res, where, { ...opts, slowMs });
    issues.push(...httpIssues);
    const usable = res.status === 200 && res.json !== undefined;
    return { res, where, record, usable };
  };

  // 1. Manifest
  const m = await get(manifestUrl(base), { cache: false });
  if (!m.usable) return { manifest: undefined, issues, requests, samples };
  const manifest = m.res.json;
  issues.push(...checkManifest(manifest));
  if (manifestOnly || !manifest || typeof manifest !== 'object' || !Array.isArray(manifest.resources)) {
    return { manifest, issues, requests, samples };
  }

  const hints = manifest.behaviorHints || {};
  if (Array.isArray(manifest.config) && manifest.config.length) {
    if (config) {
      await get(manifestUrl(base, config), { cache: false });
    } else if (hints.configurationRequired) {
      issues.push(issue('not-configured', 'manifest', 'configurationRequired is set: resources were tested without user configuration. Pass --config \'{"key":"value"}\' to test as a user would.'));
    }
  }

  const names = resourceNames(manifest);
  /** Items seen in catalogs, used as samples for meta/stream/subtitles. */
  const seen = [];

  // 2. Catalogs
  for (const catalog of Array.isArray(manifest.catalogs) ? manifest.catalogs : []) {
    if (!catalog || typeof catalog.type !== 'string' || typeof catalog.id !== 'string') continue;
    const extra = {};
    // Required extras may be declared in `extra` (with options) and/or the legacy `extraRequired`.
    const declared = Array.isArray(catalog.extra) ? catalog.extra.filter((e) => e && typeof e.name === 'string') : [];
    const requiredNames = new Set([
      ...declared.filter((e) => e.isRequired).map((e) => e.name),
      ...(Array.isArray(catalog.extraRequired) ? catalog.extraRequired : []),
    ]);
    const required = [...requiredNames].map((name) => declared.find((e) => e.name === name) || { name });
    let testable = true;
    for (const e of required) {
      if (e.name === 'search') extra.search = search;
      else if (Array.isArray(e.options) && e.options.length) extra[e.name] = e.options[0];
      else testable = false;
    }
    if (!testable) {
      issues.push(issue('not-tested', `catalog ${catalog.type}/${catalog.id}`, 'has a required extra with no value to try, so it was not requested'));
      continue;
    }
    const r = await get(resourceUrl(base, { resource: 'catalog', type: catalog.type, id: catalog.id, extra, config }), { cache: true });
    if (!r.usable) continue;
    issues.push(...capIssues(shapeIssues(r.res.json, RESPONSES.catalog, r.where, 'response')));
    const metas = Array.isArray(r.res.json.metas) ? r.res.json.metas.filter((x) => x && typeof x === 'object') : [];
    r.record.items = metas.length;
    const perMeta = [];
    metas.forEach((meta, i) => {
      if (typeof meta.poster !== 'string' || !meta.poster) {
        perMeta.push(issue('poster-missing', r.where, `metas[${i}] (${meta.name || meta.id}) has no poster`));
      }
      for (const field of ['poster', 'background', 'logo']) {
        perMeta.push(...checkImage(meta[field], r.where, DOCS.metaPreview).map((x) => ({ ...x, message: `metas[${i}].${field}: ${x.message}` })));
      }
      if (typeof meta.id === 'string' && typeof meta.type === 'string') seen.push({ type: meta.type, id: meta.id });
    });
    issues.push(...capIssues(perMeta));
  }

  // 3. Add-on catalogs
  if (names.includes('addon_catalog')) {
    for (const ac of Array.isArray(manifest.addonCatalogs) ? manifest.addonCatalogs : []) {
      if (!ac || typeof ac.type !== 'string' || typeof ac.id !== 'string') continue;
      const r = await get(resourceUrl(base, { resource: 'addon_catalog', type: ac.type, id: ac.id, config }), { cache: true });
      if (!r.usable) continue;
      issues.push(...capIssues(shapeIssues(r.res.json, RESPONSES.addon_catalog, r.where, 'response')));
      if (Array.isArray(r.res.json.addons)) r.record.items = r.res.json.addons.length;
    }
  }

  // 4. meta, stream, subtitles: one sample id per type.
  /** Video ids discovered from meta responses (e.g. series episodes), by meta id. */
  const videoIds = new Map();
  for (const resource of ['meta', 'stream', 'subtitles']) {
    const scope = resourceScope(manifest, resource);
    if (!scope) continue;
    samples[resource] = [];
    for (const type of scope.types) {
      const own = seen.find((s) => s.type === type && matchesPrefixes(s.id, scope.idPrefixes));
      const fallback = SAMPLE_IDS[type] && matchesPrefixes(SAMPLE_IDS[type].meta, scope.idPrefixes) ? SAMPLE_IDS[type] : null;
      let id;
      if (own) id = resource === 'meta' ? own.id : videoIds.get(own.id) || own.id;
      else if (fallback) id = resource === 'meta' ? fallback.meta : fallback.video;
      if (!id) {
        issues.push(issue('not-tested', `${resource} ${type}`, 'no id to try: none of the catalogs returned a matching item and there is no well-known sample for this type'));
        continue;
      }
      samples[resource].push({ type, id });
      const r = await get(resourceUrl(base, { resource, type, id, config }), { cache: true });
      if (!r.usable) continue;
      const body = r.res.json;
      issues.push(...capIssues(shapeIssues(body, RESPONSES[resource], r.where, 'response')));

      if (resource === 'meta' && body && typeof body === 'object') {
        if (body.meta === null || (body.meta && typeof body.meta === 'object' && !Object.keys(body.meta).length)) {
          if (own) issues.push(issue('meta-not-found', r.where, `no meta for "${id}", although the add-on's own catalog lists it`));
          else issues.push(issue('not-tested', r.where, `no meta for the sample id "${id}", so the meta shape was not verified`));
        } else if (body.meta !== undefined) {
          issues.push(...capIssues(shapeIssues(body.meta, metaSchema, r.where, 'meta')));
          for (const field of ['poster', 'background', 'logo']) issues.push(...checkImage(body.meta[field], `${r.where} meta.${field}`, DOCS.meta));
          const firstVideo = Array.isArray(body.meta.videos) && body.meta.videos.find((v) => v && typeof v.id === 'string');
          if (firstVideo) videoIds.set(id, firstVideo.id);
        }
      }
      if (resource === 'stream' && body && Array.isArray(body.streams)) {
        r.record.items = body.streams.length;
        const perStream = [];
        body.streams.forEach((s, i) => {
          if (!s || typeof s !== 'object') return;
          const sources = STREAM_SOURCES.filter((f) => s[f] !== undefined);
          if (sources.length !== 1) {
            perStream.push(issue('stream-source', r.where, `streams[${i}] has ${sources.length ? sources.join(' + ') : 'no source'}; it needs exactly one of ${STREAM_SOURCES.join(', ')}`));
          }
        });
        issues.push(...capIssues(perStream));
      }
      if (resource === 'subtitles' && body && Array.isArray(body.subtitles)) {
        r.record.items = body.subtitles.length;
      }
    }
  }

  return { manifest, issues, requests, samples };
}

module.exports = { checkLive, SAMPLE_IDS };
