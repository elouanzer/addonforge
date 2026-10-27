#!/usr/bin/env node
'use strict';

/**
 * Single entry point for every Addon Forge tool: `node tools/forge.js <command>`.
 *
 * Each command lives in its own file next to this one and exports
 * `run(args: string[]): Promise<number>`, resolving to an exit code from lib/exit-codes.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EXIT } = require('./lib/exit-codes');
const { version } = require('../package.json');

/**
 * @typedef {object} CommandSpec
 * @property {string} usage   Arguments shown in the help text.
 * @property {string} summary One-line description.
 * @property {string} file    Implementation file, relative to tools/.
 */

/** @type {Record<string, CommandSpec>} */
const COMMANDS = {
  doctor: {
    usage: 'doctor',
    summary: 'Check Node, npm, Docker, Docker Compose and optional tunnel tools',
    file: 'doctor.js',
  },
  new: {
    usage: 'new <name> [--template node-sdk] [--from addon.forge.json] [--force]',
    summary: 'Create addons/<name>/ from a template',
    file: 'new.js',
  },
  validate: {
    usage: 'validate <path-or-url> [--static] [--search <text>]',
    summary: 'Check the manifest and live responses against the Stremio add-on protocol',
    file: 'validate.js',
  },
  smoke: {
    usage: 'smoke <url> [--samples N] [--search <text>] [--config <json>]',
    summary: 'Call every declared endpoint and report status, latency and item count',
    file: 'smoke.js',
  },
  'install-link': {
    usage: 'install-link <url> [--config <json>]',
    summary: 'Print the install links (and a QR code) for a running add-on',
    file: 'install-link.js',
  },
  expose: {
    usage: 'expose <port>',
    summary: 'Make a local add-on reachable over HTTPS through a tunnel',
    file: 'expose.js',
  },
  list: {
    usage: 'list',
    summary: 'List the examples and your own add-ons, with their status',
    file: 'list.js',
  },
};

/**
 * Build the help text.
 * @returns {string}
 */
function helpText() {
  const lines = Object.values(COMMANDS).map((c) => `  ${c.usage}\n      ${c.summary}`);
  return [
    `Addon Forge ${version}`,
    '',
    'Usage: node tools/forge.js <command> [options]',
    '',
    'Commands:',
    ...lines,
    '',
    'Every command accepts --json for machine-readable output.',
    'Exit codes: 0 success, 1 validation/test failure, 2 usage or environment error.',
  ].join('\n');
}

/**
 * Dispatch to a command.
 * @param {string[]} argv Arguments after `forge.js`.
 * @param {{ toolsDir?: string }} [options] Overrides, used by tests.
 * @returns {Promise<number>} Exit code.
 */
async function main(argv, { toolsDir = __dirname } = {}) {
  const [name, ...args] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    console.log(helpText());
    return EXIT.OK;
  }
  if (name === '--version' || name === '-v') {
    console.log(version);
    return EXIT.OK;
  }

  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!spec) {
    console.error(`Unknown command: ${name}\nRun "node tools/forge.js --help" to see the available commands.`);
    return EXIT.USAGE;
  }

  const file = path.join(toolsDir, spec.file);
  if (!fs.existsSync(file)) {
    console.error(`"${name}" is not implemented yet.`);
    return EXIT.USAGE;
  }

  return require(file).run(args);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err && err.stack ? err.stack : err);
      process.exitCode = EXIT.USAGE;
    },
  );
}

module.exports = { main, COMMANDS };
