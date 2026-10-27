'use strict';

// Starts the HTTP server. The SDK adds CORS; HTTPS is the host's or tunnel's job.
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/README.md

const { serveHTTP } = require('stremio-addon-sdk');
const { addonInterface } = require('./addon');

const port = Number.parseInt(process.env.PORT, 10) || 7100;

serveHTTP(addonInterface, { port }).then(({ server }) => {
  // Stop cleanly on `docker compose down` / Ctrl+C.
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
});
