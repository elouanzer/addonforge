'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../tools/lib/json-schema');

const paths = (errors) => errors.map((e) => `${e.path}: ${e.message}`);

test('type mismatch stops further checks on that value', () => {
  assert.deepEqual(paths(validate(3, { type: 'string', minLength: 5 })), [': must be string, got integer']);
});

test('integer satisfies number', () => {
  assert.deepEqual(validate(3, { type: 'number' }), []);
});

test('string rules', () => {
  const schema = { type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$' };
  assert.equal(validate('ab', schema).length, 0);
  assert.equal(validate('a', schema).length, 1);
  assert.equal(validate('abcd', schema).length, 1);
  assert.equal(validate('AB', schema).length, 1);
});

test('enum, const, minimum, maximum', () => {
  assert.equal(validate('x', { enum: ['a', 'b'] }).length, 1);
  assert.equal(validate(true, { const: false }).length, 1);
  assert.equal(validate(5, { type: 'integer', minimum: 10 }).length, 1);
  assert.equal(validate(50, { type: 'integer', maximum: 10 }).length, 1);
});

test('arrays: items, minItems, uniqueItems, contains', () => {
  const schema = { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } };
  assert.deepEqual(paths(validate(['a', 1], schema)), ['[1]: must be string, got integer']);
  assert.equal(validate([], schema).length, 1);
  assert.equal(validate(['a', 'a'], schema).length, 1);
  assert.equal(validate(['a'], { contains: { const: 'b' } }).length, 1);
  assert.equal(validate(['b'], { contains: { const: 'b' } }).length, 0);
});

test('objects: required, properties, additionalProperties', () => {
  const schema = {
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: { a: { type: 'object', properties: { b: { type: 'string' } } } },
  };
  assert.deepEqual(paths(validate({ a: { b: 1 }, c: 2 }, schema)), ['a.b: must be string, got integer', 'c: is not an allowed property']);
  assert.deepEqual(paths(validate({}, schema)), ['a: is required']);
});

test('allOf with if/then/else', () => {
  const schema = {
    allOf: [{ if: { properties: { k: { const: 1 } } }, then: { required: ['x'] }, else: { required: ['y'] } }],
  };
  assert.deepEqual(paths(validate({ k: 1 }, schema)), ['x: is required']);
  assert.deepEqual(paths(validate({ k: 2 }, schema)), ['y: is required']);
});
