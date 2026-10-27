'use strict';

/**
 * forge install-link <url> [--config <json>] [--no-qr] [--json]
 *
 * Prints the manifest URL and the stremio:// deep link that installs the add-on
 * (https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md),
 * plus a terminal QR code of the deep link for phones and TVs.
 */

const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { report, reportError } = require('./lib/output');
const { getJson } = require('./lib/http');
const { baseUrl, isAllowedInsecure, manifestUrl, parseConfig } = require('./lib/addon-url');
const { renderQr } = require('./lib/qr');

/**
 * Deep link: the manifest URL with its scheme replaced by stremio://.
 * @param {string} url
 */
function deepLink(url) {
  return url.replace(/^https?:\/\//, 'stremio://');
}

/**
 * Build the links and notes for an add-on URL.
 * @param {string} input
 * @param {{ config?: object, check?: boolean, timeoutMs?: number }} [options]
 */
async function installLinks(input, { config, check = true, timeoutMs = 5000 } = {}) {
  const base = baseUrl(input);
  const manifest = manifestUrl(base, config);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  /** @type {string[]} */
  const notes = [];

  if (!isAllowedInsecure(base)) {
    notes.push('Stremio only installs HTTPS add-ons (or http://127.0.0.1). Use `node tools/forge.js expose <port>` to get an HTTPS URL; see docs/hosting.md.');
  }
  if (local) notes.push('This URL only works on this computer. For a phone or TV, expose the add-on over HTTPS first (docs/hosting.md).');
  if (config) notes.push('The link contains your configuration: do not share it if that includes secrets such as API keys.');

  let configure;
  if (check) {
    const res = await getJson(manifestUrl(base), { timeoutMs });
    if (res.status !== 200 || !res.json) {
      notes.push(`The add-on is not answering right now (${res.error || `HTTP ${res.status}`}). Start it before installing.`);
    } else if (Array.isArray(res.json.config) && res.json.config.length && !config) {
      configure = `${base.href.replace(/\/$/, '')}/configure`;
      const hints = res.json.behaviorHints || {};
      notes.push(
        hints.configurationRequired
          ? `This add-on needs configuration: open ${configure} to fill it in and install, or pass --config '<json>'.`
          : `Optional settings: ${configure}`,
      );
    }
  }

  return { manifestUrl: manifest, deepLink: deepLink(manifest), configureUrl: configure, local, notes };
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
        config: { type: 'string' },
        'no-qr': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    reportError(args.includes('--json'), err.message);
    return EXIT.USAGE;
  }
  const json = values.json;
  if (positionals.length !== 1) {
    reportError(json, 'expected one add-on URL. Usage: node tools/forge.js install-link <url> [--config <json>]');
    return EXIT.USAGE;
  }

  let links;
  try {
    links = await installLinks(positionals[0], { config: parseConfig(values.config) });
  } catch (err) {
    reportError(json, err.message);
    return EXIT.USAGE;
  }

  const showQr = !values['no-qr'] && !links.local;
  report(json, { ok: true, ...links }, () => {
    const lines = [
      'Install in Stremio',
      '',
      `  Manifest URL:  ${links.manifestUrl}`,
      `  Deep link:     ${links.deepLink}`,
      '',
      'Open the deep link on a device with Stremio, or paste the manifest URL in',
      'Stremio > Add-ons > search bar.',
    ];
    if (showQr) lines.push('', 'Scan with a phone that has Stremio:', '', renderQr(links.deepLink));
    if (links.notes.length) lines.push('', ...links.notes.map((n) => `Note: ${n}`));
    return lines.join('\n');
  });
  return EXIT.OK;
}

module.exports = { run, installLinks, deepLink };
