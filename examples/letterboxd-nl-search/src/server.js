'use strict';

// Starts the HTTP server. The SDK adds CORS; HTTPS is the host's or tunnel's job.
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/README.md

const { serveHTTP } = require('stremio-addon-sdk');
const { addonInterface, config } = require('./addon');
const { describe } = require('./config');

const port = Number.parseInt(process.env.PORT, 10) || 7101;

for (const problem of config.problems) console.warn(`Config: ${problem}. Using keyword search instead.`);
console.log(`Letterboxd NL Search: ${describe(config)}`);

serveHTTP(addonInterface, { port }).then(({ server }) => {
  // Stop cleanly on `docker compose down` / Ctrl+C.
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
});
