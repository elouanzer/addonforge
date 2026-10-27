'use strict';

// The search pipeline: query -> backend (keyword or LLM) -> drop films you've watched
// -> Stremio meta previews. Results are cached in memory for a few hours, so the same
// search doesn't cost a second LLM call.

const letterboxd = require('../sources/letterboxd');
const { keywordSearch } = require('./keyword');
const { llmSearch } = require('./llm');
const { keepMatching, keepMatchingLocal } = require('./constraints');
const { createAnthropicProvider } = require('./anthropic');
const { createOpenAiProvider } = require('./openai');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_SIZE = 200;

/** @param {string} imdbId */
const poster = (imdbId) => `https://images.metahub.space/poster/small/${imdbId}/img`;

/**
 * @typedef {object} MetaPreview
 * @property {string} id
 * @property {'movie'} type
 * @property {string} name
 * @property {string} poster
 * @property {string} [releaseInfo]
 * @property {string[]} [genres]
 */

/** A local model writes about one film per second: ask Ollama for at most this many. */
const OLLAMA_MAX_CANDIDATES = 40;

/**
 * How many films to ask the backend for: more than are shown, to make up for those
 * hidden as watched (the longer the watch history, the more of the obvious picks are
 * gone). 10 extra for a small export, up to 40 extra (60 for 20 shown) from 1,200 films;
 * at most 40 in all for Ollama, where each film costs about a second.
 * @param {{ maxResults: number, provider: string }} config
 * @param {number} watchedCount  0 when watched films are not hidden
 */
function candidateCount(config, watchedCount) {
  const extra = watchedCount ? Math.min(40, 10 + Math.floor(watchedCount / 40)) : 0;
  const count = config.maxResults + extra;
  return config.provider === 'ollama' ? Math.min(count, Math.max(OLLAMA_MAX_CANDIDATES, config.maxResults)) : count;
}

/**
 * The LLM backend for a config, or null in keyword mode.
 * @param {import('../config').Config} config
 * @returns {import('./llm').Provider|null}
 */
function createProvider(config) {
  if (config.provider === 'anthropic') return createAnthropicProvider(config);
  if (config.provider === 'openai' || config.provider === 'ollama') return createOpenAiProvider({ ...config, name: config.provider });
  return null;
}

/**
 * @param {import('../config').Config} config
 * @param {{ provider?: import('./llm').Provider|null }} [overrides] Tests pass a fake provider.
 * @returns {(query: string) => Promise<MetaPreview[]>}
 */
function createSearch(config, overrides = {}) {
  const provider = 'provider' in overrides ? overrides.provider : createProvider(config);
  /** @type {Map<string, { at: number, result: Promise<MetaPreview[]> }>} */
  const cache = new Map();

  /** @returns {Promise<{ metas: MetaPreview[], fallback: boolean }>} */
  async function run(query) {
    const data = letterboxd.load(config.letterboxdDir);
    const watched = config.hideWatched ? letterboxd.matcher(data.watched) : () => false;
    const count = candidateCount(config, config.hideWatched ? data.watched.length : 0);

    if (provider) {
      try {
        const favourites = config.tasteHints ? letterboxd.favourites(data) : [];
        const films = await llmSearch(query, { provider, count, favourites });
        if (!films.length) throw new Error('its reply had no film found on Cinemeta');
        // The model's year can be wrong (The Chaser, 2008, given as 2013): Cinemeta's counts too.
        const seen = (f) => watched([f.name, f.suggestedTitle], f.year) || (f.cinemetaYear !== undefined && watched([f.name, f.suggestedTitle], f.cinemetaYear));
        const unseen = films.filter((f) => !seen(f));
        const metas = (await keepMatching(unseen, query))
          .slice(0, config.maxResults)
          .map((f) => ({ id: f.id, type: 'movie', name: f.name, poster: poster(f.id), ...(f.year ? { releaseInfo: String(f.year) } : {}) }));
        if (!metas.length) throw new Error(`none of its ${films.length} film(s) were both unseen and matching the search`);
        return { metas, fallback: false };
      } catch (err) {
        console.warn(`${provider.name} search failed (${err.message}); falling back to keyword search.`);
      }
    }

    const metas = keepMatchingLocal(keywordSearch(query, { limit: count }), query)
      .filter((f) => !watched([f.name, ...(f.aka || [])], f.year))
      .slice(0, config.maxResults)
      .map((f) => ({ id: f.id, type: 'movie', name: f.name, poster: poster(f.id), releaseInfo: String(f.year), genres: f.genres }));
    // A keyword answer standing in for a failed LLM call is not cached: the next try asks the LLM again.
    return { metas, fallback: Boolean(provider) };
  }

  return function search(query) {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

    const result = run(query.trim()).then(({ metas, fallback }) => {
      if (fallback) cache.delete(key);
      return metas;
    });
    cache.set(key, { at: Date.now(), result });
    result.catch(() => cache.delete(key));
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return result;
  };
}

module.exports = { createSearch, createProvider, candidateCount, poster };
