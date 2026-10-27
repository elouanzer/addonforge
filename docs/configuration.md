# Settings, secrets and user configuration

An add-on can get its settings from two places. Choosing the right one is mostly a question of **who the add-on is for**.

| | Environment variables (`.env`) | User configuration (`manifest.config`) |
|---|---|---|
| Set by | Whoever runs the add-on | Each person who installs it, on its Configure page |
| Same for everyone | Yes | No: each install has its own values |
| Where values live | `addons/<name>/.env`, on the computer running it | Inside the install URL |
| Good for | API keys of an add-on you run for yourself, folders, backend choice | Usernames, languages, preferences; API keys of an add-on shared with others |
| In `addon.forge.json` | `sources[].needsKey` adds a line to `.env.example` | `userConfig` |

**Rule of thumb:** an add-on you run for yourself keeps everything in `.env`. Use user configuration only when each person installing it must enter something different.

## Environment variables

1. `forge new` writes `.env.example`, which lists every variable with a comment. It's committed, and holds no real values.
2. Copy it to `.env` and fill it in. Git ignores `.env`, and Docker Compose loads it automatically.
3. Read values in the add-on with `process.env.NAME`, in one place (a `src/config.js`, as in `examples/letterboxd-nl-search`), with defaults and clear startup messages when something is missing.
4. After changing `.env`, restart: `docker compose up -d`.

Never print a secret, even partly, in logs or errors. Log *that* a key is set, not its value.

## User configuration

Declare the values in `addon.forge.json`:

```json
"userConfig": [
  { "key": "username", "type": "text", "title": "Your username", "required": true },
  { "key": "language", "type": "select", "title": "Subtitle language", "options": ["fre", "eng", "spa"], "default": "fre" }
]
```

`forge new` turns this into `manifest.config` and sets `behaviorHints.configurable`, plus `configurationRequired` when a value is required ([manifest docs](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md)). Then:

- The SDK serves a **Configure page** at `/configure`. Installing from it puts the values in the URL: `https://host/<config>/manifest.json`, where `<config>` is the URL-encoded JSON of the values.
- Every handler receives them as `args.config`, e.g. `async function catalogHandler({ type, id, extra, config })`. Values from the form arrive as text: convert numbers yourself, and handle a missing or invalid `config` (the SDK passes `false` when it can't parse it).
- To test, pass the same values to the tools: `node tools/forge.js validate http://127.0.0.1:7100 --config '{"username":"test"}'` and the same for `smoke` and `install-link`. They mask the configuration in their output.

### Secrets in user configuration

The install URL contains the configuration, so **a password or API key entered there is visible to anyone who sees the link**: Stremio's add-on list, a shared screenshot, a tunnel's logs. The `password` type only hides the value while it's typed on the Configure page.

If each user must bring their own key, user configuration is still the right place. Tell them so in the README, and suggest a key with limited permissions. If the key is yours, keep it in `.env` instead.
