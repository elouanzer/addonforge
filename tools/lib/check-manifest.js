'use strict';

/**
 * Static checks on a manifest object: its shape, then consistency between its parts.
 */

const { validate } = require('./json-schema');
const { manifest: manifestSchema, RESOURCES } = require('./schemas/manifest');
const { issue } = require('./rules');
const DOCS = require('./schemas/docs');

const MAX_MANIFEST_BYTES = 8192;

/**
 * Resource names, whether declared as strings or { name, types, idPrefixes }.
 * @param {any} manifest
 * @returns {string[]}
 */
function resourceNames(manifest) {
  return (Array.isArray(manifest.resources) ? manifest.resources : []).map((r) => (r && typeof r === 'object' ? r.name : r));
}

/**
 * Types and idPrefixes that apply to a resource (its own, or the manifest's).
 * @param {any} manifest
 * @param {string} name
 * @returns {{ types: string[], idPrefixes: string[]|undefined } | null} null when not declared.
 */
function resourceScope(manifest, name) {
  const r = (manifest.resources || []).find((x) => (x && typeof x === 'object' ? x.name : x) === name);
  if (r === undefined) return null;
  if (r && typeof r === 'object') return { types: r.types || manifest.types || [], idPrefixes: r.idPrefixes || manifest.idPrefixes };
  return { types: manifest.types || [], idPrefixes: manifest.idPrefixes };
}

/**
 * Protocol of an absolute URL ("https:"), or null if the URL is relative or invalid.
 * @param {string} url
 */
