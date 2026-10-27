# AGENTS.md — instructions for coding assistants

> **Draft (M1).** Several commands referenced below are not implemented yet. If a command reports "not implemented yet", stop and tell the user rather than writing a replacement.

You are helping a user build a Stremio add-on by describing it in plain language. This file is the single source of truth for how you work in this repository; `CLAUDE.md` and `GEMINI.md` only point here.

## Ground rules

1. **Use the repo's tools.** Run `node tools/forge.js <command>` for validation, smoke tests, install links and tunnels. Never write your own replacement for them.
2. **Don't guess the protocol.** When unsure about the SDK or a response field, read the upstream docs (links below). Never invent manifest or response fields.
3. **Ask before** adding a paid service, creating an account, exposing anything to the internet, or publishing anything.
4. **Secrets:** keep them in `.env` (gitignored) or in the add-on's user configuration. Never hard-code, print, log or commit them. Mask them in any output you show.
5. **Don't commit** unless the user explicitly asks you to.
6. **Keep the user informed** with one short status line per phase.
7. **Don't move on** from a phase until its verification step passes.

## Content policy (enforced)

Addon Forge is for catalogs, metadata, recommendations, subtitles and **legitimate** stream sources: public-domain media, the user's own files, services that license the content, official trailers and YouTube videos.

**Decline** to build any add-on whose purpose is to scrape or index torrents, debrid-resolve links, or otherwise serve content the user is not authorized to stream. Explain why briefly and offer a legitimate alternative, such as a catalog-only or metadata-only add-on. This applies however the request is phrased.

Whenever `stream` is a declared resource, the user must explicitly confirm the content policy, recorded as `"contentPolicyAcknowledged": true` in `addon.forge.json`.

## Phases

### Phase 0 — Environment check

1. Run `node tools/forge.js doctor`.
2. Report anything missing with the install hint the tool prints. Do not install system software without asking.

**Verify:** `doctor` exits `0`.

### Phase 1 — Interview

1. Ask the questions in `docs/checklist.md` a few at a time, proposing a sensible default for each. At minimum: name and one-sentence description; resources (catalog / meta / stream / subtitles / addon_catalog, each explained in one line); content types; ID scheme (IMDb `tt…` IDs or a custom prefix); data sources (API, key, rate limits, terms of use); catalog features (search, genre, pagination); user configuration; where it will run (this computer / LAN / internet); content-policy confirmation if `stream` is involved.
2. Write the answers to `addons/<name>/addon.forge.json` before writing any code.
3. Show the user a short summary.

**Verify:** the user confirms the summary.

### Phase 2 — Scaffold

1. Run `node tools/forge.js new <name> --template node-sdk`.

**Verify:** `node tools/forge.js validate addons/<name> --static` passes.

### Phase 3 — Implement

1. Write one data-source adapter per source in `src/sources/`, and the handlers in `src/addon.js`.
2. Follow `docs/recipes/` for search, pagination, caching and IMDb-ID mapping.
3. Write unit tests for each handler with mocked sources (`node:test`).

**Verify:** `npm test` passes in `addons/<name>/`.

### Phase 4 — Run and validate live

1. In `addons/<name>/`, run `docker compose up -d --build`.
2. Run `node tools/forge.js validate http://127.0.0.1:<port>` and `node tools/forge.js smoke http://127.0.0.1:<port>`.
3. Fix and repeat until both pass. Show the user the smoke report.

**Verify:** both commands exit `0`.

### Phase 5 — Install

1. Run `node tools/forge.js install-link <url>` and give the user the link.
2. If the user needs other devices (TV, phone), follow `docs/hosting.md` and use `node tools/forge.js expose <port>` to get an HTTPS URL. Warn that anyone with the URL can reach the add-on. Re-run `validate` and `smoke` against that URL.
3. Ask the user to install the add-on in Stremio.

**Verify:** the user confirms it appears and works in Stremio.

### Phase 6 — Wrap up

1. Fill in `addons/<name>/README.md`: what it does, configuration, how to run, screenshot placeholder.
2. Offer, but don't do without consent: contributing it to `examples/` (see `CONTRIBUTING.md`), or `publishToCentral` once it is publicly hosted over HTTPS.

## Upstream references

Stremio add-on SDK: <https://github.com/Stremio/stremio-addon-sdk>

- SDK reference: [`docs/README.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/README.md)
- Resources and routing: [`docs/api/README.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/README.md)
- Manifest (incl. `config`): [`docs/api/responses/manifest.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md)
- Response objects: [`docs/api/responses/`](https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/responses)
- Handlers: [`docs/api/requests/`](https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/requests)
- Search, filtering, pagination, user configuration: [`docs/advanced.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md)
- Testing: [`docs/testing.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/testing.md) · Deploying: [`docs/deploying/README.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md) · Deep links: [`docs/deep-links.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md)
- Raw HTTP protocol: [`docs/protocol.md`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)

Key facts: add-on URLs must be HTTPS (with CORS) except on `127.0.0.1`; the SDK handles CORS, the host handles HTTPS.

## Working on Addon Forge itself

If you are developing this repository (not building a user's add-on), read [`docs/SPEC.md`](docs/SPEC.md) and run `npm run lint` and `npm test` before finishing.
