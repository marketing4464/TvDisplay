# TvDisplay

SignalDeck Signage MVP for displaying media on all OPE TVs.

A Vercel-hosted signage dashboard and fullscreen player with shared Vercel Blob storage.

## What it does

- Upload images and videos into Vercel Blob.
- Create generated slides for quick signage tests.
- Build playlists from media assets.
- Create screen/player endpoints.
- Change a screen's assigned playlist without changing its player URL.
- Copy a fullscreen player URL for each screen.
- Run a player route that loops assigned media and can feed HDMI into a Just Add Power encoder.

For step-by-step operating instructions, see [USER_GUIDE.md](./USER_GUIDE.md).

## How to run

Install dependencies, link the folder to the Vercel project, and use the npm script so the API routes are available:

```bash
npm install
vercel link
npx vercel dev
```

## Deploy to Vercel

This project deploys to Vercel as a static site plus three serverless API routes. Connect the existing `tv-display-blob` store to Production, Preview, and Development before deploying.

Recommended flow:

```bash
git init
git add .
git commit -m "Initial SignalDeck Vercel app"
```

Then import this repository into Vercel. No build command is required, and the output directory can be left blank/default.

## Shared cloud storage

This app uses the Vercel Blob store `tv-display-blob`:

- Media path: `media/`
- State path: `state/signaldeck-state.json`
- API routes: `/api/state`, `/api/upload`, and `/api/media`

Uploaded files and shared configuration are saved in Blob. Player computers keep local IndexedDB copies of downloaded media, so a playlist loop does not repeatedly transfer the same videos. If Vercel is briefly unreachable, the player uses its last saved configuration and cached media while retrying automatically.

## Kiosk player idea

On a player mini PC, open the screen-specific URL from the Screens view in fullscreen kiosk mode.

For Chromium on Linux, the command will look like:

```bash
chromium-browser --kiosk http://localhost:5173/#/player/screen-lobby
```

## Current limitations

- There is no login/user management yet, so anyone with the dashboard URL can make changes.
- Write routes do not have dashboard authentication yet; anyone with the dashboard URL can make changes.
- Player pages sync shared state in the background and apply playlist changes after the current image or video finishes.
- Video wall synchronization is not frame-accurate yet.
