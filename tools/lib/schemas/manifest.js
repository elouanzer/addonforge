'use strict';

/**
 * Shape of a Stremio add-on manifest, in the JSON Schema subset of ../json-schema.js.
 * Each part carries `doc`, the upstream section it comes from.
 * Cross-field rules (consistency between parts) live in ../../validate.js.
 */

const DOCS = require('./docs');

/** Known resources (https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/README.md). */
const RESOURCES = ['catalog', 'meta', 'stream', 'subtitles', 'addon_catalog'];

/** Accepted manifest.config types. */
const CONFIG_TYPES = ['text', 'number', 'password', 'checkbox', 'select'];

/** semver.org's recommended pattern. */
const SEMVER =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$';

const nonEmptyString = { type: 'string', minLength: 1 };
const stringArray = { type: 'array', items: nonEmptyString };

const extra = {
  doc: DOCS.manifestExtra,
  type: 'object',
  required: ['name'],
  properties: {
    name: nonEmptyString,
    isRequired: { type: 'boolean' },
    options: { type: 'array', items: { type: 'string' } },
    optionsLimit: { type: 'integer', minimum: 1 },
  },
};

const catalog = {
  doc: DOCS.manifestCatalogs,
  type: 'object',
  required: ['type', 'id', 'name'],
  properties: {
    type: nonEmptyString,
    id: nonEmptyString,
    name: nonEmptyString,
    extra: { type: 'array', items: extra },
    // Legacy "short" notation, still accepted by Stremio.
    extraSupported: { type: 'array', items: { type: 'string' } },
    extraRequired: { type: 'array', items: { type: 'string' } },
  },
};

const resource = {
  doc: DOCS.manifestFiltering,
  anyOf: [
    { type: 'string', minLength: 1 },
    {
      type: 'object',
      required: ['name', 'types'],
      properties: { name: nonEmptyString, types: { type: 'array', minItems: 1, items: nonEmptyString }, idPrefixes: stringArray },
    },
  ],
  anyOfMessage: 'must be a resource name, or an object { name, types, idPrefixes? }',
};

const configItem = {
  doc: DOCS.manifestConfig,
  type: 'object',
  required: ['key', 'type'],
  properties: {
    key: nonEmptyString,
    type: { type: 'string', enum: CONFIG_TYPES },
    default: { type: 'string' },
    title: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    required: { type: 'boolean' },
  },
};

const manifest = {
  doc: DOCS.manifest,
  type: 'object',
  required: ['id', 'version', 'name', 'description', 'resources', 'types', 'catalogs'],
  properties: {
    id: { doc: DOCS.manifestBasic, type: 'string', pattern: '^[^.\\s/]+(\\.[^.\\s/]+)+$' },
    version: { doc: DOCS.manifestBasic, type: 'string', pattern: SEMVER },
    name: { doc: DOCS.manifestBasic, ...nonEmptyString },
    description: { doc: DOCS.manifestBasic, ...nonEmptyString },
    resources: { doc: DOCS.manifestFiltering, type: 'array', minItems: 1, items: resource },
    types: { doc: DOCS.manifestFiltering, type: 'array', minItems: 1, uniqueItems: true, items: nonEmptyString },
    idPrefixes: { doc: DOCS.manifestFiltering, type: 'array', minItems: 1, items: nonEmptyString },
    catalogs: { doc: DOCS.manifestCatalogs, type: 'array', items: catalog },
    addonCatalogs: {
      doc: DOCS.manifestAddonCatalogs,
      type: 'array',
      items: { type: 'object', required: ['type', 'id', 'name'], properties: { type: nonEmptyString, id: nonEmptyString, name: nonEmptyString } },
    },
    config: { doc: DOCS.manifestUserData, type: 'array', items: configItem },
    behaviorHints: {
      doc: DOCS.manifestOther,
      type: 'object',
      properties: {
        adult: { type: 'boolean' },
        p2p: { type: 'boolean' },
        configurable: { type: 'boolean' },
        configurationRequired: { type: 'boolean' },
        epgProvider: { type: 'boolean' },
      },
    },
    background: { doc: DOCS.manifestOther, type: 'string' },
    logo: { doc: DOCS.manifestOther, type: 'string' },
    contactEmail: { doc: DOCS.manifestOther, type: 'string' },
  },
};

module.exports = { manifest, RESOURCES, CONFIG_TYPES };
