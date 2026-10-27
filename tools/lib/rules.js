'use strict';

/**
 * Every rule `forge validate` can report, with its severity and the upstream doc it cites.
 * Errors fail validation (exit 1); warnings are reported but do not fail.
 */

const DOCS = require('./schemas/docs');

/**
 * @typedef {object} Rule
 * @property {'error'|'warning'} severity
 * @property {string} doc     Upstream documentation link.
 * @property {string} summary What the rule checks.
 */

/** @type {Record<string, Rule>} */
const RULES = {
  // Manifest (static and live)
  'manifest-shape': { severity: 'error', doc: DOCS.manifest, summary: 'Manifest fields are present and correctly typed' },
  'manifest-size': { severity: 'error', doc: DOCS.sdkBuilder, summary: 'Manifest is at most 8 KB (SDK limit)' },
  'resource-unknown': { severity: 'warning', doc: DOCS.resources, summary: 'Resources are ones Stremio knows' },
  'catalog-resource-mismatch': { severity: 'error', doc: DOCS.manifestCatalogs, summary: '"catalog" resource and catalogs list agree' },
  'catalog-duplicate': { severity: 'error', doc: DOCS.manifestCatalogs, summary: 'Each catalog type + id pair is unique' },
  'catalog-type-undeclared': { severity: 'warning', doc: DOCS.manifestFiltering, summary: 'Catalog types are listed in manifest.types' },
  'extra-duplicate': { severity: 'error', doc: DOCS.manifestExtra, summary: 'Catalog extra names are unique' },
  'extra-inconsistent': { severity: 'error', doc: DOCS.manifestExtra, summary: 'extra / extraSupported / extraRequired / isRequired agree' },
  'addon-catalogs-missing': { severity: 'error', doc: DOCS.manifestAddonCatalogs, summary: 'addon_catalog resource has addonCatalogs' },
  'id-prefixes-missing': { severity: 'warning', doc: DOCS.manifestFiltering, summary: 'meta/stream/subtitles declare idPrefixes' },
  'custom-ids-without-meta': { severity: 'warning', doc: DOCS.resources, summary: 'Custom id prefixes come with a meta resource' },
  'config-duplicate-key': { severity: 'error', doc: DOCS.manifestConfig, summary: 'Config keys are unique' },
  'config-select-options': { severity: 'error', doc: DOCS.manifestConfig, summary: 'select config fields have options' },
  'config-not-configurable': { severity: 'error', doc: DOCS.manifestUserData, summary: 'config is paired with behaviorHints.configurable' },
  'configuration-required-without-config': { severity: 'warning', doc: DOCS.manifestUserData, summary: 'configurationRequired comes with a config' },
  'relative-image-url': { severity: 'error', doc: DOCS.metaPreview, summary: 'Image URLs are absolute' },
  'insecure-image': { severity: 'warning', doc: DOCS.metaPreview, summary: 'Images are served over HTTPS' },
  'forge-config': { severity: 'error', doc: 'tools/lib/schemas/forge.schema.json', summary: 'addon.forge.json matches its schema' },

  // Live responses
  'manifest-unreachable': { severity: 'error', doc: DOCS.transports, summary: 'GET /manifest.json answers 200' },
  'manifest-not-json': { severity: 'error', doc: DOCS.protocol, summary: 'The manifest is JSON' },
  'content-type': { severity: 'warning', doc: DOCS.protocol, summary: 'Responses are served as application/json' },
  'cors-missing': { severity: 'error', doc: DOCS.protocol, summary: 'Every route sends CORS headers allowing all origins' },
  'endpoint-failed': { severity: 'error', doc: DOCS.resources, summary: 'Declared resources answer 200 with JSON' },
  'response-shape': { severity: 'error', doc: DOCS.resources, summary: 'Responses have the fields the protocol requires' },
  'poster-missing': { severity: 'warning', doc: DOCS.metaPreview, summary: 'Meta previews have a poster' },
  'meta-not-found': { severity: 'error', doc: DOCS.meta, summary: 'meta answers for ids from the add-on’s own catalogs' },
  'stream-source': { severity: 'error', doc: DOCS.stream, summary: 'Each stream has exactly one source field' },
  'cache-headers': { severity: 'warning', doc: DOCS.catalogHandler, summary: 'Resource responses set Cache-Control' },
  'slow-response': { severity: 'warning', doc: DOCS.resources, summary: 'Responses take under 3 s' },
  'insecure-url': { severity: 'warning', doc: DOCS.deploying, summary: 'The add-on is served over HTTPS (except on 127.0.0.1)' },
  'not-configured': { severity: 'warning', doc: DOCS.manifestUserData, summary: 'Configurable add-ons are tested with --config' },
  'not-tested': { severity: 'warning', doc: DOCS.resources, summary: 'Every declared resource could be exercised' },
};

/**
 * @typedef {object} Issue
 * @property {string} rule
 * @property {'error'|'warning'} severity
 * @property {string} where   What the issue is about, e.g. "manifest.catalogs[0].name" or "GET /catalog/movie/top.json".
 * @property {string} message
 * @property {string} doc
 */

/**
 * Build an issue for a rule.
 * @param {string} rule
 * @param {string} where
 * @param {string} message
 * @param {string} [doc] Overrides the rule's default link.
 * @returns {Issue}
 */
function issue(rule, where, message, doc) {
  const def = RULES[rule];
  if (!def) throw new Error(`unknown rule ${rule}`);
  return { rule, severity: def.severity, where, message, doc: doc || def.doc };
}

module.exports = { RULES, issue };
