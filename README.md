# TvDisplay

SignalDeck Signage MVP for displaying media on all OPE TVs.

A Vercel-hosted signage dashboard and fullscreen player with shared media storage.

## What it does

- Upload images and videos into Vercel Blob storage.
- Create generated slides for quick signage tests.
- Build playlists from media assets.
- Create screen/player endpoints.
- Change a screen's assigned playlist without changing its player URL.
- Copy a fullscreen player URL for each screen.
- Run a player route that loops assigned media and can feed HDMI into a Just Add Power encoder.

For step-by-step operating instructions, see [USER_GUIDE.md](./USER_GUIDE.md).

## How to run

Open `index.html` in a browser, or serve this folder with any simple static server. Static local mode still works, but it will fall back to browser-only storage because the Vercel API routes are not running.

Example with Python:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

Or use the npm script:

```bash
npm run dev
```

## Deploy to Vercel

This project deploys to Vercel as a static site plus API routes.

Recommended flow:

```bash
git init
git add .
git commit -m "Initial SignalDeck Vercel app"
```

Then import this repository into Vercel as a static project. No build command is required, and the output directory can be left blank/default.

## Shared cloud storage

Create a Vercel Blob store in the same Vercel project. Vercel will add `BLOB_READ_WRITE_TOKEN` automatically. After the next deployment:

- `/api/state` saves media, playlists, screens, and schedules into `state/signaldeck-state.json`.
- `/api/upload` sends large media files directly from the browser to Vercel Blob.
- `/api/media` deletes removed media from Blob storage.

If the Blob store or token is missing, the dashboard shows `Local only` and falls back to the old browser-only storage path.

## Kiosk player idea

On a player mini PC, open the screen-specific URL from the Screens view in fullscreen kiosk mode.

For Chromium on Linux, the command will look like:

```bash
chromium-browser --kiosk http://localhost:5173/#/player/screen-lobby
```

## Current limitations

- There is no login/user management yet, so anyone with the dashboard URL can make changes.
- Player pages refresh shared state about once per minute, so updates are not instant.
- Video wall synchronization is not frame-accurate yet.
