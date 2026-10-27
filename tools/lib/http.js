'use strict';

/**
 * Minimal HTTP client for talking to add-ons, built on the global fetch.
 */

/**
 * @typedef {object} HttpResult
 * @property {string} url
 * @property {number} status    0 when the request failed before a response.
 * @property {Headers|null} headers
 * @property {string} body
 * @property {unknown} json     Parsed body, or undefined when the body is not JSON.
 * @property {number} ms        Time to the full body.
 * @property {string} [error]   Network error or timeout message.
 */

/**
 * GET a URL and try to parse the body as JSON.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<HttpResult>}
 */
async function getJson(url, { timeoutMs = 15000 } = {}) {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      json = undefined;
    }
    return { url, status: res.status, headers: res.headers, body, json, ms: Math.round(performance.now() - start) };
  } catch (err) {
    const message = err.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : (err.cause && err.cause.message) || err.message;
    return { url, status: 0, headers: null, body: '', json: undefined, ms: Math.round(performance.now() - start), error: message };
  }
}

module.exports = { getJson };
