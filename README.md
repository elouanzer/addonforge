<h1 align="center"><img src="assets/logo.svg" alt="Addon Forge" width="480"></h1>

**Describe the Stremio add-on you want in one sentence. Your coding assistant builds it, checks it, runs it and gives you an install link.**

<!-- GIF placeholder: "described in one sentence → installed in Stremio" -->

Addon Forge is a repository you open in a coding assistant (Claude Code, Codex, Gemini CLI…). It gives the assistant a step-by-step procedure, a tested template and tools that check the result against Stremio's add-on protocol, so you get a working add-on without writing the code yourself. Everything also works by hand.

## How it works

| Step | You | The assistant, with this repo |
|---|---|---|
| 1. Describe | Say what you want: *"French subtitles from a folder on my computer"* | Asks a short checklist of questions, each with a sensible default |
| 2. Build and check | Answer the questions | Creates the add-on from a template, writes and tests the code, runs it in Docker, and checks it against the Stremio protocol |
| 3. Install | Paste the link into Stremio | Gives you the install link, and a QR code for your TV or phone |

## Quick start

**You need:** [Node.js](https://nodejs.org) (the LTS version), [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running), [git](https://git-scm.com/downloads), and [Stremio](https://www.stremio.com/downloads).

```bash
git clone https://github.com/elouanzer/addonforge.git
```

```bash
cd addonforge
```

```bash
node tools/forge.js doctor
```

`doctor` checks your setup and tells you how to fix anything missing.

| You have | Do this |
|---|---|
| A coding assistant | Open the `addonforge` folder in it, copy [`PROMPT.md`](PROMPT.md), replace the example idea with yours, and paste it. Then answer the questions. Expect about 15 minutes. |
| No assistant | Follow [Doing it by hand](#doing-it-by-hand) below. |

**Try a ready-made add-on first** (about a minute):

```bash
cd examples/hello-catalog
```

```bash
docker compose up -d --build --wait
```

Then, in Stremio, open **Add-ons**, paste `http://127.0.0.1:7100/manifest.json` into the search bar, and install. A "Hello Catalog" row of public-domain films appears on your Board. Remove it later with `docker compose down` in the same folder.

## What you can build

An add-on can provide one or more of these:

| It adds… | In plain words | Ideas |
|---|---|---|
| **Catalogs** | Rows of films or series on the Board, in Discover, or in search results | Palme d'Or winners · a random pick from your Letterboxd watchlist · trending films from an API · a search that understands plain language |
| **Subtitles** | Subtitle tracks in the player | French subtitles from a folder on your computer · subtitles in your language from an online service |
| **Details pages** | The page with the synopsis, cast and episodes | Your own home videos or a podcast, which IMDb doesn't know |
| **Streams** | Something to play, from a legitimate source only | Public-domain films · official trailers · your own videos |
| **Add-on lists** | A list of other add-ons to install | Your favourite add-ons, as one collection |

Films and series known to IMDb get their posters and details pages from Stremio for free. Read the [content policy](#content-policy) before planning streams.

## Doing it by hand

Every step the assistant takes is a command you can run yourself. From the `addonforge` folder:

| Command | What it does |
|---|---|
| `node tools/forge.js doctor` | Check Node, npm, Docker, Docker Compose and the optional tunnel tools |
| `node tools/forge.js new <name>` | Create `addons/<name>/` from the template, from `addons/<name>/addon.forge.json` if you wrote one |
| `node tools/forge.js validate <path-or-url>` | Check the manifest, and with a URL the live responses, against the protocol |
| `node tools/forge.js smoke <url>` | Call every declared endpoint and report status, latency and item count |
| `node tools/forge.js install-link <url>` | Print the install links and a QR code |
| `node tools/forge.js expose <port>` | Make a local add-on reachable over HTTPS through a tunnel |
| `node tools/forge.js list` | List the examples and your add-ons, with their port and status |

Every command accepts `--json`, and `node tools/forge.js --help` lists their options. A typical session:

```bash
node tools/forge.js new my-catalog
```

New add-ons use port 7100, like `hello-catalog`: stop it first (`docker compose down` in its folder), choose another `port` in `addons/<name>/addon.forge.json` before running `new`, or set `HOST_PORT` in the add-on's `.env`.

In the add-on's folder (`cd addons/my-catalog`), install, test and start it:

```bash
npm install
```

```bash
npm test
```

```bash
docker compose up -d --build --wait
```

Back in the `addonforge` folder (`cd ../..`), check it:

```bash
node tools/forge.js validate http://127.0.0.1:7100
```

```bash
node tools/forge.js smoke http://127.0.0.1:7100
```

Then edit `addons/my-catalog/src/`: [`AGENTS.md`](AGENTS.md) describes each phase, and [`docs/checklist.md`](docs/checklist.md) the settings in `addon.forge.json`. Your add-ons live in `addons/`, which git ignores.

## Hosting

Stremio only installs add-ons over **HTTPS**, except on `http://127.0.0.1`.

| You want to use it… | How | HTTPS |
|---|---|---|
| On the same computer | `http://127.0.0.1:<port>/manifest.json` | Not needed |
| On other devices (TV, phone) | A tunnel: `node tools/forge.js expose <port>` | Provided by the tunnel |
| Always on, shareable | A host, such as BeamUp or any Node or Docker host | Provided by the host |

Details, tunnel options and their trade-offs are in [`docs/hosting.md`](docs/hosting.md).

## Examples

| Example | What it shows |
|---|---|
| [`hello-catalog`](examples/hello-catalog/) | The smallest add-on: ten public-domain films, search and genre filter. No configuration, no key. |
| [`letterboxd-nl-search`](examples/letterboxd-nl-search/) | Search in plain language ("slow-burn 70s thrillers set in Paris") with a keyword, Anthropic, OpenAI or Ollama backend, personalised with your own Letterboxd export. |

More, built by the community, in [`SHOWCASE.md`](SHOWCASE.md).

## Documentation

- [`AGENTS.md`](AGENTS.md): the procedure assistants follow, phase by phase. Useful to read by hand too.
- [`docs/checklist.md`](docs/checklist.md): the questions you'll be asked, and what each one means.
- [`docs/recipes/`](docs/recipes/): search, pagination, genre filters, caching, rate-limited APIs, IMDb ids, subtitles, natural-language search.
- [`docs/configuration.md`](docs/configuration.md): settings, secrets and per-user configuration.
- [`docs/hosting.md`](docs/hosting.md): using your add-on on a TV or phone, or hosting it.
- [`docs/protocol-cheatsheet.md`](docs/protocol-cheatsheet.md): the Stremio add-on protocol in one page.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md): when something doesn't work.

## Why JavaScript?

The add-ons are built on Stremio's official [add-on SDK](https://github.com/Stremio/stremio-addon-sdk), which only exists for Node.js. It does the protocol work for every add-on: routing requests to the right handler, CORS headers, checking the manifest at startup, the Configure page for per-user settings, and cache headers. Using it keeps generated add-ons small and in step with Stremio, and leaves the protocol details to Stremio's own code rather than a reimplementation.

The tools in `tools/` are JavaScript too, so you install only one runtime. They don't depend on the SDK, though: they only talk to a running add-on over HTTP, so they can check an add-on written in any language. A Python template is a likely next step for people who prefer Python.

## Content policy

Addon Forge is for catalogs, metadata, recommendations, subtitles and **legitimate** stream sources: public-domain media, your own files, services that license their content, official trailers. Assistants following this repo will decline add-ons that scrape or index torrents, debrid-resolve, or otherwise serve content you are not authorized to stream. Details in [`CONTRIBUTING.md`](CONTRIBUTING.md#content-policy).

## Contributing

Built something others could use? Share it in [`SHOWCASE.md`](SHOWCASE.md), or propose it as an example. Found a bug, or an assistant that got stuck? Open an issue. Everything is explained in [`CONTRIBUTING.md`](CONTRIBUTING.md). Security problems go through [`SECURITY.md`](SECURITY.md).

## License and credits

[MIT](LICENSE). Built on the official [Stremio add-on SDK](https://github.com/Stremio/stremio-addon-sdk). Inspired by [cleanyourtv](https://github.com/Gathin23/cleanyourtv).

Addon Forge is an independent community project, not affiliated with or endorsed by Stremio.
