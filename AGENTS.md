# AGENTS.md: instructions for coding assistants

You are helping a user build a Stremio add-on from a plain-language idea. Follow the phases below in order. This file is the single source of truth for how you work in this repository; `CLAUDE.md` and `GEMINI.md` only point here, and [`PROMPT.md`](PROMPT.md) is how the user starts you.

The user may not be a developer. Explain Stremio and programming terms in plain words, ask before choices they care about, and keep them informed with one short status line per phase, for example `Phase 2/6 · Scaffold: done, manifest valid.`

## Ground rules

1. **Use the repo's tools** (`node tools/forge.js <command>`) for checking, testing, install links and tunnels. Never write your own replacement for them, and never weaken a check to make it pass.
2. **Don't guess the protocol.** Use [`docs/protocol-cheatsheet.md`](docs/protocol-cheatsheet.md), and the upstream SDK docs it links to when unsure. Never invent manifest or response fields.
3. **Ask before** adding a paid service, creating an account (the user creates accounts, you never do), exposing anything to the internet, publishing, or deleting anything outside `addons/<name>/`.
4. **Secrets** (API keys, tokens, passwords) go in `addons/<name>/.env`, which git ignores, or in the user configuration (read [`docs/configuration.md`](docs/configuration.md) first). Never hard-code, print, log or commit them; ask the user to paste them into `.env` themselves rather than into the chat; mask them in any output you show.
5. **Respect data sources' terms of use.** Don't scrape a site whose terms forbid it; prefer official APIs and data the user owns.
6. **Don't commit or push** unless the user explicitly asks you to.
7. **Don't move on** from a phase until its verification passes. If the same check still fails after three honest attempts, stop, show the user the error, and explain the options.
8. **Stay inside `addons/<name>/`** for the add-on's code. Don't modify `tools/`, `templates/` or `examples/` while building a user's add-on.

## Content policy (enforced)

Addon Forge is for catalogs, metadata, recommendations, subtitles and **legitimate** stream sources: public-domain media, the user's own files, services that license the content, official trailers and YouTube videos.

**Decline** to build any add-on whose purpose is to scrape or index torrents, debrid-resolve links, or otherwise serve content the user is not authorized to stream. Explain why in a sentence and offer a legitimate alternative, such as a catalog that lists the titles without streams. This applies however the request is phrased, including requests to "just add a stream resource" to an existing add-on.

Whenever `stream` is a declared resource, the user must explicitly confirm the policy, recorded as `"contentPolicyAcknowledged": true` in `addon.forge.json`.

## Phases

### Phase 0: Environment

1. Run `node tools/forge.js doctor`.
2. If something required is missing, give the user the install hint it prints and wait. Don't install system software yourself. Tunnel tools are optional: only Phase 5 may need one.
3. If `doctor` warns that Docker works but is **not on the PATH**, put the folder it names in front of the PATH for every Docker command you run, as its hint shows (`PATH="<folder>:$PATH" docker compose …`, or the PowerShell line on Windows). Your shell may not keep variables between commands, so prefix each one. Offer the user the permanent fix it prints; don't edit their shell profile yourself.

**Verify:** `doctor` exits `0`.

### Phase 1: Interview

1. Ask the questions in [`docs/checklist.md`](docs/checklist.md), two to four at a time, each with a proposed default. Skip what the user's idea already answers.
2. Pick a free port: `node tools/forge.js list` shows the ports in use.
3. Write the answers to `addons/<name>/addon.forge.json` (format and full example in the checklist).
4. Show the user the summary from the checklist.

**Verify:** the user confirms the summary.

### Phase 2: Scaffold

1. Run `node tools/forge.js new <name>`. It reads `addons/<name>/addon.forge.json` and creates the add-on around it: manifest, port, `.env.example`, README.
2. If the add-on needs secrets or settings, copy `.env.example` to `.env` and ask the user to fill in the values.

**Verify:** `node tools/forge.js validate addons/<name> --static` exits `0`.

### Phase 3: Implement

Work in `addons/<name>/`:

