'use strict';

// Keyword search: the backend that needs no key and no network (SEARCH_PROVIDER=keyword).
// It reads a decade or year, genres and countries out of the query, then scores the
// bundled seed list (src/sources/seed-films.json) on genres, hand-written tags, titles
// and directors. "slow-burn 70s thrillers set in Paris" becomes: 1970-1979, Thriller,
// terms "slow-burn" and "paris".

const SEED = require('../sources/seed-films.json');

/**
 * @typedef {object} SeedFilm
 * @property {string} id
 * @property {string} name
 * @property {string[]} [aka]
 * @property {number} year
 * @property {string[]} genres
 * @property {string[]} countries
 * @property {string[]} directors
 * @property {string[]} tags
 */

/**
 * @typedef {object} ParsedQuery
 * @property {number} [from]       first year allowed
 * @property {number} [to]         last year allowed
 * @property {string[]} genres     Cinemeta genre names
 * @property {string[]} countries
 * @property {string[]} terms      everything else, normalized
 */

/** Query words -> Cinemeta genres. */
const GENRES = {
  thriller: ['Thriller'], suspense: ['Thriller'],
  horror: ['Horror'], scary: ['Horror'], spooky: ['Horror'],
  comedy: ['Comedy'], comedie: ['Comedy'], funny: ['Comedy'], hilarious: ['Comedy'],
  romance: ['Romance'], romantic: ['Romance'], romcom: ['Romance', 'Comedy'],
  scifi: ['Sci-Fi'], 'science fiction': ['Sci-Fi'],
  western: ['Western'], war: ['War'],
  animation: ['Animation'], animated: ['Animation'], cartoon: ['Animation'], anime: ['Animation'],
  musical: ['Musical'], crime: ['Crime'], mystery: ['Mystery'], mysterie: ['Mystery'], whodunit: ['Mystery'],
  drama: ['Drama'], action: ['Action'], adventure: ['Adventure'], fantasy: ['Fantasy'],
  family: ['Family'], kid: ['Family'], noir: ['Film-Noir'],
  biopic: ['Biography'], biography: ['Biography'], sport: ['Sport'], historical: ['History'], history: ['History'],
};

/** Query words -> Cinemeta country names. */
const COUNTRIES = {
  french: 'France', france: 'France', italian: 'Italy', italy: 'Italy',
  japanese: 'Japan', japan: 'Japan', korean: 'South Korea', korea: 'South Korea',
  german: 'Germany', germany: 'Germany', british: 'United Kingdom', uk: 'United Kingdom',
  american: 'United States', hollywood: 'United States', usa: 'United States',
  spanish: 'Spain', spain: 'Spain', swedish: 'Sweden', sweden: 'Sweden',
  soviet: 'Soviet Union', russian: 'Soviet Union', chinese: 'China', mexican: 'Mexico', mexico: 'Mexico',
  brazilian: 'Brazil', brazil: 'Brazil', australian: 'Australia', australia: 'Australia', canadian: 'Canada',
};
const MULTI_WORD_COUNTRIES = { 'hong kong': 'Hong Kong' };

/** Spelled-out decades. */
const DECADES = { twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990 };

/** "not American", "non-Korean", "no horror": the next genre or country is not a requirement. */
const NEGATIONS = new Set(['not', 'non', 'no', 'without', 'except']);

const STOPWORDS = new Set(
  'not non no without except a an and or the of in on at to for from by with about into set located takes take place where that which who is are be some something anything any film films movie movies show me find want looking like i im good great best really very kind sort type ones one this those these please'.split(' '),
);

/**
 * Lowercase, no accents, words joined by single spaces; hyphens become spaces.
 * @param {string} text
 */
function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/sci-fi|science-fiction/g, 'scifi')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

/** "thrillers" -> "thriller", "comedies" -> "comedie" (matched as such above). */
const singular = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

/** A tag in the form queries are compared in: "Slow-Burn" -> "slow burn", "Paris" -> "pari". */
const tagForm = (tag) => normalize(tag).split(' ').map(singular).join(' ');

/** Every tag of the seed list, to recognise two-word tags in queries. */
const TAG_VOCABULARY = new Set(SEED.flatMap((f) => f.tags.map(tagForm)));

/**
 * @param {string} query
 * @returns {ParsedQuery}
 */
