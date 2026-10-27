'use strict';

// The add-on's manifest: what Stremio reads first to know what this add-on offers.
// Field reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
// The version always comes from package.json.

const { version } = require('../package.json');

// forge:manifest:start (written by `forge new` from addon.forge.json; edit freely afterwards)
const MANIFEST = {
  "id": "community.addonforge.hello-catalog",
  "name": "Hello Catalog",
  "description": "A small catalog of public-domain films. No configuration, no API keys.",
  "resources": [
    "catalog"
  ],
  "types": [
    "movie"
  ],
  "catalogs": [
    {
      "type": "movie",
      "id": "hello-catalog",
      "name": "Hello Catalog",
      "extra": [
        {
          "name": "search",
          "isRequired": false
        },
        {
          "name": "genre",
          "isRequired": false,
          "options": [
            "Action",
            "Adventure",
            "Comedy",
            "Crime",
            "Drama",
            "Fantasy",
            "Film-Noir",
            "Horror",
            "Mystery",
            "Romance",
            "Sci-Fi",
            "Thriller"
          ]
        }
      ]
    }
  ]
};
// forge:manifest:end

module.exports = { ...MANIFEST, version };
