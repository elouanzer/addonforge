# {{displayName}}

{{description}}

A Stremio add-on built with [Addon Forge](https://github.com/elouanzer/addonforge) on the official [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk).

<!-- Screenshot: add screenshot.png showing the add-on in Stremio -->

## What it does

- **Resources:** {{resources}}
- **Content types:** {{types}}
- **Data source(s):** {{sources}}

## Configuration

{{configuration}}

Secrets (API keys) go in `.env`, copied from `.env.example`. Never commit `.env`.

## Run it

With Docker (recommended):

```bash
docker compose up -d --build
```

Without Docker:

```bash
npm install
npm start
```

Then install it in Stremio from `http://127.0.0.1:{{port}}/manifest.json`, or from Addon Forge:

```bash
node tools/forge.js install-link http://127.0.0.1:{{port}}/manifest.json
```

To use it on other devices (TV, phone), see Addon Forge's `docs/hosting.md`.

## Develop

```bash
npm test
```

- `src/manifest.js`: what the add-on declares to Stremio
- `src/addon.js`: request handlers
- `src/sources/`: one adapter per data source
- `test/`: handler tests with mocked sources
