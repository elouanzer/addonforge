'use strict';

/**
 * Exit codes shared by every forge command.
 * @readonly
 */
const EXIT = Object.freeze({
  /** Everything passed. */
  OK: 0,
  /** A validation or test failed. */
  FAILURE: 1,
  /** Bad usage, or the environment is missing something. */
  USAGE: 2,
});

module.exports = { EXIT };