function parseQuery(query) {
  let text = ` ${normalize(query)} `;
  /** @type {ParsedQuery} */
  const parsed = { genres: [], countries: [], terms: [] };

  // Decades: 70s, '70s, 1970s, seventies.
  text = text.replace(/ '?(?:(19|20)(\d)0|(\d)0)'?s /g, (_, century, d1, d2) => {
    const start = century ? Number(`${century}${d1}0`) : 1900 + Number(d2) * 10 < 1920 ? 2000 + Number(d2) * 10 : 1900 + Number(d2) * 10;
    parsed.from = start;
    parsed.to = start + 9;
    return ' ';
  });
  for (const [word, start] of Object.entries(DECADES)) {
    if (text.includes(` ${word} `)) {
      parsed.from = start;
      parsed.to = start + 9;
      text = text.replace(` ${word} `, ' ');
    }
  }
  // Years: "before 1960", "pre-1960", "after 2000", "since 1990", "post-2000", or a bare year.
  text = text.replace(/ (before|pre|after|since|from|post) ((?:19|20)\d\d) /g, (_, word, y) => {
    if (word === 'before' || word === 'pre') parsed.to = Number(y) - 1;
    else parsed.from = Number(y) + (word === 'after' ? 1 : 0);
    return ' ';
  });
  text = text.replace(/ ((?:19|20)\d\d) /g, (_, y) => {
    parsed.from = Number(y);
    parsed.to = Number(y);
    return ' ';
  });

  for (const [words, country] of Object.entries(MULTI_WORD_COUNTRIES)) {
    if (text.includes(` ${words} `)) {
      parsed.countries.push(country);
      text = text.replace(` ${words} `, ' ');
    }
  }
  if (text.includes(' science fiction ')) {
    parsed.genres.push('Sci-Fi');
    text = text.replace(' science fiction ', ' ');
  }

  // Two-word tags first ("slow burn", "feel good", "los angeles"), even across stopwords.
  const words = text.split(' ').filter(Boolean).map((w) => singular(w.replace(/'/g, '')));
  const used = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (TAG_VOCABULARY.has(pair)) {
      parsed.terms.push(pair);
      used.add(i).add(i + 1);
    }
  }
  words.forEach((word, i) => {
    if (used.has(i)) return;
    if (i > 0 && NEGATIONS.has(words[i - 1]) && (GENRES[word] || COUNTRIES[word])) return;
    if (GENRES[word]) parsed.genres.push(...GENRES[word]);
    else if (COUNTRIES[word]) {
      parsed.countries.push(COUNTRIES[word]);
      parsed.terms.push(singular(normalize(COUNTRIES[word]))); // also matches setting tags ("japan")
    } else if (!STOPWORDS.has(word) && word.length > 1) parsed.terms.push(word);
  });

  parsed.genres = [...new Set(parsed.genres)];
  parsed.countries = [...new Set(parsed.countries)];
  parsed.terms = [...new Set(parsed.terms)];
  return parsed;
}

/**
 * How well a film matches; 0 means not at all.
 * @param {SeedFilm} film
 * @param {ParsedQuery} q
 */
function score(film, q) {
  if (q.from && film.year < q.from) return 0;
  if (q.to && film.year > q.to) return 0;

  let points = 0;
  for (const g of q.genres) if (film.genres.includes(g)) points += 3;
  // Cinemeta lists co-producers too (Ratatouille: United States, France, Japan): the first country weighs most.
  for (const c of q.countries) if (film.countries.includes(c)) points += film.countries[0] === c ? 2 : 1;

  const tags = film.tags.map(tagForm);
  const titleWords = new Set([film.name, ...(film.aka || [])].flatMap((t) => normalize(t).split(' ')).map(singular));
  const titles = [film.name, ...(film.aka || [])].map((t) => normalize(t).split(' ').map(singular).join(' '));
  const directors = film.directors.map(tagForm);
  for (const term of q.terms) {
    if (tags.includes(term)) points += 3;
    else if (tags.some((t) => t.split(' ').includes(term))) points += 1;
    if (titles.includes(term) || (term.includes(' ') && titles.some((t) => t.includes(term)))) points += 4;
    else if (titleWords.has(term)) points += 1;
    if (directors.some((d) => d === term || d.split(' ').includes(term))) points += 3;
  }

  const filtersOnly = !q.genres.length && !q.countries.length && !q.terms.length;
  if (filtersOnly && (q.from || q.to)) return 1; // "80s films": everything from the decade
  return points;
}

/**
 * Seed films matching the query, best first.
 * @param {string} query
 * @param {{ limit?: number, films?: SeedFilm[] }} [options]
 * @returns {SeedFilm[]}
 */
function keywordSearch(query, { limit = 20, films = SEED } = {}) {
  const q = parseQuery(query);
  return films
    .map((film, index) => ({ film, index, points: score(film, q) }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.film);
}

module.exports = { keywordSearch, parseQuery, score, normalize, SEED };
