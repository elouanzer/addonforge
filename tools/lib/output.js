'use strict';

/**
 * Shared output helpers: every command prints a short human report, or JSON with --json.
 */

/**
 * Print a command's result.
 * @param {boolean} json   Print machine-readable JSON instead of text.
 * @param {object} result  Serialisable result object.
 * @param {() => string} human Builds the human-readable report.
 */
function report(json, result, human) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(human());
}

/**
 * Print a usage/environment error (exit code 2), as text or JSON.
 * @param {boolean} json
 * @param {string} message
 */
function reportError(json, message) {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`Error: ${message}`);
}

module.exports = { report, reportError };
