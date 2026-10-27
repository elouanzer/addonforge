# Natural-language search with a language model

Searches like *"slow-burn 70s thrillers set in Paris"* need understanding, not keyword matching. A language model can turn them into film titles. `examples/letterboxd-nl-search` is a complete, tested implementation of this recipe: read its `src/search/` folder before writing your own.

## The pipeline

1. **Ask the model for titles, not ids.** Models know titles and years well, and IMDb ids badly. Request JSON that must match a schema (structured output), e.g. `{ films: [{ title, year }] }`, so the reply always parses.
2. **Resolve each title to an IMDb id** ([imdb-mapping](imdb-mapping.md)). Titles that don't resolve are dropped, so an invented film never reaches Stremio.
3. **Enforce what the search states.** Small models ignore parts of a request. When the query names an era, genres or countries, check them against Cinemeta's metadata and drop what doesn't fit (`src/search/constraints.js` in the example).
4. **Return meta previews** with the metahub poster, and cache the result.

Declare the catalog `searchOnly`, so Stremio only calls it with a query.

## Backends

Make the backend a setting (`SEARCH_PROVIDER` in `.env`), with a **keyless default** so the add-on, its tests and CI work without any key:

| Backend | Notes |
|---|---|
| keyword (no LLM) | Matches the query against a built-in list. Offline and instant; the CI mode |
| Anthropic, OpenAI | API key in `.env`; a few seconds per search; costs a little per search |
| Ollama | A local model: free, private, 10 to 30 s per search on a laptop |

Use each provider's official SDK where one exists. An OpenAI-compatible endpoint, called with `fetch`, covers OpenAI, Ollama and many others.

## Make it robust

- **Fall back** to the keyword backend when the model fails, times out or returns nothing usable, and log why. Don't cache that fallback answer, so the next search retries the model.
- **Retry once** when a small model stops after a film or two.
- **Cache** answers per normalised query for hours: the same search shouldn't cost a second model call ([caching](caching.md)).
- **Time out** the model call (`LLM_TIMEOUT_MS`), and keep in mind that `validate` and `smoke` wait 15 s at most.
- **Ask for more films than you show** when some will be filtered out (already watched, wrong era), but fewer with slow local models.

## Privacy and cost

Searches sent to a hosted model leave the user's computer. Say so in the README, keep anything personal (watch history, ratings) opt-in, and state what the provider receives. With a hosted provider, mention the rough cost per search.
