'use strict';

// LLM search: a language model turns the query into film titles, then Cinemeta turns
// each title into an IMDb id (models know titles well, ids badly). Titles Cinemeta
// can't match are dropped, so an invented film never reaches Stremio.

const cinemeta = require('../sources/cinemeta');

/**
 * A language-model backend.
 * @typedef {object} Provider
 * @property {string} name
 * @property {(request: { system: string, prompt: string, schema: object }) => Promise<any>} suggest
 *   Resolves to an object matching `schema`.
 */

/** Fewer suggestions than this (when more were asked for) means the model stopped early. */
const MIN_SUGGESTIONS = 5;

/** The JSON the model must return. */
const FILM_LIST_SCHEMA = {
  type: 'object',
  properties: {
    films: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          year: { type: 'integer' },
        },
        required: ['title', 'year'],
        additionalProperties: false,
      },
    },
  },
  required: ['films'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'You help someone find films to watch. They typed a search into Stremio, a media centre,',
  'and you turn it into a list of real, released feature films that match it, best matches first.',
  'Read the search the way a knowledgeable friend would: mood, era, setting, themes, people, similar films.',
  'If it names a specific film, put that film first.',
  "For each film give the title it is best known by in English and its original release year.",
  'Only list films you are sure exist. Never invent a title.',
].join(' ');

/**
 * @param {string} query
 * @param {{ count: number, favourites?: string[] }} options
 * @returns {string}
 */
function buildPrompt(query, { count, favourites = [] }) {
  const lines = [`Search: ${query}`, '', `List up to ${count} films.`];
  if (favourites.length) {
    lines.push(
      '',
      'Films this person rated highly on Letterboxd. Use them only to lean towards their taste when several films fit the search equally well; do not list them unless the search asks for them:',
      ...favourites.map((f) => `- ${f}`),
    );
  }
  return lines.join('\n');
}

/**
 * Run `fn` over `items` with at most `limit` calls at a time, keeping the order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Films for a query, resolved to IMDb ids, in the model's order.
 * @param {string} query
 * @param {{ provider: Provider, count: number, favourites?: string[] }} options
 * @returns {Promise<{ id: string, name: string, year?: number, cinemetaYear?: number, suggestedTitle: string }[]>}
 */
async function llmSearch(query, { provider, count, favourites }) {
  const ask = async () => {
    const reply = await provider.suggest({ system: SYSTEM_PROMPT, prompt: buildPrompt(query, { count, favourites }), schema: FILM_LIST_SCHEMA });
    return (reply && Array.isArray(reply.films) ? reply.films : [])
      .filter((f) => f && typeof f.title === 'string' && f.title.trim())
      // Small models sometimes repeat the year in the title: "A Fistful of Dollars (1964)".
      .map((f) => ({ ...f, title: f.title.replace(/\s*\((?:19|20)\d\d\)\s*$/, '').trim() }))
      .slice(0, count);
  };
  let suggestions = await ask();
  // Small local models now and then stop after a film or two: ask once more.
  if (suggestions.length < Math.min(MIN_SUGGESTIONS, count)) {
    const again = await ask();
    if (again.length > suggestions.length) suggestions = again;
  }

  const resolved = await mapLimit(suggestions, 6, async (s) => {
    const film = await cinemeta.resolve(s.title, Number.isInteger(s.year) ? s.year : undefined);
    return film && { id: film.id, name: film.name, year: Number.isInteger(s.year) ? s.year : film.year, cinemetaYear: film.year, suggestedTitle: s.title };
  });

  const seen = new Set();
  return resolved.filter((f) => f && !seen.has(f.id) && seen.add(f.id));
}

module.exports = { llmSearch, buildPrompt, mapLimit, FILM_LIST_SCHEMA, SYSTEM_PROMPT };
