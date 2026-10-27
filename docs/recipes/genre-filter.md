# Genre filter

A catalog can offer a genre picker in Discover. Stremio shows the `options` you declare and sends the chosen one as `extra.genre` ([advanced.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md)).

1. In `addon.forge.json`, add `"genre"` to `catalogFeatures` and list the choices in `genres`:

   ```json
   "catalogFeatures": ["search", "genre"],
   "genres": ["Comedy", "Drama", "Horror", "Sci-Fi"]
   ```

   `forge new` turns this into `{ name: 'genre', isRequired: false, options: [...] }`.

2. Filter in the handler; the template already does:

   ```js
   if (extra.genre) metas = metas.filter((m) => (m.genres || []).includes(extra.genre));
   ```

3. Only offer genres your data can actually filter on, spelled exactly as your items' `genres`. Cinemeta's genre names (`Sci-Fi`, `Film-Noir`…) are a good default for IMDb-based catalogs.

When the source is an API with genre ids, keep a map from the displayed name to the API's id in the source adapter, and pass the id to the API rather than filtering locally.

`smoke` tries the first genre in `options`.
