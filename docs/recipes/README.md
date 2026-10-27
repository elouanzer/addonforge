# Recipes

Short, tested patterns for the things most add-ons need. Each one fits the template's layout: data-source adapters in `src/sources/`, handlers in `src/addon.js`, tests in `test/`. The code is CommonJS, like the template.

| Recipe | Use it when |
|---|---|
| [search](search.md) | Stremio's search bar should query your catalog, or the catalog *is* a search engine |
| [pagination](pagination.md) | A catalog has more than 100 titles, or the API returns pages |
| [genre-filter](genre-filter.md) | Users should filter a catalog by genre in Discover |
| [caching](caching.md) | Responses are slow, or the source is slow, paid or rate-limited |
| [rate-limited-apis](rate-limited-apis.md) | The source limits requests per second or per day |
| [imdb-mapping](imdb-mapping.md) | You have titles (and years) and need IMDb ids |
| [subtitles](subtitles.md) | The add-on provides subtitles, e.g. from a folder of `.srt` files |
| [llm-search](llm-search.md) | Searches in plain language, understood by a language model |

The protocol details behind them are in [../protocol-cheatsheet.md](../protocol-cheatsheet.md).