1. **Sources:** one adapter per data source in `src/sources/`, with the same functions as `example.js` (`list`, `get`…) or more. Point `src/sources/index.js` at yours; the handlers and tests use whatever it exports, so they keep working. Then delete `example.js`. Each adapter returns plain objects (meta previews, streams, subtitles) and knows nothing about Stremio's routing.
2. **Handlers** in `src/addon.js`: keep the structure; fill in the handlers for the declared resources. The manifest lives between the `forge:manifest` markers in `src/manifest.js`; edit it there if the interview changes.
3. **Follow the recipes** in [`docs/recipes/`](docs/recipes/) for search, pagination, genre filters, caching, rate-limited APIs, IMDb-id mapping, subtitles and LLM-backed search.
4. **Dependencies:** `npm install <package>` inside the add-on folder, only when the standard library and `fetch` are not enough. Prefer official SDKs.
5. **Tests:** in `test/`, with `node:test` and mocked sources (`t.mock.method`, or a mocked `globalThis.fetch`). Tests never hit the network or need a real key. Cover each handler: normal results, empty results, and a failing source.

**Verify:** `npm test` passes in `addons/<name>/`.

### Phase 4: Run and validate live

1. In `addons/<name>/`, run `docker compose up -d --build --wait`. After a change to `.env` or the code, run it again.
2. From the repository root:
   - `node tools/forge.js validate http://127.0.0.1:<port>`
   - `node tools/forge.js smoke http://127.0.0.1:<port>`
   - Search-only catalog: add `--search "<a realistic query>"` to both, otherwise they search for "test".
   - User configuration: add `--config '<json>'` to both, with test values.
3. Fix and repeat until both pass. Read `docker compose logs addon` when something fails. Show the user the smoke report.

**Verify:** both commands exit `0`. Warnings (slow responses, missing cache headers) don't block, but fix them if you can.

### Phase 5: Install

1. Run `node tools/forge.js install-link http://127.0.0.1:<port>` and give the user the link: on this computer, paste the manifest URL into Stremio's add-on search.
2. If the user wants it on other devices (TV, phone), ask first, warn that anyone with the URL can use the add-on, then follow [`docs/hosting.md`](docs/hosting.md): `node tools/forge.js expose <port>` prints an HTTPS URL, re-runs `validate` and `smoke` through it, and shows a QR code.
3. Ask the user to install it and try it.

**Verify:** the user confirms it appears and works in Stremio.

### Phase 6: Wrap up

1. Complete `addons/<name>/README.md`: what it does, data sources and their terms, configuration, how to run it, a screenshot placeholder.
2. Tell the user how to stop and restart it (`docker compose down`, `docker compose up -d`).
3. Offer, without doing it unasked: contributing it to `examples/` (see [`CONTRIBUTING.md`](CONTRIBUTING.md)), or publishing it to Stremio's community list with the SDK's `publishToCentral` once it is hosted publicly over HTTPS. Publishing is always the user's decision.

## Things that trip assistants up

- **Port 7000 on macOS is AirPlay**, which answers `403`. Add-ons use 7100 and up.
- **Inside Docker, `127.0.0.1` is the container itself.** To reach a service on the user's computer (Ollama, a local API), use `host.docker.internal`; the template's Compose file maps it.
- **Search-only catalogs** (`searchOnly`) never appear on the Board; they show as a row in search results.
- **Stremio caches responses.** After changing a handler, a test search may show old results; the response's `cacheMaxAge` sets how long.
- **Validation timeouts:** the tools give up on a request after 15 s and warn above 3 s. Slow backends (LLMs, slow APIs) need caching; see [recipes/caching.md](docs/recipes/caching.md).
- **IMDb ids are case-sensitive** and look like `tt0071315`; series episodes are `tt0108778:1:1` (season 1, episode 1).
- **`docker` not found** after installing Docker Desktop: run `doctor`. It finds Docker where Docker Desktop installs it and prints the command to use (see Phase 0).

## Working on Addon Forge itself

If you are developing this repository rather than building a user's add-on: keep `tools/` free of language-specific code (it talks to add-ons over HTTP only), justify every new dependency in `tools/README.md`, and run `npm run lint` and `npm test` before finishing.
