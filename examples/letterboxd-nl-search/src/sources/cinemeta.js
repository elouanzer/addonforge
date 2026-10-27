'use strict';

// Cinemeta, Stremio's own metadata add-on: turns a film title (+ year) into an IMDb id.
// It is a public Stremio add-on, so it speaks the same protocol as this one:
// GET /catalog/movie/top/search=<title>.json and GET /meta/movie/<id>.json.
// Results are cached in memory: a title is looked up once per run.

const BASE_URL = (process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io').replace(/\/+$/, '');
const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 500;

/** @type {Map<string, Promise<Film|null>>} */
const cache = new Map();

/**
 * @typedef {object} Film
 * @property {string} id      IMDb id, e.g. "tt0071315"
 * @property {string} name
 * @property {number} [year]
 */

/**
 * Compare titles loosely: case, accents, punctuation, "&" and a leading "The" don't matter.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/**
 * GET JSON from Cinemeta. A server error (Cinemeta answers 504 under bursts of lookups)
 * is retried once after a short pause.
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
async function getJson(url, retries = 1) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status >= 500 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return getJson(url, retries - 1);
  }
  if (!res.ok) throw new Error(`Cinemeta answered HTTP ${res.status}`);
  return res.json();
}

/**
 * Cinemeta's search results for a title.
 * @param {string} title
 * @returns {Promise<{ id: string, name: string, releaseInfo?: string }[]>}
 */
async function search(title) {
  const body = await getJson(`${BASE_URL}/catalog/movie/top/search=${encodeURIComponent(title)}.json`);
  return Array.isArray(body.metas) ? body.metas : [];
}

/**
 * The best match among search results (which Cinemeta already ranks by relevance).
 * Cinemeta often lists the US release year (Seven Samurai: 1956, not 1954) and the
 * English title (Le Cercle Rouge: The Red Circle), so, in order of preference:
 *   1. the same title, released within 2 years (5 if it is the top result: Picnic at Hanging Rock, 1975, is listed as 1979);
 *   2. one title starting the other ("Star Wars" / "Star Wars: Episode IV - A New Hope"), within 1 year;
 *   3. one of the top 3 results released the very same year (translated or restyled titles).
 * Without a year, only an exact title match counts.
 * @param {{ id: string, name: string, releaseInfo?: string }[]} metas
 * @param {string} title
 * @param {number} [year]
 * @returns {Film|null}
 */
function pickMatch(metas, title, year) {
  const wanted = normalizeTitle(title);
  const candidates = metas
    .filter((m) => typeof m.id === 'string' && m.id.startsWith('tt') && typeof m.name === 'string')
    .map((m) => ({ id: m.id, name: m.name, year: Number.parseInt(m.releaseInfo, 10) || undefined, key: normalizeTitle(m.name) }));
  const near = (c, years) => Boolean(year && c.year && Math.abs(c.year - year) <= years);
  const prefixOf = (a, b) => a.length > 0 && b.startsWith(`${a} `);

  const found = !year
    ? candidates.find((c) => c.key === wanted)
    : candidates.find((c, i) => c.key === wanted && near(c, i === 0 ? 5 : 2)) ||
      candidates.find((c) => (prefixOf(wanted, c.key) || prefixOf(c.key, wanted)) && near(c, 1)) ||
      candidates.slice(0, 3).find((c) => near(c, 0));
  return found ? { id: found.id, name: found.name, year: found.year } : null;
}

/**
 * Resolve a title (and year, if known) to an IMDb id. Null when nothing matches
 * well enough; never throws (a failed lookup is logged and treated as no match).
 * @param {string} title
 * @param {number} [year]
 * @returns {Promise<Film|null>}
 */
function resolve(title, year) {
  const key = `${normalizeTitle(title)}|${year || ''}`;
  if (!cache.has(key)) {
    const lookup = search(title)
      .then((metas) => pickMatch(metas, title, year))
      .catch((err) => {
        console.warn(`Cinemeta lookup failed for "${title}": ${err.message}`);
        cache.delete(key); // retry next time
        return null;
      });
    cache.set(key, lookup);
  }
  return cache.get(key);
}

/** @type {Map<string, Promise<any|null>>} */
const metaCache = new Map();

/**
 * Full metadata for one film (year, genres, country…), cached. Throws when Cinemeta
 * can't be reached, so callers can tell "unknown" from "no metadata".
 * @param {string} id
 * @returns {Promise<any|null>}
 */
function meta(id) {
  if (!metaCache.has(id)) {
    const lookup = getJson(`${BASE_URL}/meta/movie/${encodeURIComponent(id)}.json`).then((body) => body.meta || null);
    lookup.catch(() => metaCache.delete(id)); // retry next time
    metaCache.set(id, lookup);
  }
  return metaCache.get(id);
}

/** Forget cached lookups (tests). */
function clearCache() {
  cache.clear();
  metaCache.clear();
}

module.exports = { resolve, search, pickMatch, meta, normalizeTitle, clearCache };
