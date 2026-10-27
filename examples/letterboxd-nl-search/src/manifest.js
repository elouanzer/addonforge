'use strict';

// The add-on's manifest: what Stremio reads first to know what this add-on offers.
// Field reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
// The version always comes from package.json.

const { version } = require('../package.json');

// forge:manifest:start (written by `forge new` from addon.forge.json; edit freely afterwards)
const MANIFEST = {
  "id": "community.addonforge.letterboxd-nl-search",
  "name": "Letterboxd NL Search",
  "description": "Search films in plain language (\"slow-burn 70s thrillers set in Paris\"), optionally personalised with your own Letterboxd export. Not affiliated with Letterboxd.",
  "resources": [
    "catalog"
  ],
  "types": [
    "movie"
  ],
  "catalogs": [
    {
      "type": "movie",
      "id": "letterboxd-nl-search",
      "name": "Letterboxd NL Search",
      "extra": [
        {
          "name": "search",
          "isRequired": true
        }
      ]
    }
  ]
};
// forge:manifest:end

module.exports = { ...MANIFEST, version };
