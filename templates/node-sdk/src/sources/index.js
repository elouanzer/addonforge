'use strict';

// The data source the handlers use. To use your own, write src/sources/<name>.js with
// the same functions (list, get…) and point the line below at it: src/addon.js and the
// tests use whatever this file exports, so they don't change.

module.exports = require('./example');
