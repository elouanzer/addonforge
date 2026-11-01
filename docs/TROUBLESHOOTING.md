# Troubleshooting

Problems people actually run into, and their fixes. Start with `node tools/forge.js doctor`: it checks your setup and prints install hints. For an add-on that misbehaves, `docker compose logs addon` in its folder shows what it printed. Tunnels and HTTPS have their own section in [hosting.md](hosting.md#troubleshooting).

## Setup

| Symptom | Fix |
|---|---|
| `docker: command not found`, but Docker Desktop is installed | Its folder isn't on your PATH. `doctor` finds it anyway and prints the exact command to fix it, for now and for good. |
| `doctor` says the Docker engine is missing | Docker Desktop isn't running. Start it and wait until it shows "Engine running". On Linux: `sudo systemctl start docker`. |
| `doctor` warns that Node isn't an LTS release | Things should work, but install the LTS version from [nodejs.org](https://nodejs.org) if anything behaves oddly. |

## Starting an add-on

| Symptom | Fix |
|---|---|
| `Bind for 127.0.0.1:7100 failed: port is already allocated` | Another add-on uses that port, often `hello-catalog`. `node tools/forge.js list` shows which. Stop it (`docker compose down` in its folder), or move yours: set `HOST_PORT=7104` (any free port) in its `.env`, restart it, and use that port in its URL. |
| `http://127.0.0.1:7000` answers `403` on a Mac | That's macOS's AirPlay Receiver, not your add-on. Addon Forge uses 7100 and up. (On Windows, port problems look different: see [On Windows](#on-windows).) |
| `docker compose up --wait` fails with "unhealthy" | The add-on crashed at startup. `docker compose logs addon` shows the error, often a typo in the code or a missing setting in `.env`. |
| A change to `.env` or the code has no effect | Rebuild and restart: `docker compose up -d --build --wait`. |
| The add-on can't reach a service on your computer (Ollama, a local API) | Inside Docker, `127.0.0.1` is the container itself. Use `http://host.docker.internal:<port>` instead. |

## Checking it

| Symptom | Fix |
|---|---|
| `validate` reports `manifest-unreachable` | Nothing answers on that port: the add-on isn't running, or runs on another port (`node tools/forge.js list`). |
| A search-only catalog shows "0 item(s)" | `validate` and `smoke` search for "test" by default. Give them a real query: `--search "70s thriller"`. |
| `validate` warns `not-configured` on an add-on with user settings | It tested without settings. Pass test values: `--config '{"username":"test"}'` to `validate`, `smoke` and `install-link`. |
| `slow-response` warnings, or requests that time out after 15 s | The source or the model is slow. Cache results ([recipes/caching.md](recipes/caching.md)), or use a faster backend. |

## On Windows

| Symptom | Fix |
|---|---|
| Docker says `Ports are not available` … `An attempt was made to access a socket in a way forbidden by its access permissions` | Windows reserves ranges of ports for Hyper-V and WSL, and the add-on's port fell in one. See them with `netsh interface ipv4 show excludedportrange protocol=tcp`, then set `HOST_PORT` in the add-on's `.env` to a port outside every range, and use that port in its URL. |
| `The token '&&' is not a valid statement separator` | Windows PowerShell 5.1 can't chain commands with `&&`. Run them one at a time, or use PowerShell 7, Git Bash or the Command Prompt. |
| `--config` says the JSON is invalid | Windows PowerShell 5.1 strips double quotes from arguments. Escape them, `--config '{\"username\":\"test\"}'`, or use PowerShell 7. |
| `docker` is not recognized | Docker Desktop's folder isn't on your PATH. `doctor` finds it and prints the PowerShell command to fix it. |
| Docker Desktop won't start | It needs WSL 2 and virtualization turned on. Follow the steps Docker Desktop shows at startup, or [its Windows install guide](https://docs.docker.com/desktop/setup/install/windows-install/). |

## In Stremio

| Symptom | Fix |
|---|---|
| Stremio refuses to install the add-on | The URL is plain `http://` on something other than `127.0.0.1`. From another device, use a tunnel: [hosting.md](hosting.md). |
| Installed, but no row on the Board | A search-only catalog only appears in search results: type a search. Otherwise, check that the catalog returns items: `node tools/forge.js smoke http://127.0.0.1:<port>`. |
| Old results after changing the code | Stremio caches responses for as long as their `cacheMaxAge` says. Wait, or remove and reinstall the add-on. Lower `cacheMaxAge` while developing. |
| Details pages are empty for your titles | Titles with custom ids need your add-on's own `meta` resource. With IMDb ids (`tt…`), check the id is right. |
| Subtitles show garbled accents | The file isn't UTF-8. Convert it, for example by re-saving it as UTF-8 in a text editor. |

## Data sources

| Symptom | Fix |
|---|---|
| Cinemeta lookups fail with `HTTP 504` | Cinemeta is busy. Retry once after a pause, and limit concurrent lookups. `examples/letterboxd-nl-search/src/sources/cinemeta.js` does both. |
| An API answers `429 Too Many Requests` | You hit its rate limit. See [recipes/rate-limited-apis.md](recipes/rate-limited-apis.md). |
| An LLM backend returns few or wrong films | Smaller local models ignore parts of a request. See [recipes/llm-search.md](recipes/llm-search.md) for the checks that help, or use a larger model. |

Still stuck? [Open an issue](https://github.com/elouanzer/addonforge/issues/new/choose) with the command you ran and its full output. Remove any API key first.