function urlProtocol(url) {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

/**
 * Check an image URL: must be absolute; should be HTTPS.
 * @param {unknown} url
 * @param {string} where
 * @param {string} [doc]
 * @returns {import('./rules').Issue[]}
 */
function checkImage(url, where, doc) {
  if (typeof url !== 'string' || !url) return [];
  const protocol = urlProtocol(url);
  if (!protocol) return [issue('relative-image-url', where, `"${url}" is not an absolute URL`, doc)];
  if (protocol === 'http:') return [issue('insecure-image', where, `"${url}" is served over HTTP; Stremio web and some devices block it`, doc)];
  return [];
}

/**
 * @param {any[]} list
 * @param {(item: any) => string} key
 * @returns {string[]} Keys that appear more than once.
 */
function duplicates(list, key) {
  const seen = new Set();
  const dups = new Set();
  for (const item of list) {
    const k = key(item);
    if (seen.has(k)) dups.add(k);
    seen.add(k);
  }
  return [...dups];
}

/**
 * @param {any} catalog
 * @param {string} where
 * @returns {import('./rules').Issue[]}
 */
function checkCatalogExtra(catalog, where) {
  const issues = [];
  const extra = Array.isArray(catalog.extra) ? catalog.extra.filter((e) => e && typeof e === 'object') : [];

  for (const name of duplicates(extra, (e) => e.name)) {
    issues.push(issue('extra-duplicate', `${where}.extra`, `extra "${name}" is declared more than once`));
  }

  const supported = Array.isArray(catalog.extraSupported) ? catalog.extraSupported : null;
  const required = Array.isArray(catalog.extraRequired) ? catalog.extraRequired : null;
  if (required) {
    const notSupported = required.filter((n) => !(supported || []).includes(n) && !extra.some((e) => e.name === n));
    if (notSupported.length) {
      issues.push(issue('extra-inconsistent', `${where}.extraRequired`, `${notSupported.join(', ')} is required but not supported (missing from extraSupported/extra)`));
    }
  }
  if (extra.length && required) {
    const fromExtra = extra.filter((e) => e.isRequired).map((e) => e.name).sort();
    const fromLegacy = [...required].sort();
    if (JSON.stringify(fromExtra) !== JSON.stringify(fromLegacy)) {
      issues.push(issue('extra-inconsistent', where, `extra[].isRequired (${fromExtra.join(', ') || 'none'}) disagrees with extraRequired (${fromLegacy.join(', ') || 'none'})`));
    }
  }
  for (const e of extra) {
    if (e.name === 'genre' && e.isRequired && !(Array.isArray(e.options) && e.options.length)) {
      issues.push(issue('extra-inconsistent', `${where}.extra`, 'a required "genre" extra needs options, or Stremio has nothing to send'));
    }
    if (Array.isArray(e.options) && e.optionsLimit > e.options.length) {
      issues.push(issue('extra-inconsistent', `${where}.extra`, `"${e.name}" optionsLimit (${e.optionsLimit}) is larger than its ${e.options.length} option(s)`));
    }
  }
  return issues;
}

/**
 * Run every static rule on a manifest.
 * @param {unknown} manifest
 * @returns {import('./rules').Issue[]}
 */
function checkManifest(manifest) {
  const shape = validate(manifest, manifestSchema).map((e) =>
    issue('manifest-shape', e.path ? `manifest.${e.path}` : 'manifest', e.message, e.doc),
  );
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return shape;
  /** @type {any} */
  const m = manifest;
  const issues = [...shape];

  const size = Buffer.byteLength(JSON.stringify(m));
  if (size > MAX_MANIFEST_BYTES) {
    issues.push(issue('manifest-size', 'manifest', `is ${size} bytes; the SDK refuses manifests over ${MAX_MANIFEST_BYTES}`));
  }

  const names = resourceNames(m);
  for (const name of names) {
    if (typeof name === 'string' && !RESOURCES.includes(name)) {
      issues.push(issue('resource-unknown', 'manifest.resources', `"${name}" is not a standard resource (${RESOURCES.join(', ')})`));
    }
  }

  const catalogs = Array.isArray(m.catalogs) ? m.catalogs.filter((c) => c && typeof c === 'object') : [];
  if (names.includes('catalog') && catalogs.length === 0) {
    issues.push(issue('catalog-resource-mismatch', 'manifest.catalogs', '"catalog" is a declared resource but manifest.catalogs is empty'));
  }
  if (!names.includes('catalog') && catalogs.length > 0) {
    issues.push(issue('catalog-resource-mismatch', 'manifest.resources', 'manifest.catalogs is not empty but "catalog" is not in manifest.resources'));
  }
  for (const key of duplicates(catalogs, (c) => `${c.type}/${c.id}`)) {
    issues.push(issue('catalog-duplicate', 'manifest.catalogs', `catalog ${key} is declared more than once`));
  }
  const types = Array.isArray(m.types) ? m.types : [];
  catalogs.forEach((c, i) => {
    const where = `manifest.catalogs[${i}]`;
    if (typeof c.type === 'string' && !types.includes(c.type)) {
      issues.push(issue('catalog-type-undeclared', `${where}.type`, `"${c.type}" is not in manifest.types`));
    }
    issues.push(...checkCatalogExtra(c, where));
  });

  if (names.includes('addon_catalog') && !(Array.isArray(m.addonCatalogs) && m.addonCatalogs.length)) {
    issues.push(issue('addon-catalogs-missing', 'manifest.addonCatalogs', '"addon_catalog" is declared but manifest.addonCatalogs is empty'));
  }

  for (const name of ['meta', 'stream', 'subtitles']) {
    const scope = resourceScope(m, name);
    if (scope && !scope.idPrefixes) {
      issues.push(issue('id-prefixes-missing', 'manifest.idPrefixes', `"${name}" has no idPrefixes, so Stremio will call it for every item of its types`));
    }
  }
  const allPrefixes = ['meta', 'stream', 'subtitles'].flatMap((n) => (resourceScope(m, n) || {}).idPrefixes || []);
  const custom = [...new Set(allPrefixes.filter((p) => typeof p === 'string' && !p.startsWith('tt')))];
  if (custom.length && !names.includes('meta')) {
    issues.push(issue('custom-ids-without-meta', 'manifest.resources', `custom id prefix(es) ${custom.join(', ')} but no "meta" resource: only IMDb ids get metadata from Cinemeta`));
  }

  const config = Array.isArray(m.config) ? m.config.filter((c) => c && typeof c === 'object') : [];
  for (const key of duplicates(config, (c) => c.key)) {
    issues.push(issue('config-duplicate-key', 'manifest.config', `key "${key}" is declared more than once`));
  }
  config.forEach((c, i) => {
    if (c.type === 'select' && !(Array.isArray(c.options) && c.options.length)) {
      issues.push(issue('config-select-options', `manifest.config[${i}]`, `"${c.key}" is a select without options`));
    }
  });
  const hints = m.behaviorHints && typeof m.behaviorHints === 'object' ? m.behaviorHints : {};
  if (config.length && hints.configurable !== true) {
    issues.push(issue('config-not-configurable', 'manifest.behaviorHints.configurable', 'manifest.config is set but behaviorHints.configurable is not true, so Stremio shows no Configure button'));
  }
  if (hints.configurationRequired === true && !config.length) {
    issues.push(issue('configuration-required-without-config', 'manifest.behaviorHints.configurationRequired', 'configurationRequired is true but there is no manifest.config; you need your own /configure page'));
  }

  issues.push(...checkImage(m.logo, 'manifest.logo', DOCS.manifestOther), ...checkImage(m.background, 'manifest.background', DOCS.manifestOther));
  return issues;
}

module.exports = { checkManifest, checkImage, resourceNames, resourceScope };
