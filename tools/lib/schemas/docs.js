'use strict';

/**
 * Links to the upstream protocol docs that each validation rule cites.
 * Update here if the upstream docs move.
 */

const SDK = 'https://github.com/Stremio/stremio-addon-sdk/blob/master/docs';
const MANIFEST = `${SDK}/api/responses/manifest.md`;

module.exports = Object.freeze({
  manifest: MANIFEST,
  manifestBasic: `${MANIFEST}#basic-information`,
  manifestFiltering: `${MANIFEST}#filtering-properties`,
  manifestCatalogs: `${MANIFEST}#catalog-format`,
  manifestExtra: `${MANIFEST}#extra-properties`,
  manifestAddonCatalogs: `${MANIFEST}#addon-catalogs`,
  manifestUserData: `${MANIFEST}#user-data`,
  manifestConfig: `${MANIFEST}#config-format`,
  manifestOther: `${MANIFEST}#other-metadata`,
  sdkBuilder: `${SDK}/README.md`,
  resources: `${SDK}/api/README.md`,
  protocol: `${SDK}/protocol.md`,
  transports: `${SDK}/protocol.md#transports-urls`,
  deploying: `${SDK}/deploying/README.md`,
  catalogHandler: `${SDK}/api/requests/defineCatalogHandler.md`,
  metaPreview: `${SDK}/api/responses/meta.md#meta-preview-object`,
  meta: `${SDK}/api/responses/meta.md#meta-object`,
  video: `${SDK}/api/responses/meta.md#video-object`,
  stream: `${SDK}/api/responses/stream.md#stream-object`,
  subtitles: `${SDK}/api/responses/subtitles.md#subtitles-object`,
  addonCatalog: `${SDK}/api/responses/addon_catalog.md#addon-catalog-object`,
});
