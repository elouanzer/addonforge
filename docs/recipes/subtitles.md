# Subtitles

A subtitles add-on answers `/subtitles/{type}/{id}.json` with a list of subtitle files. Stremio offers them in the player for that film or episode ([defineSubtitlesHandler](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md), [Subtitle object](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md)).

```json
{ "subtitles": [{ "id": "tt0071315.fre.srt", "url": "https://…/tt0071315.fre.srt", "lang": "fre", "label": "Français" }] }
```

- `id`: unique per subtitle. `url`: **absolute** URL of an `.srt`, `.vtt`, `.ass` or `.ssa` file. `lang`: an ISO 639-2 code (`fre`, `eng`, `spa`, `ger`…). `label`: optional, shown in the subtitle picker.
- The `id` Stremio asks for is a film's IMDb id (`tt0071315`), or an episode's (`tt0108778:1:1` for season 1, episode 1).
- `addon.forge.json`: `"resources": ["subtitles"]`, `"types": ["movie", "series"]`, `"idScheme": "imdb"`. A subtitles-only add-on has no catalog.

## Subtitles from a folder of files

The user drops files into the add-on's `subtitles/` folder, named after the IMDb id:

```text
subtitles/tt0071315.fre.srt             Chinatown, French
subtitles/tt0071315.eng.srt             Chinatown, English
subtitles/tt0108778_1_1.fre.srt         Friends, season 1 episode 1 (":" becomes "_": Windows forbids ":" in file names)
subtitles/tt0071315.fre.Forced.srt      an optional label before the extension
```

The SDK's `serveHTTP` serves a folder of static files (with the same CORS headers as the add-on), so the add-on hands out its own files:

```js
// src/server.js: serve ./subtitles at /subtitles
serveHTTP(addonInterface, { port, static: '/subtitles' }).then(/* … unchanged … */);
```

`serveHTTP` refuses to start if the folder is missing: commit an empty `subtitles/.gitkeep`.

```js
// src/sources/folder.js
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(process.cwd(), 'subtitles');
const EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa']);

/**
 * Base URL Stremio reaches the add-on at. Set PUBLIC_URL when it isn't 127.0.0.1 (a tunnel,
 * a host). The last fallback is the default port in src/server.js: keep them the same.
 */
const publicUrl = () => (process.env.PUBLIC_URL || `http://127.0.0.1:${process.env.HOST_PORT || process.env.PORT || 7100}`).replace(/\/+$/, '');

/**
 * Subtitles for a video id, from files named <id>.<lang>[.<label>].<ext>.
 * @param {string} videoId e.g. "tt0071315" or "tt0108778:1:1"
 * @param {{ dir?: string, baseUrl?: string }} [options] Tests point these elsewhere.
 */
async function find(videoId, { dir = DIR, baseUrl = publicUrl() } = {}) {
  const prefix = `${videoId.replace(/:/g, '_')}.`;
  const files = await fs.promises.readdir(dir).catch(() => []);
  return files
    .filter((file) => file.startsWith(prefix))
    .map((file) => {
      const parts = file.slice(prefix.length).split('.');
      const ext = parts.pop().toLowerCase();
      const [lang, ...label] = parts;
      if (!EXTENSIONS.has(ext) || !/^[a-z]{3}$/.test(lang || '')) return null;
      return {
        id: file,
        url: `${baseUrl}/subtitles/${encodeURIComponent(file)}`,
        lang,
        ...(label.length ? { label: label.join(' ') } : {}),
      };
    })
    .filter(Boolean);
}

module.exports = { find };
```

```js
// src/addon.js
async function subtitlesHandler({ id }) {
  return { subtitles: await folder.find(id), cacheMaxAge: 10 * 60 };
}
```

With Docker, mount the folder read-only and pass the port the URLs must use, in `docker-compose.yml`:

```yaml
    environment:
      PORT: "7100"
      HOST_PORT: "${HOST_PORT:-7100}"
      PUBLIC_URL: "${PUBLIC_URL:-}"
    volumes:
      - ./subtitles:/app/subtitles:ro
```

When the add-on is reached through a tunnel or a host, set `PUBLIC_URL` in `.env` to that HTTPS address and restart, or the subtitle URLs will point at `127.0.0.1`.

## Tips

- **Encoding:** Stremio expects UTF-8. Convert older Latin-1 `.srt` files before adding them, or accents show up garbled.
- **Online sources:** a subtitles API works the same way: the source adapter calls the API for the IMDb id and maps its results to `{ id, url, lang }`. Use the subtitle URLs it gives, respect its terms and rate limits ([rate-limited-apis](rate-limited-apis.md)), and cache results ([caching](caching.md)).
- **Matching a specific file:** Stremio also sends `extra.videoHash`, `extra.videoSize` and `extra.filename` when it knows them, which subtitle APIs use to find subtitles synced to that exact video.

## Testing

- Unit test `find` against a temporary folder holding a few empty files: right language, label, episode naming, other files ignored.

  ```js
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-'));
  for (const f of ['tt0071315.fre.srt', 'tt0071315.eng.Forced.srt', 'tt0108778_1_1.fre.srt', 'tt0071315.fre.txt']) fs.writeFileSync(path.join(dir, f), '');
  const subs = await folder.find('tt0071315', { dir, baseUrl: 'http://x' });
  // → fre and eng (label "Forced"); the .txt file is ignored
  ```
- Live: `smoke` asks for subtitles for a few sample ids (Night of the Living Dead, `tt0063350`, among them). Add a file for one of them to see a non-empty answer.
