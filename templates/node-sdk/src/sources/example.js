'use strict';

// Example data source: a few public-domain films, identified by their IMDb ids so
// Stremio's Cinemeta add-on can provide the full metadata.
//
// Replace this file with one adapter per real source (an API, a file, a website
// whose terms allow it). Keep the same shape: async functions returning Meta Preview
// objects (https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md#meta-preview-object).

/** @param {string} imdbId */
const poster = (imdbId) => `https://images.metahub.space/poster/small/${imdbId}/img`;

/**
 * @typedef {object} MetaPreview
 * @property {string} id
 * @property {string} type
 * @property {string} name
 * @property {string} poster
 * @property {string} [releaseInfo]
 * @property {string[]} [genres]
 */

/** @type {MetaPreview[]} */
const FILMS = [
  { id: 'tt0010323', name: 'The Cabinet of Dr. Caligari', releaseInfo: '1920', genres: ['Horror', 'Mystery', 'Thriller'] },
  { id: 'tt0013442', name: 'Nosferatu', releaseInfo: '1922', genres: ['Fantasy', 'Horror'] },
  { id: 'tt0015324', name: 'Sherlock Jr.', releaseInfo: '1924', genres: ['Action', 'Comedy', 'Romance'] },
  { id: 'tt0017925', name: 'The General', releaseInfo: '1927', genres: ['Action', 'Adventure', 'Comedy'] },
  { id: 'tt0017136', name: 'Metropolis', releaseInfo: '1927', genres: ['Drama', 'Sci-Fi'] },
  { id: 'tt0032599', name: 'His Girl Friday', releaseInfo: '1940', genres: ['Comedy', 'Drama', 'Romance'] },
  { id: 'tt0037638', name: 'Detour', releaseInfo: '1946', genres: ['Crime', 'Drama', 'Film-Noir'] },
  { id: 'tt0052077', name: 'Plan 9 from Outer Space', releaseInfo: '1959', genres: ['Horror', 'Sci-Fi'] },
  { id: 'tt0056923', name: 'Charade', releaseInfo: '1963', genres: ['Comedy', 'Mystery', 'Romance'] },
  { id: 'tt0063350', name: 'Night of the Living Dead', releaseInfo: '1968', genres: ['Horror', 'Thriller'] },
].map((film) => ({ ...film, type: 'movie', poster: poster(film.id) }));

/**
 * All items of a given type.
 * @param {{ type: string }} query
 * @returns {Promise<MetaPreview[]>}
 */
async function list({ type }) {
  return FILMS.filter((film) => film.type === type);
}

/**
 * One item by id, or null.
 * @param {string} id
 * @returns {Promise<MetaPreview|null>}
 */
async function get(id) {
  return FILMS.find((film) => film.id === id) || null;
}

module.exports = { list, get };
