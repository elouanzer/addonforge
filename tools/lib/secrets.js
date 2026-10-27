'use strict';

/**
 * Heuristics for "this looks like a real secret", used to keep API keys out of
 * examples/. False positives are fine: rename or move the value.
 */

/** @type {{ name: string, pattern: RegExp }[]} */
const SECRET_PATTERNS = [
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'OpenAI / Anthropic style key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'secret-looking assignment',
    pattern: /\b(?:api[_-]?key|apikey|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?(?=[A-Za-z0-9_\-/+]*\d)(?=[A-Za-z0-9_\-/+]*[A-Za-z])[A-Za-z0-9_\-/+]{16,}/i,
  },
];

/**
 * Find secret-looking strings in a text.
 * @param {string} text
 * @returns {{ name: string, line: number }[]}
 */
function findSecrets(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(line)) found.push({ name, line: i + 1 });
    }
  });
  return found;
}

module.exports = { findSecrets, SECRET_PATTERNS };
