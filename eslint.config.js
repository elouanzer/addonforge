'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // addons/ holds the user's own generated add-ons; they are not part of this repo.
    ignores: ['addons/**', '**/node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      strict: ['error', 'global'],
    },
  },
];
