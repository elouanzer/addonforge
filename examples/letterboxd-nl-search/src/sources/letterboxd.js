'use strict';

// Your own Letterboxd data export, read from local files. Nothing is fetched from
// Letterboxd: its terms forbid scraping (https://letterboxd.com/legal/terms-of-use/).
//
// Get the export from letterboxd.com > Settings > Data > Export your data, unzip it,
// and put the CSV files in data/ (or the folder LETTERBOXD_DIR points to). Used files:
//   watched.csv    Date, Name, Year, Letterboxd URI          -> hide films you've seen
//   ratings.csv    Date, Name, Year, Letterboxd URI, Rating  -> taste hints for the LLM
// The files are read once, at the first search: restart the add-on after replacing them.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeTitle } = require('./cinemeta');

/**
 * @typedef {object} LoggedFilm
 * @property {string} name
 * @property {number} [year]
 * @property {number} [rating]  0.5 to 5, ratings.csv only
 */

/**
 * @typedef {object} LetterboxdData
 * @property {LoggedFilm[]} watched
 * @property {LoggedFilm[]} ratings
 */

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, CRLF) into objects keyed by
 * the header row.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] || '').trim()])));
}

/**
 * Read one export file; a missing file is simply empty.
 * @param {string} dir
 * @param {string} file
 * @returns {LoggedFilm[]}
 */
function readFile(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return [];
  return parseCsv(fs.readFileSync(full, 'utf8'))
    .filter((r) => r.Name)
    .map((r) => ({
      name: r.Name,
      ...(Number.parseInt(r.Year, 10) ? { year: Number.parseInt(r.Year, 10) } : {}),
      ...(r.Rating !== undefined && r.Rating !== '' && !Number.isNaN(Number(r.Rating)) ? { rating: Number(r.Rating) } : {}),
    }));
}

/** @type {Map<string, LetterboxdData>} */
const loaded = new Map();

/**
 * The export in `dir`, read once and kept in memory.
 * @param {string} dir
 * @returns {LetterboxdData}
 */
function load(dir) {
  if (!loaded.has(dir)) {
    const data = { watched: readFile(dir, 'watched.csv'), ratings: readFile(dir, 'ratings.csv') };
    // A rated film was watched, even when watched.csv is missing.
    data.watched = [...data.watched, ...data.ratings.map(({ name, year }) => ({ name, year }))];
    loaded.set(dir, data);
    if (data.watched.length) {
      console.log(`Letterboxd export: ${data.watched.length} logged film(s), ${data.ratings.length} rating(s) from ${dir}`);
    }
  }
  return loaded.get(dir);
}

/**
 * A matcher telling whether a film was logged: same title (loosely), released within a year.
 * @param {LoggedFilm[]} films
 * @returns {(names: string[], year?: number) => boolean}
 */
function matcher(films) {
  /** @type {Map<string, (number|undefined)[]>} */
  const byTitle = new Map();
  for (const f of films) {
    const key = normalizeTitle(f.name);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(f.year);
  }
  return (names, year) =>
    names.some((name) => {
      const years = byTitle.get(normalizeTitle(name));
      return Boolean(years) && (!year || years.some((y) => !y || Math.abs(y - year) <= 1));
    });
}

/**
 * The user's favourite films, best first, as "Title (Year)".
 * @param {LetterboxdData} data
 * @param {number} [limit]
 * @returns {string[]}
 */
function favourites(data, limit = 25) {
  return data.ratings
    .filter((f) => f.rating >= 4)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
    .map((f) => (f.year ? `${f.name} (${f.year})` : f.name));
}

/** Forget loaded exports (tests). */
function clearCache() {
  loaded.clear();
}

module.exports = { parseCsv, load, matcher, favourites, clearCache };
