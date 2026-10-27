# Mapping titles to IMDb ids

Catalogs that use IMDb ids (`tt0071315`) get Stremio's details pages, posters, and other add-ons' streams and subtitles for free. Many sources (a CSV export, a list, a language model) only give a title and a year, though. Three ways to get the id, from best to last resort:

1. **The source gives it.** Many APIs include IMDb ids in their results or in an "external ids" field. Use them as they are.
2. **A metadata API with a key**, such as TMDB's "find" and "external ids" endpoints. Accurate, needs an API key in `.env`, and has terms and rate limits to respect.
3. **Cinemeta's search**, Stremio's own public add-on. No key needed. Be gentle with it: cache every lookup and limit concurrency.

## Cinemeta search

Cinemeta speaks the add-on protocol, so a search is a catalog request:

```text
GET https://v3-cinemeta.strem.io/catalog/movie/top/search=<title>.json
→ { "metas": [{ "id": "tt0071315", "name": "Chinatown", "releaseInfo": "1974", … }, …] }
```

Use `series` instead of `movie` for shows. Results are ranked by relevance, but **don't just take the first one**: remakes share titles (*Dune* 1984 and 2021). Match the title loosely, then the year.

`examples/letterboxd-nl-search/src/sources/cinemeta.js` is a complete, tested resolver to copy. It handles Cinemeta's quirks:

- **Titles compared loosely:** case, accents, punctuation, `&`/"and" and a leading "The" don't matter.
- **Year within 2**, or 5 for the top result. Cinemeta often lists the US release year: *Seven Samurai* (1954) appears as 1956.
- **Prefix titles:** "Star Wars" (1977) matches "Star Wars: Episode IV - A New Hope".
- **Same year, translated title:** *Le Cercle Rouge* (1970) is listed as *The Red Circle*. One of the top 3 results from the very same year is accepted.
- **Caching and retries:** lookups are cached, a server error is retried once, and failures count as "no match" rather than crashing the request.

Drop titles that don't resolve, rather than guessing. And test the resolver with recorded Cinemeta answers (a mocked `fetch`), never the live service.
