'use strict';

/**
 * forge new <name> [--template node-sdk] [--from addon.forge.json] [--force] [--json]
 *
 * Creates addons/<name>/ from a template and fills it from addon.forge.json:
 * - with --from, from that file;
 * - else from addons/<name>/addon.forge.json if the interview already wrote it;
 * - else from a minimal default (a movie catalog).
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { EXIT } = require('./lib/exit-codes');
const { report, reportError } = require('./lib/output');
const {
  FORGE_FILE,
  DEFAULT_PORT,
  isValidName,
  validateForgeConfig,
  readForgeConfig,
  defaultForgeConfig,
  manifestFromForge,
  titleCase,
} = require('./lib/forge-config');
const { formatErrors } = require('./lib/json-schema');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_BLOCK = /(\/\/ forge:manifest:start[^\n]*\n)[\s\S]*?(\n\/\/ forge:manifest:end)/;

/** Files and folders never copied from a template. */
const SKIP = new Set(['node_modules', '.env']);

/**
 * @param {string[]} args
 * @param {{ rootDir?: string }} [options] Overrides, used by tests.
 * @returns {Promise<number>}
 */
async function run(args, { rootDir = ROOT } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        template: { type: 'string' },
        from: { type: 'string' },
        force: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    });
  } catch (err) {
    reportError(args.includes('--json'), err.message);
    return EXIT.USAGE;
  }
  const { values, positionals } = parsed;
  const json = values.json;
  const fail = (message, code = EXIT.USAGE) => {
    reportError(json, message);
    return code;
  };

  if (positionals.length > 1) return fail('expected a single add-on name.');
  let name = positionals[0];

  // 1. Find the configuration.
  let forge;
  let configSource;
  const interviewFile = name && path.join(rootDir, 'addons', name, FORGE_FILE);
  try {
    if (values.from) {
      forge = readForgeConfig(path.resolve(values.from));
      configSource = values.from;
    } else if (interviewFile && isValidName(name) && fs.existsSync(interviewFile)) {
      forge = readForgeConfig(interviewFile);
      configSource = path.relative(rootDir, interviewFile);
    }
  } catch (err) {
    return fail(err.message);
  }

  if (!name && forge && typeof forge.name === 'string') name = forge.name;
  if (!name) return fail('missing add-on name. Usage: node tools/forge.js new <name>');
  if (!isValidName(name)) {
    return fail(`invalid name "${name}": use lowercase letters, digits and dashes (kebab-case), e.g. "my-addon".`);
  }
  if (values.template && !fs.existsSync(path.join(rootDir, 'templates', values.template))) {
    return fail(`template "${values.template}" not found in templates/.`);
  }
  if (!forge) {
    forge = defaultForgeConfig(name);
    if (values.template) forge.template = values.template;
    configSource = 'defaults';
  }
  if (forge.name !== name) {
    return fail(`the name "${name}" does not match "name": "${forge.name}" in ${configSource}.`);
  }
  if (values.template) {
    if (forge.template && forge.template !== values.template) {
      return fail(`--template ${values.template} does not match "template": "${forge.template}" in ${configSource}.`);
    }
    forge.template = values.template;
  }
  delete forge.$schema;

  const errors = validateForgeConfig(forge);
  if (errors.length) {
    if (json) report(true, { ok: false, configSource, errors }, () => '');
    else console.error(`${configSource} is not valid:\n${formatErrors(errors)}`);
    return EXIT.FAILURE;
  }

  // 2. Check the template and the target folder.
  const templateDir = path.join(rootDir, 'templates', forge.template);
  if (!fs.existsSync(templateDir)) return fail(`template "${forge.template}" not found in templates/.`);

  const target = path.join(rootDir, 'addons', name);
  if (fs.existsSync(target)) {
    const existing = fs.readdirSync(target).filter((f) => f !== FORGE_FILE);
    if (existing.length && !values.force) {
      return fail(`addons/${name}/ already exists. Use --force to overwrite its template files (your .env is never touched).`);
    }
  }

  // 3. Copy and fill.
  const manifest = manifestFromForge(forge);
  copyTemplate(templateDir, target);
  fillAddon(target, forge, manifest);

  const port = forge.port || DEFAULT_PORT;
  const rel = path.relative(rootDir, target).split(path.sep).join('/');
  // Search-only catalogs need a real query: "test" usually finds nothing.
  const search = (forge.catalogFeatures || []).includes('searchOnly') ? ' --search "<a query that has results>"' : '';
  const nextSteps = [
    `cd ${rel}`,
    'npm install',
    'npm test',
    'docker compose up -d --build --wait',
    `node ../../tools/forge.js validate http://127.0.0.1:${port}${search}`,
    `node ../../tools/forge.js smoke http://127.0.0.1:${port}${search}`,
  ];
  report(json, { ok: true, name, path: rel, configSource, manifest, nextSteps }, () =>
    [
      `Created ${rel}/ from template "${forge.template}" (config: ${configSource}).`,
      `  id:        ${manifest.id}`,
      `  resources: ${forge.resources.join(', ')}`,
      `  types:     ${forge.types.join(', ')}`,
      '',
      'Next steps:',
      ...nextSteps.map((s) => `  ${s}`),
    ].join('\n'),
  );
  return EXIT.OK;
}

