'use strict';

// Rebuilds src/sources/seed-films.json from scripts/seed-films.txt.
//
//   node scripts/build-seed.js
//
// seed-films.txt has one film per line: "Title|Year|tag,tag,…". The tags are written
// by hand (mood, setting, themes). This script looks each film up on Cinemeta to get
// its IMDb id and plain facts (year, genres, country, director). No synopses or other
// copyrighted text are stored. Needs network access; the add-on itself does not run it.

const fs = require('node:fs');
const path = require('node:path');
const cinemeta = require('../src/sources/cinemeta');

const INPUT = path.join(__dirname, 'seed-films.txt');
const OUTPUT = path.join(__dirname, '..', 'src', 'sources', 'seed-films.json');
const CONCURRENCY = 4;

/** @param {string} value */
const list = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
  .map((s) => s.trim())
  .filter(Boolean);

async function buildOne({ title, year, tags }) {
  const film = await cinemeta.resolve(title, year);
  if (!film) throw new Error(`no Cinemeta match for "${title}" (${year})`);
  const meta = await cinemeta.meta(film.id);
  if (!meta) throw new Error(`no Cinemeta metadata for ${film.id}`);
  const name = meta.name || film.name;
  return {
    id: film.id,
    name,
    // The title as written in seed-films.txt when Cinemeta lists another one
    // (Le Cercle Rouge -> The Red Circle): searched too, and matched against Letterboxd.
    ...(cinemeta.normalizeTitle(title) !== cinemeta.normalizeTitle(name) ? { aka: [title] } : {}),
    year, // the original release year from seed-films.txt (Cinemeta often has the US one)
    genres: list(meta.genres || meta.genre),
    countries: list(meta.country),
    directors: list(meta.director),
    tags,
  };
}

async function main() {
  const rows = fs
    .readFileSync(INPUT, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const [title, year, tags = ''] = line.split('|');
      return { title: title.trim(), year: Number(year), tags: list(tags) };
    });

  const films = new Array(rows.length);
  const failures = [];
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      try {
        films[i] = await buildOne(rows[i]);
      } catch (err) {
        failures.push(err.message);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const seen = new Set();
  const out = films.filter((f) => f && !seen.has(f.id) && seen.add(f.id));
  fs.writeFileSync(OUTPUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`Wrote ${out.length} films to ${path.relative(process.cwd(), OUTPUT)}.`);
  if (failures.length) {
    console.error(`${failures.length} film(s) skipped:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main();
