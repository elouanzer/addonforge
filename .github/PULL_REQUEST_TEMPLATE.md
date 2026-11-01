## What this changes

<!-- One or two sentences. Link the issue it fixes, if any. -->

## Checklist

- [ ] `npm run lint` and `npm test` pass.
- [ ] New behaviour has tests; `AGENTS.md`, the checklist or recipes are updated if assistants are affected.
- [ ] No secrets, personal data or real `.env` files are included.
- [ ] **Content policy:** this is not about scraping or indexing torrents, debrid services, or streaming content without authorization ([CONTRIBUTING.md](https://github.com/elouanzer/addonforge/blob/main/CONTRIBUTING.md#content-policy)).

### For a new example or showcase entry

- [ ] Generated with `node tools/forge.js new`, with its own `port`.
- [ ] Passes CI with no key and no network (keyless mode or recorded fixtures), and is listed in the `examples` matrix of `.github/workflows/ci.yml`.
- [ ] Its README covers what it does, its data sources and their terms, its configuration and how to run it, with a `screenshot.png` at most 1400 px wide.
- [ ] If it declares a `stream` resource: where the streams come from, and why they are legitimate:

<!-- Examples with a stream resource get an extra review by a maintainer. -->