/**
 * Recursively copy a template, skipping node_modules and .env.
 * @param {string} from
 * @param {string} to
 */
function copyTemplate(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTemplate(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/**
 * Rewrite the copied template's files for this add-on.
 * @param {string} dir
 * @param {import('./lib/forge-config').ForgeConfig} forge
 * @param {object} manifest
 */
function fillAddon(dir, forge, manifest) {
  const port = forge.port || DEFAULT_PORT;
  const edit = (file, fn) => {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) fs.writeFileSync(full, fn(fs.readFileSync(full, 'utf8')));
  };
  const editJson = (file, fn) =>
    edit(file, (text) => {
      const data = JSON.parse(text);
      fn(data);
      return `${JSON.stringify(data, null, 2)}\n`;
    });

  fs.writeFileSync(
    path.join(dir, FORGE_FILE),
    `${JSON.stringify({ $schema: '../../tools/lib/schemas/forge.schema.json', ...forge }, null, 2)}\n`,
  );

  editJson('package.json', (pkg) => {
    pkg.name = forge.name;
    pkg.description = forge.description;
  });
  editJson('package-lock.json', (lock) => {
    lock.name = forge.name;
    if (lock.packages && lock.packages['']) lock.packages[''].name = forge.name;
  });

  edit('src/manifest.js', (text) => {
    if (!MANIFEST_BLOCK.test(text)) throw new Error('src/manifest.js: forge:manifest markers not found');
    return text.replace(MANIFEST_BLOCK, (_, start, end) => `${start}const MANIFEST = ${JSON.stringify(manifest, null, 2)};${end}`);
  });

  // The template uses DEFAULT_PORT everywhere (host and container); swap in this add-on's port.
  const portPattern = new RegExp(`\\b${DEFAULT_PORT}\\b`, 'g');
  for (const file of ['docker-compose.yml', 'Dockerfile', 'src/server.js']) {
    edit(file, (text) => text.replace(portPattern, String(port)));
  }

  edit('.env.example', (text) => {
    const keys = (forge.sources || [])
      .filter((s) => s.needsKey)
      .map((s) => `${s.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY=`);
    return text.replace(/^HOST_PORT=.*$/m, `HOST_PORT=${port}`) + keys.map((k) => `${k}\n`).join('');
  });

  edit('README.md', (text) => fillReadme(text, forge, manifest, port));
}

/**
 * @param {string} text
 * @param {import('./lib/forge-config').ForgeConfig} forge
 * @param {any} manifest
 * @param {number} port
 */
function fillReadme(text, forge, manifest, port) {
  const sources = (forge.sources || []).map((s) => (s.terms ? `${s.name} ([terms](${s.terms}))` : s.name));
  const config = (forge.userConfig || []).map(
    (c) => `- \`${c.key}\` (${c.type}${c.required ? ', required' : ''})${c.title ? `: ${c.title}` : ''}`,
  );
  const values = {
    displayName: manifest.name || titleCase(forge.name),
    description: forge.description,
    resources: forge.resources.join(', '),
    types: forge.types.join(', '),
    sources: sources.length ? sources.join(', ') : '_to be filled in_',
    configuration: config.length
      ? `Each user enters these values on the add-on's \`/configure\` page:\n\n${config.join('\n')}`
      : 'No user configuration.',
    port: String(port),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => (Object.hasOwn(values, key) ? values[key] : match));
}

module.exports = { run };
