'use strict';

// The add-on's manifest: what Stremio reads first to know what this add-on offers.
// Field reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
// The version always comes from package.json.

const { version } = require('../package.json');

// forge:manifest:start (written by `forge new` from addon.forge.json; edit freely afterwards)
const MANIFEST = {
  id: 'community.addonforge.node-sdk-template',
  name: 'Node SDK Template',
  description: 'Node SDK Template, built with Addon Forge',
  resources: ['catalog'],
  types: ['movie'],
  catalogs: [{ type: 'movie', id: 'node-sdk-template', name: 'Node SDK Template' }],
};
// forge:manifest:end

module.exports = { ...MANIFEST, version };
