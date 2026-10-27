'use strict';

/**
 * forge validate <path-or-url> [--static] [--search <text>] [--config <json>] [--json]
 *
 * Checks an add-on against the Stremio add-on protocol and reports each problem
 * with the rule it breaks and a link to the upstream doc.
 * - A URL is tested live: manifest, CORS, then every declared resource.
 * - A path (add-on folder, manifest.json, addon.forge.json) is checked statically.
 * - --static with a URL only fetches and checks the manifest.
 * - --search sets the text sent to required search extras (default "test").
 * Exit codes: 0 no errors (warnings allowed), 1 errors found, 2 usage error.
 */

const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { report, reportError } = require('./lib/output');
const { checkManifest } = require('./lib/check-manifest');
const { checkLive } = require('./lib/check-live');
const { loadManifest } = require('./lib/load-manifest');
const { parseConfig, baseUrl } = require('./lib/addon-url');
const { validateForgeConfig } = require('./lib/forge-config');
const { issue } = require('./lib/rules');

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
        static: { type: 'boolean', default: false },
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
    reportError(json, 'expected one add-on URL or path. Usage: node tools/forge.js validate <path-or-url> [--static] [--search <text>]');
    return EXIT.USAGE;
  }
  if (values.search !== undefined && !values.search.trim()) {
    reportError(json, '--search needs some text, e.g. --search "70s thriller"');
    return EXIT.USAGE;
  }
  const target = positionals[0];
  const isUrl = /^https?:\/\//i.test(target);

  let result;
  try {
    const config = parseConfig(values.config);
    result = isUrl ? await validateUrl(target, { config, search: values.search, manifestOnly: values.static }) : validatePath(target);
  } catch (err) {
    reportError(json, err.message);
    return EXIT.USAGE;
  }

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const ok = errors.length === 0;
  report(json, { ok, target: result.target, mode: result.mode, source: result.source, requests: result.requests, errors, warnings }, () =>
    formatReport(result, errors, warnings, ok),
  );
  return ok ? EXIT.OK : EXIT.FAILURE;
}

/**
 * @param {string} url
 * @param {{ config?: object, search?: string, manifestOnly: boolean }} options
 */
async function validateUrl(url, { config, search, manifestOnly }) {
  const base = baseUrl(url);
  const live = await checkLive(url, { config, search, manifestOnly });
  return {
    target: `${base.href.replace(/\/$/, '')}/manifest.json`,
    mode: manifestOnly ? 'static (manifest only)' : 'live',
    source: undefined,
    requests: live.requests,
    issues: live.issues,
  };
}

/**
 * @param {string} target
 */
function validatePath(target) {
  const loaded = loadManifest(target);
  const issues = checkManifest(loaded.manifest);
  if (loaded.forge !== undefined) {
    const forge = { ...(/** @type {any} */ (loaded.forge)) };
    delete forge.$schema;
    for (const e of validateForgeConfig(forge)) {
      issues.push(issue('forge-config', `addon.forge.json ${e.path || '(root)'}`, e.message));
    }
  }
  return { target, mode: 'static', source: loaded.source, requests: [], issues };
}

/**
 * @param {any} result
 * @param {import('./lib/rules').Issue[]} errors
 * @param {import('./lib/rules').Issue[]} warnings
 * @param {boolean} ok
 */
function formatReport(result, errors, warnings, ok) {
  const lines = [`Validating ${result.target} (${result.mode})`];
  if (result.source) lines.push(`Manifest from ${result.source}`);

  if (result.requests.length) {
    lines.push('', 'Requests:');
    for (const r of result.requests) {
      const status = r.status ? String(r.status) : 'ERR';
      const items = r.items !== undefined ? `  ${r.items} item(s)` : '';
      lines.push(`  ${status.padEnd(4)} ${`${r.ms} ms`.padStart(8)}  ${r.path}${items}${r.error ? `  (${r.error})` : ''}`);
    }
  }

  const section = (title, list, mark) => {
    if (!list.length) return;
    lines.push('', `${title} (${list.length}):`);
    for (const i of list) {
      lines.push(`  ${mark} [${i.rule}] ${i.where}: ${i.message}`, `      ${i.doc}`);
    }
  };
  section('Errors', errors, '✖');
  section('Warnings', warnings, '!');

  const counts = `${errors.length} error(s), ${warnings.length} warning(s)`;
  lines.push('', ok ? `PASS: ${counts}` : `FAIL: ${counts}`);
  if (result.mode === 'static' && ok) {
    lines.push('Static checks only. Run the add-on and validate its URL to test the responses.');
  }
  return lines.join('\n');
}

module.exports = { run };
