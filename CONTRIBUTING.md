# Contributing to Addon Forge

Thanks for helping. There are four ways to contribute, from quickest to most involved:

1. **Report friction.** An assistant got stuck, guessed wrong, or needed you to fix something by hand? [Open an "Assistant friction" issue](https://github.com/elouanzer/addonforge/issues/new/choose). These reports are what make the guided flow better.
2. **Share your add-on** in [`SHOWCASE.md`](SHOWCASE.md).
3. **Propose an example** for `examples/`: a reviewed, documented add-on others can learn from.
4. **Improve Addon Forge itself:** tools, template, docs, recipes.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Content policy

Addon Forge is for **catalogs, metadata, recommendations, subtitles and legitimate stream sources**: public-domain media, your own files, services that license their content, official trailers and YouTube videos.

It does not accept, and its assistant instructions decline to build, add-ons whose purpose is to scrape or index torrents, debrid-resolve links, or otherwise serve content you are not authorized to stream. That covers examples, showcase entries, recipes and issues asking for help with such add-ons. They are closed without discussion. The policy keeps this repository legitimate and online for everyone.

Any contribution with a `stream` resource gets an extra review by a maintainer, who checks where the streams come from.

## Sharing your add-on in the showcase

Open a pull request that adds one entry to [`SHOWCASE.md`](SHOWCASE.md), following the format at the top of that file. The add-on's code can live in your own repository. Showcase entries need:

- a public repository or page with the add-on's README;
- a screenshot of it in Stremio, at most 1400 px wide;
- data sources that allow this use, linked from its README.

## Proposing an example

Examples are part of the repository: CI builds, validates and smoke-tests each one on every pull request, and assistants learn from them. So the bar is higher.

**An example must:**

- **Be generated from the template** with `node tools/forge.js new`, and keep its layout (`src/addon.js`, `src/sources/`, `test/`, Dockerfile, Compose file).
- **Have a valid `addon.forge.json`,** with a `port` no other example uses (`node tools/forge.js list` shows them).
- **Pass with no key and no network** in CI. If it needs an API key or an online service, give it a keyless mode (built-in data, recorded fixtures), as `letterboxd-nl-search` does, and use that mode by default.
- **Have tests** for each handler, with mocked sources: `npm test` never calls the network.
- **Pass `validate` and `smoke`** in Docker, with `--search` if its catalog is search-only.
- **Contain no secrets and no personal data:** an `.env.example` with empty values, never a real `.env`, and no exports of your own accounts. CI fails if anything looks like an API key.
- **Have a README** with what it does, its data sources and their terms of use, its configuration, how to run it, and a `screenshot.png` of it in Stremio, at most 1400 px wide.
- **Be listed in CI:** add its folder name to the `examples` matrix in `.github/workflows/ci.yml`. A repository test fails if you forget.

Open the pull request using the template, and say what the example teaches that the others don't.

## Working on Addon Forge itself

```bash
npm install
```

```bash
npm run lint
```

```bash
npm test
```

Both must pass, and CI runs them on Linux, macOS and Windows with Node 22 and 24. The conventions:

- **CommonJS and plain JavaScript,** with JSDoc types on public functions. Small files, readable over clever.
- **No new dependency** without a reason, written in [`tools/README.md`](tools/README.md). The tools use Node's standard library: `node:test`, `fetch`, `node:http`.
- **`tools/` talks to add-ons over HTTP only.** It must never depend on the add-on's language, so a future Python template works with the same tools.
- **Cross-platform:** no shell-specific code in `tools/`; npm scripts work in PowerShell.
- **Every command** prints a readable report, supports `--json`, and exits `0` (success), `1` (a check failed) or `2` (usage or environment problem).
- **Every validation rule** in `tools/lib/rules.js` has a broken fixture in `tests/validate.test.js`, and a test fails if one is missing.
- **Docs and assistants:** if a change affects how an assistant should work, update [`AGENTS.md`](AGENTS.md), the [checklist](docs/checklist.md) or a [recipe](docs/recipes/). Repository tests check that links resolve and that every `forge` command the docs mention exists.

### Changing the template

`templates/node-sdk/` is copied into every new add-on, so treat it as an API. Run its own tests (`npm test` in its folder), then generate a fresh add-on and check it runs:

```bash
node tools/forge.js new template-check
```

Then, in `addons/template-check`, run `npm install`, `npm test` and `docker compose up -d --build --wait`, and from the repository root:

```bash
node tools/forge.js validate http://127.0.0.1:7100
```

## Pull request checklist

The [pull request template](.github/PULL_REQUEST_TEMPLATE.md) repeats this list:

- [ ] `npm run lint` and `npm test` pass.
- [ ] New behaviour has tests; docs and `AGENTS.md` are updated if assistants are affected.
- [ ] No secrets, personal data or real `.env` files.
- [ ] The change respects the [content policy](#content-policy).
- [ ] For an example: it's in the CI matrix, passes in its keyless mode, and has a README and screenshot.
