'use strict';

/**
 * Reading, validating and interpreting addon.forge.json, the record of the interview.
 */

const fs = require('node:fs');
const schema = require('./schemas/forge.schema.json');
const { validate } = require('./json-schema');

const FORGE_FILE = 'addon.forge.json';
const DEFAULT_PORT = 7100;
const NAME_PATTERN = new RegExp(schema.properties.name.pattern);

/**
 * @typedef {object} ForgeConfig
 * @property {string} name
 * @property {string} [displayName]
 * @property {string} [id]
 * @property {string} description
 * @property {string} template
 * @property {string[]} resources
 * @property {string[]} types
 * @property {'imdb'|'custom'} idScheme
 * @property {string} [idPrefix]
 * @property {{name: string, needsKey?: boolean, rateLimit?: string, terms?: string}[]} [sources]
 * @property {('search'|'searchOnly'|'genre'|'pagination')[]} [catalogFeatures]
 * @property {string[]} [genres]
 * @property {{key: string, type: string, title?: string, required?: boolean, default?: string, options?: string[]}[]} [userConfig]
 * @property {'localhost'|'lan'|'internet'} [hosting]
 * @property {number} [port]
 * @property {boolean} [contentPolicyAcknowledged]
 */

/**
 * @param {string} name
 * @returns {boolean}
 */
function isValidName(name) {
  return typeof name === 'string' && name.length <= schema.properties.name.maxLength && NAME_PATTERN.test(name);
}

/**
 * Validate a parsed addon.forge.json.
 * @param {unknown} config
 * @returns {import('./json-schema').SchemaError[]}
 */
function validateForgeConfig(config) {
  return validate(config, schema);
}

/**
 * Read and parse an addon.forge.json file (without validating it).
 * @param {string} file
 * @returns {unknown}
 */
function readForgeConfig(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
  }
}

/**
 * The config `forge new <name>` uses when the user gives none: a minimal movie catalog.
 * @param {string} name
 * @returns {ForgeConfig}
 */
function defaultForgeConfig(name) {
  return {
    name,
    description: `${titleCase(name)}, built with Addon Forge`,
    template: 'node-sdk',
    resources: ['catalog'],
    types: ['movie'],
    idScheme: 'imdb',
    sources: [],
    catalogFeatures: [],
    userConfig: [],
    hosting: 'localhost',
    port: DEFAULT_PORT,
    contentPolicyAcknowledged: false,
  };
}

/**
 * "my-cool-addon" -> "My Cool Addon"
 * @param {string} name
 * @returns {string}
 */
function titleCase(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build the Stremio manifest that matches an addon.forge.json.
 * Field meanings: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
 * @param {ForgeConfig} forge
 * @returns {object} Manifest without `version` (the template reads it from package.json).
 */
function manifestFromForge(forge) {
  const displayName = forge.displayName || titleCase(forge.name);
  const features = forge.catalogFeatures || [];

  /** @type {object[]} */
  const extra = [];
  // searchOnly: Stremio only calls the catalog from its search bar, never as a Board row.
  if (features.includes('searchOnly')) extra.push({ name: 'search', isRequired: true });
  else if (features.includes('search')) extra.push({ name: 'search', isRequired: false });
  if (features.includes('genre')) extra.push({ name: 'genre', isRequired: false, options: forge.genres });
  if (features.includes('pagination')) extra.push({ name: 'skip', isRequired: false });

  const catalogs = forge.resources.includes('catalog')
    ? forge.types.map((type) => ({
        type,
        id: forge.types.length > 1 ? `${forge.name}-${type}` : forge.name,
        name: displayName,
        ...(extra.length ? { extra } : {}),
      }))
    : [];

  /** @type {Record<string, unknown>} */
  const manifest = {
    id: forge.id || `community.addonforge.${forge.name}`,
    name: displayName,
    description: forge.description,
    resources: forge.resources,
    types: forge.types,
    catalogs,
  };

  if (forge.resources.includes('addon_catalog')) {
    manifest.addonCatalogs = forge.types.map((type) => ({
      type,
      id: forge.types.length > 1 ? `${forge.name}-addons-${type}` : `${forge.name}-addons`,
      name: displayName,
    }));
  }

  // idPrefixes only matter for meta/stream/subtitles; catalogs are always requested.
  const needsPrefixes = forge.resources.some((r) => ['meta', 'stream', 'subtitles'].includes(r));
  if (needsPrefixes) {
    manifest.idPrefixes = forge.idScheme === 'custom' ? [forge.idPrefix] : ['tt'];
  }

  const userConfig = forge.userConfig || [];
  if (userConfig.length) {
    manifest.config = userConfig.map((c) => ({
      key: c.key,
      type: c.type,
      title: c.title || c.key,
      ...(c.required ? { required: true } : {}),
      ...(c.default !== undefined ? { default: c.default } : {}),
      ...(c.options ? { options: c.options } : {}),
    }));
    manifest.behaviorHints = {
      configurable: true,
      ...(userConfig.some((c) => c.required) ? { configurationRequired: true } : {}),
    };
  }

  return manifest;
}

module.exports = {
  FORGE_FILE,
  DEFAULT_PORT,
  isValidName,
  validateForgeConfig,
  readForgeConfig,
  defaultForgeConfig,
  manifestFromForge,
  titleCase,
};
