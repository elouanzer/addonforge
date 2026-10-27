'use strict';

/**
 * Add-on URL helpers shared by validate, smoke and install-link.
 */

/**
 * Normalise what the user typed into the add-on's base URL (no trailing slash,
 * no /manifest.json). Accepts "http://127.0.0.1:7100", ".../", ".../manifest.json".
 * @param {string} input
 * @returns {URL} Base URL.
 * @throws {Error} If it is not an http(s) URL.
 */
function baseUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`"${input}" is not a URL (expected something like http://127.0.0.1:7100)`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`"${input}" must start with http:// or https://`);
  }
  url.pathname = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

/**
 * Stremio only accepts plain HTTP from 127.0.0.1; everything else needs HTTPS.
 * @param {URL} url
 */
function isAllowedInsecure(url) {
  return url.protocol === 'https:' || url.hostname === '127.0.0.1';
}

/**
 * Path segment carrying user configuration, as built by the SDK's /configure page:
 * "/" + encodeURIComponent(JSON.stringify(config)).
 * @param {object|undefined} config
 */
function configSegment(config) {
  return config ? `/${encodeURIComponent(JSON.stringify(config))}` : '';
}

/**
 * URL of a resource request: {base}{config}/{resource}/{type}/{id}[/{extra}].json
 * See https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
 * @param {URL} base
 * @param {{ resource: string, type: string, id: string, extra?: Record<string, string>, config?: object }} req
 * @returns {string}
 */
function resourceUrl(base, { resource, type, id, extra, config }) {
  const extraPart = extra && Object.keys(extra).length ? `/${new URLSearchParams(extra).toString().replace(/\+/g, '%20')}` : '';
  const path = `${configSegment(config)}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extraPart}.json`;
  return `${base.href.replace(/\/$/, '')}${path}`;
}

/**
 * @param {URL} base
 * @param {object} [config]
 */
function manifestUrl(base, config) {
  return `${base.href.replace(/\/$/, '')}${configSegment(config)}/manifest.json`;
}

/**
 * Parse --config JSON.
 * @param {string|undefined} text
 * @returns {object|undefined}
 * @throws {Error} When it is not a JSON object.
 */
function parseConfig(text) {
  if (text === undefined) return undefined;
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`--config is not valid JSON: ${err.message}`, { cause: err });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('--config must be a JSON object, e.g. \'{"username":"me"}\'');
  return value;
}

module.exports = { baseUrl, isAllowedInsecure, configSegment, resourceUrl, manifestUrl, parseConfig };
