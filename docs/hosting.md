# Hosting your add-on

Where your add-on runs decides how Stremio reaches it. The one hard rule:

> **Stremio only installs add-ons over HTTPS, with one exception: `http://127.0.0.1`.**
> ([protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md), [deploying](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md))

The SDK already sends the CORS headers Stremio needs. HTTPS is the job of whatever sits in front of your add-on: a tunnel or a host.

| You want to use it… | How | HTTPS needed | Effort |
|---|---|---|---|
| On the same computer | `http://127.0.0.1:7100/manifest.json` | No (127.0.0.1 exception) | None |
| On other devices (TV, phone), while this computer is on | A tunnel: `node tools/forge.js expose 7100` | Yes, the tunnel provides it | A few minutes |
| Always on, shareable with others | A host: BeamUp, or any Node/Docker host | Yes, the host provides it | Longer; accounts needed |

`7100` is the default port; yours is in `addons/<name>/addon.forge.json` (`port`). Addon Forge avoids 7000 because macOS uses it for AirPlay.

---

## 1. Same computer

Nothing to do. Start the add-on and install it from `http://127.0.0.1:<port>/manifest.json`:

```bash
node tools/forge.js install-link http://127.0.0.1:7100
```

Docker Compose binds the add-on to `127.0.0.1` only, so other machines on your network cannot reach it. That is deliberate.

> Why not `http://192.168.x.x:7100` for the TV? Stremio refuses plain HTTP on anything but 127.0.0.1, so a LAN address does not work. Use a tunnel.

## 2. Other devices: a tunnel

A tunnel gives your local add-on a public `https://` address. Run it while you use the add-on; stop it with Ctrl+C.

> ⚠️ **Anyone who has the tunnel URL can use your add-on**, and through it any API key it uses. Don't post the URL publicly, and stop the tunnel when you don't need it. If your add-on's configuration contains secrets, the install link contains them too.

### The quick way: `forge expose`

With the add-on running:

```bash
node tools/forge.js expose 7100
```

It picks the first tunnel tool it finds, prints the public HTTPS URL, runs `validate` and `smoke` against it, and prints the install link and a QR code to scan with your phone. Choose a tool with `--tool cloudflared|tailscale|localtunnel|docker`. It never installs anything or creates accounts: if no tool is found, it lists your options and stops.

### Which tunnel?

| Tool | Account | URL | Install |
|---|---|---|---|
| **Cloudflare quick tunnel** (`cloudflared`) — recommended | None | Random `https://….trycloudflare.com`, new at every start | [Download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (macOS: `brew install cloudflared`, Windows: `winget install --id Cloudflare.cloudflared`) |
| **Cloudflare via Docker** (`--tool docker`) | None | Same as above | Nothing, if you have Docker Desktop (macOS, Windows). Pulls the `cloudflare/cloudflared` image |
| **Tailscale Funnel** | Tailscale account, Funnel enabled | Stable `https://<machine>.<tailnet>.ts.net` | [Download](https://tailscale.com/download), then [enable Funnel](https://tailscale.com/kb/1223/funnel) |
| **localtunnel** (`lt`) | None | Random `https://….loca.lt` | `npm install -g localtunnel`. Least reliable: the free servers are often slow or down |

Notes:
- **Quick tunnels change URL** every time they start, so you reinstall the add-on in Stremio each time. For a stable URL, use Tailscale Funnel or a named Cloudflare tunnel (needs a Cloudflare account and a domain; see Cloudflare's docs).
- **The trycloudflare.com URL can take a few seconds** to start answering. `forge expose` waits for it.
- **On Linux**, `--tool docker` cannot reach an add-on bound to 127.0.0.1. Use the `cloudflared` binary, or the Compose profile below.

### Without `forge`: the Compose tunnel profile

Every add-on's `docker-compose.yml` has a `tunnel` service, **off by default**, that runs a Cloudflare quick tunnel next to the add-on:

```bash
docker compose --profile tunnel up -d --build
```

```bash
docker compose logs tunnel
```

Look for the `https://….trycloudflare.com` line, then check it from the Addon Forge folder:

```bash
node tools/forge.js validate https://<random-name>.trycloudflare.com
```

Stop it (and the add-on) with `docker compose --profile tunnel down`.

### Install on the other device

1. Run `node tools/forge.js install-link https://<tunnel-url>` (or use the output of `expose`).
2. On a **phone**: scan the QR code, or open the `stremio://` link.
3. On a **TV** or anything without a camera: in Stremio, open *Add-ons*, paste the `https://…/manifest.json` URL into the search field, and install.

## 3. Always on: a host

When the add-on should run without your computer, deploy it. Before you do, make sure it passes `validate` and `smoke` locally.

Every add-on made from the template is ready for hosts that run Node or Docker: it reads `PORT` from the environment and ships a `Dockerfile`.

- **[BeamUp](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/beamup.md)**: free hosting recommended by Stremio. Needs a GitHub account with an SSH key and the `beamup-cli`. Your add-on folder must be its own git repository.
- **Any Node or Docker host** (a VPS, Render, Fly.io, Railway…): deploy the add-on folder as a Node app (`npm start`) or with its `Dockerfile`, and make sure the host serves it over HTTPS. Put secrets in the host's environment variables, never in the repository.

Then check the public URL:

```bash
node tools/forge.js validate https://your-addon.example.com
```

```bash
node tools/forge.js smoke https://your-addon.example.com
```

### Publishing to Stremio's community list (optional)

Once it is publicly hosted over HTTPS, you *may* list it in Stremio's community add-ons with the SDK's [`publishToCentral`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/README.md). This is public and is always your explicit decision: Addon Forge and its assistants never do it for you.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Stremio says the add-on is invalid or won't install | Plain `http://` on something other than 127.0.0.1. Use a tunnel or HTTPS host. |
| `127.0.0.1:7000` answers HTTP 403 on a Mac | That's AirPlay Receiver, not your add-on. Use port 7100 (the default), or turn off AirPlay Receiver in System Settings. |
| The tunnel URL gives 502 or 1033 | The add-on isn't running, or runs on another port than the one you exposed. |
| Works on the computer, not on the TV | The TV got the `127.0.0.1` URL, which points at the TV itself. Use the tunnel URL. |
| It worked yesterday, not today | Quick tunnels get a new URL on every start. Reinstall from the new URL. |
