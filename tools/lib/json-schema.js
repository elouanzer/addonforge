'use strict';

/**
 * A minimal JSON Schema validator, so the tools need no dependency for it.
 *
 * Supports the subset our schemas use: type, enum, const, required, properties,
 * additionalProperties (boolean), items, minItems, uniqueItems, contains,
 * minLength, maxLength, pattern, minimum, maximum, allOf, anyOf, if/then/else.
 * Unknown keywords are ignored, so keep schemas within this subset.
 *
 * Extra keyword: `doc`, a link to the documentation of that part of the schema.
 * It is inherited by nested schemas and copied onto each error.
 */

/**
 * @typedef {object} SchemaError
 * @property {string} path    Where the problem is, e.g. "resources[2]" ("" for the root).
 * @property {string} message What is wrong.
 * @property {string} [doc]   Link to the relevant documentation, when the schema has one.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

/**
 * @param {string} actual
 * @param {string} expected
 */
function typeMatches(actual, expected) {
  return actual === expected || (expected === 'number' && actual === 'integer');
}

/**
 * @param {string} base
 * @param {string|number} key
 */
function join(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/**
 * Validate a value against a schema.
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [path]
 * @param {string} [inheritedDoc]
 * @returns {SchemaError[]} Empty when valid.
 */
function validate(value, schema, path = '', inheritedDoc = undefined) {
  /** @type {SchemaError[]} */
  const errors = [];
  const doc = schema.doc || inheritedDoc;
  const at = (p, message) => errors.push(doc ? { path: p, message, doc } : { path: p, message });
  const fail = (message) => at(path, message);
  const sub = (v, s, p) => validate(v, s, p, doc);
  const actual = typeOf(value);

  if (schema.type && !typeMatches(actual, schema.type)) {
    fail(`must be ${schema.type}, got ${actual}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    fail(`must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if ('const' in schema && value !== schema.const) {
    fail(`must be ${JSON.stringify(schema.const)}`);
  }

  if (actual === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(`must match ${schema.pattern}`);
  }

  if (actual === 'integer' || actual === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be <= ${schema.maximum}`);
  }

  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) fail('must not contain duplicates');
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...sub(item, schema.items, join(path, i))));
    }
    if (schema.contains && !value.some((item) => validate(item, schema.contains).length === 0)) {
      fail('does not contain a required item');
    }
  }

  if (actual === 'object') {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) at(join(path, key), 'is required');
    }
    const props = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) {
        errors.push(...sub(child, props[key], join(path, key)));
      } else if (schema.additionalProperties === false) {
        at(join(path, key), 'is not an allowed property');
      }
    }
  }

  for (const part of schema.allOf || []) {
    errors.push(...sub(value, part, path));
  }
  if (schema.anyOf && !schema.anyOf.some((option) => validate(value, option).length === 0)) {
    fail(schema.anyOfMessage || 'does not match any of the allowed forms');
  }
  if (schema.if) {
    const branch = validate(value, schema.if, path).length === 0 ? schema.then : schema.else;
    if (branch) errors.push(...sub(value, branch, path));
  }

  return errors;
}

/**
 * Format errors for humans, one per line.
 * @param {SchemaError[]} errors
 * @returns {string}
 */
function formatErrors(errors) {
  return errors.map((e) => `  - ${e.path || '(root)'} ${e.message}`).join('\n');
}

module.exports = { validate, formatErrors };
