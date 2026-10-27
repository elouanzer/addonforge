'use strict';

// Checks a language model's suggestions against what the search explicitly asks for:
// an era ("70s", "post 2000"), genres ("thriller") and countries ("Korean"). Small
// models often ignore part of a request: "korean thriller post 2000" also brings back
// Japanese films, a 1999 one and an American romantic comedy. Genres and countries come
// from Cinemeta's metadata, so the check costs one cached request per film.

const { parseQuery } = require('./keyword');
const cinemeta = require('../sources/cinemeta');
const { mapLimit } = require('./llm');

/**
 * Genres that satisfy a requested genre: Cinemeta tags many thrillers only as Crime or
 * Mystery, and neo-noirs are never "Film-Noir". Drama and Family are too broad, or too
 * ambiguous ("family drama"), to filter on.
 */
const ACCEPTED_GENRES = {
  Thriller: ['Thriller', 'Crime', 'Mystery'],
  Mystery: ['Mystery', 'Thriller', 'Crime'],
  Crime: ['Crime', 'Thriller', 'Mystery'],
  'Film-Noir': ['Film-Noir', 'Crime', 'Thriller', 'Mystery'],
  Horror: ['Horror'],
  Comedy: ['Comedy'],
  Romance: ['Romance'],
  'Sci-Fi': ['Sci-Fi'],
  Western: ['Western'],
  War: ['War', 'History'],
  Animation: ['Animation'],
  Musical: ['Musical', 'Music'],
  Action: ['Action', 'Adventure', 'Thriller'],
  Adventure: ['Adventure', 'Action', 'Fantasy'],
  Fantasy: ['Fantasy'],
  Biography: ['Biography', 'History'],
  History: ['History', 'War', 'Biography'],
  Sport: ['Sport'],
};

/** Countries that satisfy a requested country (Cinemeta uses historical names). */
const ACCEPTED_COUNTRIES = {
  Germany: ['Germany', 'West Germany', 'East Germany'],
  'Soviet Union': ['Soviet Union', 'Russia'],
};

/**
 * @typedef {object} Constraints
 * @property {number} [from]
 * @property {number} [to]
 * @property {string[][]} genres     one list of accepted genres per requested genre
 * @property {string[][]} countries  one list of accepted countries per requested country
 */

/**
 * What a search explicitly requires.
 * @param {string} query
 * @returns {Constraints}
 */
function constraintsFor(query) {
  const q = parseQuery(query);
  return {
    from: q.from,
    to: q.to,
    genres: q.genres.filter((g) => ACCEPTED_GENRES[g]).map((g) => ACCEPTED_GENRES[g]),
    countries: q.countries.map((c) => ACCEPTED_COUNTRIES[c] || [c]),
  };
}

/** @param {Constraints} c */
const isEmpty = (c) => !c.from && !c.to && !c.genres.length && !c.countries.length;

/**
 * Whether one of a film's years is in range (the model's year or Cinemeta's, which
 * is sometimes the US release).
 * @param {Constraints} c
 * @param {(number|undefined)[]} years
 */
function yearFits(c, years) {
  const known = years.filter(Boolean);
  if (!known.length) return true;
  return known.some((y) => (!c.from || y >= c.from) && (!c.to || y <= c.to));
}

/**
 * Whether Cinemeta's metadata fits: for each requested genre, one accepted genre; for
 * each requested country, one accepted country (co-productions count).
 * @param {Constraints} c
 * @param {any} meta
 */
function metaFits(c, meta) {
  const genres = Array.isArray(meta.genres) ? meta.genres : Array.isArray(meta.genre) ? meta.genre : [];
  const countries = String(meta.country || '').split(',').map((s) => s.trim());
  const genresOk = !genres.length || c.genres.every((accepted) => accepted.some((g) => genres.includes(g)));
  const countriesOk = !meta.country || c.countries.every((accepted) => accepted.some((x) => countries.includes(x)));
  return genresOk && countriesOk;
}

/**
 * The films that fit the search's explicit requirements, in their original order.
 * A film whose metadata can't be fetched is kept: unknown is not a mismatch.
 * @template {{ id: string, year?: number, cinemetaYear?: number }} F
 * @param {F[]} films
 * @param {string} query
 * @returns {Promise<F[]>}
 */
async function keepMatching(films, query) {
  const c = constraintsFor(query);
  if (isEmpty(c)) return films;
  const inRange = films.filter((f) => yearFits(c, [f.year, f.cinemetaYear]));
  if (!c.genres.length && !c.countries.length) return inRange;

  const fits = await mapLimit(inRange, 6, (f) =>
    cinemeta.meta(f.id).then(
      (meta) => !meta || metaFits(c, meta),
      () => true,
    ),
  );
  return inRange.filter((_, i) => fits[i]);
}

/**
 * The same check for films that carry their own metadata (the keyword backend's seed list).
 * @template {{ year: number, genres: string[], countries: string[] }} F
 * @param {F[]} films
 * @param {string} query
 * @returns {F[]}
 */
function keepMatchingLocal(films, query) {
  const c = constraintsFor(query);
  if (isEmpty(c)) return films;
  return films.filter((f) => yearFits(c, [f.year]) && metaFits(c, { genres: f.genres, country: f.countries.join(', ') }));
}

module.exports = { keepMatching, keepMatchingLocal, constraintsFor, yearFits, metaFits };
